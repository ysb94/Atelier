import { diagnosticError, newDiagnosticContext, recordDiagnostic, WORKFLOW_PENDING_MS, type DiagnosticContext, type DiagnosticMeta } from './workflow-trace'

const ERROR_BODY_LIMIT = 8_192
let serial = 0

function requestTarget(url: URL): { service: string; target: string } {
  const safe = (value: string | undefined) => value && /^[a-z][a-z0-9_-]{0,79}$/i.test(value) ? value : 'unknown'
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] === 'rest' && parts[1] === 'v1') return { service: parts[2] === 'rpc' ? 'rpc' : 'table', target: safe(parts[2] === 'rpc' ? parts[3] : parts[2]) }
  if (parts[0] === 'auth') return { service: 'auth', target: ['token', 'user', 'logout', 'authorize', 'signup', 'recover', 'verify'].includes(parts[2]) ? parts[2] : 'auth' }
  if (parts[0] === 'storage') return { service: 'storage', target: safe(parts[2]) }
  if (parts[0] === 'functions') return { service: 'function', target: safe(parts[2]) }
  return { service: 'api', target: 'unknown' }
}

function requestContext(headers: Headers, fallback: DiagnosticContext): DiagnosticContext {
  const match = headers.get('x-client-info')?.match(/^atelier diagnostic\/(flow-[a-z0-9-]+)\/(app|db|offsite|leave|meeting|notification)\/([a-zA-Z][\w-]{0,79})\/([a-zA-Z][\w-]{0,79})$/)
  return match ? { traceId: match[1], domain: 'db', action: match[3], stage: match[4] } : fallback
}
function serverRequestId(response: Response): string | undefined {
  const value = response.headers.get('sb-request-id') ?? response.headers.get('x-request-id') ?? response.headers.get('cf-ray')
  return value && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : undefined
}

/** Inspect only bounded ERROR responses. Never copy a successful row, token or file. */
async function errorDetails(response: Response): Promise<DiagnosticMeta> {
  if (!response.headers.get('content-type')?.includes('json')) return diagnosticError(null, response.status)
  const reader = response.clone().body?.getReader()
  if (!reader) return diagnosticError(null, response.status)
  const decoder = new TextDecoder()
  let text = '', size = 0
  const timer = setTimeout(() => { void reader.cancel().catch(() => { /* clone may already be closed */ }) }, 1_000)
  try {
    while (size <= ERROR_BODY_LIMIT) {
      const next = await reader.read()
      if (next.done) return diagnosticError(JSON.parse(text || '{}'), response.status)
      size += next.value.byteLength
      if (size > ERROR_BODY_LIMIT) break
      text += decoder.decode(next.value, { stream: true })
    }
    return { ...diagnosticError(null, response.status), reason: 'error_body_limit' }
  } catch {
    // Malformed/truncated error bodies remain classified by HTTP status; no raw body is logged.
    return { ...diagnosticError(null, response.status), reason: 'error_body_unavailable' }
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => { /* best-effort cancellation of the diagnostic clone only */ })
  }
}

/** Observes the existing fetch policy. Does not retry, abort, rewrite bodies or alter auth. */
export function createDiagnosticFetch(supabaseUrl: string, fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)): typeof fetch {
  const origin = new URL(supabaseUrl).origin
  return async (input, init) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input))
    if (url.origin !== origin) return fetcher(input, init)
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const target = requestTarget(url)
    const headers = new Headers(init?.headers ?? request?.headers)
    const transportId = `http-${(++serial).toString(36)}`
    const context = requestContext(headers, newDiagnosticContext('db', target.target, 'send'))
    const at = performance.now()
    const base: DiagnosticMeta = { ...target, method, transportId }
    let responseReceived = false, finished = false
    const timer = setTimeout(() => recordDiagnostic(context, 'pending', { ...base, reason: responseReceived ? 'response_body_pending' : 'response_headers_pending' }, performance.now() - at), WORKFLOW_PENDING_MS)
    const finish = (phase: 'completed' | 'failed' | 'cancelled', meta: DiagnosticMeta, emit = true) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (emit) recordDiagnostic(context, phase, meta, performance.now() - at)
    }
    const failed = (error: unknown) => {
      const details = (init?.signal ?? request?.signal)?.aborted ? { category: 'cancelled' } : diagnosticError(error)
      if (error instanceof TypeError && details.category === 'unexpected_error') details.category = 'network'
      finish(details.category === 'cancelled' ? 'cancelled' : 'failed', { ...base, ...details, ...(method === 'GET' || method === 'HEAD' ? {} : { writeOutcome: 'unknown' }) })
    }
    try {
      recordDiagnostic(context, 'started', base)
      const response = await fetcher(input, init)
      responseReceived = true
      const id = serverRequestId(response)
      const meta = { ...base, httpStatus: response.status, ...(id ? { serverRequestId: id } : {}) }
      if (!response.ok) {
        // Return immediately. Diagnostics must not hold up the SDK/error UI.
        recordDiagnostic(context, 'failed', { ...meta, ...diagnosticError(null, response.status), ...(method === 'GET' || method === 'HEAD' ? {} : { writeOutcome: 'unknown' }) }, performance.now() - at)
        void errorDetails(response).then(details => recordDiagnostic(context, 'failed', { ...meta, ...details }, performance.now() - at)).catch(() => recordDiagnostic(context, 'failed', { ...meta, reason: 'error_body_unavailable' }, performance.now() - at))
      } else recordDiagnostic({ ...context, stage: 'response_headers' }, 'step', meta, performance.now() - at)
      if (!response.body || response.status === 0) { finish(response.ok ? 'completed' : 'failed', meta, response.ok); return response }
      const reader = response.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const next = await reader.read()
            if (next.done) { finish(response.ok ? 'completed' : 'failed', meta, response.ok); stream.close() }
            else stream.enqueue(next.value)
          } catch (error) { failed(error); stream.error(error) }
        },
        cancel(reason) { finish('cancelled', { ...meta, reason: 'body_cancelled' }); return reader.cancel(reason) },
      })
      const observed = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
      // SDK/Storage consumers retain original response metadata and streaming/backpressure.
      Object.defineProperties(observed, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } })
      return observed
    } catch (error) {
      failed(error)
      throw error
    }
  }
}
