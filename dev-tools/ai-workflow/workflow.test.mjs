import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { taskFromPage, memoTaskFromPage, completionDay, Notion } from './notion.mjs'
import { validatePlan, planningPrompt, prepareMemo } from './planner.mjs'
import { completionReportBlock, validateCompletionReport } from './report.mjs'
import { taskFiles, redact, projectRoot, cursorServers, cursorPlugins, settings } from './settings.mjs'
import { permissionDecision } from './acp.mjs'
import { validateReview, reviewEnvironmentProblem } from './reviewer.mjs'
import { Store, acquireLock } from './store.mjs'
import { Runner, navigationCheckProvenance } from './runner.mjs'
import { runCommand, childEnv } from './process.mjs'
import { publicMcpConfig } from './mcp.mjs'

const easyReport={deployment:'development',location:'공용 → 내 업무 → 안내',summary:'내 업무 화면의 안내를 정리했어요.',changes:['누가 어떤 업무를 볼 수 있는지 설명을 추가했어요.'],howToUse:'내 업무 화면의 안내를 읽으면 됩니다.',checked:['요청한 안내 문구가 반영된 것을 확인했어요.'],remaining:'개발 화면에 적용했습니다. 운영 사이트 게시 작업은 별도로 필요합니다.'}
const pass={decision:'pass',summary:'완료 기준 충족',criteriaResults:[{criterion:'파일 내용',passed:true,evidence:'실제 파일과 diff 확인'}],issues:[],nextPrompt:'',report:easyReport}
const task={id:'fixture-task',version:'v1',enabled:true,state:'대기',title:'안내 작성',request:'안내를 작성한다',criteria:'안내가 정확하다',files:'note.md'}
async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-workflow-'))
  // Cleanup is only this exact freshly-created temporary directory.
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^atelier-workflow-/);fs.rmSync(root,{recursive:true,force:true})})
  fs.writeFileSync(path.join(root,'.gitignore'),'.state/\n')
  fs.writeFileSync(path.join(root,'note.md'),'원래 내용')
  fs.writeFileSync(path.join(root,'other.md'),'사용자 기존 변경')
  await runCommand('git',['init'],{cwd:root})
  const store=new Store(path.join(root,'.state'))
  const updates=[],events=[]
  const notion={queue:async()=>[task],task:async()=>({...task}),publish:async(id,u)=>{updates.push(u)}}
  const config={maxAttempts:3,agentTimeoutMs:1000,env:{},verificationScripts:[]}
  const verify=async()=>[{name:'fixture-verification',passed:true,output:'checked'}]
  return {root,store,notion,config,verify,updates,events}
}

test('task version ignores manager feedback and state changes',()=>{
  const props={title:'제목',request:'요청',criteria:'기준',files:'파일',state:'상태',enabled:'실행',order:'순서'}
  const page={id:'id',properties:{제목:{title:[{plain_text:'제목'}]},요청:{rich_text:[{plain_text:'요청'}]},기준:{rich_text:[{plain_text:'기준'}]},파일:{rich_text:[{plain_text:'a.ts'}]},상태:{select:{name:'대기'}},실행:{checkbox:true}}}
  const a=taskFromPage(page,props);page.properties.상태.select.name='검토 중';assert.equal(taskFromPage(page,props).version,a.version)
  page.properties.요청.rich_text[0].plain_text='다른 요청';assert.notEqual(taskFromPage(page,props).version,a.version)
})
test('rejects paths outside workspace, secrets and DB writes',()=>{
  for(const file of ['../outside.ts','.env.local','.git/config','supabase/migrations/x.sql','src/../../bad.ts'])assert.throws(()=>taskFiles(file))
  assert.deepEqual(taskFiles('src/App.tsx\nsrc/App.tsx'),['src/App.tsx'])
})
test('unknown, SQL and shell tools do not receive unattended approval',()=>{
  assert.equal(permissionDecision({toolCall:{kind:'read',title:'execute_sql'}},[],projectRoot),false)
  assert.equal(permissionDecision({toolCall:{kind:'other',title:'apply_migration'}},[],projectRoot),false)
  assert.equal(permissionDecision({toolCall:{kind:'execute',title:'npm run check:supabase'}},[],projectRoot),false)
  assert.equal(permissionDecision({toolCall:{kind:'execute',title:'npm run lint && rm -rf .'}},[],projectRoot),false)
  assert.equal(permissionDecision({toolCall:{kind:'other',title:'notion-notion-fetch: notion-fetch'}},[],projectRoot),true)
  assert.equal(permissionDecision({toolCall:{kind:'other',title:'supabase-list_tables: list_tables'}},[],projectRoot),true)
  assert.equal(permissionDecision({toolCall:{kind:'other',title:'notion-notion-update-page: notion-update-page'}},[],projectRoot),false)
  assert.equal(permissionDecision({toolCall:{kind:'other',title:'supabase-execute_sql: execute_sql'}},[],projectRoot),false)
  assert.equal(permissionDecision({toolCall:{kind:'edit',title:'Edit file',content:[{type:'diff',path:path.join(projectRoot,'src/App.tsx')}] }},['src/App.tsx'],projectRoot),true)
  assert.equal(permissionDecision({toolCall:{kind:'edit',title:'Edit file',content:[{type:'diff',path:path.join(projectRoot,'.env.local')}] }},['src/App.tsx'],projectRoot),false)
})

test('excluded Cloudflare is absent from worker servers and plugins',()=>{
  const config={...settings(),excludedMcpServers:['cloudflare']}
  assert.ok(cursorServers(config).every(server=>server.name!=='cloudflare'))
  assert.ok(cursorPlugins(config).every(plugin=>!plugin.replaceAll('\\','/').includes('/cloudflare/')))
})

