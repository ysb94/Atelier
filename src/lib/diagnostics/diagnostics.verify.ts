/**
 * 콘솔 진단 판정 함수 검증.
 * 실행: npm run verify:diagnostics
 */
import {
  classifyRenderStorm,
  RENDER_STORM_ERROR_COUNT,
  RENDER_STORM_WARN_COUNT,
  RENDER_STORM_WINDOW_MS,
  stepRenderWindow,
} from './render-watch'
import {
  diagnosticQueryName,
  installQueryWatch,
  QUERY_SLOW_WARN_MS,
  QUERY_STORM_WARN_COUNT,
  QUERY_STORM_WINDOW_MS,
  stepFetchWindow,
} from './query-watch'
import { onlineManager, QueryClient } from '@tanstack/react-query'
import { setDiagnosticsEnabled } from './debug-flags'
import {
  classifyFrameStall,
  PERF_FRAME_STALL_ERROR_MS,
  PERF_FRAME_STALL_WARN_MS,
  safeInteractionContext,
} from './perf-watch'
import {
  INVOICE_WORK_SLOW_INFO_MS,
  INVOICE_WORK_SLOW_WARN_MS,
  invoiceWorkLogLevel,
} from '@/lib/invoice/invoice-work-perf'
import { barcodeHistoryLogLevel } from '@/lib/outbound/barcode-history-perf'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(barcodeHistoryLogLevel(199) === 'debug', '바코드 이력 200ms 미만은 debug')
assert(barcodeHistoryLogLevel(200) === 'info', '바코드 이력 200ms 이상은 info')
assert(barcodeHistoryLogLevel(1_000) === 'warn', '바코드 이력 1초 이상은 warn')

assert(classifyRenderStorm(RENDER_STORM_WARN_COUNT - 1) === 'ok', '경고 미만은 ok')
assert(classifyRenderStorm(RENDER_STORM_WARN_COUNT) === 'warn', '경고 임계는 warn')
assert(classifyRenderStorm(RENDER_STORM_ERROR_COUNT) === 'error', '오류 임계는 error')

let renderWindow: ReturnType<typeof stepRenderWindow>['window'] | null = null
const reports: string[] = []
for (let index = 0; index < RENDER_STORM_ERROR_COUNT + 5; index += 1) {
  const next = stepRenderWindow(renderWindow, 1_000 + index)
  renderWindow = next.window
  if (next.report) reports.push(next.report)
}
assert(
  reports.join(',') === 'warn,error',
  `같은 1초 창에서는 warn·error 를 각각 한 번만 보고한다: ${reports.join(',')}`,
)
const resetWindow = stepRenderWindow(renderWindow, 1_000 + RENDER_STORM_WINDOW_MS + 1)
assert(
  resetWindow.window.count === 1 && resetWindow.report === null,
  '1초가 지나면 창을 새로 시작한다',
)

let fetchWindow: ReturnType<typeof stepFetchWindow>['window'] | undefined
const fetchReports: number[] = []
for (let index = 0; index < QUERY_STORM_WARN_COUNT + 3; index += 1) {
  const next = stepFetchWindow(fetchWindow, 5_000 + index)
  fetchWindow = next.window
  if (next.report) fetchReports.push(next.window.count)
}
assert(
  fetchReports.length === 1 && fetchReports[0] === QUERY_STORM_WARN_COUNT,
  '같은 쿼리 반복 fetch 는 임계에서 한 번만 보고한다',
)
assert(
  stepFetchWindow(fetchWindow, 5_000 + QUERY_STORM_WINDOW_MS).window.count === 1,
  '10초가 지나면 fetch 창을 새로 시작한다',
)

assert(classifyFrameStall(PERF_FRAME_STALL_WARN_MS - 1) === 'ok', '짧은 프레임 간격은 ok')
assert(classifyFrameStall(PERF_FRAME_STALL_WARN_MS) === 'warn', '프레임 정지 경고 임계')
assert(classifyFrameStall(PERF_FRAME_STALL_ERROR_MS) === 'error', '프레임 정지 오류 임계')

assert(invoiceWorkLogLevel(INVOICE_WORK_SLOW_INFO_MS - 1) === 'debug', '빠른 단계는 debug')
assert(invoiceWorkLogLevel(INVOICE_WORK_SLOW_INFO_MS) === 'info', '느린 단계는 info')
assert(invoiceWorkLogLevel(INVOICE_WORK_SLOW_WARN_MS) === 'warn', '아주 느린 단계는 warn')

