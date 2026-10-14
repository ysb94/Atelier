import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SourceReader } from './source-reader.mjs'
import { digest,readFile } from './workspace.mjs'
import { runCommand } from './process.mjs'
import { toolDir } from './settings.mjs'
import { runReview } from './reviewer.mjs'

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-reader-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const write=(file,body)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),body);return digest(body)}
  return {root,write}
}

test('oversized requested source ranges are delivered in exact pages, without widening the per-response limit',t=>{
  const {root,write}=fixture(t),file='src/large.ts',body=Array.from({length:3000},(_,i)=>`export const value${i} = '${'x'.repeat(60)}';`).join('\n')
  const reader=new SourceReader({root,snapshot:{[file]:write(file,body)}})
  let start=100,end=800;const pages=[]
  do {const result=reader.call('read_source',{path:file,startLine:start,endLine:end});assert.ok(result.content.length<=10000);pages.push(result.content);start=result.nextLine}while(start)
  assert.equal(pages.join('\n'),body.split('\n').slice(99,800).join('\n'))
  assert.ok(pages.length>1);assert.equal(reader.audit.reads[0].sha256,digest(body))
})

test('large generated maps are filtered, and missing guessed paths can be resolved to actual paths',t=>{
  const {root,write}=fixture(t),file='src/lib/company/company-paths.ts'
  const hash=write(file,'export const companyPath = "/company";')
  write('dev-tools/structure-map/generated/structure.json',JSON.stringify({nodes:[{path:file,label:'회사 경로'}],edges:[],routes:[],padding:'x'.repeat(2100000)}))
  const reader=new SourceReader({root,snapshot:{[file]:hash},taskFiles:[file]})
  assert.throws(()=>readFile(root,'dev-tools/structure-map/generated/structure.json'),/파일 크기/)
  const result=reader.call('read_source',{path:'dev-tools/structure-map/generated/structure.json'})
  assert.ok(JSON.stringify(result).length<2000);assert.equal(result.nodes[0].path,file)
  assert.equal(reader.call('read_source',{path:'src/lib/workspace/company-paths.ts'}).missing,true)
  assert.deepEqual(reader.call('find_sources',{query:'company-paths'}).files,[file])
  assert.equal(reader.call('search_source',{query:'companyPath',path:file}).matches[0].line,1)
})

test('search pagination resumes after the last match instead of repeating the same file',t=>{
  const {root,write}=fixture(t),file='src/matches.ts',body=Array.from({length:45},(_,i)=>`const match${i} = 1;`).join('\n')
  const reader=new SourceReader({root,snapshot:{[file]:write(file,body)}}),matches=[]
  let offset=0,lineOffset=1
  do{const result=reader.call('search_source',{query:'match',path:file,offset,lineOffset});matches.push(...result.matches);offset=result.nextFileOffset;lineOffset=result.nextLineOffset??1}while(offset!==null)
  assert.deepEqual(matches.map(v=>v.line),Array.from({length:45},(_,i)=>i+1))
})

test('reader cannot expose private files, escape via symlinks, or accept changed source hashes',t=>{
  const {root,write}=fixture(t),file='src/a.ts',hash=write(file,'original')
  const reader=new SourceReader({root,snapshot:{[file]:hash,'.env.local':write('.env.local','private value')}})
  assert.throws(()=>reader.call('read_source',{path:'.env.local'}),/비공개/)
  assert.throws(()=>reader.call('read_source',{path:'../outside.ts'}),/밖/)
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}))
  fs.writeFileSync(path.join(outside,'private.ts'),'private value');fs.symlinkSync(path.join(outside,'private.ts'),path.join(root,'src/link.ts'))
  reader.manifest.snapshot['src/link.ts']=digest('private value')
  assert.throws(()=>reader.call('read_source',{path:'src/link.ts'}),/밖/)
  write(file,'changed');assert.throws(()=>reader.call('read_source',{path:file}),/소스가 바뀌/)
  assert.equal(reader.audit.invalidated,true)
})

