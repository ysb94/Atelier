import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export class Store {
  constructor(dir) {
    this.dir = dir; fs.mkdirSync(dir, { recursive: true }); this.file = path.join(dir,'state.json')
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file,'utf8')) : { jobs: {}, outbox: [] }
  }
  save() {
    const temp = `${this.file}.${randomUUID()}.tmp`
    fs.writeFileSync(temp, JSON.stringify(this.data,null,2))
    // Windows/OneDrive can briefly hold the destination open. Keep the old
    // journal intact and retry replacement; never unlink it before a rename.
    for(let attempt=0;attempt<7;attempt++) {
      try {
        fs.renameSync(temp,this.file)
        if(attempt)console.info('[ai-workflow] 실행 기록 교체 재시도 성공',{attempts:attempt+1})
        return
      }catch(error) {
        if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt===6)throw error
        if(attempt===0)console.warn('[ai-workflow] 실행 기록 파일 잠금; 교체 재시도',{code:error.code})
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30*(attempt+1))
      }
    }
  }
  job(task, {retry=false} = {}) {
    const key = `${task.id}:${task.version}`
    const previous=this.data.jobs[key]
    if(retry&&previous&&['done','needs_input','superseded'].includes(previous.phase)) {
      // Moving a terminal card back to the queue explicitly requests another
      // investigation. Preserve its journal; never reuse its prepared plan.
      const historyKey=`${key}:run:${previous.runId}`
      this.data.jobs[historyKey]={...previous,key:historyKey}
      delete this.data.jobs[key]
    }
    if (!this.data.jobs[key]) this.data.jobs[key] = { key, task, attempt: 0, phase: 'new', runId: randomUUID(), createdAt: new Date().toISOString() }
    this.save(); return this.data.jobs[key]
  }
  enqueue(job, update) {
    this.data.outbox.push({ pageId: job.task.id, update: { ...update, eventId: `${job.runId}:${this.data.outbox.length}:${randomUUID()}` } }); this.save()
  }
  async flush(notion, pageId) {
    const run=async()=>{
    for (;;) {
      const index=this.data.outbox.findIndex(event=>!pageId||event.pageId===pageId)
      if(index<0)return
      const event = this.data.outbox[index]
      try {await notion.publish(event.pageId, event.update)}catch(error){
        // A confirmed cancellation is discarded and delivered to the runner;
        // connection failures retain the event for a later safe retry.
        if(error.discardUpdate){this.data.outbox.splice(index,1);this.save()}
        throw error
      }
      this.data.outbox.splice(index,1); this.save()
    }
    }
    const result=(this.flushTail??Promise.resolve()).then(run,run)
    this.flushTail=result.catch(()=>{})
    return result
  }
  runDir(job) { const dir = path.join(this.dir,'runs',job.runId); fs.mkdirSync(dir,{recursive:true}); return dir }
}

export function acquireLock(dir) {
  fs.mkdirSync(dir,{recursive:true}); const file=path.join(dir,'manager.lock')
  const claim = () => { const fd=fs.openSync(file,'wx'); fs.writeFileSync(fd,String(process.pid)); fs.closeSync(fd) }
  try { claim() } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid=Number(fs.readFileSync(file,'utf8')); let live=true
    try { process.kill(pid,0) } catch (probe) { if(probe.code==='ESRCH')live=false; else throw probe }
    if(live)throw new Error('이 프로젝트의 자동화 관리자가 이미 실행 중입니다.')
    fs.unlinkSync(file); claim()
  }
  return () => { if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===String(process.pid)) fs.unlinkSync(file) }
}