assert(diagnosticQueryName(['my-leave', 'private-employee-id', { search: 'private' }]) === 'my-leave', '쿼리 이름만 진단에 남긴다')
assert(diagnosticQueryName(['private@example.com']) === 'query', '이메일을 쿼리 이름으로 기록하지 않는다')
assert(diagnosticQueryName(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']) === 'query', '첫 키가 직원 UUID여도 기록하지 않는다')
const safeContext = safeInteractionContext({ path: '/settings/profile?email=private@example.com#token=secret', lastInput: 'click button:직원 이름\n추가 상세 (120ms 전)' })
assert(safeContext.path === '/settings/profile', '공통 요청 진단에서 URL 검색값과 해시를 제외한다')
assert(safeContext.lastInput === 'click button (120ms 전)', '줄바꿈이 있는 클릭 문구도 제외하고 동작·요소 종류·경과만 남긴다')
assert(safeInteractionContext({ path: '/', lastInput: 'unexpected private value' }).lastInput === null, '알 수 없는 입력 문맥은 원문을 기록하지 않는다')
assert(safeInteractionContext({ path: '/', lastInput: 'pointerdown window (0ms 전)' }).lastInput === 'pointerdown window (0ms 전)', '문구 없는 정상 입력 문맥은 보존한다')

// 실제 QueryCache 이벤트로 대기·수동 캐시 변경·취소·삭제의 타이머 수명을 검증한다.
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
const originalNow = performance.now
const originalWarn = console.warn
const originalError = console.error
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
const originalOnline = onlineManager.isOnline()
const timers = new Map<ReturnType<typeof setTimeout>, () => void>()
const logs: unknown[][] = []
let timerId = -1
let clock = 10_000
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
const timerCount = () => timers.size
let stopWatch = () => {}
try {
  setDiagnosticsEnabled(true)
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { pathname: '/settings/profile', search: '?secret=private' } })
  performance.now = () => clock
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === QUERY_SLOW_WARN_MS && typeof callback === 'function') {
      const id = timerId-- as unknown as ReturnType<typeof setTimeout>
      timers.set(id, () => callback(...args))
      return id
    }
    return originalSetTimeout(callback, delay, ...args)
  }) as typeof setTimeout
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout> | undefined) => {
    if (id != null && timers.delete(id)) return
    originalClearTimeout(id)
  }) as typeof clearTimeout
  console.warn = (...args) => logs.push(args)
  console.error = (...args) => logs.push(args)
  stopWatch = installQueryWatch(queryClient)
  assert(installQueryWatch(queryClient) === stopWatch, '중복 설치는 타이머와 구독을 추가하지 않는다')

  let complete!: (value: string) => void
  const key = ['pending-read', 'private-employee-id', { secret: 'private-filter' }]
  const result = queryClient.fetchQuery({ queryKey: key, queryFn: () => new Promise<string>((resolve) => { complete = resolve }) })
  assert(timerCount() === 1, '진행 중 조회에 지연 타이머를 등록한다')
  queryClient.setQueryData(key, 'cached')
  assert(timerCount() === 1, '수동 캐시 변경은 실제 진행 중 요청의 타이머를 유지한다')
  clock += QUERY_SLOW_WARN_MS
  for (const [id, callback] of timers) { timers.delete(id); callback() }
  assert(logs.length === 1 && String(logs[0][0]).includes('pending-query'), '응답이 끝나지 않아도 3초에 한 번 경고한다')
  assert(!JSON.stringify(logs).includes('private'), 'UUID·필터·URL 쿼리 값은 대기 로그에 남기지 않는다')
  assert(String(JSON.stringify(logs)).includes('/settings/profile'), '대기 경고에 현재 화면 경로를 남긴다')
  complete('done')
  await result
  assert(timerCount() === 0, '정상 완료 후 타이머가 남지 않는다')

  const beforeFailure = logs.length
  await queryClient.fetchQuery({ queryKey: ['failed-read', 'private-id'], queryFn: async () => { throw { code: '57014', message: 'private-message', details: 'private-body' } } }).catch(() => undefined)
  assert(timerCount() === 0, '실패한 요청의 대기 타이머도 정리한다')
  assert(logs.length === beforeFailure + 1 && JSON.stringify(logs.at(-1)).includes('57014'), '오류 코드만 보고한다')
  assert(!JSON.stringify(logs).includes('private'), '오류 본문과 상세는 로그에 남기지 않는다')

  queryClient.mount()
  onlineManager.setOnline(false)
  const offlineKey = ['paused-read']
  const offlineResult = queryClient.fetchQuery({ queryKey: offlineKey, queryFn: ({ signal }) => { void signal; return new Promise<string>(() => {}) } }).catch(() => undefined)
  assert(timerCount() === 0, '오프라인 대기는 서버 응답 지연으로 경고하지 않는다')
  onlineManager.setOnline(true)
  await new Promise<void>((resolve) => originalSetTimeout(resolve, 0))
  assert(timerCount() === 1, '온라인 재개 후 실제 요청의 지연 타이머를 시작한다')
  await queryClient.cancelQueries({ queryKey: offlineKey })
  await offlineResult
  assert(timerCount() === 0, '재개된 요청의 취소 시 타이머를 정리한다')

  for (const action of ['cancel', 'remove', 'cleanup'] as const) {
    const queryKey = [`pending-${action}`]
    const outstanding = queryClient.fetchQuery({ queryKey, queryFn: ({ signal }) => { void signal; return new Promise<string>(() => {}) } }).catch(() => undefined)
    assert(timerCount() === 1, `${action}: 새 요청 타이머가 등록된다`)
    const count: number = logs.length
    if (action === 'cancel') await queryClient.cancelQueries({ queryKey })
    else if (action === 'remove') queryClient.removeQueries({ queryKey })
    else { stopWatch(); await queryClient.cancelQueries({ queryKey }) }
    await outstanding
    assert(timerCount() === 0, `${action}: 남은 지연 타이머를 정리한다`)
    assert(logs.length === count, `${action}: 취소된 요청에 오류·대기 경고를 추가하지 않는다`)
  }
} finally {
  stopWatch()
  queryClient.unmount()
  queryClient.clear()
  onlineManager.setOnline(originalOnline)
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
  performance.now = originalNow
  console.warn = originalWarn
  console.error = originalError
  if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation)
  else Reflect.deleteProperty(globalThis, 'location')
}

console.log('diagnostics verify: ok')
