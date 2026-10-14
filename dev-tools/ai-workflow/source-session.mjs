import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { childEnv } from './process.mjs'
import { subscriptionCommand,toolFreeArgs } from './codex-subscription.mjs'
import { SourceReader,SOURCE_TOOLS } from './source-reader.mjs'
import { EnvironmentError } from './errors.mjs'
import { redact } from './settings.mjs'

// App-server dynamic tools are forwarded into managed cloud sessions, unlike
// local stdio MCP inventory. Only these bounded read operations are implemented.
export function runSourceSession({config,root,gpt,prompt,schemaFile,outputFile,manifest,auditFile,signal}) {
  if(signal?.aborted)return Promise.reject(new Error('작업 중지됨'))
  const reader=new SourceReader(manifest,{auditFile});reader.save()
  const cli=subscriptionCommand(config,[...toolFreeArgs,'app-server'])
  return new Promise((resolve,reject)=>{
    const child=spawn(cli.command,cli.args,{cwd:root,env:childEnv(),stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true})
    let nextId=1,finished=false,stderr='',finalText='',usage=null
    const pending=new Map(),lines=createInterface({input:child.stdout})
    const send=value=>child.stdin.write(JSON.stringify(value)+'\n')
    const request=(method,params)=>new Promise((yes,no)=>{const id=nextId++;pending.set(id,{yes,no});send({id,method,params})})
    let killTimer
    const finish=(error)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort)
      child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);killTimer.unref()
      const output=usage?JSON.stringify({type:'turn.completed',usage:{input_tokens:usage.inputTokens,cached_input_tokens:usage.cachedInputTokens,output_tokens:usage.outputTokens}})+'\n':''
      const result={code:error?1:0,output,stderr:redact(stderr,config.env)}
      if(error){error.commandResult=result;reject(error)}else resolve(result)
    }
    const abort=()=>finish(new Error('작업 중지됨'))
    const timer=setTimeout(()=>finish(new Error('실행 시간 제한 초과')),config.agentTimeoutMs??120000)
    signal?.addEventListener('abort',abort,{once:true})
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-12000)})
    child.on('error',finish)
    child.on('close',code=>{clearTimeout(killTimer);if(!finished)finish(new Error(`GPT 읽기 세션이 응답 전에 종료되었습니다 (${code}): ${redact(stderr,config.env).slice(-1000)}`))})
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')finish(error)})
    lines.on('line',line=>{
      if(finished)return
      let event;try{event=JSON.parse(line)}catch{return}
      if(event.id!==undefined&&pending.has(event.id)){
        const waiter=pending.get(event.id);pending.delete(event.id)
        if(event.error)waiter.no(new Error(`Codex ${event.error.message}`));else waiter.yes(event.result)
        return
      }
      if(event.id!==undefined){
        if(event.method==='item/tool/call'){
          const p=event.params??{}
          if(p.namespace&&p.namespace!=='atelier_sources'){send({id:event.id,error:{code:-32601,message:'Unsupported read tool namespace'}});return}
          try{const value=reader.call(p.tool,p.arguments??{});send({id:event.id,result:{success:true,contentItems:[{type:'inputText',text:JSON.stringify(value)}]}})}
          catch(error){send({id:event.id,result:{success:false,contentItems:[{type:'inputText',text:error.message}]}});if(reader.audit.exhausted||reader.audit.invalidated)finish(new EnvironmentError(error.message,{retry:!!reader.audit.invalidated,code:reader.audit.invalidated?'workspace_changed':'source_reader_budget'}))}
        }else send({id:event.id,error:{code:-32601,message:'This read-only session does not approve external actions'}})
        return
      }
      const p=event.params??{}
      if(event.method==='thread/tokenUsage/updated')usage=p.tokenUsage?.total??usage
      if(event.method==='item/completed'&&p.item?.type==='agentMessage')finalText=p.item.text??finalText
      if(event.method==='turn/completed'){
        if(p.turn?.status!=='completed')return finish(new Error(`GPT 세션 실패: ${p.turn?.error?.message??p.turn?.status}`))
        if(!finalText)return finish(new Error('GPT 최종 JSON 응답이 없습니다.'))
        try{fs.writeFileSync(outputFile,finalText);finish()}catch(error){finish(error)}
      }
    })
    ;(async()=>{
      await request('initialize',{clientInfo:{name:'atelier-read-only-worker',version:'1'},capabilities:{experimentalApi:true}})
      send({method:'initialized'})
      const started=await request('thread/start',{model:gpt.model,modelProvider:'openai',cwd:root,sandbox:'read-only',ephemeral:true,
        dynamicTools:[{type:'namespace',name:'atelier_sources',description:'작업 브랜치의 해시가 검증된 읽기 전용 코드 근거',tools:SOURCE_TOOLS.map(({name,description,inputSchema})=>({type:'function',name,description,inputSchema}))}]})
      if(started.model!==gpt.model||started.modelProvider!=='openai'||started.sandbox?.type!=='readOnly')throw new EnvironmentError('선택한 구독 모델과 읽기 전용 실행 환경을 확인하지 못했습니다.',{retry:false,code:'source_session_config'})
      await request('turn/start',{threadId:started.thread.id,input:[{type:'text',text:prompt}],model:gpt.model,effort:gpt.effort,outputSchema:JSON.parse(fs.readFileSync(schemaFile,'utf8'))})
    })().catch(finish)
  })
}
