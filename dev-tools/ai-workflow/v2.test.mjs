import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GeneratedBlockLedger, stampCallout } from './generated-blocks.mjs'
import { Notion } from './notion.mjs'
import { Board } from './board.mjs'
import { Orchestrator,readyForCursor } from './orchestrator.mjs'
import { Store } from './store.mjs'
import { TaskGit } from './git-task.mjs'
import { runCommand } from './process.mjs'
import { reviewIntegration } from './integration-review.mjs'
import { CONTROL_PROPERTIES, REFLECTION } from './control.mjs'
import { Pipeline } from './pipeline.mjs'
import {validateGptPlan} from './gpt-planner.mjs'
import {cursorTransportProblem} from './acp.mjs'
import {localTypeScriptArgs} from './runner.mjs'

const config = {
  positions: {memo:'메모', answered:'답변 완료', queued:'자동화 할 일', working:'자동화 작업 중', reviewing:'검토 중', needsInput:'확인 필요', done:'완료'},
  properties: {state:'state', location:'location', result:'result', question:'question', branch:'branch', pr:'pr', model:'model', baseCommit:'base', reflection:'reflection', completedAt:'date', completedDay:'day'},
  v2: {mainBranch:'main', controlPageId:'settings', remoteUrl:'https://github.com/ysb94/Atelier.git'}, env:{}
}
const text = content => ({rich_text:[{text:{content}}]})
const memory = () => ({data:{jobs:{},outbox:[]},save(){},update(fn){fn()},flush:Store.prototype.flush,enqueue:Store.prototype.enqueue})
function setup({git={}}={}) {
  const store=memory(), notion={}, board=new Board(config, notion)
  return new Orchestrator({config,notion,board,store,git})
}
function fakeBoard() {
  let version='v1', onPatch=null
  const blocks=[]
  const page={properties:{state:{select:{name:'작업 중'}},location:{select:{name:config.positions.working}}}}
  const notion={memoSnapshot:async()=>({unstable:false,page:structuredClone(page),task:{id:'p',version,state:page.properties.state.select.name,location:page.properties.location.select.name}}),
    api:async(endpoint,method,body)=>{
      if(endpoint==='pages/p'&&method==='PATCH'){Object.assign(page.properties,body.properties);onPatch?.();return page}
      if(endpoint==='blocks/p/children'&&method==='PATCH'){
        const created=body.children.map(child=>({...structuredClone(child),id:'block-'+(blocks.length+1),has_children:true}))
        blocks.push(...created);return {results:created}
      }
      if(endpoint.startsWith('blocks/p/children'))return {results:blocks.filter(b=>!b.archived),has_more:false}
      const id=endpoint.split('/')[1],block=blocks.find(b=>b.id===id)
      if(method==='PATCH'&&block){Object.assign(block,body);return block}
      return {results:block?.[block.type]?.children??[],has_more:false}
    }}
  return {board:new Board(config,notion),page,setVersion:v=>{version=v},onPatch:fn=>{onPatch=fn}}
}
const question={v2:true,kind:'needs_input',runId:'run',cycleId:'cycle',eventId:'question-event',expectVersion:'v1',expectLocations:[config.positions.working],summary:'확인해 주세요',question:'적용 대상은?',lines:['적용 대상은?']}

test('two shared GPT workers switch between planning and review, prioritizing waiting reviews without exceeding two',async()=>{
  const p=new Pipeline({planning:2,review:2,gptWorkers:2}),signal=new AbortController().signal
  const first=await p.acquire('planning',{key:'p1',signal}),second=await p.acquire('planning',{key:'p2',signal})
  assert.equal(p.gptCount(),2);assert.deepEqual([...p.running.values()].map(item=>item.gptSlot),[1,2])
  let planned=false,reviewed=false
  const pendingPlan=p.acquire('planning',{key:'p3',signal}).then(release=>{planned=true;return release})
  const pendingReview=p.acquire('review',{key:'r1',signal}).then(release=>{reviewed=true;return release})
  first();const review=await pendingReview
  assert.equal(reviewed,true);assert.equal(planned,false);assert.equal(p.gptCount(),2)
  second();const plan=await pendingPlan
  assert.equal(p.count('review'),1);assert.equal(p.count('planning'),1);assert.equal(p.gptCount(),2)
  review();plan()
  const r1=await p.acquire('review',{key:'r2',signal}),r2=await p.acquire('review',{key:'r3',signal})
  assert.equal(p.count('review'),2);assert.equal(p.canPlan(),false)
  const c1=await p.acquire('implementation',{key:'c1',signal}),c2=await p.acquire('implementation',{key:'c2',signal})
  assert.equal(p.gptCount(),2);assert.equal(p.count('implementation'),2)
  c1();c2();r1();r2();assert.equal(p.gptCount(),0)
})

