import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Runner, verification, selectedJob } from './runner.mjs'
import { runReview, validateReview } from './reviewer.mjs'
import { createIsolatedWorkspace } from './isolation.mjs'
import { snapshot, changedPaths, readFile, digest, evidence } from './workspace.mjs'
import { projectRoot, taskFiles, inside, redact } from './settings.mjs'
import { NeedsInput } from './acp.mjs'
import { needsInputFeedback } from './feedback.mjs'

export function taskFootprint(files, root) {
  const reads=new Set([...files,'package.json','AGENTS.md'])
  for(const name of fs.readdirSync(root))if(/^tsconfig.*\.json$/.test(name))reads.add(name)
  const mapFile=path.join(root,'dev-tools/structure-map/generated/structure.json')
  if(fs.existsSync(mapFile)){
    const map=JSON.parse(fs.readFileSync(mapFile,'utf8'))
    let changed=true
    while(changed){changed=false;for(const edge of map.edges){const from=edge.from??edge.source,to=edge.to??edge.target;if(reads.has(from)&&to&&!reads.has(to)){reads.add(to);changed=true}}}
  }
  return {writes:files,reads:[...reads]}
}
export function footprintsConflict(a,b) {
  return a.writes.some(file=>b.reads.includes(file)||b.writes.includes(file))||b.writes.some(file=>a.reads.includes(file)||a.writes.includes(file))
}

function safeTarget(root,file) {
  const target=inside(root,file)
  let current=root
  for(const part of path.relative(root,target).split(path.sep)){
    current=path.join(current,part)
    try{if(fs.lstatSync(current).isSymbolicLink())throw new NeedsInput('연결된 파일 경로는 자동으로 통합하지 않습니다.')}catch(error){if(error.code!=='ENOENT')throw error}
  }
  return target
}

