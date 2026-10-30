import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'
import * as XLSX from 'xlsx'

const root = process.cwd()
const output = path.join(root, 'node_modules/.tmp/warehouse-qr-verify')
await fs.mkdir(output, { recursive: true })
const server = await createServer({
  root, configFile: false, envFile: false, logLevel: 'error',
  plugins: [
    { name: 'warehouse-qr-fixture', configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (!req.headers.accept?.includes('text/html')) return next()
        vite.transformIndexHtml(req.url, '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/warehouse-qr-entry.tsx"></script></body></html>').then((html) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) }).catch(next)
      })
    } }, react(), tailwindcss(),
  ],
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/.tmp/**', '**/.state/**'] } },
})
await server.listen()
const origin = 'http://127.0.0.1:' + server.httpServer.address().port
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true })
await context.route('**/*', (route) => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort())
const page = await context.newPage(), errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.addInitScript(() => { window.__rackPrintCalls = 0; window.print = () => { window.__rackPrintCalls++ } })
try {
  await page.goto(origin + '/logistics/warehouses?view=qr')
  await page.getByLabel('창고 번호', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('창고 번호', { exact: true }).inputValue(), '3')
  await page.getByRole('button', { name: /렉 안 고정 자리 · 아이라벨 엑셀/ }).click()
  const table = page.getByRole('table', { name: '렉 안 고정 자리 배치' })
  assert.deepEqual(await table.locator('tbody th').allTextContents(), ['4층 · D', '3층 · C', '2층 · B', '1층 · A'])
  assert.equal(await table.locator('tbody td').count(), 16)
  await table.getByText('3-1-1_C2', { exact: true }).waitFor()
  async function downloaded(button, filename) {
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
    assert.equal(await download.failure(), null)
    const file = path.join(output, filename)
    await download.saveAs(file)
    return XLSX.read(await fs.readFile(file), { type: 'buffer' })
  }
  const workbook = await downloaded(page.getByRole('button', { name: '아이라벨용 엑셀 내려받기', exact: true }), 'outbound.xlsx')
  assert.deepEqual(workbook.SheetNames, ['QR'])
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.QR, { header: 1 })
  assert.equal(rows.length, 113)
  assert.deepEqual(rows[0], ['자리', 'QR'])
  assert.deepEqual(rows[1], ['3-1-1_A1', '3-1-1_A1'])
  assert.deepEqual(rows[16], ['3-1-1_D4', '3-1-1_D4'])
  assert.deepEqual(rows.at(-1), ['3-1-7_D4', '3-1-7_D4'])
  assert.equal(new Set(rows.slice(1).map((row) => row[0])).size, 112)
  assert.ok(rows.slice(1).every(([text, qr]) => text === qr))
  await page.getByLabel('미리 볼 렉').selectOption('3-1-7')
  await table.getByText('3-1-7_A1', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'slots.png'), fullPage: true })
  await page.getByRole('button', { name: /렉 번호 · 4칸 라벨 인쇄/ }).click()
  await page.getByRole('button', { name: '4칸 라벨 미리보기', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '렉 번호 · A4 4칸 라벨' })
  await dialog.waitFor()
  assert.equal(await dialog.getByRole('img').count(), 0)
  assert.deepEqual(await dialog.locator('.outbound-rack-label-code').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))), ['3-1-1', '3-1-2', '3-1-3', '3-1-4'])
  assert.deepEqual(await dialog.locator('.outbound-rack-label').allTextContents(), ['3/1/1', '3/1/2', '3/1/3', '3/1/4'])
  await page.screenshot({ path: path.join(output, 'rack-preview.png'), fullPage: true })
  await page.getByRole('button', { name: '다음 라벨 페이지' }).click()
  assert.equal(await dialog.getByRole('img').count(), 0)
  assert.equal(await dialog.locator('.outbound-rack-label').count(), 4)
  assert.deepEqual(await dialog.locator('.outbound-rack-label-code').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))), ['3-1-5', '3-1-6', '3-1-7'])
  await page.getByRole('button', { name: '전체 렉 라벨 인쇄', exact: true }).click()
  await page.waitForFunction(() => window.__rackPrintCalls === 1)
  assert.ok(await page.locator('html').evaluate((el) => el.classList.contains('printing-outbound-racks')))
  assert.equal(await page.locator('.outbound-rack-print-root .outbound-rack-sheet').count(), 2)
  await page.emulateMedia({ media: 'print' })
  const geometry = await page.locator('.outbound-rack-print-root .outbound-rack-label').evaluateAll((els) => els.slice(0, 4).map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
  assert.ok(Math.abs(geometry[0].width - 105 * 96 / 25.4) < 1)
  assert.ok(Math.abs(geometry[0].height - 148.5 * 96 / 25.4) < 1)
  assert.equal(geometry[0].y, geometry[1].y)
  assert.ok(geometry[2].y > geometry[0].y)
  assert.equal(await page.locator('#root').isVisible(), false)
  const pdf = await page.pdf({ path: path.join(output, 'rack-labels.pdf'), preferCSSPageSize: true, printBackground: true })
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length, 2, '7 racks = 2 physical A4 pages')
  assert.deepEqual(await page.locator('.outbound-rack-print-root .outbound-rack-label').allTextContents(), ['3/1/1', '3/1/2', '3/1/3', '3/1/4', '3/1/5', '3/1/6', '3/1/7', ''])
  assert.equal(await page.locator('.outbound-rack-print-root img').count(), 0)
  assert.ok(await page.locator('.outbound-rack-print-root .outbound-rack-label-number').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 90))
  const stack = await page.locator('.outbound-rack-print-root .outbound-rack-label').first().evaluate((el) => {
    const label = el.getBoundingClientRect(), code = el.querySelector('.outbound-rack-label-code').getBoundingClientRect()
    const parts = Array.from(el.querySelectorAll('.outbound-rack-label-number, .outbound-rack-label-separator')).map((part) => {
      const rect = part.getBoundingClientRect()
      return { text: part.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
    return { center: code.x + code.width / 2, targetCenter: label.x + label.width * .625, top: code.top, bottom: code.bottom, parts }
  })
  assert.ok(Math.abs(stack.center - stack.targetCenter) < 1, 'center in the right three quarters')
  assert.deepEqual(stack.parts.map((part) => part.text), ['3', '/', '1', '/', '1'])
  assert.ok(stack.parts.every((part, index) => Math.abs(part.x + part.width / 2 - stack.center) < 1 && part.y >= stack.top - 1 && part.y + part.height <= stack.bottom + 1 && (!index || part.y >= stack.parts[index - 1].y + stack.parts[index - 1].height - 1)))
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('printing-outbound-racks')), false)
  await page.getByRole('button', { name: '렉 라벨 미리보기 닫기' }).click()
  assert.equal(await page.locator('.outbound-rack-print-root').count(), 0)
  await page.getByLabel('끝 렉 번호').fill('201')
  await page.getByRole('alert').waitFor()
  assert.ok(await page.getByRole('button', { name: '4칸 라벨 미리보기', exact: true }).isDisabled())
  await page.getByRole('button', { name: '렉 직접 입력', exact: true }).click()
  await page.getByLabel('렉 번호 목록').fill('3-1-1\n3-1-1\n3-2-1')
  await page.getByRole('button', { name: /렉 안 고정 자리 · 아이라벨 엑셀/ }).click()
  const manual = await downloaded(page.getByRole('button', { name: '아이라벨용 엑셀 내려받기', exact: true }), 'manual.xlsx')
  assert.equal(XLSX.utils.sheet_to_json(manual.Sheets.QR, { header: 1 }).length, 33)
  await page.getByLabel('렉 번호 목록').fill('3-1-1_A1')
  await page.getByRole('alert').waitFor()
  assert.ok(await page.getByRole('button', { name: '아이라벨용 엑셀 내려받기', exact: true }).isDisabled())
  await page.getByLabel('렉 번호 목록').fill('3-12-107\n3333-12345-67890')
  await page.getByRole('button', { name: /렉 번호 · 4칸 라벨 인쇄/ }).click()
  await page.getByRole('button', { name: '4칸 라벨 미리보기', exact: true }).click()
  await dialog.waitFor()
  assert.deepEqual(await dialog.locator('.outbound-rack-label-number').allTextContents(), ['3', '12', '107', '3333', '12345', '67890'])
  assert.ok(await dialog.locator('.outbound-rack-label-number').evaluateAll((els) => els.every((el) => {
    const text = el.getBoundingClientRect(), code = el.closest('.outbound-rack-label-code').getBoundingClientRect()
    return text.left >= code.left - 1 && text.right <= code.right + 1 && text.top >= code.top - 1 && text.bottom <= code.bottom + 1
  })), 'multi-digit numbers stay together and fit inside the label')
  await page.screenshot({ path: path.join(output, 'rack-preview-wide.png'), fullPage: true })
  await page.getByRole('button', { name: '렉 라벨 미리보기 닫기' }).click()
  await page.getByRole('button', { name: /^박스창고/ }).click()
  const legacy = await downloaded(page.getByRole('button', { name: '엑셀 내려받기', exact: true }), 'box.xlsx')
  assert.deepEqual(XLSX.utils.sheet_to_json(legacy.Sheets.QR, { header: 1 })[1], ['2-1-1', '2-1-1'])
  await page.getByRole('button', { name: /^출고창고/ }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, racks: 7, slots: 112, labelPages: 2, blankLastCell: true, numberOnlyLabels: true, excelAndLegacyBox: true, rangeAndListValidation: true, mobile: true, artifacts: output }))
} finally { await browser.close(); await server.close() }
