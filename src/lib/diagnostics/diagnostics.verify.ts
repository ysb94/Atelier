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
  QUERY_STORM_WARN_COUNT,
  QUERY_STORM_WINDOW_MS,
  stepFetchWindow,
} from './query-watch'
import {
  classifyFrameStall,
  PERF_FRAME_STALL_ERROR_MS,
  PERF_FRAME_STALL_WARN_MS,
} from './perf-watch'
import {
  INVOICE_WORK_SLOW_INFO_MS,
  INVOICE_WORK_SLOW_WARN_MS,
  invoiceWorkLogLevel,
} from '@/lib/invoice/invoice-work-perf'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

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

console.log('diagnostics verify: ok')
