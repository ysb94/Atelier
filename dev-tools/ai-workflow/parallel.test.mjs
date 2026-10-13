import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ParallelRunner,footprintsConflict} from './parallel.mjs'
import {Store} from './store.mjs'
import {runCommand} from './process.mjs'
import {Notion} from './notion.mjs'
import {needsInputFeedback} from './feedback.mjs'

const pass={decision:'pass',summary:'확인 완료',criteriaResults:[{criterion:'실제 변경',passed:true,evidence:'파일과 검사 기록'}],issues:[],nextPrompt:'',report:null}
async function fixture(t,files=['a.md','b.md','c.md']){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-parallel-test-'))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 await runCommand('git',['init','--quiet'],{cwd:root})
 fs.writeFileSync(path.join(root,'.gitignore'),'.state/\nnode_modules/\n')
 fs.writeFileSync(path.join(root,'package.json'),'{}')
 for(const file of new Set(files))fs.writeFileSync(path.join(root,file),'사용자 기존 내용')
 const tasks=files.map((file,i)=>({id:'job-'+i,version:'v1',enabled:true,title:'작업 '+i,request:'문구 정리',criteria:'기존 내용 보존',files:file}))
 const updates=[],store=new Store(path.join(root,'.state')),notion={queue:async()=>tasks,task:async id=>({...tasks.find(task=>task.id===id)}),publish:async(id,u)=>{updates.push({id,...u})}}
 const config={maxParallelTasks:2,maxAttempts:2,env:{},verificationScripts:[]}
 const statuses=[],runner=new ParallelRunner({root,notion,store,config,refreshMap:async()=>{},verify:async()=>[{name:'actual-fixture',passed:true,output:'실제 파일 읽기'}],review:async()=>pass,onStatus:s=>statuses.push(s)})
 t.after(async()=>runner.stop())
 return{root,runner,tasks,store,updates,statuses}
}
async function settle(f,count){
 const timeout=Date.now()+10000
 while(Date.now()<timeout){await f.runner.tick();await new Promise(resolve=>setTimeout(resolve,5));if(Object.values(f.store.data.jobs).filter(job=>['done','needs_input','superseded'].includes(job.phase)).length>=count&&!f.runner.busy)return}
 assert.fail('작업이 끝나지 않음: '+JSON.stringify(Object.values(f.store.data.jobs).map(job=>({phase:job.phase,error:job.error}))))
}
test('write/read dependencies block overlap while shared reads remain independent',()=>{
 assert.equal(footprintsConflict({writes:['a'],reads:['a','common']},{writes:['b'],reads:['b','common']}),false)
 assert.equal(footprintsConflict({writes:['a'],reads:['a']},{writes:['b'],reads:['a','b']}),true)
})
test('two real workers overlap in separate roots; a third waits; integration and reports finish once',async t=>{
 const f=await fixture(t);let running=0,peak=0,reviews=0,reviewPeak=0,reviewRunning=0
 const roots=[]
 f.runner.cursor=async({root,files,prompt})=>{
  running++;peak=Math.max(peak,running);roots.push(root);assert.ok(prompt.includes(root));assert.ok(!prompt.includes('작업 폴더: '+f.root+'.'))
  assert.equal(fs.readFileSync(path.join(f.root,files[0]),'utf8'),'사용자 기존 내용')
  fs.writeFileSync(path.join(root,files[0]),'완료 '+files[0]);await new Promise(resolve=>setTimeout(resolve,30));running--;return{report:'완료'}
 }
 f.runner.review=async({root,task,evidence})=>{reviewRunning++;reviewPeak=Math.max(reviewPeak,reviewRunning);reviews++;assert.equal(root,f.root);assert.equal(evidence.outside.length,0);assert.ok(fs.readFileSync(path.join(root,task.files),'utf8').startsWith('완료'));await new Promise(resolve=>setTimeout(resolve,10));reviewRunning--;return pass}
 await settle(f,3)
 assert.equal(peak,2);assert.equal(reviewPeak,1);assert.equal(reviews,3);assert.equal(new Set(roots).size,3)
 assert.equal(f.updates.filter(u=>u.state==='완료').length,3)
 for(const file of ['a.md','b.md','c.md'])assert.equal(fs.readFileSync(path.join(f.root,file),'utf8'),'완료 '+file)
 assert.ok(f.statuses.some(s=>s.activeCount===2));assert.ok(f.statuses.every(s=>s.activeCount<=2))
})
test('overlapping jobs are reseeded after the first accepted change and never edit together',async t=>{
 const f=await fixture(t,['a.md','a.md']);let active=0,peak=0,works=0
 f.runner.cursor=async({root,files})=>{active++;peak=Math.max(peak,active);const prior=fs.readFileSync(path.join(root,files[0]),'utf8');works++;fs.writeFileSync(path.join(root,files[0]),prior+' '+works);await new Promise(resolve=>setTimeout(resolve,25));active--;return{report:'완료'}}
 await settle(f,2)
 assert.equal(peak,1);assert.equal(works,2);assert.equal(fs.readFileSync(path.join(f.root,'a.md'),'utf8'),'사용자 기존 내용 1 2')
 assert.equal(f.updates.filter(u=>u.state==='완료').length,2)
})
test('manual edits before integration are preserved and not completed',async t=>{
 const f=await fixture(t,['a.md'])
 f.runner.cursor=async({root})=>{fs.writeFileSync(path.join(root,'a.md'),'워커 변경');fs.writeFileSync(path.join(f.root,'a.md'),'사용자 새 변경');return{report:'완료'}}
 await settle(f,1)
 assert.equal(fs.readFileSync(path.join(f.root,'a.md'),'utf8'),'사용자 새 변경');assert.equal(f.updates.filter(u=>u.state==='완료').length,0)
})
test('failed combined verification restores only the candidate and cannot mark complete',async t=>{
 const f=await fixture(t,['a.md']);f.runner.cursor=async({root})=>{fs.writeFileSync(path.join(root,'a.md'),'후보');return{report:'완료'}}
 f.runner.verify=async(config,root)=>[{name:'read-fixture',passed:root!==f.root,output:'메인 통합 실패'}]
 await settle(f,1);assert.equal(fs.readFileSync(path.join(f.root,'a.md'),'utf8'),'사용자 기존 내용');assert.equal(f.updates.filter(u=>u.state==='완료').length,0)
})
test('independent review revisions roll back the main candidate and edit only the isolated worker',async t=>{
 const f=await fixture(t,['a.md']);let works=0,reviews=0
 f.runner.cursor=async({root})=>{works++;fs.writeFileSync(path.join(root,'a.md'),works===1?'수정 필요':'완료');return{report:'완료'}}
 f.runner.review=async()=>{reviews++;return reviews===1?{...pass,decision:'revise',nextPrompt:'수정 필요를 완료로 바꾼다',issues:['설명 부족']}:pass}
 await settle(f,1);assert.equal(works,2);assert.equal(reviews,2);assert.equal(fs.readFileSync(path.join(f.root,'a.md'),'utf8'),'완료')
})
test('a manual edit during combined review is never rolled back',async t=>{
 const f=await fixture(t,['a.md']);f.runner.cursor=async({root})=>{fs.writeFileSync(path.join(root,'a.md'),'후보');return{report:'완료'}}
 f.runner.review=async()=>{fs.writeFileSync(path.join(f.root,'a.md'),'사용자 검토 중 변경');return pass}
 await settle(f,1);assert.equal(fs.readFileSync(path.join(f.root,'a.md'),'utf8'),'사용자 검토 중 변경');assert.equal(f.updates.filter(u=>u.state==='완료').length,0)
})
test('cancelled tasks cannot integrate isolated edits',async t=>{
 const f=await fixture(t,['a.md']);f.runner.cursor=async({root})=>{fs.writeFileSync(path.join(root,'a.md'),'후보');f.tasks[0].enabled=false;return{report:'완료'}}
 await settle(f,1);assert.equal(fs.readFileSync(path.join(f.root,'a.md'),'utf8'),'사용자 기존 내용');assert.equal(f.updates.filter(u=>u.state==='완료').length,0)
})
test('concurrent Notion flushes send each event once and keep cancellation scoped to its worker',async t=>{
 const f=await fixture(t,['a.md','b.md']),a=f.store.job(f.tasks[0]),b=f.store.job(f.tasks[1]);f.store.enqueue(a,{state:'작업 중'});f.store.enqueue(b,{state:'작업 중'})
 const calls=[],notion={publish:async id=>{calls.push(id);await new Promise(resolve=>setTimeout(resolve,5));if(id===a.task.id)throw Object.assign(Error('취소'),{discardUpdate:true})}}
 const outcomes=await Promise.allSettled([f.store.flush(notion,a.task.id),f.store.flush(notion,b.task.id)])
 assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'fulfilled');assert.deepEqual(calls,[a.task.id,b.task.id]);assert.equal(f.store.data.outbox.length,0)
})

