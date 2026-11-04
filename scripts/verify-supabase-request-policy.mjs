import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'
import { QueryClient } from '@tanstack/react-query'

// Only loopback HTTP fixtures are contacted. No credentials or production data.
const dir = path.resolve('.tmp/supabase-request-policy')
await mkdir(dir, { recursive: true })
const policyFile = path.join(dir, 'policy.mjs')
await build({ entryPoints: ['src/lib/supabase/request-policy.ts'], outfile: policyFile, bundle: true,
  platform: 'node', format: 'esm', alias: { '@': path.resolve('src') },
  define: { 'import.meta.env.DEV': 'false' }, logLevel: 'silent' })
const { createSupabaseFetch, isSupabaseReadTimeout, shouldRetrySupabaseQuery, SUPABASE_AUTH_TIMEOUT_MS } = await import(pathToFileURL(policyFile).href)
const hits = new Map(), closed = new Map(), warnings = []
const server = createServer((req, res) => {
  const endpoint = new URL(req.url, 'http://localhost').pathname
  hits.set(endpoint, (hits.get(endpoint) ?? 0) + 1)
  res.on('close', () => closed.set(endpoint, (closed.get(endpoint) ?? 0) + 1))
  const json = (status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'x-fixture': 'preserved' }); res.end(JSON.stringify(data)) }
  if (endpoint.endsWith('/stalled') || endpoint.endsWith('/is_my_attendance_exempt') || endpoint === '/auth/v1/token') return
  if (endpoint.endsWith('/slow-body')) { res.writeHead(200, { 'content-type': 'application/json' }); res.write('['); return }
  if (endpoint.endsWith('/unavailable')) return json(503, { message: 'fixture unavailable' })
  if (req.method !== 'GET' && req.method !== 'HEAD') return setTimeout(() => json(200, { saved: true }), 90)
  if (endpoint.startsWith('/storage/')) return setTimeout(() => json(200, { downloaded: true }), 90)
  json(200, { value: 42 })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const warn = console.warn
