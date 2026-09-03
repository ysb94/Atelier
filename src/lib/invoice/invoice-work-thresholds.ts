/**
 * 파싱 Worker와 계산 Worker를 쓸지 가르는 교차점.
 * 왕복·structured clone 비용이 계산 이득보다 크면 계산 Worker는 쓰지 않는다.
 * 현재 40,000행 벤치에서도 계산 Worker가 이득이 없고 일부 브라우저에서는
 * module Worker가 시작 이벤트 없이 멈추므로 계산은 메인 스레드에서 끝낸다.
 */
export const INVOICE_PARSE_WORKER_MIN_BYTES = 80_000
export const INVOICE_COMPUTE_WORKER_MIN_ROWS = Number.POSITIVE_INFINITY