test('two GPT slots admit a second planning job while the first is active',()=>{
  const o=setup();o.pipeline=new Pipeline({planning:2,review:2,gptWorkers:2})
  o.active.set('one',{job:{cycle:{phase:'planning'}}});assert.equal(o.planningFull(),false)
  o.active.set('two',{job:{cycle:{phase:'planning'}}});assert.equal(o.planningFull(),true)
  assert.equal(o.residentLimit(),8)
})

test('deferral parks a memo with a reason and no user question, with durable delivery recovery',async()=>{
  const o=setup(),f=fakeBoard();o.board=f.board;o.board.ledger=new GeneratedBlockLedger(o.store)
  const notice={summary:'창고 개편 전까지 보류한다는 요청을 유지합니다.',questions:[],actions:[]}
  assert.equal(validateGptPlan({decision:'defer',reason:'사용자 보류',notice},'.',{}).decision,'defer')
  assert.throws(()=>validateGptPlan({decision:'defer',reason:'보류',notice:{...notice,questions:['진행할까요?']}},'.',{}))
  const job={key:'p',task:{id:'p'},runId:'r',cycle:{id:'c',sourceVersion:'v1',phase:'planning'}};o.journal().jobs.p=job
  o.setStatus=()=>{};await o.defer({job,controller:new AbortController()},notice)
  assert.equal(job.phase,'deferred');assert.equal(job.cycle.outcome,'deferred');assert.equal(f.page.properties.location.select.name,config.positions.memo);assert.equal(f.page.properties.state.select.name,'중지');assert.deepEqual(f.page.properties.question.rich_text,[])
  assert.equal(o.recoverableDelivery(job).update.kind,'deferred')
})

test('operator verification requests and empty questions cannot enter user confirmation',async()=>{
  const o=setup(),entry={job:{cycle:{}},controller:new AbortController()}
  await assert.rejects(o.askUser(entry,{summary:'서류 출력 화면 검사 결과가 없어 완료할 수 없습니다.',questions:['합성 브라우저 결과가 필요합니다.'],actions:[]}),/자동화 담당자/)
  await assert.rejects(o.askUser(entry,{summary:'대기',questions:[],actions:[]}),/질문.*없는/)
  assert.equal(o.store.data.outbox.length,0)
})

test('publication recovery restores its live lane without replanning or losing the passed review',async()=>{
  const o=setup();o.config={...config,positions:{...config.positions,preparing:'GPT 준비'}};o.board.config=o.config
  const task={id:'p',version:'v1',location:'GPT 준비',state:'대기'},values={gptModel:'gpt-6-sol',gptEffort:'medium',cursorModel:'composer-2.5',baseBranch:'saved',integrationBranch:'integration/test'}
  const original={id:'passed-cycle',phase:'publishing',sourceVersion:'v1',outcome:'error',review:{decision:'pass'},settings:{gpt:{model:'gpt-6.1-sol',effort:'high'}}}
  const job={key:'p',phase:'error',errorKind:'operator',errorCode:'review_environment',cycle:original,task,history:[],workspace:{baseBranch:'saved',integrationBranch:'integration/test'}}
  const resumed=o.prepare(job,task,'GPT 준비',values,'대기');assert.equal(resumed.cycle,original);assert.equal(original.outcome,null)
  const entry={job:resumed,controller:new AbortController()},calls=[];let location='GPT 준비'
  o.board.read=async()=>({unstable:false,task:{...task,location}})
  o.progress=async(e,update)=>{await o.assertFresh(e);calls.push('restore');location=update.location}
  o.ensureWorkspace=async()=>{calls.push('workspace')}
  o.publishResult=async(e)=>{await o.assertFresh(e);assert.equal(location,config.positions.reviewing);assert.equal(e.publicationRecoveryLocation,null);calls.push('publish');original.outcome='done';return 'applied'}
  o.plan=async()=>assert.fail('passed publication must not plan again');o.implement=async()=>assert.fail('passed publication must not implement again');o.check=async()=>assert.fail('passed publication must not review again')
  await o.run(entry);assert.deepEqual(calls,['restore','workspace','publish']);assert.equal(original.review.decision,'pass');assert.equal(original.settings.gpt.model,'gpt-6.1-sol')
  const moved={...entry,controller:new AbortController()};o.inspect(moved,{...task,location:'GPT 준비'});assert.equal(moved.controller.signal.aborted,true)
})