console.warn = (...args) => warnings.push(args)
try {
  const transport = createSupabaseFetch(origin, fetch, 45, 45)
  const read = await transport(`${origin}/rest/v1/ready`)
  assert.equal(read.status, 200)
  assert.equal(read.headers.get('x-fixture'), 'preserved')
  assert.deepEqual(await read.json(), { value: 42 })

  // Requests waiting for headers, and bodies stalled after headers, both end.
  await assert.rejects(transport(`${origin}/rest/v1/stalled`), isSupabaseReadTimeout)
  const body = await transport(`${origin}/rest/v1/slow-body`)
  await assert.rejects(body.json(), isSupabaseReadTimeout)
  await assert.rejects(transport(`${origin}/rest/v1/rpc/is_my_attendance_exempt`, { method: 'POST', body: '{}' }), isSupabaseReadTimeout)
  await assert.rejects(transport(`${origin}/auth/v1/token`, { method: 'POST', body: '{}' }), isSupabaseReadTimeout)
  assert.equal(hits.get('/rest/v1/stalled'), 1)
  assert.equal(hits.get('/rest/v1/rpc/is_my_attendance_exempt'), 1)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(closed.get('/rest/v1/stalled'), 1, 'timeout closes the actual HTTP request')
  assert.equal(closed.get('/rest/v1/slow-body'), 1, 'body timeout closes the actual HTTP stream')

  // Caller cancellation keeps its original reason and is not logged as timeout.
  const abort = new AbortController(), reason = new Error('caller cancellation')
  const cancelled = transport(new Request(`${origin}/rest/v1/stalled`, { signal: abort.signal }))
  setTimeout(() => abort.abort(reason), 10)
  await assert.rejects(cancelled, error => error === reason)
  const alreadyAborted = new AbortController()
  alreadyAborted.abort(reason)
  await assert.rejects(transport(`${origin}/rest/v1/stalled`, { signal: alreadyAborted.signal }), error => error === reason)

  // Mutations, unknown RPCs and files may legitimately outlive a read deadline.
  for (const [endpoint, method] of [
    ['/rest/v1/records', 'POST'], ['/rest/v1/records', 'PATCH'], ['/rest/v1/records', 'DELETE'],
    ['/rest/v1/rpc/save_fixture', 'POST'], ['/rest/v1/rpc/get_unreviewed_write', 'POST'],
    ['/storage/v1/object/fixture', 'POST'], ['/storage/v1/object/fixture', 'GET'],
  ]) {
    const response = await transport(`${origin}${endpoint}`, { method })
    assert.equal(response.status, 200)
    assert.ok(await response.json())
  }
  assert.equal(warnings.length, 4, 'success, caller cancellation and writes leave no delayed timeout warnings')

  // Exercise the actual app factory: SDK GET retry must be disabled there.
  const clientFile = path.join(dir, 'client.mjs')
  await build({ entryPoints: ['src/lib/supabase/client.ts'], outfile: clientFile, bundle: true,
    platform: 'node', format: 'esm', packages: 'external', alias: { '@': path.resolve('src') },
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(origin),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '"fixture-anon"' }, logLevel: 'silent' })
  const { getSupabase } = await import(pathToFileURL(clientFile).href)
  const app = getSupabase()
  const unavailable = await app.from('unavailable').select('*')
  assert.equal(unavailable.status, 503)
  assert.equal(hits.get('/rest/v1/unavailable'), 1, 'one app query produces one HTTP request at SDK level')
  await app.auth.stopAutoRefresh()

  // Even a store wrapping PostgREST's error into Error must not replay a timeout.
  const sdk = createClient(origin, 'fixture-anon', { db: { retry: false },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: transport } })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: shouldRetrySupabaseQuery, retryDelay: 0, gcTime: 0 } } })
  const before = hits.get('/rest/v1/rpc/is_my_attendance_exempt')
  await assert.rejects(queries.fetchQuery({ queryKey: ['timeout'], queryFn: async () => {
    const { data, error } = await sdk.rpc('is_my_attendance_exempt')
    if (error) throw new Error(error.message)
    return data
  } }), isSupabaseReadTimeout)
  assert.equal(hits.get('/rest/v1/rpc/is_my_attendance_exempt'), before + 1)
  let normalAttempts = 0
  await assert.rejects(queries.fetchQuery({ queryKey: ['ordinary-failure'], queryFn: async () => { normalAttempts++; throw new Error('ordinary failure') } }))
  assert.equal(normalAttempts, 2, 'the existing single Query retry remains for ordinary errors')
  queries.clear()
  assert.ok(isSupabaseReadTimeout({ message: 'Error: 서버 응답 시간이 초과됐습니다. 연결 상태를 확인한 뒤 다시 조회해 주세요.' }))
  assert.equal(shouldRetrySupabaseQuery(1, new Error('ordinary failure')), false)

  // Actual auth-js refresh, real production deadline: aborts after its 30s retry
  // window, retains the saved session and releases the lock for later recovery.
  const storageKey = 'fixture-preserved-session'
  const storedSession = { access_token: 'fixture-access', refresh_token: 'fixture-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
    token_type: 'bearer', user: { id: 'fixture-ordinary-employee' } }
  const saved = new Map([[storageKey, JSON.stringify(storedSession)]])
  const storage = { getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }
  const authSdk = createClient(origin, 'fixture-anon', {
    auth: { storage, storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch(origin) }, db: { retry: false },
  })
  await authSdk.auth.initialize()
  const refreshBefore = hits.get('/auth/v1/token') ?? 0
  const refreshStarted = performance.now()
  const refreshed = await authSdk.auth.refreshSession()
  const refreshElapsed = performance.now() - refreshStarted
  assert.equal(hits.get('/auth/v1/token'), refreshBefore + 1, 'SDK must not send a second stalled refresh')
  assert.equal(refreshed.error?.name, 'AuthRetryableFetchError', 'keep a recoverable auth error')
  assert.ok(refreshElapsed >= SUPABASE_AUTH_TIMEOUT_MS - 200 && refreshElapsed < 36_000)
  assert.deepEqual(JSON.parse(saved.get(storageKey)), storedSession, 'a network timeout must not clear the session')
  assert.equal((await authSdk.auth.getSession()).data.session?.user.id, storedSession.user.id, 'SDK lock releases after timeout')
  await authSdk.auth.stopAutoRefresh()

  // Every allowlisted RPC must have a real app call site, not a guessed name.
  const policy = await readFile('src/lib/supabase/request-policy.ts', 'utf8')
  const index = await readFile('dev-tools/structure-map/generated/ai-index.md', 'utf8')
  const offsite = await readFile('src/lib/supabase/offsite-attendance.ts', 'utf8')
  const names = [...policy.match(/SCREEN_READ_RPCS = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map(match => match[1])
  for (const name of names) assert.ok(index.includes(`rpc:${name}`) || offsite.includes(`'${name}'`), `RPC call site missing: ${name}`)
  const appSource = await readFile('src/App.tsx', 'utf8')
  assert.match(appSource, /retry:\s*shouldRetrySupabaseQuery/)
  console.log('PASS supabase-request-policy: actual HTTP/header/body abort; caller cancellation; SDK single request; no timeout replay; normal Query retry; mutations/files preserved; RPC call sites checked; loopback fixtures only')
} finally {
  console.warn = warn
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
