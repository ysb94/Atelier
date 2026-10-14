import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Notion } from './notion.mjs'
import { settings, projectRoot, stateDir, redact } from './settings.mjs'
import { readControls } from './control.mjs'
import { acquireLock } from './store.mjs'
import { koreanTime } from './report.mjs'

export const DASHBOARD_PROPERTIES = Object.freeze({planning:'GPT 계획 상태',implementation:'Cursor 구현 상태',review:'GPT 검수 상태',heartbeat:'최근 연결'})
const stageOf = phase => ['planning'].includes(phase) ? 'planning' : ['planned','implementing'].includes(phase) ? 'implementation' : ['checking','reviewing','publishing'].includes(phase) ? 'review' : null
const text = content => ({rich_text:[{type:'text',text:{content:String(content).slice(0,1900)}}]})

// Health supplies live occupancy; the durable journal supplies each admitted
// task's pinned model. Selected settings must not impersonate an older session.
export function dashboardSnapshot({health,controls,jobs={},at=new Date()}) {
  const online=health?.tool==='atelier-ai-workflow',values=controls?.values??health?.controls??{}
  const enabled=values.enabled===true,rows={}
  const blocked=health?.admission&&!health.admission.paused?health.admission.reason:health?.problems?.length?health.problems.join(' / '):null
  for(const [stage,label] of [['planning','GPT 계획'],['implementation','Cursor 구현'],['review','GPT 검수']]) {
    const configured=stage==='implementation'?values.cursorModel:[values.gptModel,values.gptEffort].filter(Boolean).join(' / ')
    const counts=health?.pipeline?.[stage]
    const tasks=(health?.tasks??[]).filter(task=>stageOf(task.phase)===stage)
    const running=counts?.running??tasks.filter(task=>!task.waitingStage).length,waiting=counts?.waiting??tasks.filter(task=>task.waitingStage===stage).length
    const activeModels=new Map()
    for(const task of tasks.filter(task=>!task.waitingStage)) {
      const pinned=Object.values(jobs).find(job=>job.branch===task.branch)?.cycle?.settings
      const model=pinned?(stage==='implementation'?pinned.cursorModel:[pinned.gpt?.model,pinned.gpt?.effort].filter(Boolean).join(' / ')):null
      if(model)activeModels.set(model,(activeModels.get(model)??0)+1)
    }
    const modelLine=activeModels.size?[...activeModels].map(([model,n])=>`${model}${n>1?` ×${n}`:''}`).join(', '):running?`실행 모델 확인 중 (설정: ${configured||'미확인'})`:configured||'설정 확인 필요'
    const state=!online?'🔴 연결 확인 필요':running?`🟢 ${stage==='review'?'검사·검수 중':'실행 중'} ${running}개`:!controls?.ok?'🟠 설정 확인 필요':blocked?'🟠 실행 차단':!enabled?'⚪ 일시정지':waiting?'🟡 순서 대기':'🟡 대기'
    rows[stage]=`${state} · ${modelLine}${waiting?` · 대기 ${waiting}개`:''}${activeModels.size&&[...activeModels.keys()].some(model=>model!==configured)?`\n새 작업 설정: ${configured}`:''}`
    rows[stage]=rows[stage].slice(0,1200)
  }
  const active=health?.activeCount??0
  const overall=!online?`🔴 실행기 연결 확인 필요 · 자동화 설정 ${typeof values.enabled!=='boolean'?'미확인':enabled?'ON':'OFF'}`:!controls?.ok?'🟠 설정 확인 필요':blocked?'🟠 자동화 실행 차단':enabled?'🟢 자동화 켜짐 · 실행기 연결됨':`⚪ 자동화 일시정지${active?` · 진행 중 ${active}건 마무리`:''}`
  const reason=!controls?.ok?controls?.problems?.join(' / '):blocked
  const content=['자동화 실행 현황',overall,...Object.entries(rows).map(([stage,value])=>`${{planning:'GPT 계획',implementation:'Cursor 구현',review:'GPT 검수'}[stage]}: ${value}`),
    reason?`멈춘 이유: ${reason}`:null,`상태 확인: ${koreanTime(at)} (한국시간)`,
    '대기는 작업을 기다리는 상태예요. 최근 연결이 2분 넘게 갱신되지 않으면 실행기 연결을 확인해 주세요.'].filter(Boolean).join('\n').slice(0,1900)
  return {online,rows,content}
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
      const at=new Date(),snapshot=dashboardSnapshot({health,controls,jobs,at})
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