test('Cursor readiness requires completed instructions and the latest source, never an active or failed implementation',()=>{
  const job={phase:'active',cycle:{phase:'planned',sourceVersion:'v1',plan:{decision:'execute'},writeBase:{digest:'code'}}}
  assert.equal(readyForCursor(job,{version:'v1'}),true)
  assert.equal(readyForCursor(job,{version:'v2'}),false)
  assert.equal(readyForCursor({...job,phase:'error'},{version:'v1'}),false)
  assert.equal(readyForCursor({...job,cycle:{...job.cycle,phase:'implementing',implementationStarted:true}},{version:'v1'}),false)
  assert.equal(readyForCursor({...job,cycle:{...job.cycle,plan:{decision:'needs_input'}}},{version:'v1'}),false)
})

test('Cursor polls ready cards while the GPT scan is busy and returns unprepared cards without calling a model',async()=>{
  const o=setup(),ready={id:'ready',version:'v1',location:config.positions.queued,state:'대기'},raw={id:'raw',version:'raw',location:config.positions.queued,state:'대기'}
  o.config={...config,positions:{...config.positions,preparing:'GPT 준비'},v2:{...config.v2,cursorPull:{enabled:true,pollMs:5000}}}
  o.scanning=true
  const values={gptModel:'gpt-6-sol',gptEffort:'medium',cursorModel:'composer-2.5',enabled:true,baseBranch:'saved',integrationBranch:'integration/test'}
  o.notion.api=async()=>({properties:Object.fromEntries(Object.entries(CONTROL_PROPERTIES).map(([key,spec])=>[spec.name,{type:spec.type,...(spec.type==='select'?{select:{name:values[key]}}:spec.type==='checkbox'?{checkbox:values[key]}:{rich_text:[{text:{content:values[key]??''}}]})}]))})
  o.journal().jobs.ready={task:ready,phase:'active',cycle:{phase:'planned',sourceVersion:'v1',plan:{decision:'execute'},writeBase:{digest:'code'}}}
  const pages=[{id:'raw',properties:{state:{select:{name:'대기'}}}},{id:'ready',properties:{state:{select:{name:'대기'}}}}],taken=[],writes=[]
  o.board.list=async()=>pages;o.board.read=async id=>({unstable:false,task:id==='ready'?ready:raw})
  o.board.patch=async(id,p)=>writes.push({id,p})
  o.consider=async page=>taken.push(page.id)
  o.gpt=async()=>{throw Error('queue discovery must not invoke GPT')}
  await o.dispatchCursor()
  assert.deepEqual(taken,['ready'])
  assert.equal(writes[0].id,'raw');assert.equal(writes[0].p.location.select.name,'GPT 준비')
  assert.equal(o.scanning,true)
})

test('a full conflict queue still admits independent ready work to an idle Cursor',async t=>{
  const o=setup(),abort=new AbortController(),taken=[]
  o.config={...config,positions:{...config.positions,preparing:'GPT 준비'},v2:{...config.v2,cursorPull:{enabled:true,pollMs:5000}}}
  o.pipeline=new Pipeline({implementation:2,planning:2,review:2,gptWorkers:2,readyLimit:4})
  const release=await o.pipeline.acquire('implementation',{key:'busy',files:['shared.ts'],signal:abort.signal})
  o.active.set('busy',{})
  for(let i=0;i<4;i++)void o.pipeline.acquire('implementation',{key:'waiting'+i,files:['shared.ts'],signal:abort.signal}).catch(()=>{})
  t.after(()=>{abort.abort();release();o.pipeline.finish('busy')})
  assert.equal(o.pipeline.queued('implementation'),4)
  const values={gptModel:'gpt-6-sol',gptEffort:'medium',cursorModel:'composer-2.5',enabled:true,baseBranch:'saved',integrationBranch:'integration/test'}
  o.notion.api=async()=>({properties:Object.fromEntries(Object.entries(CONTROL_PROPERTIES).map(([key,spec])=>[spec.name,{type:spec.type,...(spec.type==='select'?{select:{name:values[key]}}:spec.type==='checkbox'?{checkbox:values[key]}:{rich_text:[{text:{content:values[key]??''}}]})}]))})
  const tasks=['blocked','independent'].map(id=>({id,version:'v1',location:config.positions.queued,state:'대기'}))
  for(const task of tasks)o.journal().jobs[task.id]={task,phase:'active',cycle:{phase:'planned',sourceVersion:'v1',plan:{decision:'execute',files:[task.id==='blocked'?'shared.ts':'other.ts']},writeBase:{digest:'code'}}}
  const pages=tasks.map(task=>({id:task.id,properties:{state:{select:{name:'대기'}}}}))
  o.board.list=async()=>pages;o.board.read=async id=>({unstable:false,task:tasks.find(task=>task.id===id)})
  o.consider=async page=>taken.push(page.id)
  await o.dispatchCursor()
  assert.deepEqual(taken,['independent'])
})

