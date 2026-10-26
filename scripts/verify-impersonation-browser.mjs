import assert from 'node:assert/strict'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'
import { transform } from 'esbuild'

// 실제 AuthProvider·전환 라이브러리·직원 선택 UI를 사용하고 외부 인증/업무 저장만 대체한다.
const clientSource = `
const operatorId='d0000000-0000-4000-8000-000000000001',staffId='10000000-0000-4000-8000-000000000002'
const company='e0000000-0000-4000-8000-000000000001'
const sessionFor=id=>({user:{id,email:id===operatorId?'dev@atelier.local':'staff@example.invalid'},access_token:id===operatorId?'operator-token':'staff-token',refresh_token:id===operatorId?'operator-refresh':'staff-refresh'})
const current=()=>JSON.parse(localStorage.getItem('test:session')||'null')
if(!localStorage.getItem('test:initialized')){localStorage.setItem('test:initialized','1');localStorage.setItem('test:session',JSON.stringify(sessionFor(new URLSearchParams(location.search).has('staff')?staffId:operatorId)))}
const listeners=new Set()
function emit(){for(const callback of listeners)callback('SIGNED_IN',current())}
function setSession(value){localStorage.setItem('test:session',JSON.stringify(value));emit()}
window.addEventListener('storage',event=>{if(event.key==='test:session')emit()})
const audit=()=>JSON.parse(localStorage.getItem('test:audit')||'[]')
function record(value){localStorage.setItem('test:audit',JSON.stringify([...audit(),value]))}
export async function getMyProfile(){const s=current();if(!s)return null;const operator=s.user.id===operatorId;return {id:s.user.id,email:s.user.email,displayName:operator?'검증 개발자':'검증 직원',status:'active',companyId:company,departmentId:'test-department',departmentName:operator?'개발팀':'물류팀',position:'사원',jobGrade:'사원',capabilities:[],memberships:[],isAdmin:operator,permissionMode:'assigned',permissionGrants:(operator?['basic.use','preview.use']:['basic.use']).map(permission=>({permission,scopeKind:'company',scopeId:company}))}}
const client={auth:{
getSession:async()=>({data:{session:current()},error:null}),getUser:async()=>({data:{user:current()?.user},error:null}),
onAuthStateChange:callback=>{listeners.add(callback);return {data:{subscription:{unsubscribe(){listeners.delete(callback)}}}}},
verifyOtp:async()=>{if(sessionStorage.getItem('test:otp-error'))return {data:{session:null},error:{message:'expired'}};setSession(sessionFor(staffId));return {data:{session:current()},error:null}},
setSession:async()=>{if(sessionStorage.getItem('test:restore-error'))return {data:{session:null},error:{message:'expired'}};setSession(sessionFor(operatorId));return {data:{session:current()},error:null}},
signOut:async options=>{record({action:'signOut',scope:options.scope,id:current()?.user.id});setSession(null);return {error:null}}},
functions:{invoke:async(_name,options)=>{const action=options.body.action;record({action,id:current()?.user.id});if(sessionStorage.getItem('test:deny'))return {data:null,error:{context:{status:403,json:async()=>({error:'전환 불가'})}}};if(action==='list')return {data:{targets:[{id:operatorId,name:'검증 개발자',department:'개발팀',position:'사원'},{id:staffId,name:'검증 직원',department:'물류팀',position:'사원'}]},error:null};if(action==='start')return {data:{tokenHash:'hash',eventId:'20000000-0000-4000-8000-000000000001',target:{id:staffId,name:'검증 직원',department:'물류팀',position:'사원'}},error:null};return {data:{ok:true},error:null}}},
rpc:async name=>{record({action:name,id:current()?.user.id});return {data:true,error:null}}
}
export const getSupabase=()=>client
export const isSupabaseConfigured=()=>true
Object.assign(window,{__impersonationFixture:{audit,current}})
`
const entry = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import '@/index.css'
import {AuthProvider,useAuth} from '@/lib/supabase/auth'
import {DeveloperPreviewProvider,DeveloperPreviewPage,DeveloperPreviewBar} from '@/components/layout/DeveloperPreview'
import {getSupabase} from '@/lib/supabase/client'
function Screen(){const auth=useAuth();if(!auth.ready)return <p>불러오는 중</p>;return <><DeveloperPreviewProvider><DeveloperPreviewPage><DeveloperPreviewBar/><p data-testid="account">{auth.profile?.displayName||'로그아웃'}</p><DeveloperPreviewBar scope="chat"/><button onClick={()=>void getSupabase().rpc('work-write')}>검증용 저장</button><button onClick={()=>void auth.signOut()}>로그아웃</button></DeveloperPreviewPage></DeveloperPreviewProvider></>}
createRoot(document.getElementById('root')).render(<AuthProvider><Screen/></AuthProvider>)
`
const root = process.cwd(), clientFile = '\0impersonation-client.ts', entryFile = '\0impersonation-entry.tsx'
const server = await createServer({ root, configFile: false, envDir: false, logLevel: 'error', cacheDir: path.join(root, 'node_modules/.cache/impersonation-vite'),
  plugins: [{ name: 'impersonation-offline', enforce: 'pre', resolveId(source, importer) {
    if (source === clientFile || source === entryFile) return source
    if (source === '/__impersonation_entry.tsx') return entryFile
    if (source === '@/lib/supabase/client' || source === '@/lib/supabase/profiles') return clientFile
    if (importer && source.startsWith('.')) {
      const target = path.resolve(path.dirname(importer), source).replace(/\.tsx?$/, '')
      if ([path.join(root, 'src/lib/supabase/client'), path.join(root, 'src/lib/supabase/profiles')].includes(target)) return clientFile
    }
  }, async load(id) { if (id === clientFile) return clientSource; if (id === entryFile) return (await transform(entry, { loader: 'tsx', jsx: 'automatic', format: 'esm' })).code }, configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (!req.headers.accept?.includes('text/html')) return next()
      vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/__impersonation_entry.tsx"></script></body></html>')
        .then(html => { res.setHeader('Content-Type', 'text/html'); res.end(html) }).catch(next)
    })
  } }, react(), tailwindcss()], resolve: { alias: [{ find: '@/lib/supabase/client', replacement: clientFile }, { find: '@/lib/supabase/profiles', replacement: clientFile }, { find: '@', replacement: path.join(root, 'src') }] },
  server: { host: '127.0.0.1', port: 5197, strictPort: true, hmr: false },
})
let browser, page
const errors = [], remote = []
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext(), origin = 'http://127.0.0.1:5197'
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : (remote.push(route.request().url()), route.abort()))
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const account = (name, target = page) => target.getByTestId('account').filter({ hasText: name }).waitFor()
  const bar = () => page.getByRole('region', { name: '직원 계정 전환' })
  await page.goto(origin + '/settings/profile')
  await account('검증 개발자')
  await bar().getByRole('button', { name: '직원 계정', exact: true }).click()
  await bar().getByText('물류팀', { exact: true }).waitFor()
  assert.equal(await page.getByRole('group', { name: '표시 역할' }).count(), 0)
  await bar().getByRole('button', { name: '검증 직원 사원', exact: true }).click()
  await account('검증 직원')
  await page.getByText(/검증 직원 계정으로 사용 중/).waitFor()
  await page.getByRole('button', { name: '검증용 저장' }).click()
  assert.equal(await page.evaluate(() => window.__impersonationFixture.audit().find(row => row.action === 'work-write').id), '10000000-0000-4000-8000-000000000002')
  await page.reload(); await account('검증 직원')
  const second = await context.newPage(); await second.goto(origin + '/'); await account('검증 직원', second)
  await bar().getByRole('button', { name: '내 계정으로 돌아가기' }).click()
  await account('검증 개발자'); await account('검증 개발자', second)
  assert.equal(await page.evaluate(() => localStorage.getItem('atelier:impersonation')), null)
  await second.close()
  await bar().getByRole('button', { name: '직원 계정', exact: true }).click()
  await page.evaluate(() => sessionStorage.setItem('test:otp-error', '1'))
  await bar().getByRole('button', { name: '검증 직원 사원', exact: true }).click()
  await page.getByRole('alert').getByText('전환 링크가 만료되었습니다. 다시 선택해 주세요.').waitFor()
  await account('검증 개발자')
  await page.evaluate(() => sessionStorage.removeItem('test:otp-error'))
  await bar().getByRole('button', { name: '검증 직원 사원', exact: true }).click()
  await account('검증 직원')
  await page.getByRole('button', { name: '로그아웃', exact: true }).click()
  await account('로그아웃')
  assert.equal(await page.evaluate(() => localStorage.getItem('atelier:impersonation')), null)
  const staffContext = await browser.newContext(), staff = await staffContext.newPage()
  await staffContext.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
  await staff.goto(origin + '/?staff'); await account('검증 직원', staff)
  assert.equal(await staff.getByRole('region', { name: '직원 계정 전환' }).count(), 0)
  assert.equal(await staff.evaluate(() => window.__impersonationFixture.audit().some(row => row.action === 'list')), false)
  await staffContext.close()
  assert.deepEqual(errors, []); assert.deepEqual(remote, [])
  console.log('impersonation-browser: 실제 선택 UI·AuthProvider·직원 이름 저장·새로고침·다른 탭 동기화·원래 계정 복귀·만료 오류·완전 로그아웃·일반 직원 비노출 통과 (외부 연결 없음)')
} catch (error) { console.error({ errors, url: page?.url(), body: (await page?.locator('body').innerText().catch(() => ''))?.slice(0, 1600) }); throw error }
finally { await browser?.close(); await server.close() }