test('MCP login probe copies public URLs without credentials',()=>{
  const server={name:'notion',type:'http',url:'https://mcp.notion.com/mcp',headers:[]}
  assert.deepEqual(publicMcpConfig([server]),{mcpServers:{notion:{url:server.url}}})
  for(const unsafe of [{...server,headers:[{name:'Authorization',value:'private'}]},{...server,url:'https://host/mcp?token=private'},{...server,url:'https://user:private@host/mcp'},{...server,type:'stdio'}])assert.throws(()=>publicMcpConfig([unsafe]))
})
test('pass needs all criteria and real evidence; revision needs next prompt',()=>{
  assert.equal(validateReview(pass).decision,'pass')
  assert.throws(()=>validateReview({...pass,criteriaResults:[]}))
  assert.throws(()=>validateReview({...pass,criteriaResults:[{passed:false,evidence:'미충족'}]}))
  assert.throws(()=>validateReview({...pass,issues:['오류']}))
  assert.throws(()=>validateReview({...pass,decision:'revise',nextPrompt:''}))
})
test('reviewer infrastructure failures are distinguished from code defects',()=>{
  assert.match(reviewEnvironmentProblem({...pass,decision:'revise',summary:'검토 실패',issues:['app-server socket directory must be a user-owned directory with mode 0700']}),/socket directory/)
  assert.match(reviewEnvironmentProblem({...pass,decision:'needs_input',issues:['검증 실행 담당자가 현재 검사 내용과 성공 기록이 일치하는지 확인해야 합니다.']}),/검증 실행 담당자/)
  assert.equal(reviewEnvironmentProblem({...pass,decision:'revise',issues:['이미지 기본 너비 계산이 잘못되었습니다.']}),undefined)
})
test('manager navigation checks identify the executed script and unchanged task workspace',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-validator-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  fs.mkdirSync(path.join(root,'scripts'));const script=path.join(root,'scripts/verify-work-request-navigation.mjs');fs.writeFileSync(script,'original task validator')
  const args=['--experimental-strip-types',path.join(projectRoot,'scripts/verify-work-request-navigation.mjs'),root,'proof.json']
  const proof=await navigationCheckProvenance(root,args,undefined,async(command,passed,options)=>{
    assert.equal(command,'git');assert.deepEqual(options.acceptedCodes,[0,1]);assert.equal(options.cwd,root);assert.equal(passed.at(-2),script)
    return {output:'exact script comparison'}
  })
  assert.equal(proof.kind,'manager-validator');assert.equal(proof.targetRoot,fs.realpathSync(root));assert.deepEqual(proof.command,[process.execPath,...args])
  assert.notEqual(proof.script.sha256,proof.taskScript.sha256);assert.equal(proof.difference,'exact script comparison')
  assert.match(proof.proofValidator,/sourceHashes/);assert.match(proof.proofValidator,/owners.length\*searches.length/)
  assert.equal(fs.readFileSync(script,'utf8'),'original task validator')
})
test('actual baseline diff, revision, re-review, completion and duplicate suppression',async t=>{
  const f=await fixture(t);let works=0,reviews=0
  const runner=new Runner({...f,cursor:async()=>{works++;fs.writeFileSync(path.join(f.root,'note.md'),works===1?'불완전':'완료');return{sessionId:'fixture',report:'작업 보고'}},review:async({evidence})=>{
    reviews++;assert.match(evidence.changes[0].diff,/원래 내용/)
    return reviews===1?{...pass,decision:'revise',nextPrompt:'불완전한 설명 보완',issues:['설명 부족']}:pass
  }})
  await runner.tick();await runner.tick()
  assert.equal(works,2);assert.equal(reviews,2);assert.equal(f.updates.at(-1).progress,'완료')
  assert.equal(fs.readFileSync(path.join(f.root,'other.md'),'utf8'),'사용자 기존 변경')
})
test('failed verification cannot mark complete even if reviewer says pass',async t=>{
  const f=await fixture(t)
  const runner=new Runner({...f,config:{...f.config,maxAttempts:1},verify:async()=>[{name:'build',passed:false,output:'failed'}],cursor:async()=>{fs.writeFileSync(path.join(f.root,'note.md'),'새 내용');return{report:'완료'}},review:async()=>pass})
  await runner.tick();assert.equal(f.updates.at(-1).state,'확인 필요');assert.ok(!f.updates.some(u=>u.progress==='완료'))
})
test('verification-only runs complete without editing files and preserve completion time',async t=>{
  const f=await fixture(t),verificationTask={...task,executionKind:'verification'}
  f.notion.queue=async()=>[verificationTask]
  const runner=new Runner({...f,cursor:async({files})=>{assert.deepEqual(files,[]);return{report:'실제 검증 대상 확인'}},review:async()=>pass})
  await runner.tick()
  const update=f.updates.at(-1)
  assert.equal(update.state,'완료')
  assert.ok(Number.isFinite(Date.parse(update.completedAt)))
  assert.match(update.note,/한국시간/)
  assert.equal(fs.readFileSync(path.join(f.root,'note.md'),'utf8'),'원래 내용')
})
test('implementation without an actual change cannot complete',async t=>{
  const f=await fixture(t)
  const runner=new Runner({...f,config:{...f.config,maxAttempts:1},cursor:async()=>({report:'변경 없음'}),review:async()=>pass})
  await runner.tick()
  assert.equal(f.updates.at(-1).state,'확인 필요')
  assert.ok(!f.updates.some(u=>u.state==='완료'))
})
test('out-of-scope or concurrent edits require input and are not overwritten',async t=>{
  const f=await fixture(t);let reviews=0
  const runner=new Runner({...f,cursor:async()=>{fs.writeFileSync(path.join(f.root,'other.md'),'다른 작업 변경');return{report:'완료'}},review:async()=>{reviews++;return pass}})
  await runner.tick();assert.equal(reviews,0);assert.equal(f.updates.at(-1).state,'확인 필요');assert.equal(fs.readFileSync(path.join(f.root,'other.md'),'utf8'),'다른 작업 변경')
})
test('lost Notion completion publication retries without running agent again',async t=>{
  const f=await fixture(t);let works=0,fail=true
  f.notion.publish=async(id,u)=>{if(u.state==='완료'&&fail){fail=false;throw Error('network response lost')}f.updates.push(u)}
  const runner=new Runner({...f,cursor:async()=>{works++;fs.writeFileSync(path.join(f.root,'note.md'),'완료');return{report:'완료'}},review:async()=>pass})
  await assert.rejects(runner.tick(),/network/);assert.equal(f.store.data.outbox.length,1)
  await runner.tick();assert.equal(works,1);assert.equal(f.updates.at(-1).progress,'완료')
})
test('restart after an interrupted Cursor run does not repeat edits',async t=>{
  const f=await fixture(t),job=f.store.job(task);job.phase='cursor';f.store.save();let works=0
  const runner=new Runner({...f,store:new Store(f.store.dir),cursor:async()=>{works++}})
  await runner.tick();assert.equal(works,0);assert.equal(f.updates.at(-1).state,'확인 필요')
})
test('manager lock prevents a second worker',async t=>{
  const f=await fixture(t),release=acquireLock(f.store.dir)
  assert.throws(()=>acquireLock(f.store.dir),/이미 실행/);release();acquireLock(f.store.dir)()
})
test('transient Windows journal locks preserve state and retry replacement',async t=>{
  const f=await fixture(t),rename=fs.renameSync;let attempts=0
  t.mock.method(fs,'renameSync',(from,to)=>{if(attempts++<2)throw Object.assign(Error('file locked'),{code:'EPERM'});return rename(from,to)})
  f.store.data.recovery='kept';f.store.save()
  assert.equal(attempts,3);assert.equal(JSON.parse(fs.readFileSync(f.store.file,'utf8')).recovery,'kept')
})
test('parent credentials are not forwarded to workers and secrets are redacted',()=>{
  assert.equal(childEnv().OPENAI_API_KEY,undefined)
  assert.equal(redact('token=secret-test-long-token',{NOTION_TOKEN:'secret-test-long-token'}),'token=[비밀값 숨김]')
})
test('Notion report retry checks stable marker before appending again',async()=>{
  let appends=0
  const client=new Notion({env:{NOTION_TOKEN:'fixture'},properties:{}},async(url,options)=>({ok:true,json:async()=>{
    if(options.method==='PATCH'){appends++;return{}}
    return{results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'Atelier AI event-1'}]}}],has_more:false}
  }}))
  await client.publish('page',{note:'record',eventId:'event-1'});assert.equal(appends,0)
})

