import assert from 'node:assert/strict'
import path from 'node:path'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {chromium} from 'playwright-core'
const root=process.cwd(),fixture=path.join(root,'dev-tools/ai-workflow/browser-fixture'),client=path.join(fixture,'auth-recovery-client.ts')
const browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
// 같은 검증 서버에서 빌드 시 주입되는 스위치 값만 시험한다. 서버 교체에 따른 의존성 재최적화 경합을 피한다.
 const server=await createServer({root,cacheDir:path.join(root,"node_modules",".cache","auth-recovery-vite"),configFile:false,envFile:false,logLevel:'error',define:{'import.meta.env.VITE_ASSIGNED_PERMISSIONS_ENABLED':'globalThis.__assignedPermissionsTestFlag'},plugins:[{name:'auth-recovery-fixture',enforce:'pre',resolveId(source,importer){if(importer&&source.startsWith('.')&&path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'')===path.join(root,'src/lib/supabase/client'))return client},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.headers.accept?.includes('text/html'))return next();vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>globalThis.__assignedPermissionsTestFlag=new URLSearchParams(location.search).has("assigned")?"true":"false"</script><script type="module" src="/dev-tools/ai-workflow/browser-fixture/auth-recovery-entry.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)}).catch(next)})}},react(),tailwindcss()],resolve:{alias:[{find:'@/lib/supabase/client',replacement:client},{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port:5192,hmr:false,fs:{allow:[root]}}})
 await server.listen()
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`,context=await browser.newContext(),errors=[],remote=[]
 try{
  await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();remote.push(route.request().url());return route.abort()})
  const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(120000);page.on('pageerror',error=>errors.push(error.message))
   await page.goto(origin+'/');await page.getByText('기존 작업 화면 진입',{exact:true}).waitFor()
   assert.equal(await page.locator('output').first().innerText(),'active · legacy')
   assert.deepEqual(await page.evaluate(()=>window.__authRecovery.audit.rpcs),[],'전환 전에는 새 RPC를 호출하지 않음')
   await page.getByRole('button',{name:'승인 계정 재신청 시도',exact:true}).click()
   await page.locator('#request-result').getByText(/현재 계정은 재신청할 수 없습니다/).waitFor()
   assert.equal(await page.evaluate(()=>window.__authRecovery.audit.updates),0,'승인 계정에 pending 업데이트를 보내지 않음')
   await page.goto(origin+'/?no-request');await page.getByText('기존 작업 화면 진입',{exact:true}).waitFor()
   assert.equal(await page.getByRole('heading',{name:'처음 시작하기'}).count(),0,'신청일 없는 기존 승인 계정도 재가입 방지')
   await page.goto(origin+'/?profile-error');await page.getByRole('alert').getByText(/계정 정보를 불러오지 못했습니다/).waitFor()
   assert.equal(await page.getByRole('heading',{name:'처음 시작하기'}).count(),0,'프로필 오류는 신규 가입이 아님')
   await page.evaluate(()=>window.__authRecovery.recover());await page.getByRole('button',{name:'계정 다시 불러오기',exact:true}).click();await page.getByText('기존 작업 화면 진입',{exact:true}).waitFor()
   await page.goto(origin+'/?pending');await page.getByRole('heading',{name:'승인 대기 중',exact:true}).waitFor()
   assert.equal(await page.getByText('기존 작업 화면 진입',{exact:true}).count(),0,'실제 미승인 계정을 자동 승인하지 않음')
   await page.goto(origin+'/?assigned');await page.getByRole('alert').getByText(/계정 정보를 불러오지 못했습니다/).waitFor()
   assert.equal(await page.getByRole('heading',{name:'처음 시작하기'}).count(),0,'전환 후 새 RPC 오류도 가입 화면을 열지 않음')
   assert.ok((await page.evaluate(()=>window.__authRecovery.audit.rpcs)).includes('list_my_permission_grants'))
   assert.equal(await page.evaluate(()=>window.__authRecovery.audit.updates),0)
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[])
 }finally{await context.close();await server.close()}
console.log('auth-recovery-browser: 실제 AuthProvider·프로필 로더·AuthGate에서 이전 DB 로그인 유지·조회 오류/신규 가입 분리·승인 계정 재신청 차단·실제 미승인 유지·전환 후 오류 차단 통과 (운영 연결·외부 요청 없음)')
}finally{await browser.close()}