test('handoff releases transient reservations while preserving prepared edits and hashes',async()=>{
  const o=setup();o.config={...config,v2:{...config.v2,cursorPull:{enabled:true,pollMs:5000}}}
  o.pipeline=new Pipeline();o.stopping=true;o.status=()=>{};o.run=async()=>{}
  const task={id:'p',version:'v1'},writeBase={digest:'preserved-edits',files:{'shared.ts':'hash'}}
  const job={key:'p',task,phase:'active',cycle:{phase:'implementing',sourceVersion:'v1',implementationStarted:false,plan:{decision:'execute',files:['shared.ts']},writeBase}}
  o.pipeline.reserve(job.key,['shared.ts']);o.launch(job)
  await o.active.get(job.key).promise
  assert.equal(o.pipeline.reservations.has(job.key),false)
  assert.equal(job.cycle.writeBase,writeBase)
  assert.equal(readyForCursor(job,task),true)
})

test('terminal Cursor transport errors cannot masquerade as completed reports',()=>{
  assert.equal(cursorTransportProblem('확인 중입니다.\n\nError: RetriableError: [unknown] Premature close'),true)
  assert.equal(cursorTransportProblem('Error: ECONNRESET'),true)
  assert.equal(cursorTransportProblem('연결 오류 처리를 구현했습니다.'),false)
  assert.equal(cursorTransportProblem('Error: RetriableError: Premature close\n위 오류를 재현하고 처리했습니다.'),false)
})

test('Notion authentication failures are operator errors and do not reach paid work',async()=>{
  const n=new Notion({env:{NOTION_TOKEN:'fixture'}},async()=>({ok:false,status:401,json:async()=>({code:'unauthorized'})}))
  await assert.rejects(n.api('pages/p'),error=>error.code==='notion_auth'&&error.retry===false)
  const o=setup();o.enqueue=()=>{};o.store.flush=async()=>{await n.api('pages/p')}
  await assert.rejects(o.progress({job:{key:'p'},controller:new AbortController()},{state:'작업 중'}),error=>error.code==='notion_auth')
})

test('legacy TypeScript checks use the pinned local tool with unchanged task arguments',()=>{
  const direct=localTypeScriptArgs('tsx src/features/work-requests/work-request-roles.verify.ts')
  const legacy=localTypeScriptArgs('npx tsx src/features/work-requests/work-request-roles.verify.ts')
  assert.deepEqual(direct,legacy)
  assert.match(direct[0],/node_modules[\\/]tsx[\\/]dist[\\/]cli\.mjs$/)
  assert.deepEqual(localTypeScriptArgs('npx tsx --tsconfig tsconfig.app.json src/lib/chat/thread-layout.verify.ts').slice(1),['--tsconfig','tsconfig.app.json','src/lib/chat/thread-layout.verify.ts'])
  assert.equal(localTypeScriptArgs('npx tsx file.ts; echo skipped'),null)
})

test('a completed GPT plan is handed off to the visible queue before any Cursor invocation',async()=>{
  const o=setup();o.config={...config,v2:{...config.v2,cursorPull:{enabled:true,pollMs:5000}}}
  const job={cycle:{phase:'planning'}},entry={job,controller:new AbortController()};let calls=0
  o.watch=()=>null;o.inStage=async(entry,stage,work)=>work();o.ensureWorkspace=async()=>{}
  o.plan=async()=>{job.cycle.phase='planned'};o.implement=async()=>{calls++}
  await o.run(entry)
  assert.equal(job.cycle.phase,'planned');assert.equal(calls,0)
})

