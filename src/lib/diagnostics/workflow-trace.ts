import { isDiagnosticsEnabled } from './debug-flags'

export type DiagnosticDomain = 'app' | 'db' | 'offsite' | 'leave' | 'meeting' | 'notification'
export type DiagnosticPhase = 'started' | 'step' | 'pending' | 'completed' | 'blocked' | 'failed' | 'cancelled'
export type DiagnosticContext = { traceId: string; domain: DiagnosticDomain; action: string; stage: string }
/** Only operational flags/counts, never business values, UUIDs, notes or request bodies. */
export type DiagnosticMeta = Partial<Record<
  'count' | 'configuredCount' | 'missingCount' | 'nextDay' | 'continuous' | 'group' | 'configured' |
  'kind' | 'scope' | 'reason' | 'state' | 'status' | 'method' | 'target' | 'service' | 'httpStatus' |
  'errorCode' | 'category' | 'hasHint' | 'hasDetails' | 'serverRequestId' | 'writeOutcome' |
  'online' | 'visible' | 'source' | 'line' | 'column' | 'transportId' | 'elapsedMs', string | number | boolean>>
export type DiagnosticEvent = DiagnosticContext & {
  at: string; phase: DiagnosticPhase; elapsedMs: number; path: string; lastInput: string | null
  meta: DiagnosticMeta; trail?: string[]; repeated?: number
}

const LIMIT = 240
export const WORKFLOW_PENDING_MS = 3_000
const events: DiagnosticEvent[] = []
const failures: DiagnosticEvent[] = []
const repeats = new Map<string, { at: number; count: number }>()
const META_KEYS = new Set('count configuredCount missingCount nextDay continuous group configured kind scope reason state status method target service httpStatus errorCode category hasHint hasDetails serverRequestId writeOutcome online visible source line column transportId elapsedMs'.split(' '))
const ROUTE_PARTS = new Set('settings profile permissions access-ip products product-work drafts new data all upload codes barcodes sabangnet-codes usage-codes partner-codes operations operations-support schedule meetings members org-chart brands design styled-cuts file-manager work-requests logistics invoices invoice-data-entry barcode-outbound-data-entry bulk-outbound finder warehouses temporary-warehouse cargo-inbound china work-orders idea-contest test spin360 md planning visual b2b duty-free'.split(' '))
let lastInput: string | null = null
let serial = 0
const inputContexts = new WeakMap<object, DiagnosticContext>()

/** Attach context without adding diagnostic fields to business/API payloads. */
export function tracedInput<T extends object>(input: T, context: DiagnosticContext): T { inputContexts.set(input, context); return input }
export function inputDiagnosticContext(input: object): DiagnosticContext | undefined { return inputContexts.get(input) }

function token(value: unknown, fallback = 'unknown'): string {
  return typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value) ? value : fallback
}
function cleanMeta(meta: DiagnosticMeta): DiagnosticMeta {
  return Object.fromEntries(Object.entries(meta).filter(([key, value]) => META_KEYS.has(key) && (
    typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ||
    typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,120}$/.test(value)
  ))) as DiagnosticMeta
}
export function diagnosticLocation(): string {
  if (typeof location === 'undefined') return '/'
  return location.pathname.split('/').map(part => !part || ROUTE_PARTS.has(part) ? part : ':id').join('/')
}
export function rememberDiagnosticInput(event: Event) {
  // Element names alone. Text/labels can contain employee names or private notes.
  const target = event.target instanceof Element ? event.target.closest('button,a,input,select,textarea,[role="button"]') : null
  lastInput = `${token(event.type)}:${target?.tagName.toLowerCase() ?? 'element'}`
}
export function diagnosticError(error: unknown, httpStatus?: number, depth = 0): DiagnosticMeta {
  const object = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {}
  if (object.cause && object.cause !== error && depth < 3) return diagnosticError(object.cause, httpStatus, depth + 1)
  const code = typeof object.code === 'string' && /^[A-Z0-9_]{1,24}$/.test(object.code) ? object.code : undefined
  const message = String(object.message ?? (error instanceof Error ? error.message : error ?? ''))
  let category = 'unexpected_error'
  if (code === 'PGRST003') category = 'connection_pool_timeout'
  else if (['PGRST000', 'PGRST001', 'PGRST002', '57P01', '57P02', '57P03'].includes(code ?? '') || code?.startsWith('08')) category = 'database_connection'
  else if (code === 'PGRST300' || /Supabase 환경변수|Invalid supabaseUrl|supabaseKey is required|supabaseUrl is required/i.test(message)) category = 'configuration_missing'
  else if (object.name === 'AbortError' || /^AbortError:|operation was aborted|signal is aborted/i.test(message)) category = 'cancelled'
  else if (/응답 시간.*초과|timeout|timed out/i.test(message) || code === '57014' || httpStatus === 504 || httpStatus === 408) category = 'timeout'
  else if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code ?? '') || httpStatus === 401 || /로그인|JWT/i.test(message)) category = 'authentication'
  else if (code === '42501' || httpStatus === 403 || /권한|permission denied/i.test(message)) category = 'permission'
  else if (['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'].includes(code ?? '') || /서버.*적용 대기|DB 설정.*대기/.test(message)) category = 'schema_missing'
  else if (code === '40P01') category = 'deadlock'
  else if (code === '40001') category = 'concurrent_change'
  else if (code === '55P03') category = 'lock_busy'
  else if (code?.startsWith('53')) category = 'server_capacity'
  else if (httpStatus === 429) category = 'rate_limit'
  else if (/연차.*부족|휴가.*부족|잔여.*부족|잔액.*부족|남은.*연차/.test(message)) category = 'leave_balance'
  else if (/미리보기|계정 전환/.test(message)) category = 'preview_restricted'
  else if (/비활성|활성 직원/.test(message)) category = 'inactive_employee'
  else if (/출근 기준/.test(message) && /없|미설정|확인하지/.test(message)) category = 'workday_basis_missing'
  else if (/같은 시간|겹|충돌|기존 신청/.test(message) || code === '23P01') category = 'schedule_conflict'
  else if (code === '23505') category = 'duplicate'
  else if (code === '23503') category = 'reference_missing'
  else if (/이미 처리|다른 사람이|최신|버전|revision/i.test(message)) category = 'stale_state'
  else if (code === '23514' || code === 'P0001') category = 'business_rule'
  else if (/failed to fetch|network|load failed|연결.*실패/i.test(message)) category = 'network'
  else if (httpStatus && httpStatus >= 500) category = 'server_error'
  else if (httpStatus && httpStatus >= 400) category = 'request_rejected'
  return { category, ...(code ? { errorCode: code } : {}), ...(httpStatus ? { httpStatus } : {}), hasHint: Boolean(object.hint), hasDetails: Boolean(object.details) }
}

