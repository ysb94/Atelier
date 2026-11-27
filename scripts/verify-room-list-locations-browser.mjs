import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = process.cwd()
const brand = 'b0000000-0000-4000-8000-000000000001'
const stockSet = 'active-stock-set'
let activeSetId = stockSet
const name = index => `상품 ${String(index).padStart(3, '0')}`
const items = Array.from({ length: 451 }, (_, index) => [name(index), '2'])
const folders = [items.slice(0, 225), [...items.slice(225), [name(0), '4']]].map((rows, index) => ({
  id: `folder-${index}`, brand_id: brand, title: `폴더 ${index + 1}`, items: rows, item_count: rows.length,
  created_at: new Date().toISOString(), created_by: 'another-viewer', created_by_name: '등록자', revision: 1,
}))
const stockRequests = []
const sources = []
let active = 0
let maxActive = 0
let fail = true
let app
const position = (index, location) => ({
  id: `stock-${index}`, warehouse_id: 'warehouse', zone: 'box_storage', location_code: location,
  style_id: `sku-${index}`, normalized_style_no: `M${index}`, source_style_no: `M${index}`,
  source_product_name: name(index), received_on: '2026-11-01', received_on_raw: '2026-11-01',
  quantity_status: 'known', units_per_box: 50, remaining_boxes: 1, opened_units: 0,
  source_row_number: index + 1, created_at: '2026-11-01T00:00:00Z',
})
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  const json = (body, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'sb-request-id': 'room-list-fixture' })
    response.end(JSON.stringify(body))
  }
  if (url.pathname === '/app.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' })
    response.end(app)
  } else if (url.pathname === '/rest/v1/warehouse_room_list_folders') {
    response.setHeader('Content-Range', '0-1/2')
    json(url.searchParams.get('select') === 'id,items' ? folders.map(({ id, items }) => ({ id, items })) : folders)
  } else if (url.pathname === '/rest/v1/warehouse_inventory_sets') {
    sources.push('set')
    json([{ id: activeSetId, brand_id: brand, warehouse_id: 'warehouse', kind: 'sandbox', status: 'active' }])
  } else if (url.pathname === '/functions/v1/warehouse-fixed-locations') {
    sources.push('fixed')
    json({ rows: [{ sheetRow: 1, location: '6-4-1', productName: name(2) }], revision: '1', syncedAt: null })
  } else if (url.pathname === '/rest/v1/styles') {
    sources.push('catalog')
    response.setHeader('Content-Range', '0-0/1')
    json([{ id: 'style-2', style_no: 'M2', name: name(2) }])
  } else if (url.pathname === '/rest/v1/rpc/list_room_list_stock_positions') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = JSON.parse(body)
    stockRequests.push(params)
    active++
    maxActive = Math.max(maxActive, active)
    await delay(135)
    active--
    if (params.p_set_id !== activeSetId) {
      json({ code: 'P0002', message: 'Fixture active set changed' }, 404)
      return
    }
    if (fail && params.p_names.includes(name(400))) {
      json({ code: '57014', message: 'Fixture statement timeout' }, 500)
      return
    }
    json([[0, '2-1-1'], [400, '3-3-3'], [451, '3-4-1']].filter(([index]) => params.p_names.includes(name(index)))
      .map(([index, location]) => position(index, location)))
  } else if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/functions/')) {
    sources.push(url.pathname)
    json({ code: 'PGRST202', message: 'Unexpected endpoint' }, 404)
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>')
  }
})

let browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const fixtures = {
    auth: `const session = { user: { id: 'room-list-viewer' } }; export const useAuth = () => ({ session });`,
    brands: `const scope = { selectedBrands: [{ id: '${brand}', name: 'Atelier' }], loading: false, error: false };
      export const useCompanyBrandScope = () => scope;`,
  }
  const bundle = await build({
    stdin: { sourcefile: 'room-list-entry.tsx', resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { BrowserRouter } from 'react-router-dom'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { RoomListPage } from '@/features/logistics/RoomListPage'
      import { installWorkflowDiagnostics } from '@/lib/diagnostics/runtime-watch'
      import { diagnosticReport } from '@/lib/diagnostics/workflow-trace'
      const queryClient = new QueryClient({ defaultOptions: { queries: {
        retry: false, staleTime: 30000, refetchOnWindowFocus: false,
      } } })
      installWorkflowDiagnostics(queryClient)
      window.fixtureReport = diagnosticReport
      createRoot(document.querySelector('#root')).render(<BrowserRouter><QueryClientProvider client={queryClient}>
        <RoomListPage />
      </QueryClientProvider></BrowserRouter>)
    ` },
    alias: { '@': path.join(root, 'src') }, jsx: 'automatic', bundle: true, format: 'esm', write: false,
    loader: { '.css': 'empty' },
    define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_SUPABASE_URL: origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-key' }) },
    plugins: [{
      name: 'room-list-viewer-fixtures',
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/supabase\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
        build.onResolve({ filter: /^@\/components\/layout\/company-brand-scope$/ }, () => ({ path: 'brands', namespace: 'fixture' }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path] }))
      },
    }],
  })
  app = bundle.outputFiles[0].text
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
  await page.goto(origin + '/logistics/room-list')
  const firstFolder = page.getByLabel('폴더 1 선택', { exact: true })
  await page.getByRole('button', { name: /폴더 2개/ }).waitFor()
  if (!await firstFolder.isVisible()) await page.getByRole('button', { name: /폴더 2개/ }).click()
  await firstFolder.check()
  await page.getByLabel('폴더 2 선택', { exact: true }).check()
  await page.getByRole('button', { name: '선택한 폴더 열기 (2)' }).click()

  const warning = page.getByRole('alert').filter({ hasText: '일부 창고 위치를 불러오지 못했습니다.' })
  const print = page.getByRole('button', { name: '전체 방 미리보기 및 출력' })
  const cell = label => page.getByText(label, { exact: true }).first()
  await warning.waitFor()
  await cell('2-1-1').waitFor()
  await cell('6-4-1').waitFor()
  await cell('위치 확인 필요').waitFor()
  assert.equal(await print.isDisabled(), true)
  assert.equal(stockRequests.length, 5)
  assert.equal(maxActive, 4)
  assert.deepEqual(stockRequests.flatMap(request => request.p_names).sort(), items.map(([product]) => product))
  assert.ok(stockRequests.every(request => request.p_brand_id === brand && request.p_set_id === stockSet && request.p_names.length <= 100))
  assert.ok(!sources.includes('/rest/v1/warehouse_stock_positions'))
  await page.waitForFunction(() => {
    const { failures } = window.fixtureReport()
    return failures.some(event => event.action === 'room_list_warehouse' && event.stage === 'read_stock_positions') &&
      failures.some(event => event.domain === 'db' && Object.values(event.meta).includes('57014'))
  })
  const failed = stockRequests.find(request => request.p_names.includes(name(400)))
  const priorSources = [...sources]
  fail = false
  await warning.getByRole('button', { name: '다시 조회' }).click()
  await warning.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '전체', exact: true }).click()
  await cell('3-3-3').waitFor()
  assert.equal(await print.isEnabled(), true)
  assert.deepEqual(stockRequests.slice(5), [failed])
  assert.deepEqual(sources, priorSources)
  await print.click()
  await page.getByRole('dialog', { name: '피킹표 미리보기 및 출력' }).waitFor()
  await page.getByRole('button', { name: '닫기', exact: true }).click()

  const row = location => page.getByRole('row').filter({ has: page.getByText(location, { exact: true }) })
  const mergedQuantity = row('2-1-1').getByRole('textbox', { name: /수량/ })
  assert.equal(await mergedQuantity.inputValue(), '6')
  await mergedQuantity.fill('7')
  await mergedQuantity.blur()
  const edit = row('3-3-3').getByRole('textbox', { name: /상품명/ })
  await edit.fill(name(451))
  assert.equal(stockRequests.length, 6, 'quantity and in-progress name edits do not fetch')
  await page.evaluate(() => document.activeElement.blur())
  await cell('3-4-1').waitFor()
  assert.equal(stockRequests.length, 7)
  assert.ok(stockRequests[6].p_names.includes(name(451)))
  await row('3-4-1').getByRole('textbox', { name: /상품명/ }).evaluate((input, pastedName) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', pastedName + '\t9')
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
  }, name(452))
  await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).some(input => input.value === '상품 452'))
  await page.locator('tr').filter({ has: page.locator('input[value="상품 452"]') })
    .getByText('위치 없음', { exact: true }).waitFor()
  assert.equal(stockRequests.length, 8)
  assert.ok(stockRequests[7].p_names.includes(name(452)), 'paste commits the name immediately')
  activeSetId = 'replacement-stock-set'
  await page.locator('input[value="상품 452"]').fill(name(453))
  await page.evaluate(() => document.activeElement.blur())
  await warning.waitFor()
  await cell('2-1-1').waitFor({ state: 'hidden' })
  await cell('6-4-1').waitFor()
  const beforeReplacement = stockRequests.length
  await warning.getByRole('button', { name: '다시 조회' }).click()
  await cell('2-1-1').waitFor()
  await page.getByRole('button', { name: '전체 방 미리보기 및 출력', disabled: false }).waitFor()
  assert.equal(stockRequests.slice(beforeReplacement).length, 5)
  assert.ok(stockRequests.slice(beforeReplacement).every(request => request.p_set_id === activeSetId))
  assert.deepEqual(errors, [])
  console.log('Room list browser: merged folders, scoped batches, four concurrent reads, partial HTTP 500, exact retry, diagnostics, print, field edits and active set changes verified.')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
