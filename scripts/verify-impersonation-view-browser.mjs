import assert from 'node:assert/strict'
import path from 'node:path'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {chromium} from 'playwright-core'
const root=process.cwd(),origin='http://127.0.0.1:5198',fixture=path.join(root,'dev-tools/ai-workflow/browser-fixture/impersonation-view-entry.tsx'),key='atelier:impersonation-view'
let server,browser
try{
 server=await createServer({configFile:false,envDir:false,cacheDir:path.join(root,'node_modules/.cache/impersonation-view'),logLevel:'error',plugins:[{name:'impersonation-view-test',enforce:'pre',resolveId(source,importer){if(importer&&source.startsWith('.')){const target=path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'');if(['src/lib/supabase/client','src/lib/supabase/auth','src/components/layout/release-access-context','src/features/home/attendance-entry-context'].some(name=>target===path.join(root,name)))return fixture}},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.headers.accept?.includes('text/html'))return next();void vite.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/impersonation-view-entry.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next)})}},react()],resolve:{alias:[...['@/lib/supabase/client','@/lib/supabase/auth','@/components/layout/release-access-context','@/features/home/attendance-entry-context'].map(find=>({find,replacement:fixture})),{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false}})
 await server.listen();browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const errors=[]
 async function newPage(){const context=await browser.newContext();await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);return page}
 async function position(page){await page.waitForFunction(()=>document.querySelector('[data-testid=loaded]')?.textContent==='true');await page.evaluate(()=>{document.querySelector('[data-brand-page-scroll]').scrollTo(40,720);document.querySelector('#sheet-scroll').scrollTo(360,100)})}
 async function clickReload(page,label){await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:label,exact:true}).click()])}
 async function restored(page){await page.waitForFunction(()=>document.querySelector('[data-brand-page-scroll]')?.scrollTop===720&&document.querySelector('#sheet-scroll')?.scrollLeft===360);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null)}
 for(const operator of ['developer','delegate','ceo']){
  const page=await newPage(),href=origin+'/drafts?operator='+operator+'&brand=atelier&folder=sample&delay=1#PL-0006'
  await page.goto(href);await position(page);await page.getByLabel('미저장 입력').fill('계정 간 전달 금지');await position(page)
  for(const label of ['planner','planner2','복귀']){await clickReload(page,label);assert.equal(page.url(),href);await restored(page);assert.equal(await page.getByLabel('미저장 입력').inputValue(),'')}
  // Fresh failed switching must not navigate or leave a pending restoration.
  await page.evaluate(()=>sessionStorage.setItem('fixture:fail','1'));await page.getByRole('button',{name:'planner',exact:true}).click();await page.getByRole('alert').filter({hasText:'검증용 전환 실패'}).waitFor();assert.equal(page.url(),href);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null)
  await page.context().close()
 }
 const page=await newPage();await page.goto(origin+'/drafts?delay=1');await position(page);await clickReload(page,'design');await page.waitForURL(origin+'/settings/profile');assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);assert.equal(await page.locator('[data-brand-page-scroll]').evaluate(e=>e.scrollTop),0)
 await clickReload(page,'복귀');await page.goto(origin+'/settings/profile?part=meetings&brand=atelier#response');await position(page);await clickReload(page,'planner');assert.equal(new URL(page.url()).search,'?part=meetings&brand=atelier');assert.equal(new URL(page.url()).hash,'#response');await restored(page)
 // Attendance blocks restoration; the pending position is retained until the gate is ready.
 await page.goto(origin+'/drafts?gate=1&delay=1');await position(page);await clickReload(page,'planner2');await page.waitForFunction(()=>document.querySelector('[data-testid=loaded]')?.textContent==='true');assert.notEqual(await page.evaluate(key=>sessionStorage.getItem(key),key),null);assert.equal(await page.locator('[data-brand-page-scroll]').evaluate(e=>e.scrollTop),0);await page.getByRole('button',{name:'출근 확인 완료'}).click();await restored(page)
 // A real user scroll cancels delayed restoration.
 await page.goto(origin+'/drafts?delay=1');await position(page);await clickReload(page,'planner');await page.locator('[data-brand-page-scroll]').hover();await page.mouse.wheel(0,100);await page.waitForFunction(()=>document.querySelector('[data-testid=loaded]')?.textContent==='true');assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);assert.notEqual(await page.locator('[data-brand-page-scroll]').evaluate(e=>e.scrollTop),720)
 // Mismatched actors, expired snapshots and the five-second bound cannot produce a later jump.
 await page.evaluate(async key=>{const m=await import('/src/lib/workspace/impersonation-view.ts');sessionStorage.setItem(key,JSON.stringify({...m.captureImpersonationView(),v:1,profileId:'other',savedAt:Date.now()}));m.restoreImpersonationView('current')},key);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null)
 await page.evaluate(async key=>{const m=await import('/src/lib/workspace/impersonation-view.ts');sessionStorage.setItem(key,JSON.stringify({...m.captureImpersonationView(),v:1,profileId:'current',savedAt:Date.now()-600000}));m.restoreImpersonationView('current')},key);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null)
 await position(page);await page.evaluate(async key=>{const m=await import('/src/lib/workspace/impersonation-view.ts'),snapshot=m.captureImpersonationView();snapshot.points[0].top=99999;sessionStorage.setItem(key,JSON.stringify({...snapshot,v:1,profileId:'current',savedAt:Date.now()}));m.restoreImpersonationView('current')},key);await page.waitForFunction(key=>!sessionStorage.getItem(key),key,{timeout:8000})
 assert.deepEqual(errors,[])
 console.log('impersonation-view-browser: 3 operators, staff re-switch/return, URL/query/hash, delayed nested scroll, StrictMode, discarded unsaved input, denied-page fallback, attendance gate, user cancellation and bounded restoration passed; no server requests')
}finally{await browser?.close();await server?.close()}