const REASONS: Record<string, string> = {
  connection_pool_timeout: 'DB 연결 풀 대기 시간 초과', database_connection: '서버에서 DB 연결 실패',
  configuration_missing: '서버 연결 환경 설정 확인',
  authentication: '로그인·세션 확인', permission: '권한 확인', schema_missing: 'DB 함수·열·테이블 적용 확인',
  timeout: '서버 응답 시간 초과', network: '네트워크 연결 실패', schedule_conflict: '일정 충돌 검사',
  workday_basis_missing: '출근 기준 미설정', stale_state: '다른 처리와 버전 충돌', concurrent_change: '동시 변경 충돌',
  deadlock: 'DB 잠금 교착', lock_busy: 'DB 잠금 대기', server_capacity: 'DB 연결·자원 부족',
  rate_limit: '요청 한도 초과', business_rule: '서버 업무 규칙 검사', duplicate: '중복 기록 검사',
  reference_missing: '연결된 기록 확인', server_error: '서버 오류', request_rejected: '서버 요청 거절',
  leave_balance: '사용 가능한 연차 확인', preview_restricted: '미리보기·계정 전환 제한', inactive_employee: '직원 활성 상태 확인',
  cancelled: '요청 취소', unexpected_error: '예상하지 못한 오류',
}

export function recordDiagnostic(context: DiagnosticContext, phase: DiagnosticPhase, meta: DiagnosticMeta = {}, elapsedMs = 0) {
  const safe = cleanMeta(meta)
  const event: DiagnosticEvent = {
    traceId: token(context.traceId), domain: context.domain, action: token(context.action), stage: token(context.stage),
    at: new Date().toISOString(), phase, elapsedMs: Math.max(0, Math.round(elapsedMs)), path: diagnosticLocation(), lastInput,
    meta: { online: typeof navigator === 'undefined' || navigator.onLine, visible: typeof document === 'undefined' || document.visibilityState === 'visible', ...safe },
  }
  if (phase === 'failed' || phase === 'blocked') {
    event.trail = events.filter(item => item.traceId === event.traceId).slice(-12).map(item => `${item.stage}:${item.phase}`)
  }
  events.push(event)
  if (events.length > LIMIT) events.shift()
  if (phase === 'failed' || phase === 'blocked' && context.stage !== 'query_gate') {
    failures.push(event)
    if (failures.length > 40) failures.shift()
  }
  const warning = phase === 'failed' || phase === 'pending' || phase === 'blocked' && context.stage !== 'query_gate'
  if (!warning && !isDiagnosticsEnabled()) return
  // A failed poll can repeat indefinitely. Keep the latest events, bound console noise.
  const key = `${event.domain}:${event.action}:${event.stage}:${phase}:${safe.category ?? safe.reason ?? ''}`
  const now = Date.now(), previous = repeats.get(key)
  if (previous && now - previous.at < 10_000) {
    previous.count++
    if (previous.count > 3) return
    event.repeated = previous.count
  } else repeats.set(key, { at: now, count: 1 })
  if (repeats.size > 200) for (const [name, value] of repeats) if (now - value.at >= 10_000) repeats.delete(name)
  while (repeats.size > 200) repeats.delete(repeats.keys().next().value!)
  const description = safe.category ? REASONS[String(safe.category)] ?? safe.category : phase
  const label = `[${event.domain === 'db' ? 'db-request' : 'workflow'}] ${event.domain}.${event.action} / ${event.stage} · ${description}`
  if (phase === 'failed') console.error(label, event)
  else if (warning) console.warn(label, event)
  else console.info(label, event)
}

