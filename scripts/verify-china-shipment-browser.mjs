import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {chromium} from 'playwright-core'

const root=process.cwd(),folder=path.join(root,'.tmp/china-shipment-browser'),origin='http://127.0.0.1:5199'
fs.mkdirSync(folder,{recursive:true})
const auth=path.join(folder,'auth.ts'),client=path.join(folder,'client.ts'),brand=path.join(folder,'brand.ts')
fs.writeFileSync(auth,`export function useAuth(){return {profile:{id:'worker',status:'active',companyId:'e0000000-0000-4000-8000-000000000001',email:'worker@example.invalid'}}}`)
fs.writeFileSync(brand,`export function useCompanyBrandScope(){return {brands:[]}}`)
fs.writeFileSync(client,`import {emptyDraftInput} from '@/lib/drafts/empty-draft';
const seed={id:'draft',company_id:'e0000000-0000-4000-8000-000000000001',brand_id:null,created_by:'author',draft_no:'PL-SHIP',season_id:null,status:'open',owner:'기획 담당',name_ko:'발송 검증 상품',name_en:'',image_url:null,sample_work_order_url:null,sample_work_order_name:'',sample_done:false,order_done:false,order_in_progress:false,photo_sample_done:false,held:false,hold_reason:'',held_at:null,target_cost:null,cost_currency:'CNY',cost_confirmed:false,retail_price:null,discount_price:null,origin_country:'중국',register_type:'',open_type:'',open_type_detail:'',release_issue:'',specs:emptyDraftInput().specs,has_options:false,note:'',promoted_style_id:null,created_at:'2026-10-20T00:00:00Z',updated_at:'2026-10-20T00:00:00Z',sample_work_orders:[{id:'sample',round:1,url:'data:text/plain,work-order',name:'sample.txt',shipped:false,shippedAt:'2026-10-20T00:00:00Z',returnedAt:null,receivedAt:null,passed:false,passedAt:null,failReason:'',assigneeId:'worker',assigneeName:'중국 담당',fileCheckedAt:null}]};
const state=window.__chinaShipment={row:JSON.parse(sessionStorage.getItem('china-row')||'null')||seed,calls:[],fail:false,holdCheck:false,releaseCheck:null};
const persist=()=>{state.row.updated_at=new Date().toISOString();sessionStorage.setItem('china-row',JSON.stringify(state.row))};
export function getSupabase(){return {rpc:async(name,args)=>{if(name==='list_org_chart_members')return {data:[{id:'worker',display_name:'중국 담당',department_id:'china'}],error:null};if(name!=='apply_china_work_order')return {data:[],error:null};state.calls.push(args);if(state.fail){state.fail=false;return {data:null,error:{code:'40001',message:'다른 직원이 수정했습니다. 다시 조회해 주세요.'}}}if(args.p_revision!==state.row.updated_at)return {data:null,error:{code:'40001',message:'이전 상태로 요청했습니다.'}};if(args.p_action==='check'){if(state.holdCheck)await new Promise(resolve=>{state.releaseCheck=resolve});state.row.sample_work_orders[0].fileCheckedAt=new Date().toISOString()}if(args.p_action==='ship')state.row.sample_work_orders[0].returnedAt='2026-10-28 10:17:23.538142+00';persist();return {data:null,error:null}},from(table){let single=false;const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,maybeSingle:()=>{single=true;return q},then:resolve=>Promise.resolve({data:table==='product_drafts'?(single?structuredClone(state.row):[structuredClone(state.row)]):table==='departments'?[{id:'china',company_id:seed.company_id,name:'중국팀',is_active:true}]:[],error:null}).then(resolve)};return q}}}
`)
fs.writeFileSync(path.join(folder,'entry.tsx'),`import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {BrowserRouter} from 'react-router-dom';import {CompanySampleWorkOrderPage} from '@/features/china/SampleWorkOrderPage';import '@/index.css';const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><BrowserRouter><CompanySampleWorkOrderPage/></BrowserRouter></QueryClientProvider>)`)
const server=await createServer({root,configFile:false,envDir:false,logLevel:'error',plugins:[{name:'china-shipment-fixture',enforce:'pre',resolveId(source,importer){if(!importer||!source.startsWith('.'))return;const target=path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'');if(target===path.join(root,'src/lib/supabase/client'))return client;if(target===path.join(root,'src/lib/supabase/auth'))return auth},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.headers.accept?.includes('text/html'))return next();vite.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.tmp/china-shipment-browser/entry.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next)})}},react(),tailwindcss()],resolve:{alias:[{find:'@/lib/supabase/auth',replacement:auth},{find:'@/lib/supabase/client',replacement:client},{find:'@/components/layout/company-brand-scope',replacement:brand},{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port:5199,strictPort:true,hmr:false}})
let browser
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1450,height:950}}),errors=[],remote=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(remote.push(route.request().url()),route.abort()))
 await page.goto(origin+'/china/work-orders',{timeout:120000})
 const ship=page.getByRole('button',{name:'발송 완료',exact:true});await ship.waitFor()
 await page.evaluate(()=>{window.__chinaShipment.holdCheck=true});await page.getByRole('button',{name:'받기',exact:true}).click()
 await page.waitForFunction(()=>window.__chinaShipment.releaseCheck!==null);assert.equal(await page.getByRole('button',{name:'확인 중...',exact:true}).isDisabled(),true,'받기 확인 저장 중 이전 버전으로 발송 요청하지 않음')
 await page.evaluate(()=>window.__chinaShipment.releaseCheck());await ship.waitFor();await page.waitForFunction(()=>Boolean(window.__chinaShipment.row.sample_work_orders[0].fileCheckedAt))
 await page.evaluate(()=>{window.__chinaShipment.fail=true});await ship.click();await page.getByRole('alert').filter({hasText:'다른 직원이 수정했습니다.'}).first().waitFor();assert.equal(await page.evaluate(()=>window.__chinaShipment.row.sample_work_orders[0].returnedAt),null)
 await ship.click();await page.getByRole('tab',{name:'종료',exact:false}).click();await ship.waitFor();assert.equal(await ship.isDisabled(),true);assert.equal(await ship.getAttribute('aria-pressed'),'true')
 const raw=await page.evaluate(()=>window.__chinaShipment.row.sample_work_orders[0]);assert.ok(raw.returnedAt);assert.equal(raw.shipped,false,'서버와 동일하게 발송일만 응답');assert.equal(raw.receivedAt,null);assert.equal(raw.passed,false)
 assert.equal(await page.evaluate(()=>window.__chinaShipment.calls.filter(c=>c.p_action==='ship').length),2,'실패 1회와 재시도 1회만 호출')
 await page.reload();await page.getByRole('tab',{name:'종료',exact:false}).click();await ship.waitFor();assert.equal(await ship.isDisabled(),true);assert.equal(await ship.getAttribute('aria-pressed'),'true','새로고침 후에도 종료 상태 유지')
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[])
 console.log('china-shipment-browser: 실제 중국팀 화면·저장 API·응답 변환으로 발송일만 저장된 완료 처리, 종료 탭, 재조회, 실패 표시·재시도, 받기와 발송 경합 방지 검증 통과')
}finally{await browser?.close();await server.close()}
