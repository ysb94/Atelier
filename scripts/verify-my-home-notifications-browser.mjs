import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import path from 'node:path'
import {build} from 'esbuild'
import {createServer} from 'node:http'
import {chromium} from 'playwright-core'
const root=process.cwd(),dir=path.join(root,'.tmp','my-home-notifications-browser')
await mkdir(dir,{recursive:true})
await writeFile(path.join(dir,'auth.ts'),`export const useAuth=()=>({profile:{id:'staff',companyId:'company',status:'active'},session:{user:{id:'staff'}}});`)
await writeFile(path.join(dir,'client.ts'),`
let read=false,done=false,fail=false;
const row=()=>({event_key:done?'request-result:one':'request-approval:one',entity_id:'one',created_at:'2026-11-02T00:00:00Z',event_type:done?'result':'approval',tab:done?'overtime':'approvals',kind:'overtime',employee_name:'검증 직원',from_date:'2026-11-02',to_date:'2026-11-02',start_time:'18:00',end_time:'19:00',note:'검증용 야근 신청',decision_note:done?'확인했습니다':null,action_needed:!done,status:done?'approved':'pending',read_at:read?'2026-11-02T00:01:00Z':null});
export function fixture(action){if(action==='reset'){read=false;done=false}else if(action==='complete'){done=true;read=false}else if(action==='fail'){fail=!fail}}
export function getSupabase(){return {rpc:async(name,args)=>{if(name==='list_my_home_work_notifications')return {data:[row()],error:null};if(name==='read_my_home_work_notification'){if(fail)return {data:null,error:{message:'의도한 읽음 실패'}};read=true;return {data:null,error:null}}return {data:[],error:null}},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,like:()=>q,then:(ok)=>Promise.resolve({data:[],error:null}).then(ok)};return q}}}
export const isSupabaseConfigured=()=>true;
`)
await writeFile(path.join(dir,'entry.tsx'),`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BrowserRouter,useNavigate}from'react-router-dom';
import{MyHomeNotificationList,MyHomeWorkNoticeDetail}from'@/features/settings/MyHomeNotificationList';import{useMyHomeNotifications}from'@/features/settings/use-my-home-notifications';import{NotificationPanel}from'@/components/layout/NotificationPanel';import{fixture}from'./client';
const cache=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
function Screen(){const notices=useMyHomeNotifications();const go=useNavigate();const[tab,setTab]=useState('approvals');return <main><h1>My home 알림 통합 검증</h1><output aria-label="상태">안 읽음 {notices.items.filter(x=>!x.readAt).length} / 처리 {new Set(notices.items.flatMap(x=>x.action?[x.action.key]:[])).size}</output><button onClick={()=>setTab('approvals')}>승인 탭</button><button onClick={()=>setTab('overtime')}>야근 탭</button><button onClick={async()=>{fixture('complete');await cache.invalidateQueries({queryKey:['my-home-work-notices']})}}>서버 승인</button><button onClick={async()=>{fixture('reset');await cache.invalidateQueries({queryKey:['my-home-work-notices']})}}>초기화</button><button onClick={()=>fixture('fail')}>실패 전환</button><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24,padding:24}}><section><MyHomeNotificationList key={tab} tab={tab}/><MyHomeWorkNoticeDetail/></section><NotificationPanel titleId="bell-title" items={notices.items} onOpen={item=>go(item.href)} onClose={()=>{}}/></div></main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><BrowserRouter><Screen/></BrowserRouter></QueryClientProvider>);
`)
await build({entryPoints:[path.join(dir,'entry.tsx')],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',plugins:[{name:'mock-relative-client',setup(b){b.onResolve({filter:/^\./},args=>{const target=path.resolve(path.dirname(args.importer),args.path).replace(/\.tsx?$/,'');if(target===path.join(root,'src/lib/supabase/client'))return {path:path.join(dir,'client.ts')};if(target===path.join(root,'src/lib/supabase/auth'))return {path:path.join(dir,'auth.ts')}})}}],define:{'import.meta.env':'{}'},jsx:'automatic',alias:{'@/lib/supabase/auth':path.join(dir,'auth.ts'),'@/lib/supabase/client':path.join(dir,'client.ts'),'@':path.join(root,'src')},logLevel:'silent'})
const css=(await readdir('dist/assets')).find(name=>/^index-.*\.css$/.test(name))
const server=createServer(async(req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(path.join(dir,'app.js')))}else if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(path.join('dist/assets',css)))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')}})
let browser
try{
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1000}})
const origin=`http://127.0.0.1:${server.address().port}`
await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort())
const errors=[];page.on('pageerror',error=>errors.push(error.message))
await page.goto(origin)

const status=page.getByLabel('상태'),bell=page.getByRole('dialog',{name:'알림',exact:true}),tab=page.getByRole('region',{name:'이 탭의 알림'})
await status.filter({hasText:'안 읽음 1 / 처리 1'}).waitFor()
assert.equal(await page.getByRole('button',{name:'모두 읽음'}).count(),0)
await bell.getByRole('button').filter({hasText:'승인 요청'}).click()
await status.filter({hasText:'안 읽음 0 / 처리 1'}).waitFor()
assert.ok(await tab.getByText('승인 처리 필요',{exact:true}).isVisible())
await page.getByRole('button',{name:'서버 승인',exact:true}).click()
await status.filter({hasText:'안 읽음 1 / 처리 0'}).waitFor()
await page.getByRole('button',{name:'야근 탭',exact:true}).click()
await tab.getByRole('button').filter({hasText:'야근 승인'}).click()
await status.filter({hasText:'안 읽음 0 / 처리 0'}).waitFor()
assert.equal(await bell.getByText('야근 승인',{exact:true}).count(),0,'Read result leaves the default attention list')
await page.getByRole('button',{name:'초기화',exact:true}).click();await page.getByRole('button',{name:'승인 탭',exact:true}).click()
await page.getByRole('button',{name:'실패 전환',exact:true}).click()
await tab.getByRole('button').filter({hasText:'승인 요청'}).click()
await page.getByRole('button',{name:'읽음 저장 재시도'}).waitFor()
assert.match(await status.textContent(),/안 읽음 1/)
await page.getByRole('button',{name:'실패 전환',exact:true}).click();await page.getByRole('button',{name:'읽음 저장 재시도'}).click()
await status.filter({hasText:'안 읽음 0 / 처리 1'}).waitFor()
await page.screenshot({path:path.join(dir,'verified.png'),fullPage:true})
assert.deepEqual(errors,[])
console.info('My home browser: bell/tab shared reads, pending retained, completion, result read, failure/retry passed')
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