export function diagnosticReport() {
  const copy = (event: DiagnosticEvent) => ({ ...event, meta: { ...event.meta }, ...(event.trail ? { trail: [...event.trail] } : {}) })
  return {
    version: 1, release: import.meta.env.VITE_ATELIER_RELEASE ?? 'local', builtAt: import.meta.env.VITE_ATELIER_BUILT_AT ?? 'local',
    capturedAt: new Date().toISOString(), path: diagnosticLocation(),
    // Copy so console inspection cannot mutate stored evidence.
    events: events.map(copy), failures: failures.map(copy),
  }
}
export function clearDiagnosticReport() { events.length = 0; failures.length = 0; repeats.clear() }

export function newDiagnosticContext(domain: DiagnosticDomain, action: string, stage = 'begin'): DiagnosticContext {
  return { traceId: `flow-${Date.now().toString(36)}-${(++serial).toString(36)}`, domain, action: token(action), stage: token(stage) }
}
export function startWorkflow(domain: DiagnosticDomain, action: string, meta: DiagnosticMeta = {}, parent?: DiagnosticContext) {
  const traceId = parent?.traceId ?? newDiagnosticContext(domain, action).traceId
  const startedAt = performance.now()
  let stage = 'begin', closed = false
  const context = (): DiagnosticContext => ({ traceId, domain, action: token(action), stage })
  recordDiagnostic(context(), 'started', meta)
  return {
    context,
    step(name: string, details: DiagnosticMeta = {}) {
      stage = token(name)
      if (!closed) recordDiagnostic(context(), 'step', details, performance.now() - startedAt)
      return context()
    },
    async run<T>(name: string, work: (context: DiagnosticContext) => PromiseLike<T>, details: DiagnosticMeta = {}): Promise<T> {
      const current = this.step(name, details), at = performance.now()
      const timer = setTimeout(() => { if (!closed) recordDiagnostic(current, 'pending', details, performance.now() - at) }, WORKFLOW_PENDING_MS)
      try { return await work(current) }
      catch (error) { this.fail(error, details); throw error }
      finally { clearTimeout(timer) }
    },
    block(reason: string, details: DiagnosticMeta = {}) {
      if (closed) return
      recordDiagnostic(context(), 'blocked', { ...details, reason: token(reason) }, performance.now() - startedAt)
      closed = true
    },
    fail(error: unknown, details: DiagnosticMeta = {}) {
      if (closed) return
      const failure = diagnosticError(error)
      recordDiagnostic(context(), failure.category === 'cancelled' ? 'cancelled' : 'failed', { ...failure, ...details }, performance.now() - startedAt)
      closed = true
    },
    done(details: DiagnosticMeta = {}) {
      if (closed) return
      recordDiagnostic(context(), 'completed', details, performance.now() - startedAt)
      closed = true
    },
  }
}
export type WorkflowTrace = ReturnType<typeof startWorkflow>

export async function diagnosticOperation<T>(domain: DiagnosticDomain, action: string, work: (trace: WorkflowTrace) => Promise<T>, parent?: DiagnosticContext): Promise<T> {
  const trace = startWorkflow(domain, action, {}, parent)
  try { const value = await work(trace); trace.done(); return value }
  catch (error) { trace.fail(error); throw error }
}

export function diagnosticRealtime(domain: DiagnosticDomain, action: string, status: string) {
  const trace = startWorkflow(domain, action)
  trace.step('realtime_subscription', { status })
  if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') trace.fail(new Error(status === 'TIMED_OUT' ? 'timeout' : 'network'), { scope: 'polling_fallback' })
  else trace.done({ status })
}

/** Explicit context through async work, never a global "current request". */
export function tracedQuery<T>(query: T, context?: DiagnosticContext): T {
  if (context && typeof (query as { setHeader?: unknown })?.setHeader === 'function') {
    // x-client-info is an existing Supabase CORS-supported header. No custom CORS/auth changes.
    ;(query as { setHeader(name: string, value: string): unknown }).setHeader('x-client-info', `atelier diagnostic/${token(context.traceId)}/${context.domain}/${token(context.action)}/${token(context.stage)}`)
  }
  return query
}
