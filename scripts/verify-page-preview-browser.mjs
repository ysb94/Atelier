import assert from 'node:assert/strict'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'
import { verifyWorkspaceOverlays } from './workspace-overlay-browser.mjs'
import { verifyPermissionSettings } from './permission-settings-browser.mjs'

const root = process.cwd(), fixture = path.join(root, 'dev-tools/ai-workflow/browser-fixture')
const auth = path.join(fixture, 'page-preview-auth.tsx'), client = path.join(fixture, 'page-preview-client.ts')
const server = await createServer({ root, configFile: false, envFile: false, logLevel: 'error',
  cacheDir: path.join(root, 'node_modules', '.cache', 'page-preview-vite'),
  plugins: [{ name: 'preview-fixture', enforce: 'pre', resolveId(source, importer) {
    if (importer && source.startsWith('.')) {
      const target = path.resolve(path.dirname(importer), source).replace(/\.tsx?$/, '')
      if (target === path.join(root, 'src/lib/supabase/auth')) return auth
      if (target === path.join(root, 'src/lib/supabase/client')) return client
    }
  }, configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (!req.headers.accept?.includes('text/html')) return next()
    vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/page-preview-entry.tsx"></script></body></html>')
      .then(html => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) }).catch(next)
  }) } }, react(), tailwindcss()],
  resolve: { alias: [{ find: '@/lib/supabase/auth', replacement: auth }, { find: '@/lib/supabase/client', replacement: client }, { find: '@', replacement: path.join(root, 'src') }] },
  server: { host: '127.0.0.1', port: 5191, hmr: false, watch: { ignored: ['**/.state/**'] }, fs: { allow: [root] } },
})
await server.listen()
let browser
let diagnosticPage
const errors = []
try {
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const remote = []
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue()
    remote.push(route.request().url()); return route.abort()
  })
  const page = await context.newPage()
  diagnosticPage = page
  page.setDefaultTimeout(10000)
  page.setDefaultNavigationTimeout(120000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') console.error('browser-console:', message.text()) })
  page.on('requestfailed', request => console.error('browser-request:', request.url(), request.failure()?.errorText))
  page.on('response', response => { if (response.status() >= 400) console.error('browser-response:', response.status(), response.url()) })
  const bar = () => page.getByRole('region', { name: '개발자 화면 미리보기' })
  const choose = async name => {
    const button = bar().getByRole('button', { name, exact: true })
    await button.click()
    assert.equal(await button.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByTestId('hidden-profile').textContent(), 'dev@atelier.local', '비활성 탭의 프로필은 바뀌지 않음')
  }
  if (process.argv.includes('--permissions-only')) {
    await verifyPermissionSettings(page,origin)
  } else {
  await page.goto(origin + '/data/all')
  await page.getByRole('columnheader', { name: '상품명', exact: true }).waitFor()
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  const assertAboveHeaders = async panelId => {
    const result = await page.evaluate(id => {
      const panel = document.getElementById(id)
      const p = panel.getBoundingClientRect()
      const samples = [...document.querySelectorAll('[data-testid="sheet-layering"] th')].flatMap(header => {
        const h = header.getBoundingClientRect()
        const left = Math.max(h.left, p.left, 0), right = Math.min(h.right, p.right, innerWidth)
        const top = Math.max(h.top, p.top, 0), bottom = Math.min(h.bottom, p.bottom, innerHeight)
        if (right - left < 4 || bottom - top < 4) return []
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
        return [{ header: header.textContent, above: panel.contains(hit), hit: hit?.tagName }]
      })
      return samples
    }, panelId)
    assert.ok(result.length > 0, '표 헤더와 패널이 실제 겹치는 좌표를 검사')
    assert.ok(result.every(sample => sample.above), `${panelId}: 상품 데이터 헤더가 패널을 가립니다: ${JSON.stringify(result)}`)
  }
  await assertAboveHeaders('workspace-chat-panel')
  await page.locator('[data-testid="sheet-layering"] > div').evaluate(element => { element.scrollLeft = 240; element.scrollTop = 160 })
  await assertAboveHeaders('workspace-chat-panel')
  await page.getByRole('region', { name: '채팅 화면 미리보기' }).getByRole('button', { name: '채팅 · 팀장', exact: true }).click()
  await page.getByRole('region', { name: '채팅 화면 미리보기' }).waitFor()
  await page.getByRole('button', { name: /^알림(?:,|$)/ }).click()
  await page.locator('#workspace-notification-panel').waitFor()
  await assertAboveHeaders('workspace-notification-panel')
  await page.keyboard.press('Escape')
  if (!process.argv.includes('--layering-only') && !process.argv.includes('--permissions-only')) await verifyWorkspaceOverlays(page, origin)
  if (!process.argv.includes('--layering-only') && !process.argv.includes('--overlay-only')) await verifyPermissionSettings(page, origin)
  if (process.argv.includes('--layering-only')) {
    console.log('page-preview-layering: 실제 SheetTable 고정 헤더 위에서 채팅/알림 표시·스크롤·내부 클릭·닫기 통과')
  } else if (process.argv.includes('--overlay-only')) {
    console.log('workspace-overlays: 전체 소스 점검과 실제 표·모달 겹침 회귀 검증 통과')
  } else if (process.argv.includes('--permissions-only')) {
    console.log('permission-settings: 통합 권한·담당자 화면 검증 통과')
  } else {
  await page.goto(origin + '/')
  await choose('운영지원 · 사원')
  await page.getByRole('heading', { name: '운영지원 업무', exact: true }).waitFor()
  assert.ok((await page.getByTestId('navigation').textContent()).includes('운영지원'))
  await choose('이사 · 출퇴근 제외')
  await page.getByText('출퇴근 기록 제외 직책입니다. 출근·퇴근을 기록하지 않습니다.', { exact: true }).waitFor()
  await choose('사원급')
  await page.getByRole('heading', { name: '나의 업무', exact: true }).waitFor()
  assert.equal((await page.getByTestId('navigation').textContent()).includes('운영지원'), false)
  const chatBar = () => page.getByRole('region', { name: '채팅 화면 미리보기' })
  const chatRoleButtons = () => page.getByRole('button', { name: /^채팅 · / })
  assert.equal(await chatRoleButtons().count(), 0, '채팅을 닫았을 때 공통 상단에 채팅 역할 버튼 없음')
  await page.setViewportSize({ width: 700, height: 1000 })
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  await chatBar().waitFor()
  assert.equal(await chatRoleButtons().count(), 3)
  assert.equal(await bar().getByRole('button', { name: /^채팅 · / }).count(), 0)
  await chatBar().getByRole('button', { name: '채팅 · 팀장', exact: true }).click()
  assert.equal(await chatBar().getByRole('button', { name: '채팅 · 팀장', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await bar().getByRole('button', { name: '사원급', exact: true }).getAttribute('aria-pressed'), 'true', '페이지 역할을 바꾸지 않음')
  await page.getByRole('button', { name: /검증 대화방/ }).click()
  await page.getByText('동료 메시지', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '메시지 더보기', exact: true }).count(), 2, '팀장: 본인+동료 관리 메뉴 유지')
  await chatBar().getByRole('button', { name: '채팅 · 사원', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '메시지 더보기', exact: true }).count(), 1, '사원: 본인 관리 메뉴만 유지')
  await page.getByRole('button', { name: /^알림(?:,|$)/ }).click()
  await chatBar().waitFor({ state: 'hidden' })
  assert.equal(await chatRoleButtons().count(), 0, '알림으로 전환하면 숨김')
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  await chatBar().waitFor()
  assert.equal(await chatBar().getByRole('button', { name: '채팅 · 사원', exact: true }).getAttribute('aria-pressed'), 'false', '재오픈 시 테스트 선택 초기화')
  await chatBar().getByRole('button', { name: '채팅 · 사원', exact: true }).click()
  assert.equal(await page.getByText(/파일 사용량 1/).count(), 0)
  await chatBar().getByRole('button', { name: '채팅 · 관리자', exact: true }).click()
  await page.getByText(/파일 사용량 1/).waitFor()
  await page.keyboard.press('Escape')
  await chatBar().waitFor({ state: 'hidden' })
  assert.equal(await chatRoleButtons().count(), 0, '닫으면 테스트 버튼 제거')
  assert.equal(await bar().getByRole('button', { name: '사원급', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  await chatBar().waitFor()
  await page.mouse.click(10, 350)
  await chatBar().waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(origin + '/settings/profile?part=work')
  await choose('팀장급')
  await page.getByRole('button', { name: '팀 업무', exact: true }).waitFor()
  await choose('사원급')
  assert.equal(await page.getByRole('button', { name: '팀 업무', exact: true }).count(), 0)
  await choose('부서 승인 담당자 · 사원')
  await page.getByRole('tab', { name: '부서 출근시간', exact: true }).waitFor()
  await choose('부서 승인 미지정 · 사원')
  assert.equal(await page.getByRole('tab', { name: '부서 출근시간', exact: true }).count(), 0)
  await page.getByRole('tab', { name: '승인할 신청', exact: true }).click()
  await page.getByRole('button', { name: '검토', exact: true }).first().click()
  await choose('신청 검토 · 본인 신청')
  assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isDisabled(), true)
  await choose('신청 검토 · 다른 직원 신청')
  assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: '승인', exact: true }).click()
  await page.getByRole('article', { name: '근태 신청 검토' }).waitFor()
  await page.getByRole('status').getByText('실제 본인 신청은 화면 테스트에서도 승인·반려할 수 없습니다.', { exact: false }).waitFor()
  await page.goto(origin + '/brands')
  await choose('대표 · 브랜드 생성 / 수정 / 삭제')
  await page.getByRole('button', { name: '새 브랜드', exact: true }).waitFor()
  await choose('대표이사 · 허용')
  assert.equal(await page.getByRole('button', { name: '새 브랜드', exact: true }).count(), 0)
  await choose('관리자 · 제한')
  await page.getByText('브랜드 관리는 대표이사와 개발자만 볼 수 있습니다.', { exact: true }).waitFor()
  await page.goto(origin + '/settings/ai?reader')
  await choose('브랜드 책임자 · 편집 가능')
  await page.getByRole('button', { name: '이 모델 사용', exact: true }).waitFor()
  await choose('조회 전용')
  assert.equal(await page.getByRole('button', { name: '이 모델 사용', exact: true }).count(), 0)
  await page.goto(origin + '/idea-contest')
  await choose('일반 직원 · 접근 제한')
  await page.getByText('접근 제한 화면', { exact: false }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/idea-contest')
  await choose('대표이사 · 접수함 조회')
  await page.getByRole('heading', { name: '아이디어 공모전 접수함', exact: true }).waitFor()
  await page.goto(origin + '/meetings')
  await choose('회의 · 주최자')
  assert.ok(await page.getByRole('button', { name: '삭제', exact: true }).count())
  await choose('회의 · 참여자')
  assert.equal(await page.getByRole('button', { name: '삭제', exact: true }).count(), 0)
  await choose('회의 · 비참여자')
  assert.equal(await page.getByRole('button', { name: '삭제', exact: true }).count(), 0)
  await page.goto(origin + '/usage-codes?role=reader')
  await page.getByRole('button', { name: /무신사/ }).first().click()
  await choose('관리자 · 담당자 / 헤더 설정')
  await page.getByRole('button', { name: '담당자 설정', exact: true }).waitFor()
  await page.getByRole('button', { name: '검증용 저장 시도', exact: true }).click()
  await page.locator('#guard-result').getByText('로그인 계정에 이 업체를 수정할 권한이 없습니다.', { exact: false }).waitFor()
  assert.equal(await page.evaluate(() => window.__usageFixture.audit.length), 0)
  await choose('업체 담당자 · 전용 값 수정')
  assert.equal(await page.getByRole('button', { name: '담당자 설정', exact: true }).count(), 0)
  await choose('일반 직원 · 조회 전용')
  await page.getByRole('button', { name: '헤더 설정', exact: true }).click()
  await page.getByText('조회 전용', { exact: false }).last().waitFor()
  await page.goto(origin + '/?identity=ceo')
  await bar().getByRole('button', { name: '운영지원 · 사원', exact: true }).waitFor()
  assert.equal(await chatRoleButtons().count(), 0)
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  await chatBar().waitFor()
  await page.goto(origin + '/?identity=employee')
  await page.getByRole('heading', { name: '나의 업무', exact: true }).waitFor()
  assert.equal(await bar().count(), 0, '일반 직원에게 테스트 기능 노출 안 함')
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  assert.equal(await chatBar().count(), 0, '일반 직원의 채팅에도 테스트 비노출')
  await page.goto(origin + '/chat/room/fixture-room')
  await chatBar().waitFor()
  assert.equal(await bar().count(), 0, '별도 채팅 창에는 페이지 역할 버튼 없음')
  await chatBar().getByRole('button', { name: '채팅 · 팀장', exact: true }).click()
  await page.getByText('동료 메시지', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '메시지 더보기', exact: true }).count(), 2)
  await chatBar().getByRole('button', { name: '채팅 · 사원', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '메시지 더보기', exact: true }).count(), 1)
  await page.goto(origin + '/chat/room/fixture-room?identity=employee')
  await page.getByText('동료 메시지', { exact: true }).waitFor()
  assert.equal(await chatBar().count(), 0)
  }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(remote, [])
  console.log('page-preview-browser: 선택한 브라우저 시나리오 통과 (오류·외부 요청 0)')
} catch (error) {
  console.error(JSON.stringify({ runtimeErrors: errors, url: diagnosticPage?.url(), text: (await diagnosticPage?.locator('body').innerText().catch(() => ''))?.slice(0, 4500) }))
  throw error
} finally { await browser?.close(); await server.close() }