test('copied provenance never takes ownership away from the original block',async()=>{
  const ledger=new GeneratedBlockLedger(), record=ledger.begin('p',{kind:'notice',eventId:'e'})
  const original=stampCallout({id:'generated',type:'callout',callout:{rich_text:[]}},record.nonce)
  await ledger.adoptResponse({},'p',record,{results:[original]})
  const copy=structuredClone(original);copy.id='user-copy'
  const notion=new Notion({});notion.blockLedger=ledger
  assert.equal(await notion.isGeneratedBlock('p',copy),false)
  const owned=await ledger.blocksOf({api:async()=>({results:[copy,original]})},'p')
  assert.deepEqual(owned.map(item=>item.block.id),['generated'])
  assert.equal(record.blockId,'generated')
  await ledger.adoptResponse({},'p',record,{results:[copy]})
  assert.equal(record.blockId,'generated')
  ledger.release('p',record)
  assert.equal(ledger.hasPending('p'),false)
  assert.equal(ledger.hasNonce('p',record.nonce),false)
  assert.deepEqual(await ledger.blocksOf({api:async()=>({results:[copy]})},'p'),[])
  assert.notEqual(ledger.begin('p',{kind:'notice',eventId:'e'}).nonce,record.nonce)
})

test('an unbound lost-response claim is recovered by nonce exactly once',async()=>{
  const ledger=new GeneratedBlockLedger(), record=ledger.begin('p',{kind:'report',eventId:'lost'})
  const generated=stampCallout({id:'g',type:'callout',callout:{rich_text:[]}},record.nonce)
  const found=await ledger.blocksOf({api:async()=>({results:[generated]})},'p')
  assert.equal(found.length,1);assert.equal(record.blockId,'g');assert.equal(ledger.hasPending('p'),false)
})

test('a user toggle with a placeholder or AI title retains its children',async()=>{
  let body='직접 작성한 요청'
  const notion=new Notion({properties:{},env:{NOTION_TOKEN:'fixture'}},async url=>({ok:true,json:async()=>({results:url.includes('/blocks/p/')
    ? [{id:'user',type:'toggle',has_children:true,toggle:{rich_text:[{text:{content:'필요한 설명이나 참고 자료를 여기에 이어 적을 수 있습니다.'}}]}}]
    : [{type:'paragraph',paragraph:{rich_text:[{text:{content:body}}]}}]})}))
  const before=await notion.memoBody('p');assert.ok(before.includes(body))
  body='수정한 원문';assert.notEqual(await notion.memoBody('p'),before)
})

test('question publication overlapping a new answer requeues only its own stale result',async()=>{
  const f=fakeBoard();let once=true
  f.onPatch(()=>{if(once){once=false;f.setVersion('v2')}})
  await assert.rejects(f.board.recordNeedsInput('p',question),error=>error.superseded)
  assert.equal(f.page.properties.location.select.name,config.positions.queued)
  assert.equal(f.page.properties.question.rich_text[0].text.content,question.question)
  const moved=fakeBoard();let race=true
  moved.onPatch(()=>{if(race){race=false;moved.setVersion('v2');moved.page.properties.location={select:{name:config.positions.answered}}}})
  await assert.rejects(moved.board.recordNeedsInput('p',question),error=>error.superseded)
  assert.equal(moved.page.properties.location.select.name,config.positions.answered)
})

test('existing completion report is not ACKed after source changes during lookup',async()=>{
  const f=fakeBoard(), update={...question,kind:'complete',eventId:'done-event',completedAt:'2026-10-14T04:00:00Z',publication:{branch:'auto/task',prUrl:'https://example.invalid/pr'},summary:'완료'}
  Object.assign(f.page.properties,{state:{select:{name:'완료'}},location:{select:{name:config.positions.done}},result:text(f.board.resultText(update)),branch:text('auto/task'),pr:{url:update.publication.prUrl},date:{date:{start:update.completedAt}}})
  f.board.notice=async()=> 'ready'
  f.board.ledger={blocksOf:async()=>{f.setVersion('v2');return[{block:{id:'report'},record:{eventId:'done-event'}}]},release(){}}
  await assert.rejects(f.board.complete('p',update),error=>error.superseded)
  assert.equal(f.page.properties.location.select.name,config.positions.queued)
  assert.equal(f.page.properties.date.date,null)
})

