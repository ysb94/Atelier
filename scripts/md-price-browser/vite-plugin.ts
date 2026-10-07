import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Plugin } from 'vite'

type Context = {path:string;lastInput:string}
type Capture = {url:string;status:number;visibleText:string;title:string;blocked:boolean;crawlMs:number;scope:string;controls:{text:string;disabled:boolean}[]}
type Pending = {resolve:(data:Capture)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}

export function mdPriceBrowserPlugin(env:Record<string,string>):Plugin {
  let worker:ChildProcessWithoutNullStreams | undefined
  const pending=new Map<string,Pending>()
  const running=new Map<string,Promise<unknown>>()
  const stop=() => {
    worker?.stdin.end();worker=undefined
    for(const job of pending.values()){clearTimeout(job.timer);job.reject(new Error('개발 서버가 재시작되어 수집이 중단되었습니다.'))}
    pending.clear()
  }
  const collect=(url:string,context:Context) => new Promise<Capture>((resolve,reject)=>{
    if (pending.size>=6) { reject(new Error('가격 수집 요청이 많습니다. 잠시 후 재시도해 주세요.')); return }
    if (!worker) {
      const root=process.cwd()
      const python=env.MD_PRICE_PYTHON || join(root,process.platform==='win32' ? '.venv-md-price/Scripts/python.exe' : '.venv-md-price/bin/python')
      if (!existsSync(python)) { reject(new Error('가격 수집기 설치가 필요합니다. npm run setup:md-price 실행 후 다시 시도해 주세요.')); return }
      const child=spawn(python,['-u',join(root,'scripts/md-price-browser/worker.py')],{
        cwd:root,windowsHide:true,stdio:'pipe',
        env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|windir|temp|tmp|userprofile|appdata|localappdata|comspec|systemdrive|home|lang)$/i.test(key))),PYTHONIOENCODING:'utf-8',PLAYWRIGHT_BROWSERS_PATH:join(root,'.tmp/md-price-browsers')},
      })
      worker=child
      createInterface({input:child.stdout}).on('line',line=>{
        try {
          const result=JSON.parse(line), job=pending.get(result.id)
          if (!job) return
          clearTimeout(job.timer);pending.delete(result.id)
          if(result.error) job.reject(new Error(result.error)); else job.resolve(result.data)
        } catch(error) { console.warn('[md-price] 수집기 응답 해석 실패',{error,...context}) }
      })
      createInterface({input:child.stderr}).on('line',line=>console.info('[md-price] 브라우저 수집기',line))
      const fail=()=>{
        if(worker!==child)return
        worker=undefined
        for(const job of pending.values()){clearTimeout(job.timer);job.reject(new Error('가격 수집기가 종료되었습니다. npm run setup:md-price로 설치 상태를 확인해 주세요.'))}
        pending.clear()
      }
      child.once('error',fail);child.once('exit',fail)
    }
    const id=randomUUID()
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('브라우저 수집 응답 시간이 초과되었습니다.'))},60_000)
    pending.set(id,{resolve,reject,timer})
    worker.stdin.write(JSON.stringify({id,url,context})+'\n',error=>{
      if(error){clearTimeout(timer);pending.delete(id);reject(new Error('브라우저 수집기에 요청을 전달하지 못했습니다.'))}
    })
  })
  return {
    name:'atelier-md-price-browser',apply:'serve',
    configureServer(server) {
      const workerFile=join(process.cwd(),'scripts/md-price-browser/worker.py').replaceAll('\\','/')
      const onWorkerChange=(file:string)=>{
        if(file.replaceAll('\\','/')===workerFile)stop()
      }
      server.watcher.add(workerFile)
      server.watcher.on('change',onWorkerChange)
      server.httpServer?.once('close',()=>{server.watcher.off('change',onWorkerChange);stop()})
      server.middlewares.use('/__md-price-refresh',async(req,res)=>{
        const started=Date.now()
        const reply=(body:unknown,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))}
        let context:Context={path:'/product-work/md',lastInput:'가격 최신화'}
        try {
          if(req.method!=='POST')return reply({error:'POST만 지원합니다.'},405)
          // Same-origin UI or authenticated CLI only. This is not a general-purpose browsing proxy.
          if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)return reply({error:'허용하지 않은 요청 출처입니다.'},403)
          const authorization=req.headers.authorization ?? ''
          if(!authorization.startsWith('Bearer '))return reply({error:'로그인이 필요합니다.'},401)
          let raw=''
          for await (const chunk of req) {raw+=chunk.toString();if(Buffer.byteLength(raw)>4000)return reply({error:'요청 크기 초과'},413)}
          const body=JSON.parse(raw)
          const urlId=String(body.urlId??'')
          if(!/^[0-9a-f-]{36}$/i.test(urlId))return reply({error:'상품 URL 식별자 오류'},400)
          context={path:String(body.context?.path??context.path).slice(0,160),lastInput:String(body.context?.lastInput??context.lastInput).slice(0,240)}
          const db=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
          const {data:{user},error:authError}=await db.auth.getUser(authorization.slice(7))
          if(authError||!user)return reply({error:'로그인이 필요합니다.'},401)
          const {data:link,error:linkError}=await db.from('sabangnet_mall_urls').select('url,brand_id,target_id').eq('id',urlId).maybeSingle()
          if(linkError||!link)return reply({error:'이 상품 URL에 접근할 수 없습니다.'},403)
          const {data:allowed,error:permissionError}=await db.rpc('md_price_can_refresh',{p_brand_id:link.brand_id})
          if(permissionError||!allowed)return reply({error:'가격 최신화 업무 권한이 필요합니다.'},403)
          const {data:target,error:targetError}=await db.from('code_usage_targets').select('active').eq('brand_id',link.brand_id).eq('id',link.target_id).maybeSingle()
          if(targetError)throw targetError
          if(!target?.active)return reply({error:'해당 브랜드에서 비활성화된 업체입니다.'},409)
          const {data:recent,error:recentError}=await db.from('md_price_checks').select('*').eq('brand_id',link.brand_id).eq('url_id',urlId).eq('rule_state','browser-text-v1').gte('checked_at',new Date(Date.now()-60_000).toISOString()).order('checked_at',{ascending:false}).limit(1)
          if(recentError)throw recentError
          if(recent?.length)return reply({ok:true,check:recent[0],reused:true,timing:{crawlMs:0,extractMs:0,aiMs:0,totalMs:Date.now()-started,inputChars:0,inputTokens:0,outputTokens:0}})
          const key=`${user.id}:${urlId}`
          let task=running.get(key)
          if(!task){
            task=(async()=>{
              const capture=await collect(link.url,context)
              // Only rendered text crosses the authenticated Edge boundary; Python sees no tokens.
              const response=await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/md-price-refresh`,{
                method:'POST',signal:AbortSignal.timeout(65_000),headers:{Authorization:authorization,apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
                body:JSON.stringify({urlId,context,capture}),
              })
              const result=await response.json() as {ok?:boolean;error?:string;timing?:{totalMs:number}}
              if(!response.ok||!result.ok)throw new Error(result.error??'브라우저 본문 가격 분석 실패')
              if(result.timing)result.timing.totalMs=Date.now()-started
              return result
            })().finally(()=>running.delete(key))
            running.set(key,task)
          }
          return reply(await task)
        } catch(error) {
          console.warn('[md-price] 로컬 브라우저 수집 실패',{name:error instanceof Error?error.name:'unknown',elapsedMs:Date.now()-started,...context})
          return reply({error:error instanceof Error?error.message:'가격 수집 요청 실패'},500)
        }
      })
    },
  }
}
