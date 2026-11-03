import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

// 실계정·DB 없이 실제 미리보기 컴포넌트를 검사한다. 종이 출력 대신 호출 검증과 PDF를 사용한다.
const root = process.cwd(), output = path.join(root, 'tmp/pdfs/employee-document-print')
await mkdir(output, { recursive: true })
const bundle = await build({ stdin: { contents: `import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom'; import { NewEmployeeDocumentPreview } from '@/features/org/NewEmployeeDocumentPreview'; const root=createRoot(document.getElementById('root')); window.previewDocument=(kind,data)=>{flushSync(()=>root.render(<NewEmployeeDocumentPreview kind={kind} data={data} onClose={()=>root.render(null)}/>));return document.querySelector('button').disabled};`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': path.join(root, 'src') }, define: { 'process.env.NODE_ENV': '"development"' } })
const cssName = (await readdir(path.join(root, 'dist/assets'))).find(name => name.startsWith('index-') && name.endsWith('.css'))
assert.ok(cssName, 'npm run build first')
const css = await readFile(path.join(root, 'dist/assets', cssName), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const company = { employerName: '검증 회사', representative: '검증 대표', employerAddress: '검증 사업장 주소', contractStart: '2026-10-21', contractEnd: '2027-01-20', wageStart: '2026-11-03', wageTerm: 'until-change', probationApply: 'yes', probationStart: '2026-10-21', probationEnd: '2027-01-20', probationMonths: '3', probationPayRate: '100', workplace: '사업장 내', workDays: '주5일(월~금)', workHours: '08:30 ~ 17:30', breakTime: '12:30 ~ 13:30, 1시간', documentDate: '2026-11-03', hireDate: '2026-10-21', wageMode: 'excel', payBasis: '월급x12개월', workStart: '08:30', workEnd: '17:30', breakStart: '12:30', breakEnd: '13:30', fixedOvertimePlan: '유형 2', annualSalary: '50400000', monthlyWage: '4200000', basePay: '3433278', baseHours: '209', mealAllowance: '200000', overtimeHours: '32.6', overtimeAllowance: '566722', nightHours: '0', nightAllowance: '0', holidayHours: '0', holidayAllowance: '0', annualLeaveHours: '0', annualLeaveAllowance: '0' }
const example = { employeeName: '검증 직원', department: '디자인', position: '사원', personal: [['생년월일', '1994-01-02'], ['현 거주지', '검증 주소']], company }
const empty = { employeeName: '', department: '', position: '', personal: [] }
try {
  const context = await browser.newContext(), page = await context.newPage(), errors = [], requests = []
  await context.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div>인쇄 제외 사이트 화면</div><div id="root"></div></body></html>')
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => { window.print = () => { throw new Error('상위 사이트 화면 인쇄 금지') } })
  for (const [index, kind] of ['근로계약서', '개인정보 수집 동의서', '생체인식정보 동의서'].entries()) {
    await page.evaluate(({ kind, data }) => window.previewDocument(kind, data), { kind, data: example })
    const dialog = page.getByRole('dialog', { name: `${kind} 미리보기`, exact: true }), print = dialog.getByRole('button', { name: '인쇄', exact: true })
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(el => el.textContent === '인쇄' && !el.disabled))
    const frame = page.frameLocator('iframe'), element = page.locator('iframe')
    assert.equal(await element.getAttribute('sandbox'), 'allow-same-origin allow-modals')
    assert.ok((await frame.locator('[data-signature]').allTextContents()).every(text => !text.trim()), 'signature spaces blank even with employee data')
    await element.evaluate(el => { el.contentWindow.print = () => { window.printedDocument = el.contentDocument.body.textContent; window.printCount = (window.printCount || 0) + 1 } })
    await print.click()
    assert.match(await page.evaluate(() => window.printedDocument), /검증 직원/)
    assert.doesNotMatch(await page.evaluate(() => window.printedDocument), /인쇄 제외 사이트 화면/)
    await page.screenshot({ path: path.join(output, `${index}-desktop.png`) })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(() => document.querySelector('iframe').getBoundingClientRect().width < 390)
    const box = await print.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844)
    assert.equal(await dialog.getByRole('button', { name: '닫기', exact: true }).isVisible(), true)
    await page.screenshot({ path: path.join(output, `${index}-mobile.png`) })
    // 실제 iframe 문서를 PDF로 출력해 UI 밖의 미리보기 배율이 섞이지 않는지 검사한다.
    const paper = await context.newPage()
    for (const [state, data] of [['filled', example], ['blank', empty]]) {
      if (state === 'blank') {
        assert.equal(await page.evaluate(({ kind, data }) => window.previewDocument(kind, data), { kind, data }), true, 'changed document must wait for its new load')
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(el => el.textContent === '인쇄' && !el.disabled))
      }
      await paper.setContent(await frame.locator('html').evaluate(el => el.outerHTML))
      assert.ok((await paper.locator('[data-signature]').allTextContents()).every(text => !text.trim()))
      if (state === 'blank') assert.equal(await paper.locator('[data-field="employeeName"]').innerText(), '')
      if (index > 0) {
        // HWP 동의서: 내용 누락·이미지 회귀·체크 자동 선택·인쇄 영역 넘침을 검사한다.
        assert.equal(await paper.locator('.consent-table').count(), index === 1 ? 3 : 2)
        assert.equal(await paper.locator('[data-consent-choice]').count(), index === 1 ? 6 : 4)
        assert.ok((await paper.locator('[data-consent-choice]').allTextContents()).every(text => !text.trim()))
        assert.equal(await paper.locator('img,script,input').count(), 0)
        assert.match(await paper.locator('body').innerText(), index === 1 ? /퇴직일로부터 5년 간 보관/ : /출입카드, 수기 서명 등/)
        if (state === 'blank') {
          for (const key of ['department','position','birthDate','documentDate','recipient-company']) assert.equal(await paper.locator(`[data-field="${key}"]`).innerText(), '', key)
        }
        const geometry = await paper.locator('.sheet').evaluate(sheet => {
          const bounds=sheet.getBoundingClientRect(), frame=sheet.querySelector('.consent-frame').getBoundingClientRect()
          const elements=[...sheet.querySelectorAll('h1,table,.consent-choice,.consent-notes,.consent-footer')]
          return { height:bounds.height, frameInside:frame.bottom<=bounds.bottom, clipped:elements.some(element=>element.scrollWidth>element.clientWidth+1 || element.getBoundingClientRect().right>frame.right) }
        })
        assert.ok(geometry.height<=1124 && geometry.frameInside && !geometry.clipped, JSON.stringify(geometry))
      }
      await paper.pdf({ path: path.join(output, `${index}-${state}.pdf`), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })
    }
    await paper.close()
    // 프린트 예외를 사용자에게 알리고 같은 버튼으로 다시 시도할 수 있어야 한다.
    await element.evaluate(el => { el.contentWindow.print = () => { throw new Error('검증용 인쇄 오류') } })
    await print.click(); assert.match(await dialog.getByRole('alert').innerText(), /다시 눌러/)
    await element.evaluate(el => { el.contentWindow.print = () => { window.printCount += 1 } })
    await print.click(); assert.equal(await dialog.getByRole('alert').count(), 0)
    await dialog.getByRole('button', { name: '닫기', exact: true }).click()
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.setViewportSize({ width: 1280, height: 900 })
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, [])
  console.log('PASS three preview print buttons, correct iframe only, ready-state reset, blank signatures, PC/mobile, failure/retry and no network requests; six A4 PDFs prepared')
} finally { await browser.close() }