const memoConfig={mode:'memo-board',positions:{queued:'자동화 할 일',working:'자동화 작업 중',needsInput:'확인 필요',done:'완료'},
  properties:{title:'메모',location:'위치',state:'자동화 단계',screen:'화면',area:'영역',answer:'내 답변',question:'확인 질문',
    request:'AI 요청',criteria:'AI 완료 기준',files:'AI 허용 파일',order:'실행 순서',attempt:'실행 회차',result:'작업 결과',completedAt:'자동화 완료 시각',completedDay:'완료일'}}
function memoPage(location='자동화 할 일') {
  return {id:'memo-1',created_time:'2026-10-12T12:00:00Z',properties:{메모:{title:[{plain_text:'내 업무 안내를 정리한다'}]},위치:{select:{name:location}},화면:{select:{name:'내 업무'}},영역:{select:{name:'공용'}}}}
}
function noticeFixture(){
  const page=memoPage('자동화 작업 중')
  page.properties['자동화 단계']={select:{name:'작업 중'}}
  page.properties['내 답변']={rich_text:[{text:{content:'기존 답변'}}]}
  const original={id:'original',type:'paragraph',paragraph:{rich_text:[{text:{content:'원문 설명'}}]}}
  const old={id:'old-notice',type:'callout',has_children:true,callout:{rich_text:[{text:{content:'Atelier AI 확인 필요 안내'}}],children:[{id:'old-question',type:'numbered_list_item',numbered_list_item:{rich_text:[{text:{content:'예전 질문'}}]}}]}}
  const roots=[original,old],blocks=new Map([[old.id,old]]);let appends=0,loseAppend=false
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>{
    let data
    if(url.includes('/pages/')){
      if(options.method==='PATCH')Object.assign(page.properties,JSON.parse(options.body).properties)
      data=page
    }else if(url.includes('/children')){
      const id=url.match(/\/blocks\/([^/]+)\/children/)[1]
      if(options.method==='PATCH'){
        appends++
        for(const child of JSON.parse(options.body).children){
          child.id=`notice-${appends}`;child.has_children=!!child[child.type].children
          roots.push(child);blocks.set(child.id,child)
        }
        if(loseAppend){loseAppend=false;throw new Error('저장 후 응답 유실')}
      }
      data={results:id===page.id?roots.filter(block=>!block.archived):(blocks.get(id)?.callout.children??[]),has_more:false}
    }else if(options.method==='PATCH'){
      const id=url.split('/').at(-1),block=blocks.get(id)
      Object.assign(block,JSON.parse(options.body));data=block
    }else throw new Error('지원하지 않는 검사 요청: '+url)
    return{ok:true,json:async()=>structuredClone(data)}
  })
  client.blockLedger.claim({pageId:page.id,blockId:old.id,kind:'notice',eventId:'v1:legacy:old-notice'})
  return{client,page,original,roots,getAppends:()=>appends,loseNextAppend:()=>{loseAppend=true}}
}
test('resuming clears the old generated question and preserves source and answer',async()=>{
  const f=noticeFixture(),before=await f.client.task(f.page.id)
  f.page.properties.위치={select:{name:'자동화 할 일'}}
  await f.client.publish(f.page.id,{state:'구조 확인'})
  assert.equal(f.roots.filter(block=>!block.archived&&block.type==='callout').length,0)
  const after=await f.client.task(f.page.id)
  assert.equal(after.version,before.version);assert.equal(after.source.answer,'기존 답변')
  assert.equal(f.original.archived,undefined)
})
test('a stopped notice mirrors current feedback and retries a lost append without duplicates',async()=>{
  const f=noticeFixture(),before=await f.client.task(f.page.id)
  const update={state:'확인 필요',summary:'새 중단 이유',question:'새 확인 항목',expectedVersion:before.version}
  f.loseNextAppend()
  await assert.rejects(f.client.publish(f.page.id,update),/응답 유실/)
  await f.client.publish(f.page.id,update)
  const notices=f.roots.filter(block=>!block.archived&&block.type==='callout')
  assert.equal(notices.length,1);assert.equal(f.getAppends(),1)
  assert.deepEqual(notices[0].callout.children.map(block=>block.paragraph.rich_text[0].text.content),['새 중단 이유','새 확인 항목'])
  assert.equal((await f.client.task(f.page.id)).version,before.version)
  f.page.properties.위치={select:{name:'자동화 할 일'}}
  await f.client.publish(f.page.id,update)
  assert.equal(f.page.properties.위치.select.name,'자동화 할 일');assert.equal(f.getAppends(),1)
})
const memoPlan={decision:'execute',executionKind:'implementation',request:'안내를 정리한다',criteria:'기존 내용을 유지한 정확한 안내',files:['note.md'],verificationScripts:['verify:fixture'],reason:'실제 안내 파일과 연결을 확인함'}