test('restart marks a previously working card as interrupted even when it is absent from the todo queue',async t=>{
 const f=await fixture(t,['a.md']);const job=f.store.job(f.tasks[0]);job.phase='cursor';f.store.save();f.runner.notion.queue=async()=>[]
 let edits=0;f.runner.cursor=async()=>{edits++}
 await f.runner.tick();assert.equal(job.phase,'needs_input');assert.equal(edits,0);assert.equal(f.updates.at(-1).state,'확인 필요')
})

test('parallel manager spaces Notion requests to avoid exceeding the shared connection quota',async()=>{
 const starts=[],client=new Notion({maxParallelTasks:2,env:{NOTION_TOKEN:'fixture'}},async()=>{starts.push(Date.now());return{ok:true,json:async()=>({})}})
 await Promise.all([client.api('pages/one'),client.api('pages/two')]);assert.equal(starts.length,2);assert.ok(starts[1]-starts[0]>=300)
})

test('older waiting, interrupted and pending questions cannot replace a reselected newer task version',async t=>{
 for(const oldPhase of ['waiting','cursor']){
  const f=await fixture(t,['a.md']),old=f.store.job(f.tasks[0]);old.phase=oldPhase;f.store.enqueue(old,{state:'확인 필요',expectedVersion:'v1',summary:'오래된 질문'});f.store.save()
  f.tasks[0]={...f.tasks[0],version:'v2'}
  f.runner.cursor=async({root})=>{fs.writeFileSync(path.join(root,'a.md'),'새 버전 완료');return{report:'완료'}}
  await settle(f,2)
  assert.equal(old.phase,'superseded');assert.equal(f.updates.filter(u=>u.state==='확인 필요').length,0);assert.equal(f.updates.filter(u=>u.state==='완료').length,1)
 }
})

