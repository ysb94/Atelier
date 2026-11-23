import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'
import * as XLSX from 'xlsx'

const root = process.cwd(),
  fixture = path.join(root, 'dev-tools/ai-workflow/browser-fixture')
const client = path.join(fixture, 'usage-headers-client.ts'),
  auth = path.join(fixture, 'auth.ts')
const server = await createServer({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'error',
  plugins: [
    {
      name: 'usage-headers-fixture',
      enforce: 'pre',
      resolveId(source, importer) {
        if (importer && source.startsWith('.')) {
          const absolute = path
            .resolve(path.dirname(importer), source)
            .replace(/\.tsx?$/, '')
          if (absolute === path.join(root, 'src/lib/supabase/client'))
            return client
          if (absolute === path.join(root, 'src/lib/supabase/auth')) return auth
        }
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (!req.headers.accept?.includes('text/html')) return next()
          vite
            .transformIndexHtml(
              req.url,
              '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/usage-headers-entry.tsx"></script></body></html>',
            )
            .then((html) => {
              res.setHeader('Content-Type', 'text/html; charset=utf-8')
              res.end(html)
            })
            .catch(next)
        })
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      { find: '@/lib/supabase/client', replacement: client },
      { find: '@/lib/supabase/auth', replacement: auth },
      { find: '@', replacement: path.join(root, 'src') },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 0,
    hmr: false,
    watch: { ignored: ['**/.state/**'] },
    fs: { allow: [root] },
  },
})
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({
  executablePath:
    process.env.ATELIER_CHROMIUM_BIN ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const context = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
})
context.setDefaultTimeout(12000)
context.setDefaultNavigationTimeout(30000)
await context.route('**/*', (route) =>
  route
    .request()
    .url()
    .startsWith(origin + '/')
    ? route.continue()
    : route.abort(),
)
const page = await context.newPage(),
  errors = []
