import assert from 'node:assert/strict'
import path from 'node:path'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {chromium} from 'playwright-core'
const root=process.cwd(),fixture=path.join(root,'dev-tools/ai-workflow/browser-fixture'),auth=path.join(fixture,'release-auth.tsx'),client=path.join(fixture,'release-client.ts')
const server=await createServer({root,configFile:false,envDir:false,cacheDir:path.join(root,'node_modules/.cache/release-vite'),logLevel:'error',
 plugins:[{name:'release-fixture',enforce:'pre',resolveId(source,importer){if(importer&&source.startsWith('.')){const target=path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'');if(target===path.join(root,'src/lib/supabase/auth'))return auth;if(target===path.join(root,'src/lib/supabase/client'))return client}},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.headers.accept?.includes('text/html'))return next();vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/release-entry.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next)})}},react(),tailwindcss()],
 resolve:{alias:[{find:'@/lib/supabase/auth',replacement:auth},{find:'@/lib/supabase/client',replacement:client},{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port:5195,strictPort:true,hmr:false}})
let browser,page
const errors=[],remote=[]
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),origin='http://127.0.0.1:5195'
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(remote.push(route.request().url()),route.abort()))
 page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(120000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
 const tabs=()=>page.getByRole('tablist',{name:'My home 메뉴'}).getByRole('tab').allTextContents()
 async function expectTabs(labels){const ready=await page.waitForFunction(expected=>{const menu=[...document.querySelectorAll('[role="tablist"][aria-label="My home 메뉴"]')].find(element=>element.checkVisibility());if(!menu)return false;const actual=[...menu.querySelectorAll('[role="tab"]')].map(item=>item.textContent);return JSON.stringify(actual)===JSON.stringify(expected)?actual:false},labels);assert.deepEqual(await ready.jsonValue(),labels)}
 const nav=()=>page.locator('aside nav a').evaluateAll(items=>items.map(a=>a.getAttribute('href')))
 async function load(role,href='/settings/profile'){await page.goto(origin+href+(href.includes('?')?'&':'?')+'role='+role);await page.getByRole('tab',{name:'내 근태',exact:true}).waitFor();await page.waitForFunction(()=>window.__releaseFixture.reads.includes('department_request_approvers'))}
 await load('staff','/');await page.waitForURL('**/settings/profile');await expectTabs(['내 근태','회의']);assert.deepEqual(await nav(),['/settings/profile'])
 await page.getByRole('tab',{name:'회의',exact:true}).click();await page.getByRole('button',{name:'채팅',exact:true}).click();await page.locator('#workspace-chat-panel').waitFor();await page.keyboard.press('Escape')
 for(const href of ['/data/all','/drafts','/operations-support','/logistics/invoices','/settings/profile?part=work','/settings/profile?part=profile']){await load('staff',href);await page.waitForURL('**/settings/profile');assert.equal(await page.getByRole('tab',{name:'내 근태',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await page.evaluate(()=>window.__releaseFixture.reads.includes('styles')),false,'미공개 상품 화면이 조회되지 않음')}
 for(const role of ['approver','substitute','logistics-approver']){await load(role);await expectTabs(['내 근태','회의','승인할 신청'])}
 await page.getByRole('tab',{name:'승인할 신청',exact:true}).click();await page.evaluate(()=>window.__releaseFixture.setRole('staff'));await page.waitForURL('**/settings/profile');await expectTabs(['내 근태','회의'])
 await page.goto(origin+'/settings/profile?part=approvals&role=approver&approval-error=1');await page.getByText('승인자 지정을 확인하지 못했습니다.',{exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'승인할 신청',exact:true}).count(),0)
 await page.evaluate(()=>{window.__releaseFixture.approvalError=false;window.__releaseFixture.refresh()});await expectTabs(['내 근태','회의','승인할 신청'])
 await load('logistics');await page.getByRole('button',{name:'물류',exact:true}).click();let hrefs=await nav();for(const href of ['/product-work/logistics','/work-requests/logistics','/logistics/invoices','/logistics/barcode-outbound-data-entry','/logistics/bulk-outbound','/logistics/finder','/logistics/warehouses','/logistics/temporary-warehouse','/logistics/cargo-inbound'])assert.ok(hrefs.includes(href),href)
 assert.equal(hrefs.includes('/data/all'),false)
 await page.goto(origin+'/products/fixture/F-M001?role=logistics');await page.waitForURL('**/product-work/logistics/fixture/F-M001?role=logistics');assert.equal(await page.getByRole('button',{name:'전체 상품',exact:true}).count(),0,'예전 상품 상세 탭도 공개된 물류 경로로 통일')
 await page.getByRole('button',{name:'목록으로',exact:true}).click();await page.waitForURL('**/product-work/logistics?role=logistics')
 await load('logistics');await page.getByRole('button',{name:'물류',exact:true}).click()
 await page.locator('aside a[href="/product-work/logistics"]').click();await page.waitForURL('**/product-work/logistics');await page.evaluate(()=>window.__releaseFixture.setRole('staff'));await page.waitForURL('**/settings/profile');assert.equal(await page.locator('[aria-label="물류 · 상품 정보 탭 닫기"]').count(),0)
 await load('logistics');await page.getByRole('button',{name:'물류',exact:true}).click();await page.locator('aside a[href="/product-work/logistics"]').click();await page.waitForURL('**/product-work/logistics');await page.locator('aside a[href="/settings/profile"]').click();await expectTabs(['내 근태','회의']);await page.evaluate(()=>window.__releaseFixture.setRole('staff'));await expectTabs(['내 근태','회의']);assert.ok(page.url().includes('/settings/profile'),'숨긴 물류 탭이 현재 주소를 바꾸지 않음')
 await load('operations');await page.getByRole('button',{name:'운영지원',exact:true}).click();await page.getByRole('button',{name:'설정',exact:true}).click();hrefs=await nav();for(const href of ['/operations-support','/members','/settings/permissions'])assert.ok(hrefs.includes(href),href);assert.equal(hrefs.includes('/settings/access-ip'),false)
 for(const [role,title,paths] of [
  ['planning','기획',['/drafts','/work-requests/planning']],
  ['md','MD',['/product-work/md','/md/price-compare','/work-requests/md']],
  ['china','중국팀',['/china/work-orders']],
 ]){
  await load(role);await page.locator('aside nav').getByRole('button',{name:title,exact:true}).click()
  assert.deepEqual(await nav(),['/settings/profile',...paths],role+'는 자기 부서 메뉴만 표시')
  await expectTabs(['내 근태','회의'])
 }
 for(const [role,title] of [['contents','Contents'],['global','Global Online'],['visual','Visual'],['b2b','B2B 사업'],['offline','OFF LINE'],['china-global','CHINA'],['marketing','마케팅'],['executives','운영진']]){
  await load(role);await page.locator('aside nav').getByRole('button',{name:title,exact:true}).click()
  await page.locator('aside nav').getByText('준비 중',{exact:true}).waitFor()
  assert.deepEqual(await nav(),['/settings/profile'])
  assert.deepEqual(await page.locator('aside nav button').allTextContents(),[title])
 }
 for(const role of ['developer','owner','ceo']){await load(role);assert.ok((await tabs()).includes('내 업무'));assert.ok((await nav()).includes('/products'))}
 await page.setViewportSize({width:250,height:900});const fullMenu=page.getByRole('tablist',{name:'My home 메뉴'});assert.ok((await tabs()).length>=7);assert.equal(await fullMenu.evaluate(element=>element.scrollWidth>element.clientWidth),true,'예외 계정의 전체 탭은 좁은 화면에서 가로 탐색')
 await load('staff');await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.tmp/release-staff-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[])
 console.log('release-access-browser: 실제 회사 셸·전체 부서의 자기 탭/준비 중·내 근태/회의·승인자/대체·운영지원·물류 전체·예외 3계정·직접 주소·승인 해제/부서 변경·채팅 유지·비공개 쿼리 미실행·모바일 통과 (외부 연결 없음)')
}catch(error){console.error(JSON.stringify({errors,url:page?.url(),text:(await page?.locator('body').innerText().catch(()=>''))?.slice(0,3500)}));throw error}finally{await browser?.close();await server.close()}