async function memoFixture(t) {
  const f=await fixture(t)
  fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify({scripts:{'verify:fixture':'node check.mjs'}}))
  let current=memoTaskFromPage(memoPage(),memoConfig,'본문 요구사항')
  f.config={...f.config,...memoConfig,verificationScripts:[]}
  f.notion.queue=async()=>current.location==='자동화 할 일'?[current]:[]
  f.notion.task=async()=>({...current})
  const publish=f.notion.publish
  f.notion.publish=async(id,update)=>{
    await publish(id,update)
    if(!['자동화 할 일','자동화 작업 중'].includes(current.location)||current.state==='중지')return
    const location=update.state==='완료'?'완료':['확인 필요','오류','중지'].includes(update.state)?'확인 필요'
      :['구조 확인','대기'].includes(update.state)?'자동화 할 일':['작업 중','검토 중','수정 중'].includes(update.state)?'자동화 작업 중':current.location
    current={...current,state:update.state??current.state,location,enabled:['자동화 할 일','자동화 작업 중'].includes(location)}
  }
  f.notion.savePlan=async(id,plan)=>{
    const page=memoPage(current.location)
    for(const [name,value] of Object.entries({'내 답변':current.source.answer,'작업 결과':current.previousResult,'확인 질문':current.previousQuestion}))page.properties[name]={rich_text:[{plain_text:value??''}]}
    for(const [name,value] of Object.entries({'AI 요청':plan.request,'AI 완료 기준':plan.criteria,'AI 허용 파일':plan.files.join('\n')}))page.properties[name]={rich_text:[{plain_text:value}]}
    current=memoTaskFromPage(page,memoConfig,current.source.body)
  }
  f.plan=async()=>memoPlan
  f.refreshMap=async()=>{}
  return {...f,getCurrent:()=>current,setCurrent:v=>{current=v}}
}

test('memo identity retains source, answer and body but ignores reports and prepared fields',()=>{
  const page=memoPage(),a=memoTaskFromPage(page,memoConfig,'원문')
  page.properties.위치.select.name='자동화 작업 중'
  page.properties['AI 요청']={rich_text:[{plain_text:'조사로 준비한 지시'}]}
  const prepared=memoTaskFromPage(page,memoConfig,'원문')
  assert.equal(prepared.version,a.version);assert.notEqual(prepared.planVersion,a.planVersion);assert.equal(prepared.enabled,true)
  page.properties['작업 결과']={rich_text:[{plain_text:'이전 작업 결과'}]}
  page.properties['확인 질문']={rich_text:[{plain_text:'앞서 물어본 질문'}]}
  const history=memoTaskFromPage(page,memoConfig,'원문')
  assert.equal(history.version,a.version);assert.equal(history.previousResult,'이전 작업 결과');assert.equal(history.previousQuestion,'앞서 물어본 질문')
  assert.notEqual(memoTaskFromPage(page,memoConfig,'추가된 원문').version,a.version)
  page.properties['내 답변']={rich_text:[{plain_text:'면제 직책은 대표만'}]}
  assert.notEqual(memoTaskFromPage(page,memoConfig,'원문').version,a.version)
  page.properties.위치.select.name='직접 할 일';assert.equal(memoTaskFromPage(page,memoConfig).enabled,false)
})

test('new answers refresh stale queue and generated instructions before editing',async t=>{
  const f=await memoFixture(t),stale=f.getCurrent(),order=[]
  const page=memoPage()
  for(const [name,value] of Object.entries({'내 답변':'아직 이미지 크기가 제각각입니다. 고쳐 주세요.','AI 요청':'소스를 고치지 말고 검증만 하라','AI 완료 기준':'검증 단계에서는 수정 금지','AI 허용 파일':'other.md','작업 결과':'로그인한 화면 증거가 없어 멈춤','확인 질문':'이미지 크기가 같은가요?'}))page.properties[name]={rich_text:[{plain_text:value}]}
  f.setCurrent(memoTaskFromPage(page,memoConfig,'본문 요구사항'))
  f.notion.queue=async()=>[stale]
  const save=f.notion.savePlan
  f.notion.savePlan=async(...args)=>{order.push('save');await save(...args)}
  const refreshed={...memoPlan,request:'사용자가 확인한 이미지 크기 오류의 원인을 조사하고 수정한다',feedback:{kind:'problem_reported',summary:'이미지 크기가 다르다는 사용자 관찰을 수정 요청으로 반영'}}
  const runner=new Runner({...f,plan:async({task})=>{
    order.push('plan');assert.match(task.source.answer,/제각각/);assert.match(task.previousResult,/화면 증거/);assert.match(task.previousQuestion,/크기/)
    const prompt=planningPrompt(task,{})
    assert.match(prompt,/과거 참고 자료/);assert.match(prompt,/제약으로 보존하지 말 것/);assert.doesNotMatch(prompt,/있으면 제약으로 보존하세요/)
    return refreshed
  },cursor:async({prompt,files})=>{
    order.push('edit');assert.deepEqual(files,['note.md']);assert.match(prompt,/원인을 조사하고 수정/);assert.doesNotMatch(prompt,/소스를 고치지 말고 검증만 하라/)
    assert.equal(f.getCurrent().request,refreshed.request);fs.writeFileSync(path.join(f.root,'note.md'),'완료');return{report:'수정됨'}
  },review:async()=>pass})
  await runner.tick()
  assert.deepEqual(order,['plan','save','edit']);assert.equal(f.updates.at(-1).state,'완료')
  assert.equal(f.getCurrent().source.answer,page.properties['내 답변'].rich_text[0].plain_text)
})

test('a reported failure cannot be dispatched as verification-only or omit answer handling',async t=>{
  const f=await memoFixture(t),answered={...f.getCurrent(),source:{...f.getCurrent().source,answer:'아직 크기가 달라요'}}
  assert.throws(()=>validatePlan(memoPlan,f.root,answered),/최신 사용자 답변/)
  const feedback={kind:'problem_reported',summary:'크기 오류를 고쳐야 함'}
  assert.throws(()=>validatePlan({...memoPlan,executionKind:'verification',feedback},f.root,answered),/검증 전용으로 되돌리는/)
  assert.equal(validatePlan({...memoPlan,feedback},f.root,answered).executionKind,'implementation')
})

test('fresh investigation may replace obsolete generated file scopes without editing during planning',async t=>{
  const f=await memoFixture(t),dir=path.join(f.root,'dev-tools/structure-map/generated')
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'structure.json'),JSON.stringify({nodes:[],domains:[],nav:[],routes:[],edges:[]}))
  const task={...f.getCurrent(),request:'옛 검증 전용 지시',files:'other.md'}
  const plan=await prepareMemo({config:f.config,root:f.root,task,runDir:f.store.runDir(f.store.job(task)),investigate:async({files,prompt})=>{
    assert.deepEqual(files,[]);assert.match(prompt,/이전 AI 요청.*과거 참고 자료/);return{report:JSON.stringify(memoPlan)}
  }})
  assert.deepEqual(plan.files,['note.md'])
})

