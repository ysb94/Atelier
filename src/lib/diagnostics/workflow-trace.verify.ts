import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/react-query'
import { createDiagnosedClient } from '@/lib/supabase/diagnosed-client'
import { diagnosticQuery } from '@/lib/supabase/diagnostic-query'
import { createDiagnosticFetch } from './request-watch'
import { installWorkflowDiagnostics } from './runtime-watch'
import { setDiagnosticsEnabled } from './debug-flags'
import { clearDiagnosticReport, diagnosticError, diagnosticReport, inputDiagnosticContext, startWorkflow, tracedInput } from './workflow-trace'

const origin = 'https://diagnostic-fixture.example.invalid'
const PRIVATE = 'PRIVATE_EMPLOYEE_DIAGNOSTIC_SENTINEL'
const original = { error: console.error, warn: console.warn, info: console.info }
const logs: { level: string; args: unknown[] }[] = []
console.error = (...args) => { logs.push({ level: 'error', args }) }
console.warn = (...args) => { logs.push({ level: 'warn', args }) }
console.info = (...args) => { logs.push({ level: 'info', args }) }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'sb-request-id': 'fixture-request-123' } })

try {
  setDiagnosticsEnabled(false)
  clearDiagnosticReport()
  let calls = 0, sent = '', body = ''
  const db = createDiagnosedClient(origin, 'fixture-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, db: { retry: false },
    global: { fetch: async (input, init) => {
      calls++; sent = new Headers(init?.headers).get('x-client-info') ?? ''; body = String(init?.body)
      const path = new URL(String(input)).pathname
      return path.endsWith('/reject') ? json({ code: '42501', message: `permission denied ${PRIVATE}`, details: PRIVATE, hint: PRIVATE }, 403)
        : json({ name: PRIVATE, value: 3 })
    } },
  })
  const flow = startWorkflow('offsite', 'register')
  const saved = await flow.run('save', context => diagnosticQuery<{ name: string; value: number }>('offsite', 'insert', db.rpc('save', { p_note: PRIVATE }), context))
  flow.done()
  assert.deepEqual(saved, { name: PRIVATE, value: 3 }, 'SDK data must be unchanged')
  assert.match(body, new RegExp(PRIVATE), 'business payload must be unchanged')
  assert.match(sent, new RegExp(flow.context().traceId), 'explicit async context must reach actual SDK transport')
  assert.equal(calls, 1)
  assert(diagnosticReport().events.some(event => event.domain === 'db' && event.traceId === flow.context().traceId && event.phase === 'completed'))
  assert.equal(logs.filter(log => log.level === 'info').length, 0, 'normal steps stay quiet when verbose mode is off')
  assert(!JSON.stringify(diagnosticReport()).includes(PRIVATE))

  const denied = startWorkflow('leave', 'approve')
  await assert.rejects(denied.run('save', context => diagnosticQuery('leave', 'approve', db.rpc('reject'), context)), /permission denied/)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(calls, 2, 'observer must not add retries')
  assert(diagnosticReport().events.some(event => event.meta.errorCode === '42501' && event.meta.category === 'permission'))
  assert(diagnosticReport().events.some(event => event.meta.serverRequestId === 'fixture-request-123'))
  assert(diagnosticReport().events.some(event => event.traceId === denied.context().traceId && event.trail?.some(step => step.startsWith('save:'))))
  assert(!JSON.stringify(logs).includes(PRIVATE), 'raw DB messages/details/hints must never enter new console logs')

  for (const [code, expected] of Object.entries({ PGRST003: 'connection_pool_timeout', PGRST000: 'database_connection', '08006': 'database_connection', '57P01': 'database_connection', PGRST300: 'configuration_missing', PGRST301: 'authentication', PGRST202: 'schema_missing', PGRST205: 'schema_missing', '42703': 'schema_missing', '23505': 'duplicate', '23503': 'reference_missing', '40P01': 'deadlock', '40001': 'concurrent_change', '55P03': 'lock_busy', '57014': 'timeout', '53300': 'server_capacity' })) {
    assert.equal(diagnosticError({ code, message: PRIVATE }).category, expected, code)
  }
  assert.equal(diagnosticError({ code: 'PGRST003' }, 504).category, 'connection_pool_timeout', 'pool acquisition must be distinct from a generic gateway timeout')
  assert.equal(diagnosticError(new Error('wrapped', { cause: { code: 'P0001', message: '같은 시간에 기존 신청이 있습니다.' } })).category, 'schedule_conflict')
  assert.equal(diagnosticError(new TypeError('Failed to fetch')).category, 'network')
  assert.equal(diagnosticError(new TypeError('Cannot read properties of null')).category, 'unexpected_error', 'a JS TypeError must not be mistaken for a DB connection failure')

  clearDiagnosticReport()
  let release!: () => void
  const source = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('first'))
    release = () => { controller.enqueue(new TextEncoder().encode('second')); controller.close() }
  } })
  const streamFetch = createDiagnosticFetch(origin, async () => new Response(source, { status: 200 }))
  const streaming = await streamFetch(origin + '/storage/v1/object/PRIVATE_BUCKET/PRIVATE_FILE?token=PRIVATE_TOKEN')
  assert(!diagnosticReport().events.some(event => event.phase === 'completed'), 'headers alone must not be reported as a completed response')
  const reading = streaming.text(); release()
  assert.equal(await reading, 'firstsecond', 'stream bytes must be preserved')
  assert(diagnosticReport().events.some(event => event.phase === 'completed'))
  assert(!JSON.stringify(diagnosticReport()).includes('PRIVATE_'), 'storage names, object paths and query tokens must be excluded')

  clearDiagnosticReport()
  const broken = createDiagnosticFetch(origin, async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError(PRIVATE)) } })))
  await assert.rejects((await broken(origin + '/rest/v1/items')).text(), new RegExp(PRIVATE))
  assert(diagnosticReport().events.some(event => event.phase === 'failed' && event.meta.category === 'network'))
  assert(!diagnosticReport().events.some(event => event.phase === 'completed'))
  assert(!JSON.stringify(diagnosticReport()).includes(PRIVATE))

  clearDiagnosticReport()
  const controller = new AbortController(); controller.abort()
  const aborted = createDiagnosticFetch(origin, async () => { throw new DOMException('cancelled', 'AbortError') })
  await assert.rejects(aborted(origin + '/rest/v1/items', { signal: controller.signal }))
  assert(diagnosticReport().events.some(event => event.phase === 'cancelled'))
  assert(!diagnosticReport().events.some(event => event.phase === 'failed'))

  const a = startWorkflow('meeting', 'save_a'), b = startWorkflow('meeting', 'save_b')
  await Promise.all([a.run('db', context => diagnosticQuery('meeting', 'save', db.rpc('save'), context)), b.run('db', context => diagnosticQuery('meeting', 'save', db.rpc('save'), context))])
  assert.notEqual(a.context().traceId, b.context().traceId)
  for (const trace of [a, b]) assert(diagnosticReport().events.some(event => event.traceId === trace.context().traceId && event.domain === 'db'))
  const input = { kind: 'annual', note: PRIVATE }
  assert.equal(tracedInput(input, a.context()), input)
  assert.deepEqual(Object.keys(input), ['kind', 'note'])
  assert.equal(inputDiagnosticContext(input)?.traceId, a.context().traceId)

  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  installWorkflowDiagnostics(queries); installWorkflowDiagnostics(queries)
  await assert.rejects(queries.fetchQuery({ queryKey: [PRIVATE], queryFn: () => { throw new Error(PRIVATE) } }))
  assert(diagnosticReport().events.some(event => event.domain === 'app' && event.action === 'query' && event.phase === 'failed'))
  assert(!JSON.stringify(diagnosticReport()).includes(PRIVATE))
  queries.clear()

  clearDiagnosticReport(); logs.length = 0
  for (let i = 0; i < 350; i++) startWorkflow('app', 'repeat_probe').fail(new Error(PRIVATE))
  assert(diagnosticReport().events.length <= 240)
  assert(diagnosticReport().failures.length <= 40)
  assert(logs.length <= 3, 'repeated failure console output must be bounded')
  const report = diagnosticReport(); report.events[0].meta.reason = 'modified'
  assert.notEqual(diagnosticReport().events[0].meta.reason, 'modified', 'report must not mutate retained evidence')
  for (let i = 0; i < 250; i++) startWorkflow('app', 'background_poll').done()
  assert(diagnosticReport().failures.some(event => event.action === 'repeat_probe'), 'normal polling must not erase all failure evidence')
  setDiagnosticsEnabled(true)
  startWorkflow('notification', 'verbose_probe').done()
  assert(logs.some(log => log.level === 'info'))
  setDiagnosticsEnabled(false)
} finally { Object.assign(console, original); clearDiagnosticReport() }
console.info('Workflow diagnostics: real SDK trace linkage, SQLSTATE/privacy, unchanged results/streaming, body failures/cancellation, parallel isolation, bounded evidence/noise and global query failures passed.')
