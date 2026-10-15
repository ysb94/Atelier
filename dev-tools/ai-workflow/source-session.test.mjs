import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {runSourceSession} from './source-session.mjs'
import {digest} from './workspace.mjs'

test('subscription app-server forwards only scoped read tools and captures usage, without a model call',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-session-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 fs.mkdirSync(path.join(root,'src'));const source='export const expected = 42;';fs.writeFileSync(path.join(root,'src/a.ts'),source)
 const fixture=path.join(root,'fake-server'),log=path.join(root,'requests.jsonl')
 fs.writeFileSync(fixture,`#!${process.execPath}
const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
rl.on('line',line=>{const q=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},line+'\\n');
 if(q.method==='initialize')send({id:q.id,result:{}});
 if(q.method==='thread/start')send({id:q.id,result:{thread:{id:'fixture'},model:'selected',modelProvider:'openai',sandbox:{type:'readOnly'}}});
 if(q.method==='turn/start'){send({id:q.id,result:{}});send({id:100,method:'item/tool/call',params:{namespace:'atelier_sources',tool:'read_source',arguments:{path:'src/a.ts'}}})}
 if(q.id===100){if(!q.result.success||!q.result.contentItems[0].text.includes('expected'))process.exit(2);send({method:'thread/tokenUsage/updated',params:{tokenUsage:{total:{inputTokens:120,cachedInputTokens:100,outputTokens:10}}}});send({method:'item/completed',params:{item:{type:'agentMessage',text:'{"decision":"execute"}'}}});send({method:'turn/completed',params:{turn:{status:'completed'}}})}
});`,{mode:0o700})
 const schemaFile=path.join(root,'schema.json');fs.writeFileSync(schemaFile,'{}');const outputFile=path.join(root,'output.json'),auditFile=path.join(root,'audit.json')
 const result=await runSourceSession({config:{env:{ATELIER_CODEX_BIN:fixture},agentTimeoutMs:10000},root,gpt:{model:'selected',effort:'medium'},prompt:'fixture',schemaFile,outputFile,manifest:{root,snapshot:{'src/a.ts':digest(source)}},auditFile})
 const messages=fs.readFileSync(log,'utf8').trim().split('\n').map(v=>JSON.parse(v)),start=messages.find(v=>v.method==='thread/start').params,turn=messages.find(v=>v.method==='turn/start').params
 assert.equal(start.sandbox,'read-only');assert.equal(start.model,'selected');assert.equal(turn.effort,'medium');assert.equal(start.modelProvider,'openai');assert.ok(start.dynamicTools[0].tools.every(v=>!/(write|exec|apply)/.test(v.name)))
 assert.equal(JSON.parse(fs.readFileSync(auditFile)).calls,1);assert.equal(JSON.parse(fs.readFileSync(outputFile)).decision,'execute');assert.equal(JSON.parse(result.output).usage.cached_input_tokens,100)
})
