import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

const root=process.cwd(),folder=path.join(root,'.tmp/extra-leave-notices-browser');fs.mkdirSync(folder,{recursive:true})
const record={id:'notice',company_id:'c',employee_id:'staff',recipient_name:'가 직원',notice_source:'birthday',grant_id:'g',grant_version:1,phase:'registered',scheduled_on:'2026-10-29',expires_on:'2026-11-12',remaining_days:0.25,reserved_days:0.25,granted_days:0.5,reason:'생일 반차',title:'생일 반차 등록 안내',body:'생일 반차 0.5일 · 신청 가능 0.25일 · 사용 예약 0.25일 · 2026-11-12까지',issued_at:'2026-10-29T00:00:00Z',read_at:null,viewed_at:null,confirmed_at:null}
const payload={today:'2026-10-29',enabled:true,extraEnabled:true,employees:[{id:'staff',display_name:'가 직원',department:'물류',hire_date:'2024-01-01',reset_date:'2027-01-01',remaining_days:5,balance_current:true,resigned_on:null},{id:'peer',display_name:'나 직원',department:'운영지원',hire_date:null,reset_date:null,remaining_days:null,balance_current:false,resigned_on:null}],notices:[record],extraGrants:[{id:'g',employee_id:'staff',notice_source:'birthday',days:0.5,starts_on:'2026-10-29',expires_on:'2026-11-12',reason:'생일 반차',version:1,available:0.25,reserved:0.25,deleted_at:null,created_on:'2026-10-29',updated_on:'2026-10-29'}]}
const mocks={
 '@/lib/supabase/auth':`const profile={id:'staff',status:'active'};export function useAuth(){return {profile,session:{user:{id:'staff'}}}}`,
 '@/lib/company/capabilities':`export function canEditOrgAssignment(){return location.hash!=='#denied'}`,
 '@/lib/company/page-preview-context':`export function usePagePreview(){return null}`,
 '@/lib/supabase/impersonation':`export function readImpersonationState(){return location.hash==='#impersonated'?{target:'staff'}:null}`,
 '@/features/home/attendance-entry-context':`export function useAttendanceEntry(){return {phase:'ready',checkoutOpen:false}}`,
 '@/lib/supabase/client':`export function getSupabase(){return {channel(){const c={on(event,filter,fn){window.__event=fn;return c},subscribe(fn){window.__reconnect=fn;fn('SUBSCRIBED');return c}};return c},removeChannel:async()=>{}}}`,
 '@/lib/supabase/leave-usage-notices':`export const LEAVE_NOTICE_PHASES=['threeMonths','oneMonth','twoWeeks'];export const LEAVE_NOTICE_LABELS={registered:'등록 안내',threeMonths:'3개월 전',oneMonth:'1개월 전',twoWeeks:'2주 전',oneWeek:'1주일 전'};window.__state={payload:${JSON.stringify(payload)},writes:[],reads:0,fail:false};export async function getLeaveNoticeManagement(){window.__state.reads++;return structuredClone(window.__state.payload)};export async function listMyLeaveUsageNotices(){return structuredClone(window.__state.payload.notices)};export async function recordLeaveUsageNotice(id,action,source){const s=window.__state;if(s.fail){s.fail=false;throw Error('확인 저장 실패')}s.writes.push({id,action,source});for(const n of s.payload.notices.filter(n=>!id||n.id===id)){n.read_at||=new Date().toISOString();if(action==='view'||action==='confirm')n.viewed_at||=n.read_at;if(action==='confirm')n.confirmed_at||=n.viewed_at}}`,
}
const aliases=Object.entries(mocks).map(([find,source],i)=>{const replacement=path.join(folder,`mock-${i}.ts`);fs.writeFileSync(replacement,source);return{find,replacement}})
fs.writeFileSync(path.join(folder,'entry.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{LeaveUsageNoticePanel}from'@/features/operations-support/LeaveUsageNoticePanel';import{LeaveUsageNoticeReceiver}from'@/features/operations-support/LeaveUsageNoticeReceiver';import{useLeaveUsageNotices}from'@/features/operations-support/use-leave-usage-notices';import'@/index.css';const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});function Receiver(){const n=useLeaveUsageNotices();return <><p>알림 수 {n.records.length}</p><LeaveUsageNoticeReceiver notices={n}/></>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>{['#receiver','#impersonated'].includes(location.hash)?<Receiver/>:<LeaveUsageNoticePanel/>}</QueryClientProvider>);`)
const server=await createServer({configFile:false,envDir:false,logLevel:'error',plugins:[{name:'notice-fixture',enforce:'pre',resolveId(source,importer){if(!importer||!source.startsWith('.'))return;const target=path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'');return aliases.find(a=>path.join(root,'src',a.find.slice(2))===target)?.replacement},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.headers.accept?.includes('text/html'))return next();vite.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.tmp/extra-leave-notices-browser/entry.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next)})}},react(),tailwindcss()],resolve:{alias:[...aliases,{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false}})
let browser
try{
 await server.listen();browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:5198/')?route.continue():route.abort())
 await page.goto('http://127.0.0.1:5198/');await page.getByText('가 직원',{exact:true}).waitFor()
 const table=page.getByRole('table',{name:'가 직원 연차별 알림 현황'});assert.equal(await table.isVisible(),false)
 await page.getByText('가 직원',{exact:true}).click();await table.waitFor();const birthday=table.getByRole('row').filter({has:page.getByText('생일 반차',{exact:true}).first()})
 assert.equal(await birthday.getByRole('cell',{name:'0.25일',exact:true}).count(),2)
 await birthday.getByText('알림 일정·확인 이력 보기').click();await birthday.getByText('1주일 전 · 2026-11-05',{exact:true}).waitFor();assert.equal(await birthday.getByText('3개월 전',{exact:false}).count(),0)
 await birthday.getByRole('button',{name:'안내문 보기',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>window.__state.writes.length),0,'관리자 열람은 직원 확인을 남기지 않음');await page.getByRole('button',{name:'닫기',exact:true}).click()
 await page.getByRole('combobox',{name:'연차 안내 종류'}).selectOption('birthday');assert.equal(await page.getByText('나 직원',{exact:true}).count(),0)
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390),'모바일 표 내부 가로 스크롤')
 await page.getByRole('textbox',{name:'연차 안내 직원 검색'}).fill('없는 직원');await page.getByText('표시할 직원이 없습니다.').waitFor()
 await page.goto('http://127.0.0.1:5198/#denied');await page.reload();await page.getByText('직원별 잔여 연차와 확인 기록은 기존 명부 관리 권한이 있는 담당자만 확인할 수 있습니다.').waitFor();assert.equal(await page.evaluate(()=>window.__state.reads),0)
 await page.goto('http://127.0.0.1:5198/#receiver');await page.reload();await page.getByRole('button',{name:'연차 안내문 보기'}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>window.__state.writes[0].source),'birthday')
 await page.getByRole('checkbox').check();await page.evaluate(()=>{window.__state.fail=true});await page.getByRole('button',{name:'확인하고 닫기'}).click();await page.getByRole('dialog').getByRole('alert').waitFor();await page.getByRole('button',{name:'확인하고 닫기'}).click();await page.getByRole('dialog').waitFor({state:'hidden'})
 assert.equal(await page.evaluate(()=>window.__state.writes.filter(w=>w.action==='confirm').length),1)
 await page.evaluate(()=>{const n=structuredClone(window.__state.payload.notices[0]);n.id='realtime';n.confirmed_at=null;window.__state.payload.notices.push(n);window.__event()});await page.getByText('알림 수 2',{exact:true}).waitFor()
 await page.evaluate(()=>{const n=structuredClone(window.__state.payload.notices[0]);n.id='reconnect';window.__state.payload.notices.push(n);window.__reconnect('SUBSCRIBED')});await page.getByText('알림 수 3',{exact:true}).waitFor()
 await page.goto('http://127.0.0.1:5198/#impersonated');await page.reload();await page.getByText('알림 수 1',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'연차 안내문 보기'}).count(),0)
 assert.deepEqual(errors,[]);console.log('extra-leave-notices-browser: 직원별 접기/종류/검색/모바일·예약구분·관리열람무기록·본인확인/실패재시도·실시간/재연결·전환세션제한 통과')
}finally{await browser?.close();await server.close()}