test('a new failure after manual reset differs from a lost-response retry',async()=>{
  const o=setup(),f=fakeBoard(),job={task:{id:'p'},runId:'r',cycle:{id:'c',sourceVersion:'v1'}}
  const first=o.outboxEvent(job,{kind:'error',summary:'동일한 준비 오류'}).update
  f.page.properties.state={select:{name:'대기'}}
  await f.board.publish('p',first);assert.equal(f.page.properties.state.select.name,'오류')
  f.page.properties.state={select:{name:'대기'}}
  await f.board.publish('p',first);assert.equal(f.page.properties.state.select.name,'대기')
  const second=o.outboxEvent(job,{kind:'error',summary:'동일한 준비 오류'}).update
  assert.notEqual(first.eventId,second.eventId)
  await f.board.publish('p',second);assert.equal(f.page.properties.state.select.name,'오류')
})

test('a stale question delivery is discarded and the same branch can replan',async()=>{
  const o=setup(),job={key:'p',task:{id:'p'},branch:'auto/p',runId:'r',phase:'needs_input',cycle:{id:'c',sourceVersion:'v1',outcome:'needs_input'}}
  const event=o.outboxEvent(job,{kind:'needs_input'})
  job.delivery={acked:false,event};o.store.data.outbox.push(event)
  o.board.publish=async()=>{throw Object.assign(new Error('새 답변'),{discardUpdate:true,superseded:true})}
  assert.equal(await o.settleDelivery(job),'superseded')
  assert.equal(job.phase,'superseded');assert.equal(job.branch,'auto/p');assert.equal(o.store.data.outbox.length,0)
})

async function temp(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-v2-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir
}
test('completion cleanup preserves dirty edits and clears the clean workspace flag',async t=>{
  const dir=await temp(t)
  for(const dirty of [[],['user.md']]){
    let removed=false
    const o=setup({git:{headState:async()=>({head:'head',dirty}),removeWorktree:async()=>{removed=true}}})
    const job={workspace:{dir,edits:true},cycle:{pendingCompletion:{endedAt:'now',publication:{headSha:'head'}}}}
    await o.finalizeDeliveredCompletion(job)
    assert.equal(removed,dirty.length===0);assert.equal(job.workspace.edits,dirty.length>0)
  }
})
async function repository(t) {
  const dir=await temp(t),root=path.join(dir,'repo');fs.mkdirSync(root)
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{}}))
  fs.writeFileSync(path.join(root,'AGENTS.md'),'Fixture rules')
  const maps=path.join(root,'dev-tools/structure-map/generated');fs.mkdirSync(maps,{recursive:true})
  fs.writeFileSync(path.join(maps,'structure.json'),JSON.stringify({nodes:[],routes:[],edges:[],domains:[],nav:[]}))
  fs.writeFileSync(path.join(root,'a.md'),'base');fs.writeFileSync(path.join(root,'b.md'),'base')
  const git=async args=>(await runCommand('git',args,{cwd:root})).output.trim()
  await git(['init']);await git(['add','.']);
  await git(['config','user.name','Fixture']);await git(['config','user.email','fixture@example.invalid'])
  const commit=()=>git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture'])
  await commit();return {dir,root,git,commit,base:await git(['rev-parse','HEAD'])}
}
test('replanning includes a HEAD-only reversion as well as the base diff',async t=>{
  const f=await repository(t)
  fs.writeFileSync(path.join(f.root,'a.md'),'committed');await f.git(['add','.']);await f.commit()
  fs.writeFileSync(path.join(f.root,'a.md'),'base');fs.writeFileSync(path.join(f.root,'b.md'),'new')
  const o=setup({git:new TaskGit({config,root:f.root})}),runDir=path.join(f.dir,'run');fs.mkdirSync(runDir)
  o.runDir=()=>runDir;o.progress=async()=>{};o.assertFresh=async()=>{};o.refreshMap=async()=>{}
  let captured
  o.gpt=async({prompt})=>{captured=JSON.parse(prompt.split('데이터(JSON):\n')[1].split('\n주어진 JSON')[0]);return{report:JSON.stringify({decision:'execute',reason:'fixture',executionKind:'implementation',request:'수정',criteria:'내용 유지',instructions:'a 원복과 b 수정을 모두 보존하고 적용합니다.',files:['a.md','b.md'],verificationScripts:[]})}}
  const job={key:'p',runId:'r',branch:'auto/p',history:[],task:{id:'p',title:'수정',version:'v1',source:{answer:''}},workspace:{dir:f.root,baseSha:f.base},cycle:{id:'c',sourceVersion:'v1',settings:{gpt:{}},trigger:'answered'}}
  await o.plan({job,controller:new AbortController()})
  assert.deepEqual(captured.previousChanges.files.sort(),['a.md','b.md']);assert.ok(job.cycle.plan.files.includes('a.md'))
})

