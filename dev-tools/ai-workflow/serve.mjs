import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { settings, projectRoot, stateDir, redact } from './settings.mjs'
import { doctor } from './doctor.mjs'
import { Store, acquireLock } from './store.mjs'
import { Notion } from './notion.mjs'
import { Runner } from './runner.mjs'
import { ParallelRunner } from './parallel.mjs'
import { Board } from './board.mjs'
import { Orchestrator } from './orchestrator.mjs'

export async function startManager() {
  const release=acquireLock(stateDir),store=new Store(stateDir)
  let status={state:'연결 확인 중'},runner,stopping=false,ticking=false,lastMessage='',config=settings()
  const server=http.createServer((request,response)=>{
    if(request.method!=='GET'||!['/','/health'].includes(request.url)){response.writeHead(404);response.end();return}
    response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','application/json; charset=utf-8')
    response.end(JSON.stringify({tool:'atelier-ai-workflow',root:projectRoot,watch:true,workflow:config.v2?.enabled?'v2':'legacy',codexBillingPolicy:'chatgpt-subscription-only',...status},null,2))
  })
  const tick=async()=>{
    if(stopping||ticking)return;ticking=true
    try{
      config=settings()
      if(!runner){
        const check=await doctor(config)
        if(!check.ready){status={state:'설정 대기',problems:check.problems,mcp:check.mcp.map(v=>v.name)};return}
        const notion=new Notion(config);await notion.ready()
        if(config.v2?.enabled){
          const board=new Board(config,notion);await board.ready()
          runner=new Orchestrator({config,notion,board,store,onStatus:value=>{status=value}})
        }else{
          const Worker=config.maxParallelTasks===2?ParallelRunner:Runner
          runner=new Worker({config,notion,store,onStatus:value=>{status=value}})
        }
        status={state:'대기',mcp:check.mcp.map(v=>v.name)}
      }
      runner.config=config;runner.notion.config=config
      await runner.tick()
      if(!runner.busy)status={...status,state:['작업 중','검토 중','구조 확인'].includes(status.state)?'대기':status.state}
    }catch(error){status={state:'설정/연결 확인 필요',problems:[redact(error.message,config.env)]};console.warn('[ai-workflow] 관리자 확인 실패',status.problems[0])}
    finally{
      const message=JSON.stringify(status)
      if(message!==lastMessage){console.info('[ai-workflow]',status);lastMessage=message}
      ticking=false
    }
  }
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve)}).catch(error=>{release();throw error})
  console.info(`[ai-workflow] 개발 전용 관리자: http://127.0.0.1:${config.port}/health`)
  const interval=setInterval(tick,config.pollMs);void tick()
  const stop=async()=>{if(stopping)return;stopping=true;clearInterval(interval);await runner?.stop();await new Promise(resolve=>server.close(resolve));release()}
  return {server,stop,getStatus:()=>status}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let manager
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void manager?.stop()})
  try{manager=await startManager()}catch(error){console.error('[ai-workflow] 시작 실패',redact(error.message));process.exitCode=1}
}