test('failed deliveries never satisfy diff coverage and read budgets are explicit',t=>{
  const {root}=fixture(t),diff=Array.from({length:500},(_,i)=>`+ added ${i}`).join('\n')
  const reader=new SourceReader({root,snapshot:{},changes:[{file:null,diff}],limits:{totalChars:100}})
  assert.throws(()=>reader.call('read_diff',{index:0}),/자료 읽기 한도/)
  assert.equal(reader.audit.diffReads.length,0);assert.equal(reader.audit.exhausted,true)
  assert.equal(reader.coverage().missingDiffs.length,1)
  const complete=new SourceReader({root,snapshot:{},changes:[{file:null,diff}]})
  let start=1
  do{start=complete.call('read_diff',{index:0,startLine:start}).nextLine}while(start)
  assert.equal(complete.coverage().missingDiffs.length,0)
})

test('stdio MCP supports initialization and bounded read-only tool calls without a model',async t=>{
  const {root,write}=fixture(t),file='src/a.ts',hash=write(file,'export const value = 1;'),manifest=path.join(root,'manifest.json'),audit=path.join(root,'audit.json')
  fs.writeFileSync(manifest,JSON.stringify({root,snapshot:{[file]:hash}}))
  const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'read_source',arguments:{path:file}}}].map(value=>JSON.stringify(value)).join('\n')+'\n'
  const result=await runCommand(process.execPath,[path.join(toolDir,'source-reader.mjs'),manifest,audit],{input,cwd:root})
  const replies=result.output.trim().split('\n').map(JSON.parse)
  assert.equal(replies[0].result.capabilities.tools.constructor,Object)
  assert.ok(replies[1].result.tools.every(tool=>tool.annotations.readOnlyHint&&tool.annotations.openWorldHint===false))
  assert.match(replies[2].result.content[0].text,/export const value/)
  assert.equal(JSON.parse(fs.readFileSync(audit)).calls,1)
})

test('native reviewer refuses a pass when omitted diff pages were not actually delivered',async t=>{
  const {root,write}=fixture(t),file='src/a.ts',hash=write(file,'export const value = 1;')
  const cfg={env:{ATELIER_CODEX_BIN:'fixture'},reviewTransport:'source-bundle',agentTimeoutMs:1000,v2:{sourceReader:{enabled:true}}}
  const review={decision:'pass',summary:'fixture',criteriaResults:[{criterion:'value exists',passed:true,evidence:'a.ts'}],issues:[],nextPrompt:'',sourceRequests:[]}
  const run=async(command,args)=>{
    if(args[0]==='login')return {output:'Logged in using ChatGPT',stderr:''}
    assert.ok(args.includes('features.shell_tool=false'))
    const out=args[args.indexOf('-o')+1]
    const reader=new SourceReader(JSON.parse(fs.readFileSync(`${out}.sources.json`,'utf8')),{auditFile:`${out}.read-audit.json`});reader.save()
    fs.writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(review));return {output:''}
  }
  await assert.rejects(runReview({config:cfg,root,runDir:root,task:{files:file,criteria:'value exists'},evidence:{snapshot:{[file]:hash},changes:[{file,afterHash:hash,diff:'+ changed\n'.repeat(4000)}]},checks:[],cursor:{report:''},run}),/읽지 않은 변경 diff/)
})

test('Notion transient failures retry safe queries, and never duplicate block appends',async()=>{
 const {Notion}=await import('./notion.mjs')
 let calls=0;const n=new Notion({env:{NOTION_TOKEN:'fixture'},maxParallelTasks:1},async()=>{calls++;return calls===1?{ok:false,status:503,json:async()=>({code:'service_unavailable'})}:{ok:true,json:async()=>({results:[]})}})
 n.apiDelay=async()=>{};assert.deepEqual(await n.api('data_sources/fixture/query','POST',{}),{results:[]});assert.equal(calls,2)
 calls=0;await assert.rejects(n.api('blocks/fixture/children','PATCH',{children:[]}),/Notion 503/);assert.equal(calls,1)
})

test('independent file pages can be batched without more than 10000 chars per file',t=>{
 const {root,write}=fixture(t),body='line '.repeat(1500),paths=['src/a.ts','src/b.ts','src/c.ts']
 const snapshot=Object.fromEntries(paths.map(p=>[p,write(p,body)])),r=new SourceReader({root,snapshot})
 const value=r.call('read_sources',{requests:paths.map(path=>({path}))})
 assert.equal(value.files.length,3);assert.equal(r.audit.calls,1);assert.equal(r.audit.reads.length,3);assert.ok(value.files.every(v=>v.content.length<=10000));assert.equal(value.budget.callsRemaining,39)
})