test('stale answer handling is corrected internally before dispatch',async t=>{
  const f=await memoFixture(t),dir=path.join(f.root,'dev-tools/structure-map/generated')
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'structure.json'),JSON.stringify({nodes:[],domains:[],nav:[],routes:[],edges:[]}))
  const task={...f.getCurrent(),source:{...f.getCurrent().source,answer:'아직 크기가 달라요'}}
  const feedback={kind:'problem_reported',summary:'크기 오류를 수정해야 함'};let calls=0
  const plan=await prepareMemo({config:f.config,root:f.root,task,runDir:f.store.runDir(f.store.job(task)),investigate:async({prompt})=>{
    calls++;if(calls===2)assert.match(prompt,/검증 전용으로 되돌리는 계획/)
    return{report:JSON.stringify({...memoPlan,executionKind:calls===1?'verification':'implementation',feedback})}
  }})
  assert.equal(calls,2);assert.equal(plan.executionKind,'implementation')
})

test('a stale source discovered before investigation waits for the new selection without publishing a stop',async t=>{
  const f=await memoFixture(t),old=f.store.job(f.getCurrent());let planned=0,edited=0
  f.setCurrent({...f.getCurrent(),version:'latest-answer',source:{...f.getCurrent().source,body:'최신 본문'}})
  await new Runner({...f,plan:async()=>{planned++;return memoPlan},cursor:async()=>{edited++}}).execute(old)
  assert.equal(old.phase,'superseded');assert.equal(planned,0);assert.equal(edited,0);assert.equal(f.updates.length,0)
})

test('conflicting work stays queued and refreshes its plan again when dispatched',async t=>{
  const f=await memoFixture(t);let admitted=false,plans=0,edits=0
  const runner=new Runner({...f,plan:async()=>{plans++;return memoPlan},beforeImplementation:async()=>admitted,
    cursor:async()=>{edits++;fs.writeFileSync(path.join(f.root,'note.md'),'완료');return{report:'완료'}},review:async()=>pass})
  const job=f.store.job(f.getCurrent());await runner.execute(job)
  assert.equal(job.phase,'waiting');assert.equal(f.updates.at(-1).state,'대기');assert.equal(edits,0)
  admitted=true;await runner.execute(job)
  assert.equal(plans,2);assert.equal(edits,1);assert.equal(f.updates.at(-1).state,'완료')
})

test('explicitly requeueing a stopped memo refreshes it without requiring edits to AI properties',async t=>{
  const f=await memoFixture(t),current=f.getCurrent(),old=f.store.job(current)
  old.phase='needs_input';old.error='서비스 연결 일시 중단';f.store.save()
  f.setCurrent({...current,state:'확인 필요'})
  const publish=f.notion.publish
  f.notion.publish=async(id,update)=>{await publish(id,update);f.setCurrent({...f.getCurrent(),state:update.state,location:update.state==='완료'?'완료':update.state==='작업 중'?'자동화 작업 중':'자동화 할 일'})}
  let plans=0,edits=0
  const runner=new Runner({...f,plan:async()=>{plans++;return memoPlan},cursor:async()=>{edits++;fs.writeFileSync(path.join(f.root,'note.md'),'완료');return{report:'완료'}},review:async()=>pass})
  await runner.tick();await runner.tick()
  assert.equal(plans,1);assert.equal(edits,1);assert.equal(old.error,'서비스 연결 일시 중단')
  assert.ok(Object.values(f.store.data.jobs).some(job=>job.runId===old.runId&&job.phase==='needs_input'))
})

test('a requeued stopped memo with a waiting stage refreshes once and preserves its old run',async t=>{
  const f=await memoFixture(t),current=f.getCurrent(),old=f.store.job(current)
  old.phase='needs_input';old.error='서비스 연결 일시 중단';f.store.save()
  f.setCurrent({...current,state:'대기'})
  const publish=f.notion.publish
  f.notion.publish=async(id,update)=>{await publish(id,update);f.setCurrent({...f.getCurrent(),state:update.state,location:update.state==='완료'?'완료':update.state==='작업 중'?'자동화 작업 중':'자동화 할 일'})}
  let plans=0,edits=0
  const runner=new Runner({...f,plan:async()=>{plans++;return memoPlan},cursor:async()=>{edits++;fs.writeFileSync(path.join(f.root,'note.md'),'완료');return{report:'완료'}},review:async()=>pass})
  await runner.tick();await runner.tick()
  assert.equal(plans,1);assert.equal(edits,1);assert.equal(old.error,'서비스 연결 일시 중단')
  assert.ok(Object.values(f.store.data.jobs).some(job=>job.runId===old.runId&&job.phase==='needs_input'))
})

test('preparation remains in automation todo until the implementation publication',async()=>{
  const page=memoPage(),patches=[]
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
    if(options.method==='PATCH'){const properties=JSON.parse(options.body).properties;patches.push(properties);Object.assign(page.properties,properties);return page}
    if(url.includes('/children'))return{results:[],has_more:false}
    return page
  }}))
  await client.publish(page.id,{state:'구조 확인'})
  assert.equal(patches.at(-1)['위치'].select.name,'자동화 할 일')
  await client.publish(page.id,{state:'작업 중'})
  assert.equal(patches.at(-1)['위치'].select.name,'자동화 작업 중')
  await client.publish(page.id,{state:'대기'})
  assert.equal(patches.at(-1)['위치'].select.name,'자동화 할 일')
})

test('a delayed terminal write cannot undo a deliberate requeue of its already visible result',async()=>{
  for(const state of ['확인 필요','오류','완료']){
    const page=memoPage();page.properties['자동화 단계']={select:{name:state}}
    page.properties['자동화 완료 시각']={date:{start:'2026-10-13T05:00:00Z'}};let writes=0
    const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
      if(options.method==='PATCH')writes++
      return page
    }}))
    await client.publish(page.id,{state,completedAt:'2026-10-13T05:00:30Z',summary:'이전 결과',report:easyReport,source:{screen:'내 업무',area:'공용'}})
    assert.equal(writes,0);assert.equal(page.properties['위치'].select.name,'자동화 할 일')
  }
})

test('memo API queries only selected work and ignores nested execution records in source versions',async()=>{
  const seen=[],page=memoPage()
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'},dataSourceId:'fixture-source'},async(url,options)=>({ok:true,json:async()=>{
    seen.push({url,body:options.body?JSON.parse(options.body):undefined})
    if(url.includes('/query'))return{results:[page],has_more:false}
    return{results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'직접 적은 설명'}]}},{id:'report',type:'toggle',has_children:true,toggle:{rich_text:[{plain_text:'Atelier AI event-1'}]}}],has_more:false}
  }}))
  client.blockLedger.claim({pageId:page.id,blockId:'report',kind:'toggle',eventId:'legacy:report'})
  const tasks=await client.queue()
  assert.equal(seen[0].body.filter.select.equals,'자동화 할 일')
  assert.equal(tasks[0].source.body,'직접 적은 설명')
  assert.ok(!seen.some(s=>s.url.includes('blocks/report/')))
})

