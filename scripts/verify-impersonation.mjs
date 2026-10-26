import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { createClient as createSdkClient } from '@supabase/supabase-js'

const operatorId = 'd0000000-0000-4000-8000-000000000001'
const targetId = '10000000-0000-4000-8000-000000000002'
const eventId = '20000000-0000-4000-8000-000000000001'
const warnings = []
const quiet = { ...console, warn: (...args) => warnings.push(args) }
async function compile(file, imports, globals = {}) {
  const source = await readFile(file, 'utf8')
  const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' })
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(imports[name], `허용된 테스트 의존성: ${name}`)
    return imports[name]
  }, console: quiet, Date, Request, Response, Headers, ...globals }, { filename: file })
  return module.exports
}
function makeClient() {
  const values = new Map(), calls = [], moves = []
  const operator = { user: { id: operatorId }, access_token: 'operator-access', refresh_token: 'operator-refresh' }
  const employee = { user: { id: targetId }, access_token: 'employee-access', refresh_token: 'employee-refresh' }
  let session = operator
  const control = { blockedStorage: false, verifyError: false, restoreError: false, wrongTarget: false, deny: false }
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (control.blockedStorage) throw Error('storage disabled'); values.set(key, value) },
    removeItem: key => values.delete(key),
  }
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      verifyOtp: async options => {
        calls.push({ action: 'verify', options })
        if (control.verifyError) return { data: { session: null }, error: { message: 'OTP expired' } }
        session = employee
        return { data: { session }, error: null }
      },
      setSession: async options => {
        calls.push({ action: 'restore', options })
        if (control.restoreError) return { data: { session: null }, error: { message: 'expired' } }
        session = operator
        return { data: { session }, error: null }
      },
      signOut: async options => { calls.push({ action: 'logout', options }); session = null; return { error: null } },
    },
    functions: { invoke: async (_name, options) => {
      calls.push({ ...options.body, headers: options.headers })
      if (control.deny) return { data: null, error: { context: { status: 403, json: async () => ({ error: '허용되지 않은 계정' }) } } }
      const target = { id: control.wrongTarget ? operatorId : targetId, name: '테스트 직원', department: '물류팀', position: '사원' }
      return { data: options.body.action === 'list' ? { targets: [target] } : { tokenHash: 'one-use-hash', eventId, target }, error: null }
    } },
  }
  return { client, control, storage, values, calls, moves, get session() { return session } }
}
async function clientCase() {
  const f = makeClient()
  const api = await compile('src/lib/supabase/impersonation.ts', { '@/lib/supabase/client': { getSupabase: () => f.client } }, {
    localStorage: f.storage, window: { location: { pathname: '/settings/profile', search: '', assign: value => f.moves.push(value), reload: () => f.moves.push('reload') } },
  })
  return { f, api }
}
{
  const { f, api } = await clientCase()
  assert.equal((await api.listImpersonationTargets())[0].id, targetId)
  await api.startImpersonation(targetId, '운영자')
  assert.equal(f.session.user.id, targetId)
  assert.equal(api.readImpersonationState().operatorId, operatorId)
  assert.equal(api.readImpersonationState().employeeAccessToken, 'employee-access')
  assert.equal(f.moves[0], '/')
  assert.equal(await api.returnToOperator({ navigate: false }), 'restored')
  assert.equal(f.session.user.id, operatorId)
  assert.equal(api.readImpersonationState(), null)
  const stop = f.calls.find(call => call.action === 'stop')
  assert.equal(stop.employeeAccessToken, 'employee-access')
  assert.equal(stop.headers.Authorization, 'Bearer operator-access')
  assert.equal(await api.returnToOperator({ navigate: false }), 'restored')
  assert.equal(f.calls.filter(call => call.action === 'stop').length, 1)
}
for (const failure of ['blockedStorage', 'verifyError', 'wrongTarget', 'deny']) {
  const { f, api } = await clientCase()
  f.control[failure] = true
  await assert.rejects(() => api.startImpersonation(targetId, '운영자'))
  assert.equal(f.session.user.id, operatorId, `${failure}: 원래 세션 유지`)
  assert.equal(api.readImpersonationState(), null)
  assert.equal(f.moves.length, 0)
  if (failure === 'blockedStorage' || failure === 'wrongTarget' || failure === 'deny') assert.equal(f.calls.some(call => call.action === 'verify'), false)
}
{
  const { f, api } = await clientCase()
  await api.startImpersonation(targetId, '운영자')
  f.control.restoreError = true
  assert.equal(await api.returnToOperator({ navigate: false }), 'failed')
  assert.equal(f.session, null)
  assert.equal(api.readImpersonationState(), null)
  assert.equal(f.calls.find(call => call.action === 'logout').options.scope, 'local')
}
{
  const { f, api } = await clientCase()
  f.values.set('atelier:impersonation', '{bad json')
  assert.equal(api.readImpersonationState(), null)
  assert.equal(f.values.size, 0)
  await api.startImpersonation(targetId, '운영자')
  await api.startImpersonation(targetId, '직원 이름')
  assert.equal(f.calls.filter(call => call.action === 'restore').length, 1, '재전환 전에 원래 세션 복원')
  assert.equal(api.readImpersonationState().operatorName, '운영자')
}
console.log('impersonation-client: 직원 전환·원래 계정 복귀·재전환·저장소 차단·만료·잘못된 응답·403·복원 실패 로그아웃 통과')

