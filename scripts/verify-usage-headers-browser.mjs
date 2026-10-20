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
  await page.getByRole('checkbox', { name: '검증 동료', exact: false }).check()
  await page.getByRole('button', { name: '담당자 저장', exact: true }).click()
  await page
    .getByRole('dialog', { name: '업체 담당자 설정' })
    .waitFor({ state: 'hidden' })
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
    await page.getByText('읽기 전용 · 지정 담당자', { exact: false }).count(),
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
  assert.deepEqual(errors, [])
  console.log(
    'PASS actual-component offline browser: legacy defaults, managers, rename, private edit, common read-only, hide/unhide retention, multi-SKU quantities, partner isolation, failed-save draft retention, reader/missing-schema fail-closed; no remote requests',
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