test('a dangling symlink introduced at a new target cannot write outside the main project',async t=>{
 const f=await fixture(t,['new.md']),outside=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-link-target-'))
 t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.unlinkSync(path.join(f.root,'new.md'))
 const target=path.join(outside,'escaped.md')
 f.runner.cursor=async({root})=>{fs.writeFileSync(path.join(root,'new.md'),'워커 변경');fs.symlinkSync(target,path.join(f.root,'new.md'));return{report:'완료'}}
 await settle(f,1);assert.equal(fs.existsSync(target),false);assert.ok(fs.lstatSync(path.join(f.root,'new.md')).isSymbolicLink());assert.equal(f.updates.filter(u=>u.state==='완료').length,0)
})

test('a slower memo investigation waits for an in-flight integration without treating it as a user edit',async t=>{
 const f=await fixture(t,['a.md','b.md']);let applied,release
 const whenApplied=new Promise(resolve=>{applied=resolve}),continueReview=new Promise(resolve=>{release=resolve})
 fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify({scripts:{'verify:fixture':'node check.mjs'}}))
 for(const task of f.tasks){task.source={area:'공용',screen:'메모',body:'독립 문구 작업'};task.planVersion='unprepared'}
 f.runner.config.mode='memo-board';f.runner.notion.savePlan=async(id,plan)=>{Object.assign(f.tasks.find(task=>task.id===id),{request:plan.request,criteria:plan.criteria,files:plan.files.join('\n'),planVersion:'prepared'})}
 f.runner.plan=async({task})=>{if(task.id==='job-1'){await whenApplied;release()}return{decision:'execute',executionKind:'implementation',request:task.request,criteria:task.criteria,files:[task.files],verificationScripts:['verify:fixture'],reason:'실제 임시 파일'}}
 f.runner.cursor=async({root,files})=>{fs.writeFileSync(path.join(root,files[0]),'완료 '+files[0]);return{report:'완료'}}
 f.runner.verify=async(config,root)=>{if(root===f.root&&fs.readFileSync(path.join(root,'a.md'),'utf8').startsWith('완료')&&!fs.readFileSync(path.join(root,'b.md'),'utf8').startsWith('완료')){applied();await continueReview}return[{name:'read-fixture',passed:true,output:'실제 임시 파일 읽기'}]}
 const report={deployment:'development',location:'공용 → 메모',summary:'임시 문구를 정리했습니다.',changes:['임시 파일 문구를 바꿨습니다.'],howToUse:'별도 사용자 조작은 필요 없습니다.',checked:['임시 파일 문구를 확인했습니다.'],remaining:'개발 환경의 임시 검사입니다.'}
 f.runner.review=async()=>({...pass,report})
 await settle(f,2);assert.equal(f.updates.filter(u=>u.state==='완료').length,2);assert.equal(f.updates.filter(u=>u.state==='확인 필요').length,0)
})