const state = { allowed: true, inactive: false, foreign: false, emailMismatch: false, auditFailure: false, ended: false, revoked: [], generated: 0 }
function resultQuery(table) {
  const filters = {}, query = {
    select() { return query }, eq(key, value) { filters[key] = value; return query }, is() { return query },
    insert() { return query }, update() { state.ended = true; return query },
    maybeSingle: async () => ({ data: table === 'impersonation_operators' ? state.allowed ? { profile_id: operatorId } : null : filters.operator_id === operatorId && filters.id === eventId ? { id: eventId, target_id: targetId, ended_at: state.ended ? '2026-01-01' : null } : null, error: null }),
    single: async () => ({ data: state.auditFailure ? null : { id: eventId }, error: state.auditFailure ? { message: 'audit failed' } : null }),
    then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve) },
  }
  return query
}
const subject = { id: targetId, email: 'staff@example.invalid', display_name: '테스트 직원', company_id: 'e0000000-0000-4000-8000-000000000001' }
const admin = {
  from: resultQuery,
  rpc: async () => ({ data: state.inactive || state.foreign ? [] : [subject], error: null }),
  auth: {
    getUser: async token => ({ data: { user: { id: token === 'employee-access' ? targetId : operatorId } } }),
    admin: {
      getUserById: async () => ({ data: { user: { email: state.emailMismatch ? 'different@example.invalid' : subject.email } }, error: null }),
      generateLink: async () => { state.generated++; return { data: { properties: { hashed_token: 'one-use-hash' } }, error: null } },
      signOut: async (token, scope) => { state.revoked.push({ token, scope }); return { error: null } },
    },
  },
}
let handler
await compile('supabase/functions/impersonate-employee/index.ts', { 'npm:@supabase/supabase-js@2': { createClient: (_url, key) => key === 'service' ? admin : { auth: { getUser: async token => ({ data: { user: token === 'operator-access' ? { id: operatorId } : null }, error: null }) } } } }, {
  Deno: { env: { get: key => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' })[key] }, serve: callback => { handler = callback } },
})
async function request(body, token = 'operator-access') {
  const response = await handler(new Request('https://example.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }))
  return { status: response.status, body: await response.json() }
}
assert.equal((await request({ action: 'list' }, '')).status, 401)
assert.equal((await request({ action: 'list' }, 'forged')).status, 401)
state.allowed = false
assert.equal((await request({ action: 'start', targetId })).status, 403)
state.allowed = true
const list = await request({ action: 'list' })
assert.equal(list.status, 200)
assert.equal('email' in list.body.targets[0], false, '직원 이메일은 목록에 노출하지 않음')
assert.equal((await request({ action: 'start', targetId: 'invalid' })).status, 400)
for (const condition of ['inactive', 'foreign']) {
  state[condition] = true
  assert.equal((await request({ action: 'start', targetId })).status, 404)
  state[condition] = false
}
state.emailMismatch = true
assert.equal((await request({ action: 'start', targetId })).status, 409)
assert.equal(state.generated, 0)
state.emailMismatch = false
state.auditFailure = true
const auditFailed = await request({ action: 'start', targetId })
assert.equal(auditFailed.status, 500)
assert.equal(auditFailed.body.tokenHash, undefined, '감사 기록 실패 시 세션 링크 비노출')
state.auditFailure = false
assert.equal((await request({ action: 'start', targetId })).body.tokenHash, 'one-use-hash')
assert.equal((await request({ action: 'stop', eventId: targetId, employeeAccessToken: 'employee-access' })).status, 404)
await request({ action: 'stop', eventId, employeeAccessToken: 'employee-access' })
assert.deepEqual(state.revoked, [{ token: 'employee-access', scope: 'local' }], '전환 직원의 해당 세션만 폐기')
await request({ action: 'stop', eventId, employeeAccessToken: 'employee-access' })
assert.equal(state.revoked.length, 1, '반복 종료는 추가 폐기 없음')
console.log('impersonation-edge: 익명·위조·일반 직원 차단·회사/활성 제한·이메일 검증·감사 실패 차단·전환 세션만 local 폐기·반복 종료 통과 (운영 DB 변경 없음)')

// 실제 SDK가 getUser(jwt)와 admin.signOut(jwt)에 보낸 헤더를 검사한다.
// service role 강제 fetch를 되살리면 직원 JWT가 덮여 이 검증이 실패한다.
const authRequests = []
async function sdkFetch(input, options) {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const token = new Headers(options?.headers).get('Authorization')
  let body, status = 200
  if (url.pathname === '/auth/v1/user') {
    authRequests.push({ path: 'user', token })
    if (token === 'Bearer operator-access') body = { id: operatorId }
    else if (token === 'Bearer employee-access') body = { id: targetId }
    else { status = 401; body = { msg: 'invalid token' } }
  } else if (url.pathname === '/auth/v1/logout') {
    authRequests.push({ path: 'logout', token, scope: url.searchParams.get('scope') })
    status = token === 'Bearer employee-access' ? 204 : 401
    body = status === 204 ? null : { msg: 'invalid token' }
  } else if (url.pathname.endsWith('/impersonation_operators')) body = [{ profile_id: operatorId }]
  else if (url.pathname.endsWith('/impersonation_events')) body = options?.method === 'PATCH' ? null : [{ id: eventId, target_id: targetId, ended_at: null }]
  else throw Error(`예상하지 않은 SDK URL: ${url.pathname}`)
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
await compile('supabase/functions/impersonate-employee/index.ts', {
  'npm:@supabase/supabase-js@2': { createClient: (url, key, options) => createSdkClient(url, key, { ...options, global: { ...options.global, fetch: options.global?.fetch ?? sdkFetch } }) },
}, { fetch: sdkFetch, Deno: { env: { get: key => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' })[key] }, serve: callback => { handler = callback } } })
const sdkStop = await request({ action: 'stop', eventId, employeeAccessToken: 'employee-access' })
assert.equal(sdkStop.status, 200)
assert.equal(sdkStop.body.revoked, true)
assert.ok(authRequests.some(row => row.path === 'user' && row.token === 'Bearer employee-access'))
assert.ok(authRequests.some(row => row.path === 'logout' && row.token === 'Bearer employee-access' && row.scope === 'local'))
console.log('impersonation-sdk: 실제 Supabase SDK의 직원 JWT 유지·해당 세션 local 폐기 요청 통과')