test('memo planning, verification and independent review precede completion',async t=>{
  const f=await memoFixture(t);let plans=0,edits=0
  const runner=new Runner({...f,plan:async()=>{plans++;return memoPlan},cursor:async({prompt})=>{edits++;assert.match(prompt,/내 업무/);fs.writeFileSync(path.join(f.root,'note.md'),'완료');return{report:'완료'}},
    verify:async config=>{assert.ok(config.verificationScripts.includes('verify:fixture'));return f.verify()},review:async()=>pass})
  await runner.tick();await runner.tick()
  assert.equal(plans,1);assert.equal(edits,1)
  assert.equal(f.updates[0].state,'구조 확인');assert.equal(f.updates.at(-1).state,'완료');assert.ok(f.updates.at(-1).completedAt)
  assert.ok(f.updates.at(-1).expectedPlanVersion)
})

test('unknown company policy produces a question without implementation or completion',async t=>{
  const f=await memoFixture(t);let edited=false
  const runner=new Runner({...f,plan:async()=>({decision:'blocked',reason:'코드로 회사 정책을 확인할 수 없음',question:'출퇴근 기록을 면제할 직책은 무엇인가요?'}),cursor:async()=>{edited=true}})
  await runner.tick()
  assert.equal(edited,false);assert.equal(f.updates.at(-1).state,'확인 필요');assert.match(f.updates.at(-1).question,/직책/)
  assert.ok(!f.updates.some(u=>u.state==='완료'))
})

test('read-only planning detects unrelated changes and does not overwrite them',async t=>{
  const f=await memoFixture(t);let edited=false
  const runner=new Runner({...f,plan:async()=>{fs.writeFileSync(path.join(f.root,'other.md'),'동시 수정');return memoPlan},cursor:async()=>{edited=true}})
  await runner.tick();assert.equal(edited,false);assert.equal(f.updates.at(-1).state,'확인 필요')
  assert.equal(fs.readFileSync(path.join(f.root,'other.md'),'utf8'),'동시 수정')
})

test('moving a card out of automation during planning prevents code edits',async t=>{
  const f=await memoFixture(t);let edited=false
  const runner=new Runner({...f,plan:async()=>{f.setCurrent({...f.getCurrent(),enabled:false,location:'메모'});return memoPlan},cursor:async()=>{edited=true}})
  await runner.tick();assert.equal(edited,false);assert.equal(f.updates.at(-1).state,'중지')
})

test('concurrent code changes during plan save or ready read are not absorbed into a new baseline',async t=>{
  for(const boundary of ['save','ready']){
    const f=await memoFixture(t);let edits=0,saved=false
    const save=f.notion.savePlan,read=f.notion.task
    f.notion.savePlan=async(...args)=>{await save(...args);saved=true;if(boundary==='save')fs.writeFileSync(path.join(f.root,'other.md'),'사용자 변경')}
    f.notion.task=async(...args)=>{if(saved&&boundary==='ready')fs.writeFileSync(path.join(f.root,'other.md'),'사용자 변경');return read(...args)}
    await new Runner({...f,cursor:async()=>{edits++;return{report:'완료'}}}).tick()
    assert.equal(edits,0);assert.equal(f.updates.at(-1).state,'확인 필요');assert.ok(!f.updates.some(u=>u.state==='완료'))
    assert.equal(fs.readFileSync(path.join(f.root,'other.md'),'utf8'),'사용자 변경')
  }
})

test('user plan changes just after saving are preserved without starting implementation',async t=>{
  for(const field of ['request','criteria','files']){
    const f=await memoFixture(t);let edits=0
    const save=f.notion.savePlan
    f.notion.savePlan=async(...args)=>{await save(...args);f.setCurrent({...f.getCurrent(),[field]:'사용자 새 설정',planVersion:'user-new-settings'})}
    await new Runner({...f,cursor:async()=>{edits++;return{report:'완료'}}}).tick()
    assert.equal(edits,0);assert.equal(f.updates.at(-1).state,'확인 필요');assert.ok(!f.updates.some(u=>u.state==='완료'))
    assert.equal(f.getCurrent()[field],'사용자 새 설정')
  }
})

test('a late monitor response cannot crash a finished job or abort the next job',async t=>{
  const f=await memoFixture(t);let poll,pending,resolveRead,deferNext=false
  t.mock.method(globalThis,'setInterval',fn=>{poll=fn;return 1})
  t.mock.method(globalThis,'clearInterval',()=>{})
  const read=f.notion.task
  f.notion.task=async(...args)=>{
    if(deferNext){deferNext=false;return new Promise(resolve=>{resolveRead=resolve})}
    return read(...args)
  }
  const runner=new Runner({...f,cursor:async()=>{deferNext=true;pending=poll();fs.writeFileSync(path.join(f.root,'note.md'),'완료');return{report:'완료'}},review:async()=>pass})
  await runner.tick();assert.equal(f.updates.at(-1).state,'완료');assert.equal(runner.controller,null)
  const nextController=new AbortController();runner.controller=nextController
  resolveRead({...f.getCurrent(),enabled:false});await pending
  assert.equal(nextController.signal.aborted,false)
  runner.controller=null
})

test('prepared criteria edits stop a running memo task before completion',async t=>{
  const f=await memoFixture(t)
  const runner=new Runner({...f,cursor:async()=>{fs.writeFileSync(path.join(f.root,'note.md'),'수정');f.setCurrent({...f.getCurrent(),planVersion:'user-changed-plan'});return{report:'완료'}},review:async()=>pass})
  await runner.tick();assert.equal(f.updates.at(-1).state,'확인 필요');assert.ok(!f.updates.some(u=>u.state==='완료'))
})

test('completion publication preserves Korean day across midnight and respects manual cancellation',async()=>{
  assert.equal(completionDay('2026-10-12T15:10:00.000Z'),'2026-10-13')
  const patches=[],page=memoPage('자동화 작업 중')
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
    if(options.method==='PATCH'){if(!url.includes('/children'))patches.push(JSON.parse(options.body));return{}}
    if(url.includes('/children'))return{results:[],has_more:false}
    return page
  }}))
  const reportUpdate={report:easyReport,source:{screen:'내 업무',area:'공용'}}
  await client.publish('memo-1',{state:'완료',completedAt:'2026-10-12T15:10:00.000Z',summary:'검토 통과',...reportUpdate})
  assert.equal(patches[0].properties['위치'].select.name,'완료')
  assert.equal(patches[0].properties['완료일'].date.start,'2026-10-13')
  assert.equal(patches[0].properties['자동화 완료 시각'].date.start,'2026-10-12T15:10:00.000Z')
  page.properties.위치.select.name='메모'
  await client.publish('memo-1',{state:'완료',completedAt:'2026-10-12T15:10:00.000Z',...reportUpdate})
  assert.equal(patches.length,1)
  page.properties.위치.select.name='완료'
  page.properties['자동화 완료 시각']={date:{start:'2026-10-13T00:10:00.000+09:00'}}
  await client.publish('memo-1',{state:'완료',completedAt:'2026-10-12T15:10:00.000Z',...reportUpdate})
  assert.equal(patches.length,2)
})

