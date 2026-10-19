import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Notion } from './notion.mjs'
import { settings, projectRoot, stateDir, redact } from './settings.mjs'
import { readControls } from './control.mjs'
import { acquireLock } from './store.mjs'
import { koreanTime } from './report.mjs'

export const DASHBOARD_PROPERTIES = Object.freeze({gpt1:'GPT 1 상태',gpt2:'GPT 2 상태',planning:'GPT 계획 상태',implementation:'Cursor 구현 상태',cursor1:'Cursor 1 상태',cursor2:'Cursor 2 상태',review:'GPT 검수 상태',heartbeat:'최근 연결'})
const stageOf = phase => ['planning'].includes(phase) ? 'planning' : ['planned','implementing'].includes(phase) ? 'implementation' : ['checking','reviewing','publishing'].includes(phase) ? 'review' : null
const text = content => ({rich_text:[{type:'text',text:{content:String(content).slice(0,1900)}}]})
// Durable phases can lag permit release or precede acquisition. Prefer the
// actual stage permit published by the manager, with legacy health fallback.
const ownsStage = (task,stage) => Object.hasOwn(task,'runningStage') ? task.runningStage===stage : stageOf(task.phase)===stage&&!task.waitingStage

// Slot numbers stay attached to the same active branch across polling order
// changes. Queued work and work already in GPT review do not occupy Cursor.
export function cursorSlots(health,previous=[]) {
  if(health?.tool!=='atelier-ai-workflow')return previous
  const candidates=(health.tasks??[]).filter(task=>ownsStage(task,'implementation'))
    .slice(0,Math.min(2,health.pipeline?.implementation?.running??2))
  const active=new Set(candidates.map(task=>task.branch))
  const slots=Array.from({length:2},(_,i)=>active.has(previous[i])?previous[i]:null)
  for(const task of candidates)if(!slots.includes(task.branch)){
    const empty=slots.indexOf(null)
    if(empty>=0)slots[empty]=task.branch
  }
  return slots
}

// Health supplies live occupancy; the durable journal supplies each admitted
// task's pinned model. Selected settings must not impersonate an older session.
export function dashboardSnapshot({health,controls,jobs={},at=new Date(),previousCursorSlots=[],gptWorkerLimit=health?.gptWorkers?.limit??0}) {
  const online=health?.tool==='atelier-ai-workflow',values=controls?.values??health?.controls??{}
  const enabled=values.enabled===true,rows={}
  const blocked=health?.admission&&!health.admission.paused?health.admission.reason:health?.problems?.length?health.problems.join(' / '):null
  for(const [stage,label] of [['planning','GPT 계획'],['implementation','Cursor 구현'],['review','GPT 검수']]) {
    const configured=stage==='implementation'?values.cursorModel:[values.gptModel,values.gptEffort].filter(Boolean).join(' / ')
    const counts=health?.pipeline?.[stage]
    const tasks=(health?.tasks??[]).filter(task=>stageOf(task.phase)===stage)
    const running=counts?.running??tasks.filter(task=>!task.waitingStage).length,waiting=counts?.waiting??tasks.filter(task=>task.waitingStage===stage).length
    const activeModels=new Map()
    for(const task of (health?.tasks??[]).filter(task=>ownsStage(task,stage)).slice(0,running)) {
      const pinned=Object.values(jobs).find(job=>job.branch===task.branch)?.cycle?.settings
      const model=pinned?(stage==='implementation'?pinned.cursorModel:[pinned.gpt?.model,pinned.gpt?.effort].filter(Boolean).join(' / ')):null
      if(model)activeModels.set(model,(activeModels.get(model)??0)+1)
    }
    const modelLine=activeModels.size?[...activeModels].map(([model,n])=>`${model}${n>1?` ×${n}`:''}`).join(', '):running?`실행 모델 확인 중 (설정: ${configured||'미확인'})`:configured||'설정 확인 필요'
    const state=!online?'🔴 연결 확인 필요':running?`🟢 ${stage==='review'?'검사·검수 중':'실행 중'} ${running}개`:!controls?.ok?'🟠 설정 확인 필요':blocked?'🟠 실행 차단':!enabled?'⚪ 일시정지':waiting?'🟡 순서 대기':'🟡 대기'
    rows[stage]=`${state} · ${modelLine}${waiting?` · 대기 ${waiting}개`:''}${activeModels.size&&[...activeModels.keys()].some(model=>model!==configured)?`\n새 작업 설정: ${configured}`:''}`
    rows[stage]=rows[stage].slice(0,1200)
  }
  for(let i=1;i<=gptWorkerLimit;i++) {
    const task=online?(health.tasks??[]).find(task=>task.gptSlot===i&&!task.waitingStage):null
    const pinned=task?Object.values(jobs).find(job=>job.branch===task.branch)?.cycle?.settings.gpt:null
    const model=task?(pinned?[pinned.model,pinned.effort].join(' / '):'실행 모델 확인 중'):[values.gptModel,values.gptEffort].filter(Boolean).join(' / ')
    const state=!online?'🔴 연결 확인 필요':task?(task.gptStage==='review'||stageOf(task.phase)==='review'?'🟢 검사·검수 중':'🟢 계획 중'):!controls?.ok?'🟠 설정 확인 필요':blocked?'🟠 실행 차단':!enabled?'⚪ 일시정지':'🟡 대기'
    rows[`gpt${i}`]=`${state} · ${model||'설정 확인 필요'}${task?`\n업무: ${String(task.task??'업무 확인 중').replace(/\s+/g,' ').slice(0,140)}`:' · 맡은 업무 없음'}`
  }
  const slots=cursorSlots(health,previousCursorSlots)
  for(let i=0;i<2;i++) {
    const task=online?(health.tasks??[]).find(task=>task.branch===slots[i]&&ownsStage(task,'implementation')):null
    const job=task?Object.values(jobs).find(job=>job.branch===task.branch):null
    const model=task?(job?.cycle?.settings?.cursorModel??'실행 모델 확인 중'):(values.cursorModel??'설정 확인 필요')
    const state=!online?'🔴 연결 확인 필요':task?'🟢 작업 중':!controls?.ok?'🟠 설정 확인 필요':blocked?'🟠 실행 차단':!enabled?'⚪ 일시정지':'🟡 대기'
    rows[`cursor${i+1}`]=`${state} · ${model}${task?`\n업무: ${String(task.task??'업무 확인 중').replace(/\s+/g,' ').slice(0,140)}\n진행: ${task.state??'구현 중'}`:' · 맡은 업무 없음'}`
  }
  const active=health?.activeCount??0
  const overall=!online?`🔴 실행기 연결 확인 필요 · 자동화 설정 ${typeof values.enabled!=='boolean'?'미확인':enabled?'ON':'OFF'}`:!controls?.ok?'🟠 설정 확인 필요':blocked?'🟠 자동화 실행 차단':enabled?'🟢 자동화 켜짐 · 실행기 연결됨':`⚪ 자동화 일시정지${active?` · 진행 중 ${active}건 마무리`:''}`
  const reason=!controls?.ok?controls?.problems?.join(' / '):blocked
  const content=['자동화 실행 현황',overall,...(gptWorkerLimit?[...Array.from({length:gptWorkerLimit},(_,i)=>`gpt${i+1}`),'cursor1','cursor2']:['planning','cursor1','cursor2','review']).map(stage=>`${{gpt1:'GPT 1',gpt2:'GPT 2',planning:'GPT 계획',cursor1:'Cursor 1',cursor2:'Cursor 2',review:'GPT 검수'}[stage]}: ${rows[stage]}`),
    health?.pipeline?.implementation?.waiting?`Cursor 지시서 대기: ${health.pipeline.implementation.waiting}건`:null,
    reason?`멈춘 이유: ${reason}`:null,`상태 확인: ${koreanTime(at)} (한국시간)`,
    '대기는 작업을 기다리는 상태예요. 최근 연결이 2분 넘게 갱신되지 않으면 실행기 연결을 확인해 주세요.'].filter(Boolean).join('\n').slice(0,1900)
  return {online,rows,content,cursorSlots:slots}
}

