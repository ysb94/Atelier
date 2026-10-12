import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { taskFromPage, Notion } from './notion.mjs'
import { taskFiles, redact, projectRoot, cursorServers, cursorPlugins, settings } from './settings.mjs'
import { permissionDecision } from './acp.mjs'
import { validateReview } from './reviewer.mjs'
import { Store, acquireLock } from './store.mjs'
import { Runner } from './runner.mjs'
import { runCommand, childEnv } from './process.mjs'
import { publicMcpConfig } from './mcp.mjs'

const pass={decision:'pass',summary:'완료 기준 충족',criteriaResults:[{criterion:'파일 내용',passed:true,evidence:'실제 파일과 diff 확인'}],issues:[],nextPrompt:''}
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