test('delayed completion publication does not complete a newer memo version',async()=>{
  const page=memoPage('자동화 작업 중'),previous=memoTaskFromPage(page,memoConfig,'원래 요청')
  let patches=0
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
    if(options.method==='PATCH'){patches++;return{}}
    if(url.includes('/children'))return{results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'사용자가 바꾼 요청'}]}}],has_more:false}
    return page
  }}))
  await client.publish('memo-1',{state:'완료',completedAt:'2026-10-13T05:00:00Z',expectedVersion:previous.version,report:easyReport,source:previous.source})
  assert.equal(patches,0)
})

test('planner rejects missing evidence, DB scope and unknown verification commands',async t=>{
  const f=await memoFixture(t)
  assert.throws(()=>validatePlan({...memoPlan,reason:''},f.root))
  assert.throws(()=>validatePlan({...memoPlan,files:['supabase/migrations/new.sql']},f.root))
  assert.throws(()=>validatePlan({...memoPlan,verificationScripts:['verify:unknown']},f.root))
  assert.throws(()=>validatePlan({decision:'blocked',reason:'정책 미정'},f.root))
  assert.equal(validatePlan(memoPlan,f.root).files[0],'note.md')
})

test('nontechnical completion report has location, visible changes, usage and actual completion time',()=>{
  const block=completionReportBlock({source:{area:'공용',screen:'내 업무'}},easyReport,'2026-10-12T15:10:00Z')
  const content=JSON.stringify(block)
  assert.match(content,/2026-10-13 00:10:00/);assert.match(content,/작업한 곳/);assert.match(content,/바뀐 점/);assert.match(content,/사용 방법/)
  assert.match(content,/운영 사이트 게시/)
  assert.throws(()=>validateCompletionReport({...easyReport,changes:[]}))
  assert.throws(()=>validateCompletionReport({...easyReport,checked:['src/App.tsx를 수정하고 npm run build를 수행했습니다.']}))
  assert.throws(()=>validateReview({...pass,report:null},{requireReport:true}))
  assert.throws(()=>validateCompletionReport({...easyReport,deployment:undefined}))
})

test('memo publication keeps worker conversations local and writes one completion report',async()=>{
  const page=memoPage('자동화 작업 중'),records=[],propertyWrites=[]
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
    if(options.method==='PATCH'&&url.includes('/children')){records.push(...JSON.parse(options.body).children);return{}}
    if(options.method==='PATCH'){const body=JSON.parse(options.body);propertyWrites.push(body);Object.assign(page.properties,body.properties);return{}}
    if(url.includes('/children'))return{results:records,has_more:false}
    return page
  }}))
  await client.publish('memo-1',{state:'작업 중',note:'개발자용 지시와 Cursor 대화',summary:'진행 중'})
  assert.equal(records.length,0)
  assert.ok(!propertyWrites[0].properties['작업 결과'])
  const completed={state:'완료',completedAt:'2026-10-13T05:00:00Z',report:easyReport,source:{screen:'내 업무',area:'공용'},note:'원시 검토 JSON과 Cursor 대화'}
  await client.publish('memo-1',completed);await client.publish('memo-1',completed)
  assert.equal(records.length,1);assert.equal(records[0].type,'callout');assert.ok(!JSON.stringify(records).includes('Cursor'))
  // The visible report must not become a new original memo and retrigger work.
  assert.equal(await client.memoBody('memo-1'),'')
})

test('explicit stopped state blocks late progress and completion writes',async()=>{
  const page=memoPage('자동화 작업 중');page.properties['자동화 단계']={select:{name:'중지'}}
  let writes=0
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{if(options.method==='PATCH')writes++;return page}}))
  await assert.rejects(client.publish('memo-1',{state:'작업 중',summary:'계속 작업'}),error=>error.stopped&&error.discardUpdate)
  await client.publish('memo-1',{state:'완료',completedAt:'2026-10-13T05:00:00Z',report:easyReport,source:{screen:'내 업무',area:'공용'}})
  assert.equal(writes,0)
})

test('memo change records a stop without replacing the new source',async()=>{
  const page=memoPage('자동화 작업 중'),original=memoTaskFromPage(page,memoConfig,'원래 본문'),patches=[]
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
    if(options.method==='PATCH'){patches.push(JSON.parse(options.body));return{}}
    if(url.includes('/children'))return{results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'사용자가 추가한 내용'}]}}],has_more:false}
    return page
  }}))
  await client.publish('memo-1',{state:'확인 필요',expectedVersion:original.version,summary:'작업 중 메모가 바뀌었습니다.'})
  assert.equal(patches[0].properties['위치'].select.name,'확인 필요')
  assert.ok(!patches[0].properties['메모'])
})

test('plan settings changed during read-only investigation are not overwritten',async t=>{
  const f=await memoFixture(t);let saves=0
  f.notion.savePlan=async()=>{saves++}
  const runner=new Runner({...f,plan:async()=>{f.setCurrent({...f.getCurrent(),planVersion:'new-user-criteria'});return memoPlan}})
  await runner.tick();assert.equal(saves,0);assert.equal(f.updates.at(-1).state,'확인 필요')
})

test('plan storage rechecks source, settings and stop state immediately before writing',async()=>{
  const page=memoPage('자동화 작업 중'),expected=memoTaskFromPage(page,memoConfig),patches=[]
  page.properties['AI 완료 기준']={rich_text:[{plain_text:'새 완료 기준'}]}
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
    if(options.method==='PATCH'){patches.push(options);return{}}
    if(url.includes('/children'))return{results:[],has_more:false}
    return page
  }}))
  await assert.rejects(client.savePlan('memo-1',memoPlan,expected),/덮어쓰지/)
  assert.equal(patches.length,0)
})

test('attachments and link changes affect the source while signed URL expiry does not',async()=>{
  const image={type:'image',image:{type:'file',file:{url:'https://files.example/a.png?sig=1',expiry_time:'2026-10-13'}}}
  const link={type:'paragraph',paragraph:{rich_text:[{plain_text:'참고 자료',text:{content:'참고 자료',link:{url:'https://example.test/first'}}}]}}
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async()=>({ok:true,json:async()=>({results:[image,link],has_more:false})}))
  const before=await client.memoBody('memo-1')
  image.image.file.url='https://files.example/a.png?sig=2';image.image.file.expiry_time='2026-10-14'
  assert.equal(await client.memoBody('memo-1'),before)
  link.paragraph.rich_text[0].text.link.url='https://example.test/second'
  assert.notEqual(await client.memoBody('memo-1'),before)
  image.image.file.url='https://files.example/b.png?sig=3'
  assert.match(await client.memoBody('memo-1'),/b.png/)
})