test('closed PRs remain tracked and a merge into a different ref is not integration',async()=>{
  let calls=0,inIntegration=false
  const git={slug:'ysb94/Atelier',fetchBranch:async()=> 'sha',contains:async(ref,sha)=>ref==='merge'||(inIntegration&&ref.includes('/integration/')),
    pullRequest:async()=>{calls++;return {number:1,state:'MERGED',baseRefName:'other',headRefName:'auto/p',headRefOid:'reviewed',mergeCommit:{oid:'merge'},isCrossRepository:false,headRepository:{name:'Atelier'},headRepositoryOwner:{login:'ysb94'}}}}
  const o=setup({git});o.board.publish=async()=>{};o.now=()=>1000000
  const job={key:'p',task:{id:'p'},branch:'auto/p',publication:{prNumber:1,prUrl:'url',headSha:'reviewed',integrationBranch:'integration/test',prState:'CLOSED',reflection:REFLECTION.reviewing}}
  o.journal().jobs.p=job;await o.reconcile();assert.equal(calls,1);assert.equal(job.publication.reflection,REFLECTION.waiting)
  inIntegration=true;o.now=()=>2000000;await o.reconcile();assert.equal(job.publication.reflection,REFLECTION.reviewing)
})

test('integration approval rejects source drift during checks or review',async t=>{
  const f=await repository(t)
  for(const phase of ['checks','review','stable']){
    const work=path.join(f.dir,phase),records=path.join(f.dir,phase+'-records')
    const git=new TaskGit({config,root:f.root})
    git.workspaceRoot=()=>work;git.fetchBranch=async()=>f.base
    git.detachedWorktree=async dir=>{fs.mkdirSync(path.dirname(dir),{recursive:true});fs.cpSync(f.root,dir,{recursive:true})}
    git.removeWorktree=async()=>{}
    const values={gptModel:'gpt-6.1-sol',gptEffort:'high',cursorModel:'grok-4.7-xhigh-fast',enabled:false,baseBranch:'saved',integrationBranch:'integration/test',runStatus:''}
    const properties=Object.fromEntries(Object.entries(CONTROL_PROPERTIES).map(([key,s])=>[s.name,{type:s.type,...(s.type==='select'?{select:{name:values[key]}}:s.type==='checkbox'?{checkbox:values[key]}:text(values[key]))}]))
    let calls=0
    const options={config,git,recordsDir:records,notion:{api:async()=>({properties})},
      verify:async(c,dir)=>{if(phase==='checks')fs.writeFileSync(path.join(dir,'a.md'),'drift');return[{name:'fixture',passed:true}]},
      review:async({root})=>{calls++;if(phase==='review')fs.writeFileSync(path.join(root,'a.md'),'drift');return{decision:'pass',summary:'fixture'}}}
    if(phase==='stable'){assert.equal((await reviewIntegration(options)).approved,true);assert.ok(fs.existsSync(path.join(records,'latest.json')))}
    else {await assert.rejects(reviewIntegration(options),/소스가 바뀌/);assert.equal(fs.existsSync(path.join(records,'latest.json')),false)}
    if(phase==='checks')assert.equal(calls,0)
  }
})