export async function writeDashboard(notion,config,snapshot,at=new Date()) {
  const blockId=config.v2?.statusDashboard?.blockId
  if(!blockId)return
  const properties=Object.fromEntries(Object.entries(snapshot.rows).map(([stage,value])=>[DASHBOARD_PROPERTIES[stage],text(value)]))
  if(snapshot.online)properties[DASHBOARD_PROPERTIES.heartbeat]={date:{start:at.toISOString()}}
  await notion.api(`pages/${config.v2.controlPageId}`,'PATCH',{properties})
  await notion.api(`blocks/${blockId}`,'PATCH',{callout:{rich_text:text(snapshot.content).rich_text}})
}

export function startStatusDashboard({config=settings(),notion=new Notion(config),fetcher=fetch,journalFile=path.join(stateDir,'state.json')}={}) {
  if(!config.v2?.statusDashboard?.blockId)return null
  let release
  try{release=acquireLock(path.join(stateDir,'status-dashboard'))}
  catch(error){if(/이미 실행 중/.test(error.message))return null;throw error}
  let stopped=false,pending=null
  const slotsFile=path.join(stateDir,'status-dashboard','cursor-slots.json')
  let previousCursorSlots=fs.existsSync(slotsFile)?JSON.parse(fs.readFileSync(slotsFile,'utf8')):[]
  const tick=()=>{
    if(stopped||pending)return pending
    pending=(async()=>{
      let health=null,controls
      try {
        const response=await fetcher(`http://127.0.0.1:${config.port}/health`,{signal:AbortSignal.timeout(3000)})
        if(response.ok){const value=await response.json();if(value.tool==='atelier-ai-workflow'&&value.root===projectRoot)health=value}
      } catch { /* The dashboard reports an unavailable manager explicitly. */ }
      try{controls=await readControls(notion,config)}
      catch(error){controls={ok:false,problems:[redact(error.message,config.env)]}}
      let jobs={}
      if(fs.existsSync(journalFile))jobs=JSON.parse(fs.readFileSync(journalFile,'utf8')).v2?.jobs??{}
      const at=new Date(),snapshot=dashboardSnapshot({health,controls,jobs,at,previousCursorSlots,gptWorkerLimit:config.v2?.pipeline?.gptWorkers??0})
      if(snapshot.online){previousCursorSlots=snapshot.cursorSlots;fs.writeFileSync(slotsFile,JSON.stringify(previousCursorSlots))}
      await writeDashboard(notion,config,snapshot,at)
    })().catch(error=>console.warn('[ai-workflow] 노션 상태 표시 갱신 실패',redact(error.message,config.env))).finally(()=>{pending=null})
    return pending
  }
  const timer=setInterval(tick,30000)
  void tick()
  return {tick,stop:async()=>{stopped=true;clearInterval(timer);await pending;release()}}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const monitor=startStatusDashboard()
  if(monitor)for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void monitor.stop()})
}
