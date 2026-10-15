import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sourceSlice, sourceRequest } from './source-slices.mjs'
import { planningSources } from './gpt-planner.mjs'
import { reviewBundle } from './review-bundle.mjs'
import { runGptReadOnly } from './gpt.mjs'
import { codexUsage, GPT_BUDGET } from './gpt-usage.mjs'
import { digest } from './workspace.mjs'
import { GeneratedBlockLedger, provenanceSpan } from './generated-blocks.mjs'
import { Notion } from './notion.mjs'

const temporary = t => { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-efficient-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir }
function write(root,file,body) { fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),body) }
const config={env:{ATELIER_CODEX_BIN:'fixture'},agentTimeoutMs:1000}
const model={model:'gpt-6-sol',effort:'low'}

test('Notion stripping a provenance span cannot turn our own append into new user input',async()=>{
  const ledger=new GeneratedBlockLedger(),r=ledger.begin('p',{kind:'notice',eventId:'e'})
  const block={id:'owned',type:'callout',callout:{rich_text:[{text:{content:'Atelier AI 확인 필요 안내'}}]}}
  await ledger.adoptResponse({},'p',r,{results:[block]})
  const notion=new Notion({env:{}},async()=>({ok:true,json:async()=>({results:[block],has_more:false})}))
  notion.blockLedger=ledger
  assert.equal(await notion.memoBody('p'),'')
  assert.equal(await notion.isGeneratedBlock('p',{...block,id:'user-copy'}),false)
  assert.ok(provenanceSpan(r.nonce).text.content.replace(/[\s\u200b]/g,'').length)
})

test('screen matching excludes broad area matches and sends dependency references without contents',t=>{
  const root=temporary(t)
  write(root,'AGENTS.md','rules')
  write(root,'src/Meetings.tsx','export const meeting=true')
  write(root,'src/WorkRequest.tsx','unrelated work requests '.repeat(10000))
  write(root,'src/api.ts','unrelated API '.repeat(10000))
  write(root,'dev-tools/structure-map/generated/structure.json',JSON.stringify({nodes:[{path:'src/Meetings.tsx',label:'회의'},{path:'src/WorkRequest.tsx',label:'공용 작업 요청'}],routes:[{labels:['회사 · 회의'],targets:['src/Meetings.tsx']}],edges:[{from:'src/Meetings.tsx',to:'src/api.ts'}]}))
  const source=planningSources(root,{source:{screen:'회사 / 회의',area:'공용'}})
  assert.deepEqual(source.files.map(f=>f.path),['AGENTS.md','src/Meetings.tsx'])
  assert.equal(source.dependencies[0].to,'src/api.ts')
  assert.ok(JSON.stringify(source).length<2000)
})

test('large files provide exact excerpts and full hashes; requested gaps and changed lines are not silently dropped',t=>{
  const root=temporary(t), file='src/large.ts'
  const content=Array.from({length:3000},(_,i)=>`export const item${i} = 'value-${i}';`).join('\n')
  write(root,file,content)
  const item=sourceSlice(file,content,{ranges:[[1800,1810]],maxChars:12000})
  assert.equal(item.sha256,digest(content));assert.equal(item.complete,false)
  assert.ok(item.excerpts.some(e=>e.start<=1800&&e.end>=1810))
  for(const e of item.excerpts)assert.equal(e.content,content.split('\n').slice(e.start-1,e.end).join('\n'))
  assert.deepEqual(sourceRequest(`${file}#L2500-L2510`),{path:file,range:[2500,2510]})
  const evidence={changes:[{file,afterHash:digest(content),diff:'@@ -1799,2 +1799,2 @@\n-old\n+new'}],snapshot:{[file]:digest(content)}}
  const bundle=reviewBundle(root,{files:file},evidence,[`${file}#L2500-L2510`])
  const reviewed=bundle.files.find(f=>f.path===file)
  assert.ok(reviewed.excerpts.some(e=>e.start<=1799&&e.end>=1800))
  assert.ok(reviewed.excerpts.some(e=>e.start<=2500&&e.end>=2510))
  assert.throws(()=>sourceSlice(file,content,{ranges:[[1,3000]],maxChars:100}),/한도/)
  assert.throws(()=>sourceSlice(file,content,{ranges:[[3001,3002]]}),/벗어났/)
  write(root,file,content+'\nchanged')
  assert.throws(()=>reviewBundle(root,{files:file},evidence),/검증 이후/)
})

test('identical completed input uses cache; code, model and schema changes invalidate it',async t=>{
  const root=temporary(t),schemaFile=path.join(root,'schema.json'),outputFile=path.join(root,'plan.json')
  write(root,'schema.json','{"type":"object"}')
  let calls=0
  const run=async(command,args)=>{
    if(args[0]==='login')return{output:'Logged in using ChatGPT',stderr:''}
    calls++;fs.writeFileSync(args[args.indexOf('-o')+1],'{}')
    return{output:JSON.stringify({type:'turn.completed',usage:{input_tokens:120,cached_input_tokens:80,output_tokens:20}})}
  }
  const options={config,root,gpt:model,prompt:'same',schemaFile,outputFile,run,cacheContext:'source-a'}
  await runGptReadOnly(options);await runGptReadOnly(options);assert.equal(calls,1)
  await runGptReadOnly({...options,cacheContext:'source-b'});assert.equal(calls,2)
  await runGptReadOnly({...options,gpt:{...model,effort:'medium'}});assert.equal(calls,3)
  write(root,'schema.json','{"type":"object","description":"changed"}')
  await runGptReadOnly(options);assert.equal(calls,4)
  const records=fs.readFileSync(path.join(root,'gpt-usage.jsonl'),'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(records.filter(r=>r.status==='cache_hit').length,1)
  assert.deepEqual(records.find(r=>r.status==='completed').usage,{inputTokens:120,cachedInputTokens:80,outputTokens:20,turns:1})
})

test('oversized input and repeated failures stop before another inference, including across restarts',async t=>{
  const root=temporary(t),outputFile=path.join(root,'plan.json');let calls=0
  const run=async(command,args)=>{
    if(args[0]==='login')return{output:'Logged in using ChatGPT',stderr:''}
    calls++;throw Error('fixture inference failure')
  }
  const options={config,root,gpt:model,prompt:'same',outputFile,run}
  await assert.rejects(runGptReadOnly({...options,prompt:'x'.repeat(GPT_BUDGET.planPromptChars+1)}),/한도/)
  assert.equal(calls,0)
  await assert.rejects(runGptReadOnly(options),/fixture/)
  await assert.rejects(runGptReadOnly(options),/fixture/)
  await assert.rejects(runGptReadOnly({...options}),/두 번 실패/)
  assert.equal(calls,2)
  assert.equal(codexUsage('no usage reported'),null)
})
