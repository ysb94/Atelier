import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const dir = path.resolve('.tmp/desktop-notifications-browser')
await mkdir(dir, { recursive: true })
await writeFile(path.join(dir, 'entry.tsx'), `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{useDesktopNotifications}from'@/lib/inbox/use-desktop-notifications';
import{desktopCandidates,desktopEventKey,desktopBody}from'@/lib/inbox/desktop-notifications';
import{DesktopNotificationSettings}from'@/components/layout/DesktopNotificationSettings';
window.toasts=[];window.requests=0;window.testPermission='default';
class Toast{static get permission(){return window.testPermission}static async requestPermission(){window.requests++;window.testPermission='granted';return 'granted'}constructor(title,opts){this.title=title;this.opts=opts;window.toasts.push(this)}close(){this.closed=true;this.onclose?.()}}
window.Notification=Toast;Object.defineProperty(document,'visibilityState',{get:()=>window.hiddenForTest?'hidden':'visible'});
const original={id:'old',title:'기존 알림',body:'비공개 사유',createdAt:'2026-11-04',readAt:null,current:true,href:'/settings/profile?part=approvals&workNotice=new',target:{eventVersion:'1'},action:{label:'승인 처리 필요'}};
const seen=new Set([desktopEventKey(original)]);
if(desktopCandidates([original],seen,true).length)throw Error('old replay');
if(desktopBody(original).includes('비공개'))throw Error('private body');
function App(){const[user,setUser]=useState('staff');const[items,setItems]=useState([original]);const[ready,setReady]=useState(false);const[opened,setOpened]=useState('');
window.fixture={ready:()=>setReady(true),items:rows=>setItems(rows.map(row=>({...original,...row}))),user:setUser};
const controls=useDesktopNotifications(user,items,ready,item=>setOpened(item.id));return <><DesktopNotificationSettings controls={controls}/>{controls.prompt&&<DesktopNotificationSettings controls={controls} invitation/>}<output>{opened}</output></>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`)
await build({ entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic', alias: { '@': path.resolve('src') }, logLevel: 'silent' })
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext()
  // Synthetic HTTPS origin: no live site, network, or production data is used.
  const origin = 'https://atelier-desktop.test'
  const readFileSyncApp = await readFile(path.join(dir, 'app.js'), 'utf8')
  await context.route('**/*', route => route.fulfill(route.request().url().endsWith('/app.js')
    ? { contentType: 'text/javascript', body: readFileSyncApp }
    : { contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>' }))
  const errors = []
  let page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.getByText('업무 알림을 PC에서도 받을까요?').waitFor()
  assert.equal(await page.evaluate(() => window.requests), 0, 'No automatic permission request')
  await page.getByRole('button', { name: '나중에' }).click()
  assert.equal(await page.getByText('업무 알림을 PC에서도 받을까요?').count(), 0)
  await page.getByRole('button', { name: '알림 켜기', exact: true }).click()
  await page.getByRole('button', { name: 'PC 알림 끄기' }).waitFor()
  assert.equal(await page.evaluate(() => window.requests), 1)
  await page.evaluate(() => { window.fixture.ready(); window.hiddenForTest = true })
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => window.toasts.length), 0, 'No history replay on first load')
  let other = await context.newPage()
  other.on('pageerror', error => errors.push(error.message))
  await other.goto(origin)
  await other.evaluate(() => { window.testPermission = 'granted'; window.dispatchEvent(new Event('focus')); window.fixture.ready(); window.hiddenForTest = true })
  await other.waitForTimeout(80)
  await Promise.all([page, other].map(tab => tab.evaluate(() => window.fixture.items([{ id: 'new', title: '새 승인 요청' }]))))
  await Promise.race([page, other].map(tab => tab.waitForFunction(() => window.toasts.length === 1)))
  await other.waitForTimeout(100)
  const counts = await Promise.all([page, other].map(tab => tab.evaluate(() => window.toasts.length)))
  assert.equal(counts[0] + counts[1], 1, 'Only one tab delivers the event')
  if (!counts[0]) [page, other] = [other, page]
  await page.evaluate(() => window.toasts[0].onclick())
  await page.locator('output').filter({ hasText: 'new' }).waitFor()
  await page.evaluate(() => window.fixture.items([{ id: 'new', readAt: 'now' }]))
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => window.toasts.length), 1, 'Reading does not send again')
  await page.getByRole('button', { name: 'PC 알림 끄기' }).click()
  await page.evaluate(() => window.fixture.items([{ id: 'disabled' }]))
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => window.toasts.length), 1, 'Off suppresses delivery')
  await page.getByRole('button', { name: '알림 켜기', exact: true }).click()
  await page.evaluate(() => { window.hiddenForTest = false; window.fixture.items([{ id: 'visible' }]) })
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => window.toasts.length), 1, 'Visible page does not deliver')
  await page.evaluate(() => { window.hiddenForTest = true; window.fixture.items([{ id: 'retired', current: false }, { id: 'already-read', readAt: 'now' }]) })
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => window.toasts.length), 1, 'Retired and already read events do not deliver')
  await page.evaluate(() => { window.hiddenForTest = true; window.fixture.items([{ id: 'visible', target: { eventVersion: '2' } }]) })
  await page.waitForFunction(() => window.toasts.length === 2)
  await page.evaluate(() => window.fixture.user('other-account'))
  await page.waitForFunction(() => window.toasts.every(toast => toast.closed))
  await page.evaluate(() => window.toasts[1].onclick())
  assert.equal(await page.locator('output').textContent(), 'new', 'Previous account cannot navigate')
  await page.getByRole('button', { name: '테스트 알림' }).click()
  await page.waitForFunction(() => window.toasts.length === 3)
  await page.evaluate(() => { window.testPermission = 'denied'; window.dispatchEvent(new Event('focus')) })
  await page.getByText('브라우저의 사이트 설정에서 알림을 허용해 주세요.').waitFor()
  assert.equal(await page.getByRole('button', { name: '알림 켜기', exact: true }).count(), 0, 'Denied permission is not repeatedly requested')
  await page.evaluate(() => { delete window.Notification; window.dispatchEvent(new Event('focus')) })
  await page.getByText('이 브라우저에서는 PC 알림을 지원하지 않습니다.').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS desktop notifications: permission, baseline, multi-tab delivery, click, read, off, visible, retired events, versions, account cleanup, test, denied, unsupported')
} finally { await browser?.close() }
