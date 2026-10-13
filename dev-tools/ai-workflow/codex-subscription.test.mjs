import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {requireSubscriptionLogin} from './codex-subscription.mjs'
import {runReview} from './reviewer.mjs'
import {needsInputFeedback} from './feedback.mjs'
import {reviewBundle} from './review-bundle.mjs'
import {digest} from './workspace.mjs'

const config={env:{ATELIER_CODEX_BIN:'fixture-codex'},agentTimeoutMs:1000}
const review={decision:'pass',summary:'확인됨',criteriaResults:[{criterion:'내용',passed:true,evidence:'파일 확인'}],issues:[],nextPrompt:''}

test('source bundle verifies source hashes and keeps the reviewer tool-free and subscription-only',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-review-bundle-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const content='export const sum=(a,b)=>a+b;'
  fs.writeFileSync(path.join(root,'example.js'),content)
  const task={files:'example.js'},evidence={changes:[{file:'example.js',afterHash:digest(content),diff:'-a-b\n+a+b'}],snapshot:{'example.js':digest(content)}}
  let inferences=0
  const value=await runReview({config:{...config,reviewTransport:'source-bundle'},root,runDir:root,task,evidence,checks:[],cursor:{report:'untrusted success'},run:async(command,args,options)=>{
    if(args[0]==='login')return{output:'Logged in using ChatGPT',stderr:''}
    inferences++
    assert.equal(args[args.indexOf('--sandbox')+1],'read-only')
    assert.ok(args.includes('features.shell_tool=false'))
    assert.ok(args.includes('features.unified_exec=false'))
    assert.ok(args.includes('forced_login_method="chatgpt"'))
    assert.ok(options.input.includes(content))
    fs.writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(review))
    return{output:'',stderr:''}
  }})
  assert.equal(value.decision,'pass');assert.equal(inferences,1)
  fs.writeFileSync(path.join(root,'example.js'),'changed after validation')
  assert.throws(()=>reviewBundle(root,task,evidence),/검증 이후 파일/)
  assert.throws(()=>reviewBundle(root,{files:'../outside.js'},evidence),/폴더 밖/)
  assert.throws(()=>reviewBundle(root,{files:'.env.local'},evidence),/인증·환경/)
})

test('subscription auth accepts ChatGPT status from stderr without making a model call',async()=>{
  const calls=[]
  const billing=await requireSubscriptionLogin(config,{run:async(command,args)=>{
    calls.push({command,args});return{output:'',stderr:'Logged in using ChatGPT'}
  }})
  assert.deepEqual(billing,{authMethod:'chatgpt',billing:'subscription'})
  assert.deepEqual(calls,[{command:'fixture-codex',args:['login','status']}])
})

test('API-key, missing and unknown auth cannot reach a reviewer model request',async t=>{
  for(const status of ['Logged in using an API key - private-key','Not logged in','Logged in using an unknown provider']){
    await t.test(status.split(' - ')[0],async()=>{
      let calls=0
      await assert.rejects(runReview({config,run:async(command,args)=>{
        calls++;assert.deepEqual(args,['login','status']);return{output:status,stderr:''}
      }}),/구독 로그인만 허용/)
      assert.equal(calls,1)
    })
  }
})

test('failed login diagnostics stop before inference and do not expose diagnostic secrets',async()=>{
  let calls=0
  await assert.rejects(runReview({config,run:async()=>{calls++;throw Error('failure with private credential')}}),error=>{
    assert.match(error.message,/추가 API 과금을 막기 위해/);assert.doesNotMatch(error.message,/private credential/);return true
  })
  assert.equal(calls,1)
})

test('review rechecks auth and forces ChatGPT and OpenAI for the actual inference command',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-codex-subscription-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const calls=[]
  const value=await runReview({config,root,runDir:root,task:{title:'검사'},evidence:{changes:[]},checks:[],cursor:{report:'작업 보고'},run:async(command,args,options)=>{
    calls.push({command,args})
    if(args[0]==='login')return{output:'Logged in using ChatGPT',stderr:''}
    assert.equal(args[args.indexOf('--sandbox')+1],'read-only')
    assert.match(options.input,/독립 검토자/)
    fs.writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(review))
    return{output:'',stderr:''}
  }})
  assert.equal(value.decision,'pass');assert.equal(calls.length,2)
  assert.deepEqual(calls[1].args.slice(0,5),['-c','forced_login_method="chatgpt"','-c','model_provider="openai"','exec'])
})

test('switching to API auth after a successful review blocks the next review',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-codex-auth-switch-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  let api=false,inferences=0
  const args={config,root,runDir:root,task:{},evidence:{changes:[]},checks:[],cursor:{report:''},run:async(command,cli)=>{
    if(cli[0]==='login')return{output:api?'Logged in using an API key':'Logged in using ChatGPT',stderr:''}
    inferences++;fs.writeFileSync(cli[cli.indexOf('-o')+1],JSON.stringify(review));return{output:'',stderr:''}
  }}
  await runReview(args);api=true;await assert.rejects(runReview(args),/구독 로그인만 허용/)
  assert.equal(inferences,1)
})

test('billing-related stops explain that the engine needs subscription login, not another card answer',()=>{
  const feedback=needsInputFeedback({title:'이미지 작업'},'Codex 검토는 ChatGPT 구독 로그인만 허용합니다.')
  assert.match(feedback.summary,/추가 API 과금을 막기/);assert.match(feedback.question,/내 답변을 다시 적을 필요는 없습니다/)
  assert.match(feedback.question,/유료 크레딧을 구매하지 않습니다/)
})