test('memo → question → answer → two implementation rounds → reviewed commit stays on one branch',async t=>{
  const f=await repository(t), boardFixture=fakeBoard(), git=new TaskGit({config,root:f.root})
  await f.git(['checkout','-b','auto/p'])
  git.ensureWorktree=async()=>{};git.verifyOrigin=async()=>{}
  let pushes=0
  git.ensureIntegrationBranch=async()=>{};git.push=async()=>{pushes++};git.removeWorktree=async()=>{}
  const pr=async()=>({number:1,url:'https://example.invalid/pr',state:'OPEN',headRefName:'auto/p',baseRefName:'integration/test',headRefOid:await f.git(['rev-parse','HEAD']),isCrossRepository:false,headRepository:{name:'Atelier'},headRepositoryOwner:{login:'ysb94'}})
  git.ensurePullRequest=pr;git.pullRequest=pr
  const pullConfig={...config,maxAttempts:3,positions:{...config.positions,preparing:'GPT 준비'},v2:{...config.v2,cursorPull:{enabled:true,pollMs:5000}}}
  boardFixture.board.config=pullConfig
  const store=memory(),o=new Orchestrator({config:pullConfig,notion:boardFixture.board.notion,board:boardFixture.board,store,git,refreshMap:async()=>{}})
  const runDir=path.join(f.dir,'run');fs.mkdirSync(runDir);o.runDir=()=>runDir
  let plans=0,cursors=0,reviews=0
  o.gpt=async()=>{plans++;return {report:JSON.stringify(plans===1
    ? {decision:'needs_input',reason:'정책 확인',notice:{summary:'적용 범위를 결정해 주세요.',questions:['누구에게 적용할까요?'],actions:[]}}
    : {decision:'execute',reason:'답변 반영',feedback:{kind:'direction',summary:'답변한 범위를 적용합니다.'},executionKind:'implementation',request:'내용 수정',criteria:'내용이 second이다',instructions:'a.md의 내용을 second로 바꾸고 나머지 내용은 보존합니다.',files:['a.md'],verificationScripts:[]})}}
  o.cursor=async()=>{cursors++;fs.writeFileSync(path.join(f.root,'a.md'),cursors===1?'first':'second');return {report:'fixture 구현'}}
  o.verify=async()=>[{name:'fixture',passed:true}]
  o.review=async()=>{reviews++;return reviews===1
    ? {decision:'revise',summary:'보완 필요',issues:['second 필요'],criteriaResults:[{criterion:'내용이 second이다',passed:false,evidence:'first'}],nextPrompt:'a.md의 내용을 second로 수정하세요.',report:null}
    : {decision:'pass',summary:'기준 충족',issues:[],criteriaResults:[{criterion:'내용이 second이다',passed:true,evidence:'실제 파일 second'}],nextPrompt:'',report:{deployment:'development',location:'가짜 화면',summary:'내용을 수정했습니다.',changes:['내용 변경'],howToUse:'내용 확인',checked:['기준 충족'],remaining:'통합 대기'}}}
  const values={gptModel:'gpt-6.1-sol',gptEffort:'high',cursorModel:'grok-4.7-xhigh-fast',baseBranch:'saved',integrationBranch:'integration/test'}
  const initial={id:'p',title:'가짜 메모',version:'v1',source:{screen:'가짜 화면',answer:''}}
  const job=o.prepare(null,initial,config.positions.memo,values,'대기')
  job.workspace={dir:f.root,baseSha:f.base,baseBranch:'saved',integrationBranch:'integration/test',edits:false}
  job.branch='auto/p'
  await o.run({job,controller:new AbortController()})
  assert.equal(job.phase,'needs_input');assert.equal(cursors,0)
  boardFixture.setVersion('v2');boardFixture.page.properties.location={select:{name:config.positions.answered}}
  const resumed=o.prepare(job,{...initial,version:'v2',source:{...initial.source,answer:'모두 적용'}},config.positions.answered,values,'확인 필요')
  assert.equal(resumed.branch,'auto/p');assert.equal(resumed.workspace.baseSha,f.base)
  await o.run({job:resumed,controller:new AbortController()})
  assert.equal(resumed.cycle.phase,'planned');assert.equal(cursors,0)
  assert.equal(boardFixture.page.properties.location.select.name,config.positions.queued)
  resumed.task.location=config.positions.queued
  await o.run({job:resumed,controller:new AbortController()})
  assert.equal(cursors,1);assert.equal(reviews,1)
  assert.equal(boardFixture.page.properties.location.select.name,config.positions.queued)
  assert.equal(readyForCursor(resumed,resumed.task),true)
  await o.run({job:resumed,controller:new AbortController()})
  assert.equal(plans,2);assert.equal(cursors,2);assert.equal(reviews,2);assert.equal(job.cycle.attempt,2)
  assert.equal(job.phase,'done');assert.equal(boardFixture.page.properties.location.select.name,config.positions.done)
  assert.equal(fs.readFileSync(path.join(f.root,'a.md'),'utf8'),'second');assert.equal(pushes,1)
  assert.equal(job.workspace.edits,false)
  assert.equal(job.publication.headSha,await f.git(['rev-parse','HEAD']))
})