test('review recovery in GPT 준비 is admitted before planning cards in that same lane',async()=>{
 const {Orchestrator}=await import('./orchestrator.mjs'),seen=[],positions={reviewing:'검토 중',working:'작업 중',queued:'자동화 할 일',preparing:'GPT 준비',answered:'답변 완료',memo:'메모'}
 const store={data:{outbox:[],v2:{jobs:{raw:{cycle:{phase:'planning'}},review:{cycle:{phase:'reviewing'}}}}}}
 const board={list:async lane=>lane===positions.preparing?[{id:'raw'},{id:'review'}]:[]}
 const o=new Orchestrator({config:{positions,v2:{cursorPull:{enabled:true},pipeline:{enabled:true,gptWorkers:2,planning:2,review:2,implementation:2,readyLimit:4,reviewBacklog:3}}},store,board,notion:{},git:{}})
 o.consider=async page=>seen.push(page.id);await o.admit({});assert.deepEqual(seen,['review','raw'])
})

test('manager selects scoped UI evidence and preserves assertion headers instead of only a giant source dump',async()=>{
 const {browserScenariosFor,checkFailureOutput}=await import('./runner.mjs')
 assert.deepEqual(browserScenariosFor({files:['src/components/layout/workspace-tabs.tsx'],criteria:'기획·디자인 상품 정보 제거'}),['navigation'])
 assert.deepEqual(browserScenariosFor({files:['src/features/work-requests/WorkRequestPage.tsx'],criteria:'파일 선택은 요청 내용 끝에 추가'}),['attachments'])
 assert.deepEqual(browserScenariosFor({files:['src/components/layout/workspace-tabs.tsx'],criteria:'상품 설정을 데이터 관리로 이동'}),[])
 const output=checkFailureOutput({commandResult:{output:'AssertionError required contract\n'+'x'.repeat(10000),stderr:'Expected tab identifier'}},{})
 assert.match(output,/AssertionError required contract/);assert.match(output,/Expected tab identifier/);assert.ok(output.length<8100)
})

test('prior code inspection is reused only with matching source, task, model and recorded output hashes',async t=>{
 const {root,write}=fixture(t),{reusableInspection}=await import('./reviewer.mjs'),file='src/a.ts',hash=write(file,'export const a=1'),task={title:'fixture',request:'check UI',criteria:'button exists',files:file},gpt={model:'selected',effort:'medium'}
 const review={decision:'needs_input',summary:'UI proof missing',criteriaResults:[],issues:['Need UI proof'],nextPrompt:'',sourceRequests:[]},raw=JSON.stringify(review),audit=JSON.stringify({calls:2,reads:[],diffReads:[]}),out=path.join(root,'review.json')
 fs.writeFileSync(out,raw);fs.writeFileSync(`${out}.read-audit.json`,audit);fs.writeFileSync(`${out}.cache.json`,JSON.stringify({outputHash:digest(raw),auditHash:digest(audit)}));fs.writeFileSync(`${out}.sources.json`,JSON.stringify({root,snapshot:{[file]:hash}}));fs.writeFileSync(path.join(root,'review-source.json'),JSON.stringify({task}));fs.writeFileSync(path.join(root,'gpt-usage.jsonl'),JSON.stringify({status:'completed',model:gpt.model,effort:gpt.effort})+'\n')
 assert.ok(reusableInspection(root,root,task,{snapshot:{[file]:hash}},gpt))
 assert.equal(reusableInspection(root,root,{...task,request:'changed'},{snapshot:{[file]:hash}},gpt),null)
 assert.equal(reusableInspection(root,root,task,{snapshot:{[file]:'changed'}},gpt),null)
 assert.equal(reusableInspection(root,root,task,{snapshot:{[file]:hash}},{...gpt,model:'other'}),null)
 fs.writeFileSync(out,raw+' ');assert.equal(reusableInspection(root,root,task,{snapshot:{[file]:hash}},gpt),null)
})
