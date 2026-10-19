import assert from 'node:assert/strict'
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build, preview } from 'vite'
import { chromium } from 'playwright-core'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'node_modules/.tmp/excel-security-browser')
const downloads = path.join(output, 'downloads')
const errors = []
const fields = [
  ['styleNo', 'M번호', 'text', true],
  ['productName', '상품명', 'text', false],
  ['gender', '성별', 'gender', false],
  ['barcode', '바코드', 'text', false],
  ['quantity', '수량', 'number', false],
  ['price', '가격', 'number', false],
].map(([systemKey, label, type, required], order) => ({
  id: 'f-' + systemKey, brandId: 'test-brand', label, systemKey, type, required, order,
  owner: 'common', level: 'style', options: [],
}))
const rows = [
  ['M00001', '니트 가방 블랙', '여성', '0012345678901', 2, 15000.5],
  ['M00002', '니트 가방 화이트', '공용', '0088012345678', 0, 0],
]
let server
let browser
try {
  // Exercise the exact CommonJS API ExcelJS uses after the scoped uuid override.
  const excelRequire = createRequire(import.meta.resolve('exceljs'))
  const { v4, validate } = excelRequire('uuid')
  assert.ok(validate(v4()))
  const compatibility = new ExcelJS.Workbook()
  const sheet = compatibility.addWorksheet('조건부서식')
  sheet.addRows([[1], [2]])
  sheet.addConditionalFormatting({
    ref: 'A1:A2',
    rules: [{ type: 'dataBar', priority: 1, gradient: false, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF336699' } }],
  })
  const copy = new ExcelJS.Workbook()
  await copy.xlsx.load(await compatibility.xlsx.writeBuffer())
  assert.equal(copy.getWorksheet('조건부서식').getCell('A2').value, 2)

  await mkdir(downloads, { recursive: true })
  // Build the app's real helpers for a browser so the prebuilt ExcelJS browser path is covered too.
  const entry = path.join(output, 'entry.mjs')
  const source = [
    'import {createProductWorkbook,downloadExcelWorkbook} from ' + JSON.stringify(path.join(root, 'src/lib/export/product-workbook.ts').replaceAll('\\', '/')),
    'import {downloadUploadTemplate} from ' + JSON.stringify(path.join(root, 'src/lib/import/template.ts').replaceAll('\\', '/')),
    'import {parseFile} from ' + JSON.stringify(path.join(root, 'src/lib/import/parse.ts').replaceAll('\\', '/')),
    'const fields=' + JSON.stringify(fields),
    'const rows=' + JSON.stringify(rows),
    'const status=document.createElement("pre"); document.body.append(status)',
    'window.excelCheck={async download(){const workbook=await createProductWorkbook({dataSheetName:"상품데이터",headers:fields.map(f=>f.label),rows,fields,validationRows:20,guideRows:[["안내","한글과 숫자 확인"]]});await downloadExcelWorkbook(workbook,"보안수정_상품검증.xlsx")},async template(){await downloadUploadTemplate({brandName:"검증브랜드",fields})},async parse(file){return parseFile(file)}}',
    'const input=document.createElement("input");input.type="file";input.id="upload";input.onchange=async()=>{try{window.uploaded=await parseFile(input.files[0]);status.textContent="읽기 완료"}catch(error){console.error(error);status.textContent="읽기 실패"}};document.body.append(input)',
  ].join('\n')
  await writeFile(entry, source)
  await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="ko"><meta charset="utf-8"><title>엑셀 회귀 검증</title><script type="module" src="./entry.mjs"></script></html>')
  await build({
    configFile: false, root: output, publicDir: false, logLevel: 'warn',
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: { outDir: path.join(output, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  })
  server = await preview({ configFile: false, root: output, build: { outDir: path.join(output, 'dist') }, preview: { host: '127.0.0.1', port: 0, strictPort: false } })
  const address = server.httpServer.address()
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + address.port)
  await page.waitForFunction(() => !!window.excelCheck)

  async function download(method, filename) {
    const [result] = await Promise.all([page.waitForEvent('download'), page.evaluate((name) => window.excelCheck[name](), method)])
    assert.equal(await result.failure(), null)
    assert.ok(result.suggestedFilename().endsWith('.xlsx'))
    assert.match(result.suggestedFilename(), /보안수정|검증브랜드/)
    const destination = path.join(downloads, filename)
    await result.saveAs(destination)
    assert.ok((await readFile(destination)).byteLength > 1000)
    return destination
  }
  const file = await download('download', 'product.xlsx')
  await page.locator('#upload').setInputFiles(file)
  await page.waitForFunction(() => Array.isArray(window.uploaded))
  const parsed = await page.evaluate(() => window.uploaded)
  assert.deepEqual(parsed.find((item) => item.name === '상품데이터').rows, [fields.map((field) => field.label), ...rows.map((row) => row.map(String))])

  const product = new ExcelJS.Workbook()
  await product.xlsx.readFile(file)
  assert.equal(product.getWorksheet('선택목록').state, 'hidden')
  assert.equal(product.getWorksheet('상품데이터').getCell('D2').value, '0012345678901')
  assert.equal(product.getWorksheet('상품데이터').getCell('F2').value, 15000.5)
  assert.equal(product.getWorksheet('상품데이터').getCell('C2').dataValidation.type, 'list')
  assert.equal(product.getWorksheet('상품데이터').getCell('C2').fill.fgColor.argb, 'FFEAF3FA')
  const template = await download('template', 'template.xlsx')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(template)
  assert.equal(workbook.getWorksheet('선택목록').state, 'hidden')
  assert.ok(workbook.getWorksheet('작성안내'))
  assert.equal(workbook.getWorksheet('상품업로드').getCell('C2').dataValidation.type, 'list')
  const legacy = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(legacy, XLSX.utils.aoa_to_sheet([fields.map((field) => field.label), ...rows]), '기존엑셀')
  await page.evaluate(() => { window.uploaded = undefined })
  await page.locator('#upload').setInputFiles({ name: '기존형식.xls', mimeType: 'application/vnd.ms-excel', buffer: XLSX.write(legacy, { type: 'buffer', bookType: 'biff8' }) })
  await page.waitForFunction(() => Array.isArray(window.uploaded))
  const legacyParsed = await page.evaluate(() => window.uploaded)
  assert.deepEqual(legacyParsed[0].rows, [fields.map((field) => field.label), ...rows.map((row) => row.map(String))])
  assert.deepEqual(errors, [])
  console.log('Excel security regression: CJS uuid + conditional formatting round-trip; browser production bundle; actual .xlsx download/upload and legacy .xls upload; Korean, SKU rows, leading zeroes, numeric cells, hidden sheets, dropdowns and fills: OK')
} finally {
  await browser?.close()
  await server?.close()
  // Only disposable test artifacts, always within this script's fixed node_modules/.tmp directory.
  const expected = path.resolve(root, 'node_modules/.tmp/excel-security-browser')
  if (path.resolve(output) === expected) await rm(output, { recursive: true, force: true })
}
