import assert from 'node:assert/strict'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'
const root=process.cwd(),fixture=path.join(root,'dev-tools/ai-workflow/browser-fixture'),auth=path.join(fixture,'release-auth.tsx'),client=path.join(fixture,'attendance-entry-client.ts')
const server=await createServer({root,configFile:false,envDir:false,cacheDir:path.join(root,'node_modules/.cache/attendance-entry-vite'),logLevel:'error',
 plugins:[{name:'attendance-entry-fixture',enforce:'pre',resolveId(source,importer){if(importer&&source.startsWith('.')){const target=path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'');if(target===path.join(root,'src/lib/supabase/auth'))return auth;if(target===path.join(root,'src/lib/supabase/client'))return client}},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.headers.accept?.includes('text/html'))return next();vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/attendance-entry.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next)})}},react(),tailwindcss()],
 resolve:{alias:[{find:'@/lib/supabase/auth',replacement:auth},{find:'@/lib/supabase/client',replacement:client},{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port:5196,strictPort:true,hmr:false}})
const origin='http://127.0.0.1:5196',errors=[],remote=[]
let browser,current
const pending=page=>page.getByRole('dialog',{name:'직전 근무일 퇴근 확인',exact:true})
const clockIn=page=>page.getByRole('dialog',{name:'출근하기',exact:true})
async function newPage(context,time='2026-10-27T00:00:00Z'){
 const page=await context.newPage();current=page;page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(120000)
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
 await page.clock.install({time:new Date(time)})
 return page
}
async function context(){const value=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Seoul'});await value.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(remote.push(route.request().url()),route.abort()));return value}
const state=page=>page.evaluate(()=>window.__attendanceEntryFixture.state())
async function load(page,scenario,pathname='/settings/profile'){await page.goto(origin+pathname+'?case='+scenario)}
async function ready(page){await page.waitForFunction(()=>[...document.querySelectorAll('dialog.attendance-entry-dialog')].every(dialog=>!dialog.open));await page.getByRole('group',{name:'출퇴근 상태',exact:true}).waitFor()}
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const first=await context(),page=await newPage(first)
 await load(page,'missing');await clockIn(page).waitFor();await clockIn(page).getByRole('button',{name:'출근하기',exact:true}).click();await pending(page).waitFor()
 const firstStamp=(await state(page)).rows.find(row=>row.work_date==='2026-10-27').clock_in
 assert.deepEqual((await state(page)).writes,['clock_in_today'])
 assert.equal(await pending(page).getByRole('button',{name:'개발자입니다',exact:true}).count(),0)
 await page.keyboard.press('Escape');assert.equal(await pending(page).isVisible(),true)
 const url=page.url();await assert.rejects(()=>page.locator('aside a[href="/settings/profile"]').click({timeout:400}));assert.equal(page.url(),url,'배경 메뉴로 우회할 수 없음')
 await page.reload();await pending(page).waitFor();assert.equal(await clockIn(page).count(),0,'오늘 출근은 다시 입력하지 않음')
 await page.waitForFunction(()=>document.querySelector('select[aria-label="직전 근무일 퇴근 시각 시"]')?.value==='18')
 await page.clock.fastForward('05:00');assert.equal((await state(page)).rows.find(row=>row.work_date==='2026-10-27').clock_in,firstStamp)
 await page.screenshot({path:'.tmp/attendance-entry-desktop.png',fullPage:true,animations:'disabled'})
 await pending(page).getByRole('button',{name:'확인하고 입장',exact:true}).click();await ready(page)
 let saved=(await state(page)).rows.find(row=>row.work_date==='2026-10-26');assert.equal(saved.clock_out_at,'2026-10-26T09:00:00.000Z');assert.ok(saved.clock_out_reported_at)
 assert.equal((await state(page)).rows.find(row=>row.work_date==='2026-10-27').clock_in,firstStamp,'오늘 출근시각 유지')
 await page.reload();await ready(page);assert.equal(await pending(page).count(),0)
 await page.getByRole('group',{name:'출퇴근 상태',exact:true}).getByRole('button',{name:'퇴근하기',exact:true}).click()
 await page.getByRole('dialog',{name:'오늘 퇴근 확인',exact:true}).getByRole('button',{name:'퇴근 기록',exact:true}).click();await ready(page)
 assert.equal((await state(page)).writes.filter(value=>value==='clock_out_today').length,1)
 await page.getByRole('button',{name:'퇴근 무르기',exact:true}).click();assert.ok((await state(page)).rows.find(row=>row.work_date==='2026-10-27').clock_out_at==null)
 await first.close()

 for(const scenario of ['complete','pending-correction','approved-correction']){const c=await context(),p=await newPage(c);await load(p,scenario);await ready(p);assert.deepEqual((await state(p)).writes,[]);await c.close()}
 const weekendContext=await context(),weekend=await newPage(weekendContext,'2026-11-02T00:00:00Z');await load(weekend,'weekend');await clockIn(weekend).getByRole('button',{name:'출근하기',exact:true}).click();await pending(weekend).getByText('근무일 2026-10-30 · 출근 09:00',{exact:true}).waitFor();await weekendContext.close()
 const emptyContext=await context(),empty=await newPage(emptyContext);await load(empty,'no-previous');await clockIn(empty).getByRole('button',{name:'출근하기',exact:true}).click();await ready(empty);await emptyContext.close()

 const nightContext=await context(),night=await newPage(nightContext);await load(night,'overnight','/chat/room/fixture');await pending(night).waitFor()
 await pending(night).getByLabel('직전 근무일 퇴근 날짜',{exact:true}).fill('2026-10-27')
 await pending(night).getByRole('combobox',{name:'직전 근무일 퇴근 시각 시',exact:true}).selectOption('01')
 await pending(night).getByRole('button',{name:'직전 근무일 퇴근 시각 00분',exact:true}).click()
 await pending(night).getByRole('button',{name:'확인하고 입장',exact:true}).click();await pending(night).waitFor({state:'hidden'})
 assert.equal((await state(night)).rows.find(row=>row.work_date==='2026-10-26').clock_out_at,'2026-10-26T16:00:00.000Z');await nightContext.close()

 for(const scenario of ['unconfigured','basis-error']){
  const c=await context(),p=await newPage(c);await load(p,scenario);await pending(p).waitFor();assert.equal(await pending(p).getByRole('textbox',{name:'직전 근무일 퇴근 시각 분',exact:true}).inputValue(),'')
  await pending(p).getByRole('combobox',{name:'직전 근무일 퇴근 시각 시',exact:true}).selectOption('18');await pending(p).getByRole('button',{name:'직전 근무일 퇴근 시각 00분',exact:true}).click();await pending(p).getByRole('button',{name:'확인하고 입장',exact:true}).click();await ready(p);await c.close()
 }
 const failContext=await context(),fail=await newPage(failContext);await load(fail,'save-error');await pending(fail).getByRole('button',{name:'확인하고 입장',exact:true}).click();await pending(fail).getByRole('alert').filter({hasText:'검증용 퇴근 저장 실패'}).waitFor();assert.equal(await pending(fail).isVisible(),true);await pending(fail).getByRole('button',{name:'확인하고 입장',exact:true}).click();await ready(fail);assert.equal((await state(fail)).writes.filter(value=>value==='confirm_previous_clock_out').length,1);await failContext.close()

 const readContext=await context(),read=await newPage(readContext);await load(read,'read-error')
 const errorDialog=read.getByRole('dialog',{name:'출퇴근 기록 확인',exact:true});await errorDialog.getByRole('alert').waitFor();assert.deepEqual((await state(read)).writes,[])
 await read.evaluate(()=>window.__attendanceEntryFixture.repairRead());await errorDialog.getByRole('button',{name:'다시 조회',exact:true}).click();await pending(read).waitFor();await readContext.close()
 const overtimeContext=await context(),overtime=await newPage(overtimeContext);await load(overtime,'overtime');await overtime.waitForFunction(()=>document.querySelector('select[aria-label="직전 근무일 퇴근 시각 시"]')?.value==='21');await overtimeContext.close()

 const rolloverContext=await context(),rollover=await newPage(rolloverContext);await load(rollover,'rollover');await pending(rollover).getByRole('button',{name:'확인하고 입장',exact:true}).waitFor()
 await rollover.clock.setSystemTime(new Date('2026-10-27T15:00:01Z'));await rollover.clock.runFor(30000);await clockIn(rollover).waitFor();assert.deepEqual((await state(rollover)).writes,[],'확인 중 날짜가 바뀌어도 전날에 잘못 저장하지 않음');await rolloverContext.close()

 const raceContext=await context(),one=await newPage(raceContext),two=await newPage(raceContext);await load(one,'parallel');await load(two,'parallel');await pending(one).getByRole('button',{name:'확인하고 입장',exact:true}).click();await ready(one)
 await pending(two).getByRole('combobox',{name:'직전 근무일 퇴근 시각 시',exact:true}).selectOption('19');await pending(two).getByRole('button',{name:'확인하고 입장',exact:true}).click();await ready(two)
 assert.equal((await state(two)).writes.filter(value=>value==='confirm_previous_clock_out').length,1,'여러 창에서 저장해도 기존 퇴근시간은 덮어쓰지 않음');assert.equal((await state(two)).rows.find(row=>row.work_date==='2026-10-26').clock_out_at,'2026-10-26T09:00:00.000Z');await raceContext.close()

 const mobileContext=await context(),mobile=await newPage(mobileContext);await mobile.setViewportSize({width:390,height:844});await load(mobile,'mobile');await mobile.waitForFunction(()=>document.querySelector('select[aria-label="직전 근무일 퇴근 시각 시"]')?.value==='18');await pageSafeScreenshot(mobile)
 const dialog= pending(mobile);assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,'모바일 가로 넘침 없음');await mobileContext.close()
 const reminderContext=await context(),reminder=await newPage(reminderContext);await load(reminder,'complete');await ready(reminder);await reminder.clock.setSystemTime(new Date('2026-10-27T09:11:00Z'));await reminder.clock.runFor(30000)
 await reminder.getByRole('status',{name:'퇴근 기록 안내',exact:true}).waitFor();await reminder.getByRole('button',{name:'아직 근무 중',exact:true}).click();await reminder.reload();await ready(reminder);assert.equal(await reminder.getByRole('status',{name:'퇴근 기록 안내',exact:true}).count(),0,'새로고침 후 같은 안내 반복 없음');await reminderContext.close()
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[])
 console.log('attendance-entry-browser: 출근 먼저 저장·필수 확인·새로고침/직접 채팅 주소·휴일/정정·새벽 퇴근·수동 입력·실패 재시도·여러 창·오늘 퇴근/취소·모바일·1회 안내 통과 (외부 요청/실제 DB 저장 없음)')
}catch(error){console.error(JSON.stringify({errors,url:current?.url(),text:(await current?.locator('body').innerText().catch(()=>''))?.slice(0,4000)}));throw error}finally{await browser?.close();await server.close()}
async function pageSafeScreenshot(page){await page.screenshot({path:'.tmp/attendance-entry-mobile.png',fullPage:true,animations:'disabled'})}