page.on('pageerror', (error) => errors.push(error.message))
const screenshotDir = path.join(
  root,
  'dev-tools/ai-workflow/.state/usage-screenshots',
)
await fs.mkdir(screenshotDir, { recursive: true })
async function openHeaders() {
  await page.getByRole('button', { name: '헤더 설정', exact: true }).click()
  await page.getByRole('dialog', { name: '표시 항목 및 연결 설정' }).waitFor()
}
async function saveHeaders() {
  await page
    .getByRole('button', { name: '이 업체에 설정 저장', exact: true })
    .click()
  await page
    .getByRole('dialog', { name: '표시 항목 및 연결 설정' })
    .waitFor({ state: 'hidden' })
}
try {
  await page.goto(origin + '/usage-codes')
  await page.getByText('공통 물류상품명 S ×2', { exact: false }).waitFor()
  assert.ok(await page.getByText('M001-BLACK-S ×2', { exact: false }).count())
  await page.getByRole('button', { name: '담당자 설정', exact: true }).click()
  assert.equal(await page.getByRole('link', { name: '권한·담당자 설정 열기', exact: true }).getAttribute('href'), '/settings/permissions')
  assert.equal(await page.getByRole('dialog', { name: '업체 담당자 설정' }).getByRole('checkbox').count(),0,'업체 화면에서 별도 권한 원본을 변경하지 않음')
  await page.getByRole('dialog', { name: '업체 담당자 설정' }).getByRole('button', { name: '닫기', exact: true }).click()
  await openHeaders()
  await page.getByLabel('상품명 표시 이름', { exact: true }).fill('물류상품명')
  await page
    .getByRole('button', { name: '업체 전용 항목', exact: true })
    .click()
  await page.getByLabel('새 헤더 이름', { exact: true }).fill('상품명')
  await page
    .getByLabel('새 항목의 의미', { exact: true })
    .fill('무신사 판매 페이지 상품명')
  await page.getByRole('button', { name: '항목 추가', exact: true }).click()
  await page.screenshot({
    path: path.join(screenshotDir, 'headers.png'),
    fullPage: true,
  })
  await saveHeaders()
  await page
    .getByRole('button', {
      name: '8801234000015 업체 전용 값 수정',
      exact: true,
    })
    .click()
  const valuesDialog = page.getByRole('dialog', { name: '업체 전용 값 수정' })
  assert.equal(await valuesDialog.getByRole('textbox').count(), 1)
  await page
    .getByLabel('상품명 업체 전용 값', { exact: true })
    .fill('무신사 판매상품명 검증')
  await page
    .getByRole('button', { name: '업체 전용 값 저장', exact: true })
    .click()
  await valuesDialog.waitFor({ state: 'hidden' })
  await page.getByText('무신사 판매상품명 검증', { exact: true }).waitFor()
  await page.getByRole('button', { name: '일괄 등록', exact: true }).click()
  const downloadedFile = page.waitForEvent('download')
  await page.getByRole('button', { name: '양식 다운로드', exact: true }).click()
  const template = await downloadedFile
  const workbook = XLSX.read(await fs.readFile(await template.path()),{type:'buffer'})
  assert.deepEqual(
    XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
    })[0],
    ['88코드', '코드명', '상태', '물류상품명', 'M번호', '상품명'],
  )
  await page.getByRole('button', { name: '일괄 등록', exact: true }).click()
  await openHeaders()
  await page.getByLabel('상품명 표시', { exact: true }).uncheck()
  await saveHeaders()
  assert.equal(
    await page.getByText('무신사 판매상품명 검증', { exact: true }).count(),
    0,
  )
  await openHeaders()
  await page.getByLabel('상품명 표시', { exact: true }).check()
  await saveHeaders()
  await page.getByText('무신사 판매상품명 검증', { exact: true }).waitFor()
  await page.screenshot({
    path: path.join(screenshotDir, 'values.png'),
    fullPage: true,
  })
  const evidence = await page.evaluate(() => {
    const state = window.__usageFixture
    return {
      same: state.fingerprint() === state.baseline,
      audit: state.audit,
      field: state.data.usage_partner_columns.find((c) => c.kind === 'private')
        ?.id,
    }
  })
  assert.equal(evidence.same, true)
  assert.ok(evidence.field)
  assert.ok(
    evidence.audit.some((call) => call.name === 'save_usage_partner_values'),
  )
  await page.getByText('다른업체', { exact: true }).first().click()
  await page
    .getByRole('columnheader', { name: '상품명 🔒', exact: true })
    .waitFor()
  assert.equal(
    await page.getByText('무신사 판매상품명 검증', { exact: true }).count(),
    0,
  )
  await page.goto(origin + '/usage-codes?role=reader')
  await page.getByText('공통 물류상품명 S ×2', { exact: false }).waitFor()
  await openHeaders()
  assert.equal(
    await page
      .getByRole('button', { name: '이 업체에 설정 저장', exact: true })
      .count(),
    0,
  )
  assert.ok(
    await page.getByText('읽기 전용 · 이 업체에 편집 권한이 지정된 담당자만', { exact: false }).count(),
  )
  await page.goto(origin + '/usage-codes?fail=1')
  await page.getByText('공통 물류상품명 S ×2', { exact: false }).waitFor()
  await openHeaders()
  await page
    .getByLabel('상품명 표시 이름', { exact: true })
    .fill('저장 실패 보존 확인')
  await page
    .getByRole('button', { name: '이 업체에 설정 저장', exact: true })
    .click()
  await page.getByText('검증용 저장 실패', { exact: true }).waitFor()
  assert.equal(
    await page
      .getByLabel('저장 실패 보존 확인 표시 이름', { exact: true })
      .inputValue(),
    '저장 실패 보존 확인',
  )
  assert.equal(await page.evaluate(() => window.__usageFixture.audit.length), 0)
  await page.goto(origin + '/usage-codes?missing=1')
  await page
    .getByText('업체별 설정 저장 준비가 필요합니다.', { exact: false })
    .waitFor()
  await page.getByText('공통 물류상품명 S ×2', { exact: false }).waitFor()
  await openHeaders()
  assert.equal(
    await page
      .getByRole('button', { name: '이 업체에 설정 저장', exact: true })
      .count(),
    0,
  )
  assert.deepEqual(errors, [])
  await page.goto(origin + '/usage-codes?grouped=1')
  await page.getByRole('heading', { name: '무신사', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('tab', { name: '88코드', exact: true }).count(),
    0,
  )
  assert.equal(await page.getByText('88코드 찾기', { exact: true }).count(), 0)
  await openHeaders()
  const targets = await page.evaluate(() => ({
    a: window.__usageFixture.a,
    b: window.__usageFixture.b,
  }))
  await page
    .getByLabel('헤더 저장 연결', { exact: true })
    .selectOption(targets.a)
  await page.getByLabel('상품명 표시 이름', { exact: true }).fill('물류상품명')
  await page
    .getByRole('button', { name: '업체 전용 항목', exact: true })
    .click()
  await page.getByLabel('새 헤더 이름', { exact: true }).fill('상품명')
  await page
    .getByLabel('새 항목의 의미', { exact: true })
    .fill('강남 연결 전용 상품명')
  await page.getByRole('button', { name: '항목 추가', exact: true }).click()
  await saveHeaders()
  assert.equal(
    await page
      .getByRole('button', {
        name: '8801234000022 업체 전용 값 수정',
        exact: true,
      })
      .isEnabled(),
    false,
  )
  await page
    .getByRole('button', {
      name: '8801234000015 업체 전용 값 수정',
      exact: true,
    })
    .click()
  await page
    .getByLabel('상품명 업체 전용 값', { exact: true })
    .fill('연결 A 전용 값')
  await page
    .getByRole('button', { name: '업체 전용 값 저장', exact: true })
    .click()
  await page.getByText('연결 A 전용 값', { exact: true }).waitFor()
  await openHeaders()
  await page
    .getByLabel('헤더 저장 연결', { exact: true })
    .selectOption(targets.b)
  await page.getByLabel('상품명 표시 이름', { exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('상품명 표시 이름', { exact: true }).inputValue(),
    '상품명',
  )
  assert.equal(
    await page.getByLabel('상품명 업체 전용 값', { exact: true }).count(),
    0,
  )
  await page
    .getByLabel('헤더 저장 연결', { exact: true })
    .selectOption(targets.a)
  await page.getByLabel('물류상품명 표시 이름', { exact: true }).waitFor()
  await page
    .getByRole('dialog', { name: '표시 항목 및 연결 설정' })
    .getByRole('button', { name: '닫기', exact: true })
    .click()
  await page.getByText('연결 A 전용 값', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      () =>
        window.__usageFixture.fingerprint() === window.__usageFixture.baseline,
    ),
    true,
  )
  await page.goto(origin + '/?partner-folders')
  const startRegistration = page.getByRole('button', { name: '새 업체 또는 지점 등록' })
  await startRegistration.click()
  const registration = page.getByRole('dialog')
  await registration.getByRole('button', { name: /기존 업체에 지점 추가/ }).click()
  await registration.getByLabel('업체 이름').fill('롯데')
  await registration.getByRole('button', { name: /롯데면세점/ }).click()
  await registration.getByLabel('지점명').fill('김포공항점')
  await registration.getByRole('button', { name: '지점 등록하기' }).click()
  await registration.getByRole('status').getByText(/미리보기에서는 저장되지 않습니다/).waitFor()
  await registration.getByRole('button', { name: '이전' }).click()
  await registration.getByRole('button', { name: /새 업체 등록/ }).click()
  await registration.getByLabel('업체명').fill('검수용 신규상사')
  for (const folder of ['온라인', '풀필먼트', '사입']) {
    await registration.getByRole('button', { name: folder, exact: true }).click()
  }
  await registration.getByText('온라인 › 풀필먼트 › 사입에 ‘검수용 신규상사’ 업체를 추가합니다.', { exact: true }).waitFor()
  await registration.getByRole('button', { name: '업체 등록하기' }).click()
  await page.keyboard.press('Escape')
  await registration.waitFor({ state: 'hidden' })
  assert.equal(await page.getByText('검수용 신규상사', { exact: true }).count(), 0)
  assert.equal(await page.getByText('김포공항점', { exact: true }).count(), 0)
  const fulfillment = page.locator('p').filter({ hasText: /^풀필먼트$/ })
  const treeToggle = (label) => label.locator('xpath=ancestor::div[button[@aria-expanded]][1]')
    .getByRole('button', { name: /^(접기|펼치기)$/ })
  const parentToggle = treeToggle(fulfillment)
  const supplyFolder = page.locator('p').filter({ hasText: /^사입$/ })
  const distributionFolder = page.locator('p').filter({ hasText: /^유통$/ })
  const supply = page.getByText('쿠팡_MFS', { exact: true })
  const distribution = page.getByText('29CM_MFS', { exact: true })
  assert.equal(await parentToggle.getAttribute('aria-expanded'), 'false')
  await supplyFolder.waitFor({ state: 'hidden' })
  await parentToggle.click()
  assert.equal(await treeToggle(supplyFolder).getAttribute('aria-expanded'), 'false')
  assert.equal(await treeToggle(distributionFolder).getAttribute('aria-expanded'), 'false')
  await page.getByRole('button', { name: '풀필먼트 / 사입 에 업체 추가', exact: true }).click()
  await page.getByPlaceholder('예: 신라면세점').waitFor()
  await page.getByRole('button', { name: '취소', exact: true }).click()
  await treeToggle(distributionFolder).click()
  await supply.waitFor()
  await distribution.waitFor()
  assert.equal(await page.getByText('아직 업체가 없습니다.', { exact: true }).count(), 0)
  assert.equal(await page.getByText('풀필먼트 / 유통', { exact: true }).count(), 0)
  await parentToggle.click()
  await supply.waitFor({ state: 'hidden' })
  await distribution.waitFor({ state: 'hidden' })
  await parentToggle.click()
  await treeToggle(distributionFolder).click()
  await distribution.waitFor()
  const lotte = page.getByTitle('클릭해서 접기 · 더블클릭해서 이름 바꾸기')
    .filter({ hasText: '롯데면세점' })
  const lotteToggle = treeToggle(lotte)
  const incheon = page.getByRole('button', { name: '인천공항점', exact: true })
  const font = (label) => label.evaluate((element) => {
    const { fontFamily, fontSize, fontWeight } = getComputedStyle(element)
    return [fontFamily, fontSize, fontWeight]
  })
  assert.deepEqual(await font(fulfillment), await font(distribution))
  assert.deepEqual(await font(lotte), await font(distribution))
  const companyNameStart = await lotte.evaluate((element) =>
    element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft))
  assert.ok(Math.abs(companyNameStart - (await distribution.boundingBox()).x) < 1)
  const leafMarker = distribution.locator('xpath=ancestor::button[1]/preceding-sibling::span[@aria-hidden="true"]')
  await leafMarker.locator('span').waitFor()
  const { x: dotX, width: dotWidth } = await leafMarker.boundingBox()
  const { x: arrowX, width: arrowWidth } = await lotteToggle.boundingBox()
  assert.equal(dotX, arrowX)
  assert.equal(dotWidth, arrowWidth)
  assert.match(await lotte.innerText(), /롯데면세점\s*1곳/)
  assert.equal(await lotteToggle.getAttribute('aria-expanded'), 'false')
  await incheon.waitFor({ state: 'hidden' })
  await lotteToggle.click()
  await incheon.waitFor()
  await lotteToggle.click()
  await incheon.waitFor({ state: 'hidden' })
  await lotteToggle.click()
  await incheon.click()
  assert.equal(await incheon.getAttribute('aria-selected'), 'true')
  await page.getByPlaceholder('업체 그룹, 지점, 채널, 별칭, 폴더로 검색').fill('29CM')
  await page.getByText('온라인 / 풀필먼트 / 유통', { exact: true }).waitFor()
  await page.getByRole('button', { name: '검색어 지우기' }).click()
  await page.getByRole('button', { name: /^오프라인/ }).click()
  const wConcept = page.getByTitle('클릭해서 접기 · 더블클릭해서 이름 바꾸기').filter({ hasText: 'W컨셉' })
  await treeToggle(wConcept).click()
  await page.getByRole('button', { name: '한남점', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'W컨셉', exact: true }).count(), 0)
  assert.match(await wConcept.innerText(), /W컨셉\s*1곳/)
  assert.deepEqual(errors, [])
  console.log(
    'PASS actual-component offline browser: legacy defaults, managers, rename, private edit, common read-only, hide/unhide retention, multi-SKU quantities, partner isolation, failed-save draft retention, reader/missing-schema fail-closed, online folder hierarchy and search; no remote requests',
  )
} catch (error) {
  console.error({
    url: page.url(),
    errors,
    text: (await page.locator('body').innerText()).slice(-3500),
  })
  await page.screenshot({
    path: path.join(screenshotDir, 'failure.png'),
    fullPage: true,
  })
  throw error
} finally {
  await browser.close()
  await server.close()
}
