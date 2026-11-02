import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

// 실제 인증·DB·외부 요청 없이 두 저장 경로와 경합을 검증한다.
const root=process.cwd(),dir=path.join(root,'.tmp/checkout-notice-browser')
await mkdir(dir,{recursive:true})
await writeFile(path.join(dir,'mock.ts'),`
const old={date:'2026-10-29',clockIn:'09:00',clockOutAt:null,autoClosedAt:'2026-10-29T20:00:00+09:00'};
const later={date:'2026-10-30',clockIn:'09:00',clockOutAt:'2026-10-30T18:00:00+09:00'};
const today={date:'2026-11-02',clockIn:'09:00',clockOutAt:null};
let s;export function setup(mode){s=window.__checkout={rows:mode==='direct'?[old,today]:mode==='no-today'?[old]:mode==='today'?[{...today,date:'2026-10-29'}]:[old,later,today],requests:[],confirm:[],create:[],readFail:false,saveFail:false,nextRows:null};return s}
setup('old');
export function useMyClockIn(){return {rows:s.rows,loading:false,queryError:s.readFail?Error('조회 실패'):null,refresh:async()=>{if(s.nextRows){s.rows=s.nextRows;s.nextRows=null}window.__update();return [{data:s.rows,error:s.readFail?Error('조회 실패'):null},{data:false,error:null}]}}}
export function useLeaveRequests(){return {requests:s.requests,userId:'self',loading:false,error:null,refresh:async()=>({data:s.requests,error:null}),create:{mutateAsync:async form=>{if(s.saveFail)throw Error('검증용 저장 실패');await new Promise(r=>setTimeout(r,20));s.create.push(form);s.requests.push({...form,status:'pending'});return form}}}}
export async function confirmPreviousClockOut(date,time){s.confirm.push({date,time});if(date!=='2026-10-29'||s.rows.some(r=>r.date==='2026-10-30'))throw Error('직전 출근일만 확인 가능');return {outcome:'recorded'}}
`)
await writeFile(path.join(dir,'entry.tsx'),`
import{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{CheckoutNoticeForm}from'@/features/settings/CheckoutNoticeForm';import{setup}from'./mock';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});function App(){const [version,setVersion]=useState(0),[closed,setClosed]=useState(false),[,tick]=useState(0);window.__update=()=>tick(n=>n+1);window.__setCase=mode=>{setup(mode);setClosed(false);setVersion(n=>n+1)};return <QueryClientProvider client={client}><main style={{maxWidth:640,padding:24}}>{closed?<p>처리 완료</p>:<CheckoutNoticeForm key={version} workDate="2026-10-29" onClose={()=>setClosed(true)}/>}</main></QueryClientProvider>}createRoot(document.getElementById('root')).render(<App/>);
`)
await build({entryPoints:[path.join(dir,'entry.tsx')],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',jsx:'automatic',alias:{'@/features/home/use-my-clock-in':path.join(dir,'mock.ts'),'@/features/operations-support/use-leave-requests':path.join(dir,'mock.ts'),'@/lib/supabase/attendance-entry':path.join(dir,'mock.ts'),'@':path.join(root,'src')},logLevel:'silent'})
const server=createServer(async(req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?await readFile(path.join(dir,'app.js')):'<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>')})
let browser
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const context=await browser.newContext({timezoneId:'Asia/Seoul'}),page=await context.newPage(),errors=[],remote=[]
 page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-11-02T18:00:00+09:00')});await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(remote.push(route.request().url()),route.abort()));await page.goto(origin)
 const date=()=>page.getByLabel('실제 퇴근 날짜·시각'),reason=()=>page.getByLabel('정정 신청 사유'),apply=()=>page.getByRole('button',{name:'출퇴근 정정 신청',exact:true})
 const scenario=mode=>page.evaluate(mode=>window.__setCase(mode),mode)
 await apply().waitFor();await date().fill('2026-10-29T18:30');assert.equal(await apply().isEnabled(),false);await reason().fill('퇴근 미기록 확인');const original=await page.evaluate(()=>JSON.stringify(window.__checkout.rows));await apply().click();await page.getByText('처리 완료',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__checkout.confirm.length),0,'오래된 기록에 직전일 확인 API 호출 금지');assert.equal(await page.evaluate(()=>window.__checkout.create[0].kind),'correction');assert.equal(await page.evaluate(()=>JSON.stringify(window.__checkout.rows)),original,'정정 대기 중 원본 보존')
 await scenario('direct');await date().fill('2026-10-29T18:30');await page.getByRole('button',{name:'실제 퇴근시간 등록',exact:true}).click();await page.getByText('처리 완료',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__checkout.confirm.length),1);assert.equal(await page.evaluate(()=>window.__checkout.create.length),0)
 await scenario('no-today');await page.getByText(/오늘 출근을 먼저 기록/).waitFor();assert.equal(await date().count(),0)
 await scenario('old');await page.evaluate(()=>{window.__checkout.readFail=true;window.__update()});await page.getByRole('button',{name:'다시 조회'}).waitFor();await page.evaluate(()=>window.__checkout.readFail=false);await page.getByRole('button',{name:'다시 조회'}).click();await apply().waitFor()
 await date().fill('2026-10-31T18:30');await reason().fill('잘못된 날짜');await apply().click();await page.getByRole('alert').filter({hasText:'퇴근 날짜는 근무일 또는 그 다음 날'}).waitFor();assert.equal(await page.evaluate(()=>window.__checkout.create.length),0)
 await date().fill('2026-10-29T18:30');await page.evaluate(()=>window.__checkout.saveFail=true);await apply().click();await page.getByRole('alert').filter({hasText:'검증용 저장 실패'}).waitFor();assert.equal(await date().inputValue(),'2026-10-29T18:30');await page.evaluate(()=>window.__checkout.saveFail=false);await apply().click();await page.getByText('처리 완료',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__checkout.create.length),1)
 await scenario('direct');await date().fill('2026-10-29T18:30');await page.evaluate(()=>{window.__checkout.nextRows=[...window.__checkout.rows,{date:'2026-10-30',clockIn:'09:00',clockOutAt:'2026-10-30T18:00:00+09:00'}]});await page.getByRole('button',{name:'실제 퇴근시간 등록',exact:true}).click();await page.getByRole('alert').filter({hasText:'신청 상태가 바뀌었습니다.'}).waitFor();await apply().waitFor();assert.equal(await page.evaluate(()=>window.__checkout.confirm.length+window.__checkout.create.length),0,'상태 변경 후 다른 경로로 자동 저장 금지')
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);console.log('checkout-notice-browser: 오래된 기록 정정·직전일 확인·미출근·원본 보존·사유/범위·저장/조회 실패·재시도·저장 직전 경합 통과 (외부 요청 0건)')
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
