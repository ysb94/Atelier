import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

const root = process.cwd()
const fixture = {
  name: 'china-shipment-fixture',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === 'china-shipment-entry') return '\0china-shipment-entry'
    if (/\/lib\/supabase\/auth(?:\.tsx?)?$/.test(source.replaceAll('\\', '/'))) return '\0china-shipment-auth'
    if (source === './client' && importer?.replaceAll('\\', '/').includes('/lib/supabase/')) return '\0china-shipment-client'
  },
  load(id) {
    if (id === '\0china-shipment-auth') return `export const useAuth = () => ({ profile: { id: 'worker', status: 'active' } })`
    if (id === '\0china-shipment-client') return `
      const state = window.shipment = {
        order: { draftId: 'draft', orderId: 'sample', draftNo: 'PL-SHIP', kind: 'sample', round: 1,
          nameKo: '발송 검증 상품', owner: '기획 담당', fileName: 'sample.txt', revision: 'initial',
          shippedAt: '2026-10-20T00:00:00Z', assigneeCheckedAt: null, closed: false, ...JSON.parse(sessionStorage.getItem('shipment') ?? '{}') },
        calls: [], holdCheck: false, failCheck: false, failShip: false,
      }
      export function getSupabase() {
        return { rpc: async (name, args) => {
          const order = state.order
          if (name === 'get_my_china_work_orders') return { data: { role: 'worker', orders: [{ ...order }] }, error: null }
          if (name === 'get_my_china_work_order_file') return { data: 'data:text/plain,work-order', error: null }
          if (name !== 'apply_china_work_order') return { data: null, error: null }
          state.calls.push(args.p_action)
          if (args.p_revision !== order.revision) return { data: null, error: { code: '40001', message: '이전 상태로 요청했습니다.' } }
          if (args.p_action === 'check') {
            if (state.holdCheck) await new Promise(resolve => { state.releaseCheck = resolve })
            if (state.failCheck) return { data: null, error: { code: '40001', message: '받기 저장 실패' } }
            order.assigneeCheckedAt = new Date().toISOString()
          }
          if (args.p_action === 'ship') {
            if (!order.assigneeCheckedAt) return { data: null, error: { code: '55000', message: '먼저 받기를 눌러 주세요.' } }
            if (state.failShip) return { data: null, error: { code: '40001', message: '다른 직원이 수정했습니다.' } }
            order.returnedAt = '2026-10-28T10:17:23Z'
            order.closed = true
          }
          order.revision = crypto.randomUUID()
          sessionStorage.setItem('shipment', JSON.stringify(order))
          return { data: null, error: null }
        } }
      }`
    if (id === '\0china-shipment-entry') return `
      import { createElement as h } from 'react'
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
      import { BrowserRouter } from 'react-router-dom'
      import { ChinaAssignedWorkOrders } from '@/features/china/ChinaAssignedWorkOrders'
      import { getMyChinaWorkOrders } from '@/lib/supabase/china-assigned-work-orders'
      import '@/index.css'
      function Screen() {
        const { data } = useQuery({ queryKey: ['china-work-screen', 'worker'], queryFn: getMyChinaWorkOrders })
        return h(ChinaAssignedWorkOrders, { orders: data?.orders ?? [], accountId: 'worker', brandById: new Map() })
      }
      createRoot(document.getElementById('root')).render(h(QueryClientProvider, { client: new QueryClient() }, h(BrowserRouter, null, h(Screen))))`
  },
}

const bundle = await build({ configFile: false, envFile: false, logLevel: 'error',
  plugins: [fixture, react(), tailwindcss()], resolve: { alias: { '@': path.join(root, 'src') } },
  build: { write: false, cssCodeSplit: false, rolldownOptions: { input: 'china-shipment-entry' } },
})
const { output } = Array.isArray(bundle) ? bundle[0] : bundle
const entry = output.find(asset => asset.type === 'chunk' && asset.isEntry)
const css = output.find(asset => asset.fileName.endsWith('.css'))
assert.ok(entry && css)
const files = new Map(output.map(asset => [`/${asset.fileName}`, asset]))
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.end(`<!doctype html><link rel="stylesheet" href="/${css.fileName}"><div id="root"></div><script type="module" src="/${entry.fileName}"></script>`)
  }
  const asset = files.get(req.url)
  if (!asset) { res.statusCode = 404; return res.end() }
  res.setHeader('Content-Type', asset.type === 'chunk' ? 'text/javascript' : 'text/css')
  res.end(asset.type === 'chunk' ? asset.code : asset.source)
})

let browser, page
const errors = []
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage({ viewport: { width: 1450, height: 950 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort())
  await page.goto(origin)
  const ship = page.getByRole('button', { name: '발송 하기', exact: true })
  const receive = page.getByRole('button', { name: '받기', exact: true })
  const unread = page.getByTitle('미확인 건수')
  await page.getByText('지시서 받기 대기', { exact: true }).waitFor()
  assert.equal(await unread.textContent(), '1')
  assert.equal(await ship.isDisabled(), true)

  await page.evaluate(() => { window.shipment.holdCheck = true; window.shipment.failCheck = true })
  await receive.click()
  await page.waitForFunction(() => typeof window.shipment.releaseCheck === 'function')
  assert.equal(await ship.isDisabled(), true)
  assert.equal(await unread.textContent(), '1')
  await page.evaluate(() => window.shipment.releaseCheck())
  await page.getByRole('alert').filter({ hasText: '받기 저장 실패' }).waitFor()
  assert.equal(await ship.isDisabled(), true)

  await page.evaluate(() => { window.shipment.holdCheck = false; window.shipment.failCheck = false })
  await receive.click()
  await page.getByText('발송 대기', { exact: true }).waitFor()
  assert.equal(await ship.isEnabled(), true)
  assert.equal(await unread.count(), 0)
  await page.reload()
  await ship.waitFor()
  assert.equal(await ship.isEnabled(), true)

  await page.evaluate(() => { window.shipment.failShip = true })
  await ship.click()
  await page.getByRole('alert').filter({ hasText: '다른 직원이 수정했습니다.' }).waitFor()
  assert.equal(await page.evaluate(() => window.shipment.order.closed), false)
  await page.evaluate(() => { window.shipment.failShip = false })
  await ship.click()
  await page.getByText('발송 완료', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.shipment.calls), ['ship', 'ship'])
  await page.reload()
  await page.getByText('발송 완료', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('China shipment browser: unread and disabled before receipt, pending/failure guard, receipt persistence, and shipping retry passed')
} catch (error) {
  if (page) console.error({ pageErrors: errors, pageText: await page.locator('body').innerText().catch(() => '') })
  throw error
} finally {
  await browser?.close()
  server.close()
}
