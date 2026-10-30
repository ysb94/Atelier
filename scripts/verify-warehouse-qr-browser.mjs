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
  await page.getByRole('button', { name: /렉 안 고정 자리 ·/ }).click()
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
  assert.deepEqual(rows[0], ['QR', '렉자리', '렉박스자리'])
  assert.deepEqual(rows[1], ['3-1-1_A1', '3-1-1', 'A1'])
  assert.deepEqual(rows[16], ['3-1-1_D4', '3-1-1', 'D4'])
  assert.deepEqual(rows.at(-1), ['3-1-7_D4', '3-1-7', 'D4'])
  assert.equal(new Set(rows.slice(1).map((row) => row[0])).size, 112)
  assert.ok(rows.slice(1).every(([qr, rack, slot]) => qr === `${rack}_${slot}`))
  assert.ok(['A2', 'B2', 'C2'].every((address) => workbook.Sheets.QR[address].t === 's'))
  await page.getByRole('button', { name: '고정 자리 4칸 라벨 미리보기', exact: true }).click()
  const slotDialog = page.getByRole('dialog', { name: '고정 자리 · A4 4칸 QR 라벨' })
  await slotDialog.waitFor()
  assert.deepEqual(await slotDialog.locator('.outbound-slot-position').allTextContents(), ['A1', 'A2', 'A3', 'A4'])
  assert.deepEqual(await slotDialog.locator('.outbound-slot-rack').allTextContents(), ['3-1-1', '3-1-1', '3-1-1', '3-1-1'])
  await page.screenshot({ path: path.join(output, 'slot-label-preview.png'), fullPage: true })
  await page.getByRole('button', { name: '다음 라벨 페이지' }).click()
  assert.deepEqual(await slotDialog.locator('.outbound-slot-position').allTextContents(), ['B1', 'B2', 'B3', 'B4'])
  await page.getByRole('button', { name: '전체 고정 자리 라벨 인쇄', exact: true }).click()
  await page.waitForFunction(() => window.__rackPrintCalls === 1)
  assert.ok(await page.locator('html').evaluate((el) => el.classList.contains('printing-outbound-slots')))
  await page.emulateMedia({ media: 'print' })
  const slotGeometry = await page.locator('.outbound-rack-print-root .outbound-slot-label').first().evaluate((el) => {
    const label = el.getBoundingClientRect(), qr = el.querySelector('img').getBoundingClientRect(), rack = el.querySelector('.outbound-slot-rack').getBoundingClientRect(), slotElement = el.querySelector('.outbound-slot-position'), slot = slotElement.getBoundingClientRect(), text = el.querySelector('.outbound-slot-text').getBoundingClientRect()
    return { width: label.width, height: label.height, qr: qr.width, qrRight: qr.right, qrTop: qr.top, textTop: text.top, top: label.top, positionFont: parseFloat(getComputedStyle(slotElement).fontSize), textLeft: Math.min(rack.left, slot.left), textRight: Math.max(rack.right, slot.right), right: label.right }
  })
  assert.ok(Math.abs(slotGeometry.width - 148.5 * 96 / 25.4) < 1)
  assert.ok(Math.abs(slotGeometry.height - 105 * 96 / 25.4) < 1)
  assert.ok(slotGeometry.qr >= 75 * 96 / 25.4, 'large QR fits beside the wider reference-style text area')
  assert.ok(slotGeometry.qrTop - slotGeometry.top <= 1.1 * 96 / 25.4 && Math.abs(slotGeometry.textTop - slotGeometry.qrTop) < 1, 'reference layout starts at the top with a 1mm outer margin')
  assert.ok(slotGeometry.positionFont >= 44 * 96 / 25.4, 'position text is larger than the previous layout')
  assert.ok(slotGeometry.textLeft >= slotGeometry.qrRight - 1 && slotGeometry.textRight <= slotGeometry.right, 'QR and text do not overlap: ' + JSON.stringify(slotGeometry))
  const overflowingSlotText = await page.locator('.outbound-rack-print-root .outbound-slot-label').evaluateAll((els) => els.flatMap((el) => {
    const qr = el.querySelector('img').getBoundingClientRect(), label = el.getBoundingClientRect()
    return Array.from(el.querySelectorAll('.outbound-slot-rack, .outbound-slot-position')).filter((part) => {
      const rect = part.getBoundingClientRect()
      return rect.left < qr.right - 1 || rect.right > label.right || rect.bottom > label.bottom
    }).map((part) => part.textContent)
  }))
  assert.deepEqual(overflowingSlotText, [], 'all A1–D4 labels fit without overlap or clipping')
  await page.addScriptTag({ content: await fs.readFile(path.join(root, 'node_modules/jsqr/dist/jsQR.js'), 'utf8') })
  const firstSlotImage = await page.locator('.outbound-rack-print-root .outbound-slot-label').first().screenshot()
  const inkTops = await page.evaluate(async (png) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    function firstInk(start, end) {
      for (let y = 0; y < canvas.height; y++) for (let x = Math.floor(start * canvas.width); x < end * canvas.width; x++) {
        const index = (y * canvas.width + x) * 4
        if (data[index] < 64 && data[index + 1] < 64 && data[index + 2] < 64 && data[index + 3] > 200) return y
      }
      return -1
    }
    let lastInk = -1
    for (let y = canvas.height - 1; y >= 0 && lastInk < 0; y--) for (let x = 0; x < canvas.width; x++) {
      const index = (y * canvas.width + x) * 4
      if (data[index] < 64 && data[index + 1] < 64 && data[index + 2] < 64 && data[index + 3] > 200) { lastInk = y; break }
    }
    return { qr: firstInk(.03, .50), rack: firstInk(.60, .97), lastInk, height: canvas.height, decoded: window.jsQR(data, canvas.width, canvas.height)?.data }
  }, firstSlotImage.toString('base64'))
  assert.ok(inkTops.qr > 0 && inkTops.qr < inkTops.height * .1 && inkTops.rack >= inkTops.qr - 3 && inkTops.rack <= inkTops.qr + 16, 'QR is near the upper left and rack number near the upper right: ' + JSON.stringify(inkTops))
  assert.ok(inkTops.lastInk < inkTops.height * .8 && inkTops.lastInk > inkTops.height * .6, 'reference layout keeps the bottom area blank')
  assert.equal(inkTops.decoded, '3-1-1_A1', 'the actual printed label raster is readable')
  const slotPdf = await page.pdf({ path: path.join(output, 'slot-labels.pdf'), preferCSSPageSize: true, printBackground: true })
  assert.equal((slotPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length, 28, '112 slots = 28 physical A4 pages')
  const decoded = await page.evaluate(async () => {
    const values = []
    for (const img of document.querySelectorAll('.outbound-rack-print-root img')) {
      await img.decode()
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 300
      const context = canvas.getContext('2d'); context.drawImage(img, 0, 0, 300, 300)
      values.push(window.jsQR(context.getImageData(0, 0, 300, 300).data, 300, 300)?.data)
    }
    return values
  })
  assert.deepEqual(decoded, rows.slice(1).map(([qr]) => qr), 'all printed QR images decode to the existing complete slot numbers')
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('printing-outbound-slots')), false)
  await page.getByRole('button', { name: '렉 라벨 미리보기 닫기' }).click()
  await page.evaluate(() => { window.__rackPrintCalls = 0 })
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
  await page.getByRole('button', { name: /렉 안 고정 자리 ·/ }).click()
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
  console.log(JSON.stringify({ passed: true, racks: 7, slots: 112, labelPages: 2, slotLabelPages: 28, decodedSlotQrs: decoded.length, blankLastCell: true, numberOnlyLabels: true, excelAndLegacyBox: true, rangeAndListValidation: true, mobile: true, artifacts: output }))
} finally { await browser.close(); await server.close() }
