/**
 * 파싱 Worker와 계산 Worker를 쓸지 가르는 교차점.
 * 왕복·structured clone 비용이 계산 이득보다 크면 계산 Worker는 쓰지 않는다.
 */
export const INVOICE_PARSE_WORKER_MIN_BYTES = 80_000
export const INVOICE_COMPUTE_WORKER_MIN_ROWS = 200
