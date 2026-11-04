import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const dir = path.resolve('.tmp/browser-identity')
await mkdir(dir, { recursive: true })
await writeFile(path.join(dir, 'auth.tsx'), `import {createContext,useContext} from 'react'; export const Auth=createContext({}); export const useAuth=()=>useContext(Auth);`)
await writeFile(path.join(dir, 'entry.tsx'), `
import React,{useState} from 'react'; import{createRoot}from'react-dom/client';
import{BrowserRouter,useNavigate}from'react-router-dom'; import{Auth}from'./auth';
import{BrowserIdentityProvider}from'../../src/components/layout/BrowserIdentity';
import{useBrowserTabIdentity}from'../../src/components/layout/browser-identity-context';
import{browserPageTitle,browserEnvironment,browserUnreadCount}from'../../src/lib/workspace/browser-title';
function Reporter({owner,notices,rooms,page}){useBrowserTabIdentity(owner,browserUnreadCount(notices,rooms),page);return <img alt="E&J icon" width="64" height="64" src="/favicon.svg?v=ej-1"/>}
function Navigation(){const navigate=useNavigate();window.fixture.navigate=navigate;return null}
function App(){const[user,setUser]=useState('a'),[reportOwner,setOwner]=useState('a'),[notices,setNotices]=useState([]),[rooms,setRooms]=useState([]),[page,setPage]=useState(undefined);
window.fixture={...window.fixture,user:setUser,owner:setOwner,notices:setNotices,rooms:setRooms,page:setPage,resolve:browserPageTitle,environment:browserEnvironment};
return <Auth.Provider value={{ready:true,session:user?{user:{id:user}}:null,profile:user?{id:user,status:'active'}:null}}><BrowserRouter><BrowserIdentityProvider><Navigation/>{user?<Reporter owner={reportOwner} notices={notices} rooms={rooms} page={page}/>:<p>로그아웃</p>}</BrowserIdentityProvider></BrowserRouter></Auth.Provider>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`)
await build({ entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'app.js'), bundle: true,
  format: 'esm', jsx: 'automatic', alias: { '@/lib/supabase/auth': path.join(dir, 'auth.tsx'), '@': path.resolve('src') },
  define: { 'import.meta.env.DEV': 'false' }, logLevel: 'silent' })
const js = await readFile(path.join(dir, 'app.js'), 'utf8')
const html = (await readFile('index.html', 'utf8')).replace(/<link\s+rel="stylesheet"[\s\S]*?\/>/, '').replace('/src/main.tsx', '/app.js')
const browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const errors = [], unexpected = []
try {
  const context = await browser.newContext()
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: js })
    const icons = { '/favicon.svg': 'image/svg+xml', '/ej-icon-32.png': 'image/png', '/ej-icon-180.png': 'image/png', '/ej-icon-192.png': 'image/png' }
    if (icons[url.pathname]) return route.fulfill({ contentType: icons[url.pathname], body: await readFile(path.join('public', url.pathname.slice(1))) })
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html })
    unexpected.push(url.pathname); return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('https://test.atelier-6yy.pages.dev/settings/profile?part=meetings')
  const title = expected => page.waitForFunction(value => document.title === value, expected)
  await title('[TEST] 회의 · E&J')
  await page.getByAltText('E&J icon').evaluate(image => image.decode())
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'), '/ej-icon-180.png')
  await page.evaluate(() => {
    const notice={id:'new',current:true,readAt:null};
    window.fixture.notices([notice,notice,{id:'read',readAt:'now',action:{key:'pending'}},{id:'retired',current:false,readAt:null}]);
    window.fixture.rooms([{id:'room',unread:2}]);
  })
  await title('[TEST] (3) 회의 · E&J')
  for (const [url, name] of [
    ['/settings/profile', 'My Schedule'], ['/settings/profile?part=approvals', '승인할 신청'],
    ['/operations-support?part=leave&leaveView=balance', '연차 현황 · 운영지원'],
    ['/work-requests/design', '부서 업무 · Visual'], ['/drafts/new', '기획안 추가'],
    ['/products/brand/M123', '상품 상세'], ['/design/file-manager', '이미지 업로드 · Visual'],
  ]) { await page.evaluate(url => window.fixture.navigate(url), url); await title('[TEST] (3) '+name+' · E&J') }
  await page.evaluate(() => window.fixture.notices([{id:'new',readAt:'now',action:{key:'still-pending'}}]))
  await title('[TEST] (2) 이미지 업로드 · Visual · E&J')
  await page.evaluate(() => window.fixture.rooms([{id:'room',unread:0}]))
  await title('[TEST] 이미지 업로드 · Visual · E&J')
  await page.evaluate(() => window.fixture.rooms([{id:'room',unread:123}]))
  await title('[TEST] (99+) 이미지 업로드 · Visual · E&J')
  await page.evaluate(() => { window.fixture.page('기존 방 · 채팅'); window.fixture.navigate('/chat/room/one') })
  await title('[TEST] (99+) 기존 방 · 채팅 · E&J')
  await page.evaluate(() => window.fixture.user('b')) // Late updates from the old account must be ignored.
  await title('[TEST] 채팅 · E&J')
  await page.evaluate(() => { window.fixture.rooms([{id:'room',unread:9}]);window.fixture.page('이전 계정 방 · 채팅') })
  await title('[TEST] 채팅 · E&J')
  await page.evaluate(() => { window.fixture.owner('b');window.fixture.rooms([]);window.fixture.page('새 방 · 채팅') })
  await title('[TEST] 새 방 · 채팅 · E&J')
  await page.evaluate(() => window.fixture.user(null))
  await title('[TEST] 로그인 · E&J')
  await page.goto('http://localhost:5173/settings/profile?part=meetings'); await title('[로컬] 회의 · E&J')
  await page.goto('https://atelier-6yy.pages.dev/settings/profile?part=meetings'); await title('회의 · E&J')
  assert.equal(await page.evaluate(() => window.fixture.environment('test.atelier-6yy.pages.dev',true)), '[로컬] ')
  await page.screenshot({ path: path.join(dir, 'browser-identity.png') })
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [], 'Branding must not query a server or mutate notification read state')
  console.log('PASS browser identity: route/subtabs, original icons, unread vs pending/retired, account isolation, logout, chat, local/test/production; no remote requests')
} finally { await browser.close() }