test('completion outbox does not complete changed request, criteria or file scope',async()=>{
  for(const field of ['AI 요청','AI 완료 기준','AI 허용 파일']){
    const page=memoPage('자동화 작업 중'),expected=memoTaskFromPage(page,memoConfig)
    page.properties[field]={rich_text:[{plain_text:'사용자가 바꾼 새 설정'}]}
    let writes=0
    const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
      if(options.method==='PATCH'){writes++;return{}}
      if(url.includes('/children'))return{results:[],has_more:false}
      return page
    }}))
    await client.publish('memo-1',{state:'완료',completedAt:'2026-10-13T05:00:00Z',report:easyReport,source:expected.source,expectedVersion:expected.version,expectedPlanVersion:expected.planVersion})
    assert.equal(writes,0,field)
  }
})

test('after the completion property write, moving to memo or direct work blocks report retry',async()=>{
  for(const position of ['메모','직접 할 일']){
    const page=memoPage(position);page.properties['자동화 완료 시각']={date:{start:'2026-10-13T05:00:00Z'}}
    const expected=memoTaskFromPage(page,memoConfig)
    let writes=0
    const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
      if(options.method==='PATCH'){writes++;return{}}
      if(url.includes('/children'))return{results:[],has_more:false}
      return page
    }}))
    await client.publish('memo-1',{state:'완료',completedAt:'2026-10-13T05:00:00Z',report:easyReport,source:expected.source,expectedVersion:expected.version,expectedPlanVersion:expected.planVersion})
    assert.equal(writes,0,position)
  }
})

test('changes during original-block traversal are rechecked before completion properties',async()=>{
  for(const change of ['cancel','stop','plan']){
    const page=memoPage('자동화 작업 중'),expected=memoTaskFromPage(page,memoConfig);let writes=0
    const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
      if(options.method==='PATCH'){writes++;return{}}
      if(url.includes('/children')){
        if(change==='cancel')page.properties.위치.select.name='메모'
        if(change==='stop')page.properties['자동화 단계']={select:{name:'중지'}}
        if(change==='plan')page.properties['AI 완료 기준']={rich_text:[{plain_text:'새 기준'}]}
        return{results:[],has_more:false}
      }
      return structuredClone(page)
    }}))
    await client.publish('memo-1',{state:'완료',completedAt:'2026-10-13T05:00:00Z',report:easyReport,source:expected.source,expectedVersion:expected.version,expectedPlanVersion:expected.planVersion})
    assert.equal(writes,0,change)
  }
})

test('cancellation or memo edits after completion properties prevent the report append',async()=>{
  for(const change of ['cancel','source']){
    const page=memoPage('자동화 작업 중'),expected=memoTaskFromPage(page,memoConfig);let propertyWrites=0,reports=0,changedBody=false
    const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
      if(options.method==='PATCH'&&url.includes('/children')){reports++;return{}}
      if(options.method==='PATCH'){
        propertyWrites++;Object.assign(page.properties,JSON.parse(options.body).properties)
        if(change==='cancel')page.properties.위치.select.name='메모'
        if(change==='source')changedBody=true
        return{}
      }
      if(url.includes('/children'))return{results:changedBody?[{type:'paragraph',paragraph:{rich_text:[{plain_text:'새 원문'}]}}]:[],has_more:false}
      return structuredClone(page)
    }}))
    await client.publish('memo-1',{state:'완료',completedAt:'2026-10-13T05:00:00Z',report:easyReport,source:expected.source,expectedVersion:expected.version,expectedPlanVersion:expected.planVersion})
    assert.equal(propertyWrites,1);assert.equal(reports,0,change)
  }
})

test('Notion minute precision does not drop a precise completion report',async()=>{
  const page=memoPage('자동화 작업 중'),expected=memoTaskFromPage(page,memoConfig);let reports=0
  const client=new Notion({...memoConfig,env:{NOTION_TOKEN:'fixture'}},async(url,options)=>({ok:true,json:async()=>{
    if(options.method==='PATCH'&&url.includes('/children')){reports++;return{}}
    if(options.method==='PATCH'){
      Object.assign(page.properties,JSON.parse(options.body).properties)
      page.properties['자동화 완료 시각'].date.start='2026-10-13T05:00:00.000+00:00'
      return{}
    }
    if(url.includes('/children'))return{results:[],has_more:false}
    return structuredClone(page)
  }}))
  await client.publish('memo-1',{state:'완료',completedAt:'2026-10-13T05:00:42.987Z',report:easyReport,source:expected.source,expectedVersion:expected.version,expectedPlanVersion:expected.planVersion})
  assert.equal(reports,1)
})

test('unstable Notion reads retain the completion outbox for retry',async()=>{
  const page=memoPage('자동화 작업 중'),expected=memoTaskFromPage(page,memoConfig)
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-memo-outbox-'))
  try{
    const store=new Store(root),job=store.job(expected)
    store.enqueue(job,{state:'완료',completedAt:'2026-10-13T05:00:42Z',report:easyReport,source:expected.source,expectedVersion:expected.version})
    const client=new Notion(memoConfig)
    client.memoSnapshot=async()=>({page,task:expected,unstable:true})
    await assert.rejects(store.flush(client),/재시도/)
    assert.equal(store.data.outbox.length,1)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('cancellation observed when publishing progress stops before Cursor and discards that event',async t=>{
  for(const position of ['메모','직접 할 일']){
    const f=await memoFixture(t);let writes=0,edits=0
    const client=new Notion(memoConfig)
    client.memoSnapshot=async()=>({page:memoPage(position),task:f.getCurrent(),unstable:false})
    client.api=async()=>{writes++;return{}}
    const publish=f.notion.publish
    f.notion.publish=async(id,update)=>{
      if(update.state==='작업 중'){
        f.setCurrent({...f.getCurrent(),enabled:false,location:position})
        return client.publish(id,update)
      }
      if(update.state==='중지')return client.publish(id,update)
      return publish(id,update)
    }
    await new Runner({...f,cursor:async()=>{edits++;return{report:'완료'}}}).tick()
    assert.equal(writes,0);assert.equal(edits,0);assert.equal(f.store.data.outbox.length,0)
    assert.equal(f.getCurrent().location,position)
  }
})