export class ParallelRunner {
  constructor({config,notion,store,root=projectRoot,onStatus=()=>{},cursor,review=runReview,verify=verification,plan,refreshMap,isolate=createIsolatedWorkspace}) {
    Object.assign(this,{config,notion,store,root,onStatus,cursor,review,verify,plan,refreshMap,isolate})
    this.active=new Map();this.accepted=new Map();this.scanning=false;this.stopping=false;this.integrationTail=Promise.resolve();this.recovered=false;this.pendingIntegration=null
    this.scan=null
  }
  get busy(){return this.active.size>0}
  status(){
    const tasks=[...this.active.values()].map(entry=>({slot:entry.slot,task:entry.job.task.title,...entry.status}))
    this.onStatus({state:tasks.length>1?'병렬 작업 중':tasks[0]?.state??'대기',activeCount:tasks.length,limit:this.config.maxParallelTasks??2,tasks,
      waiting:Object.values(this.store.data.jobs).filter(job=>job.phase==='waiting').map(job=>job.task.title)})
  }
  async stop(){this.stopping=true;for(const entry of this.active.values())entry.runner?.stop();await Promise.allSettled([this.scan,...[...this.active.values()].map(entry=>entry.promise)])}
  // stop() awaits the whole scan, including outbox flushes already sent to Notion.
  async tick(){
    if(this.scanning||this.stopping||this.active.size>=(this.config.maxParallelTasks??2))return
    this.scanning=true
    const run=this.scanOnce().finally(()=>{this.scanning=false;if(this.scan===run)this.scan=null})
    this.scan=run
    return run
  }
  async scanOnce(){
    if(!this.recovered){
      for(const job of Object.values(this.store.data.jobs))if(!['new','waiting','done','needs_input','superseded'].includes(job.phase)){
        const fresh=await this.notion.task(job.task.id)
        if(this.stopping)return
        if(fresh.version!==job.task.version){job.phase='superseded';this.store.save();continue}
        job.phase='needs_input';job.error='이전 실행이 중단되었습니다. 남은 변경을 확인해야 하며 편집을 자동으로 반복하지 않습니다.';this.store.save()
        this.store.enqueue(job,{state:'확인 필요',...needsInputFeedback(job.task,job.error),expectedVersion:job.task.version})
      }
      this.recovered=true
    }
    // Each active worker flushes only its own records. Idle records retry here.
    const activeIds=new Set([...this.active.values()].map(entry=>entry.job.task.id))
    const queue=await this.notion.queue(),queued=new Map(queue.map(task=>[task.id,task]))
    if(this.stopping)return
    const obsolete=event=>event.update.expectedVersion&&['확인 필요','중지','오류'].includes(event.update.state)
      &&((queued.has(event.pageId)&&queued.get(event.pageId).version!==event.update.expectedVersion)
      ||[...this.active.values()].some(entry=>entry.job.task.id===event.pageId&&entry.job.task.version!==event.update.expectedVersion))
    if(this.store.data.outbox.some(obsolete)){this.store.data.outbox=this.store.data.outbox.filter(event=>!obsolete(event));this.store.save()}
    for(const id of new Set(this.store.data.outbox.map(event=>event.pageId))){if(this.stopping)return;if(!activeIds.has(id))await this.store.flush(this.notion,id)}
    for(const job of Object.values(this.store.data.jobs).filter(job=>job.phase==='waiting')){
      if(this.stopping)return
      if((queued.has(job.task.id)&&queued.get(job.task.id).version!==job.task.version)||[...this.active.values()].some(entry=>entry.job.task.id===job.task.id&&entry.job.task.version!==job.task.version)){
        job.phase='superseded';this.store.save();continue
      }
      if(queued.has(job.task.id)||activeIds.has(job.task.id))continue
      const fresh=await this.notion.task(job.task.id)
      if(this.stopping)return
      if(!fresh.enabled||fresh.state==='중지'||fresh.version!==job.task.version||fresh.planVersion!==job.task.planVersion){
        job.phase='needs_input';job.error='대기 중 메모나 실행 설정이 변경되어 중단했습니다.';this.store.save()
        this.store.enqueue(job,{state:'확인 필요',...needsInputFeedback(job.task,job.error),expectedVersion:job.task.version});await this.store.flush(this.notion,job.task.id);continue
      }
      queue.push(fresh)
    }
    const admit=async queuedTask=>{
      const task=this.config.mode==='memo-board'?await this.notion.task(queuedTask.id):queuedTask
      if(this.stopping)return
      if(this.config.mode==='memo-board'&&(!task.enabled||task.state==='중지'||task.location!==this.config.positions.queued))return
      const key=`${task.id}:${task.version}`
      if([...this.active.values()].some(entry=>entry.job.task.id===task.id))return
      const job=selectedJob(this.store,task,this.config)
      if(['done','needs_input','superseded'].includes(job.phase))return
      if(job.phase==='waiting'&&job.waitingFootprint&&[...this.active.values()].some(entry=>entry.footprint&&footprintsConflict(job.waitingFootprint,entry.footprint)))return
      if(!['new','waiting'].includes(job.phase)){
        job.phase='needs_input';job.error='중단된 실행 기록을 확인해야 합니다. 자동으로 편집을 반복하지 않습니다.';this.store.save()
        this.store.enqueue(job,{state:'확인 필요',...needsInputFeedback(job.task,job.error),expectedVersion:task.version});await this.store.flush(this.notion,task.id);return
      }
      job.task=task;job.phase='isolating';this.store.save()
      const occupied=new Set([...this.active.values()].map(entry=>entry.slot)),slot=[1,2].find(value=>!occupied.has(value))
      const entry={job,slot,status:{state:'구조 확인'}};this.active.set(key,entry);this.status()
      entry.promise=this.launch(entry).catch(async error=>{
        if(job.phase!=='done'){
          job.phase='needs_input';job.error=redact(error.message,this.config.env);this.store.save()
          this.store.enqueue(job,{state:'확인 필요',...needsInputFeedback(job.task,job.error),expectedVersion:job.task.version})
          try{await this.store.flush(this.notion,job.task.id)}catch(publishError){console.warn('[ai-workflow] 병렬 기록 재시도',redact(publishError.message,this.config.env))}
        }
        console.warn('[ai-workflow] 병렬 작업 확인 필요',{task:job.task.title,message:redact(error.message,this.config.env)})
      }).finally(()=>{
        this.active.delete(key);this.status()
        if(!this.stopping)void this.tick().catch(error=>console.warn('[ai-workflow] 다음 병렬 작업 확인',redact(error.message,this.config.env)))
      })
    }
    for(const queuedTask of queue){
      if(this.active.size>=(this.config.maxParallelTasks??2)||this.stopping)break
      await admit(queuedTask)
    }
  }
  async launch(entry){
    const {job}=entry,runDir=this.store.runDir(job),generation=(job.workspaceGeneration??0)+1;job.workspaceGeneration=generation;this.store.save()
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-ai-task-'));job.workspaceDir=dir;this.store.save()
    const isolated=await this.mainOperation(()=>this.isolate({root:this.root,dir}))
    entry.isolated=isolated
    const options={config:this.config,notion:this.notion,store:this.store,root:isolated.root,
      beforeImplementation:async({task,files})=>{
        const footprint=taskFootprint(files,isolated.root);if(task.executionKind==='verification')footprint.writes=[];job.waitingFootprint=footprint
        if([...this.active.values()].some(other=>other!==entry&&other.footprint&&footprintsConflict(footprint,other.footprint)))return false
        entry.footprint=footprint
        const current=await snapshot(this.root),changed=changedPaths(isolated.seed.all,current)
        const pending=this.pendingIntegration
        const unexpected=changed.filter(file=>(!this.accepted.has(file)||(current[file]??null)!==this.accepted.get(file))&&(!pending?.has(file)||(current[file]??null)!==pending.get(file)))
        if(unexpected.length)throw new NeedsInput('준비 중 개발 파일이 변경되었습니다. 사용자 변경을 보존하고 중단합니다.')
        if(pending&&changed.some(file=>pending.has(file)))return false
        if(changed.some(file=>footprint.reads.includes(file)||footprint.writes.includes(file)))return false
        return true
      },verify:this.verify,review:args=>this.integratedReview(entry,args),onStatus:value=>{entry.status=value;this.status()}}
    for(const key of ['cursor','plan','refreshMap'])if(this[key])options[key]=this[key]
    entry.runner=new Runner(options)
    if(this.stopping){job.phase='waiting';this.store.save();return}
    await entry.runner.execute(job)
  }
  async integratedReview(entry,args){
    return this.mainOperation(()=>this.integrate(entry,args))
  }
  async mainOperation(run){
    const result=this.integrationTail.then(run,run);this.integrationTail=result.catch(()=>{})
    return result
  }
  async integrate(entry,args){
    const {job,isolated,footprint}=entry,{task,signal,runDir}=args
    await entry.runner.assertCurrent(task)
    if(signal?.aborted)throw new NeedsInput('통합 전에 작업이 중지되었습니다.')
    const before=await snapshot(this.root),changed=changedPaths(isolated.seed.all,before)
    if(changed.some(file=>footprint.reads.includes(file)||footprint.writes.includes(file)||!this.accepted.has(file)||(before[file]??null)!==this.accepted.get(file)))throw new NeedsInput('다른 변경과 겹쳐 자동 통합을 중단했습니다. 기존 파일은 보존했습니다.')
    const files=taskFiles(task.files),baseline={all:before,contents:Object.fromEntries(files.map(file=>[file,readFile(this.root,file)]))}
    const entries=args.evidence.changes.map(change=>({file:change.file,before:baseline.contents[change.file],after:readFile(isolated.root,change.file)}))
    if(!entries.length&&task.executionKind!=='verification')throw new NeedsInput('실제 변경이 없어 완료할 수 없습니다.')
    const journalFile=path.join(runDir,`integration-${job.attempt}.json`),journal={phase:'prepared',entries,at:new Date().toISOString()}
    fs.writeFileSync(journalFile,JSON.stringify(journal))
    this.pendingIntegration=new Map(entries.map(item=>[item.file,item.after===null?null:digest(item.after)]))
    let applied
    try{
      for(const item of entries){
        const target=safeTarget(this.root,item.file)
        if(readFile(this.root,item.file)!==item.before)throw new NeedsInput('통합 직전 파일이 변경되었습니다.')
        if(item.after===null){if(fs.existsSync(target))fs.unlinkSync(target)}else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,item.after,'utf8')}
        item.applied=true;fs.writeFileSync(journalFile,JSON.stringify(journal))
      }
      applied=await snapshot(this.root)
      if(changedPaths(before,applied).some(file=>!entries.some(item=>item.file===file)))throw new NeedsInput('통합 중 다른 개발 파일이 변경되었습니다.')
      const combinedDir=path.join(runDir,'combined');fs.mkdirSync(combinedDir,{recursive:true})
      const proof=await evidence(this.root,baseline,files,combinedDir)
      if(proof.outside.length)throw new NeedsInput('통합 검토 범위 밖 변경이 감지되었습니다.')
      const config={...this.config,verificationScripts:[...new Set([...(this.config.verificationScripts??[]),...(task.verificationScripts??[])])]}
      const checks=await this.verify(config,this.root,signal)
      fs.writeFileSync(path.join(runDir,`combined-checks-${job.attempt}.json`),JSON.stringify(checks,null,2))
      if(!checks.length||checks.some(check=>!check.passed))throw new NeedsInput('개발 화면에 합친 뒤 확인 검사를 통과하지 못했습니다.')
      const review=validateReview(await this.review({...args,config,root:this.root,evidence:proof,checks}),{requireReport:this.config.mode==='memo-board'})
      if(this.config.mode==='memo-board'&&review.decision==='pass'&&review.report.deployment!==(task.executionKind==='verification'?'verification':'development'))throw new NeedsInput('완료 보고서의 적용 상태가 실제 작업 종류와 다릅니다.')
      await entry.runner.assertCurrent(task)
      if(signal?.aborted||changedPaths(applied,await snapshot(this.root)).length)throw new NeedsInput('통합 검토 중 다른 변경이 감지되었거나 작업이 중지되었습니다.')
      if(review.decision!=='pass'){this.rollback(entries);journal.phase='rolled_back';fs.writeFileSync(journalFile,JSON.stringify(journal));return review}
      for(const item of entries)this.accepted.set(item.file,item.after===null?null:digest(item.after))
      journal.phase='accepted';journal.reviewedAt=new Date().toISOString();fs.writeFileSync(journalFile,JSON.stringify(journal))
      return review
    }catch(error){
      try{this.rollback(entries);journal.phase='rolled_back'}catch(rollbackError){journal.phase='needs_input';journal.rollbackError=rollbackError.message;console.warn('[ai-workflow] 사용자 변경 보존',rollbackError.message)}
      journal.error=error.message;fs.writeFileSync(journalFile,JSON.stringify(journal));throw error
    }finally{this.pendingIntegration=null}
  }
  rollback(entries){
    let changed=false
    for(const item of entries.filter(item=>item.applied)){
      const current=readFile(this.root,item.file)
      if(current!==item.after){changed=true;continue}
      const target=safeTarget(this.root,item.file)
      if(item.before===null){if(fs.existsSync(target))fs.unlinkSync(target)}else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,item.before,'utf8')}
    }
    if(changed)throw new NeedsInput('사용자가 통합 파일을 수정했습니다. 해당 수정은 되돌리지 않았습니다.')
  }
}