test('input feedback explains policy, actual screen checks and connection failures without raw development logs',()=>{
 const task={title:'작업 요청 이미지 크기 통일'}
 const policy=needsInputFeedback(task,'회사 정책 미정','어떤 직책을 출퇴근 기록에서 제외하나요?')
 assert.match(policy.summary,/회사에서 정해야/);assert.match(policy.question,/어떤 직책/);assert.match(policy.question,/내 답변/)
 const screen=needsInputFeedback(task,'총 3회 후 실제 로그인 브라우저 증거 부족: src/App.tsx Codex 검토')
 assert.match(screen.summary,/실제 로그인한 화면/);assert.match(screen.question,/화면·계정·결과/);assert.match(screen.question,/이미지 크기/);assert.doesNotMatch(screen.summary,/src\/|Codex/)
 const connection=needsInputFeedback(task,'명령 실패 (1): Selected model is at capacity. raw JSON')
 assert.match(connection.summary,/실행 응답/);assert.doesNotMatch(connection.summary,/raw JSON|at capacity/)
})

test('interrupted task recovery retries after a transient source lookup failure',async t=>{
 const f=await fixture(t,['a.md']),job=f.store.job(f.tasks[0]);job.phase='cursor';f.store.save();f.runner.notion.queue=async()=>[]
 const read=f.runner.notion.task;let calls=0
 f.runner.notion.task=async(...args)=>{if(calls++===0)throw Error('일시 조회 실패');return read(...args)}
 await assert.rejects(f.runner.tick(),/일시 조회 실패/);await f.runner.tick();assert.equal(job.phase,'needs_input');assert.equal(calls,2)
})

test('a manager status write during memo reads retries a fresh snapshot instead of asking the user for changes',async()=>{
 let reads=0
 const page={id:'memo',last_edited_time:'first',properties:{메모:{title:[{plain_text:'기한 입력'}]},위치:{select:{name:'자동화 작업 중'}},화면:{select:{name:'작업 요청'}},영역:{select:{name:'공용'}}}}
 const config={mode:'memo-board',positions:{queued:'자동화 할 일',working:'자동화 작업 중'},properties:{title:'메모',state:'자동화 단계',location:'위치',screen:'화면',area:'영역'},env:{NOTION_TOKEN:'fixture'}}
 const n=new Notion(config,async url=>({ok:true,json:async()=>{if(url.includes('/children'))return{results:[],has_more:false};reads++;if(reads>=2){page.last_edited_time='second';page.properties['자동화 단계']={select:{name:'작업 중'}}}return structuredClone(page)}}))
 const task=await n.task('memo');assert.equal(task.title,'기한 입력');assert.equal(task.state,'작업 중');assert.equal(reads,4)
})
