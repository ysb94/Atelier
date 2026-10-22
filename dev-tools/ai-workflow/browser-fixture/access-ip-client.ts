import { getSupabase as authFixture } from './auth-recovery-client'
const base = authFixture() as any
const params = new URLSearchParams(location.search)
const denied = params.has('denied')
const state = { calls: [] as string[], rpcCalls: [] as string[], updates: [] as unknown[], queries: [] as string[], reviews: [] as any[], rerender: () => {} }
Object.assign(window, { __accessIpTest: state })
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
const records = Array.from({ length: 51 }, (_, i) => ({ id: `event-${i}`, user_id: 'staff', person_name: `검증 직원 ${i}`, event_kind: i % 2 ? 'clock_in_request' : 'login', ip_address: '203.0.113.9', ip_source: 'cf-connecting-ip', created_at: `${day}T09:00:00+09:00` }))
export function isSupabaseConfigured() { return true }
export function getSupabase() { return client as never }
const client = {
  ...base,
  auth: { ...base.auth, async getSession() { const r = await base.auth.getSession(); return { ...r, data: { session: { ...r.data.session, access_token: 'fixture-token' } } } } },
  functions: { async invoke(_name: string, { body }: any) {
    state.calls.push(body.kind)
    if (params.has('hanging')) return new Promise(() => {})
    return params.has('record-error') ? { data: null, error: { message: '검증용 기록 실패' } } : { data: { ok: true }, error: null }
  } },
  async rpc(name: string) { state.rpcCalls.push(name); return { data: '09:01:00', error: null } },
  from(table: string) {
    if (!['access_ip_reviewers', 'access_ip_events', 'office_ip_reviews', 'attendance_clock_ins'].includes(table)) return base.from(table)
    state.queries.push(table)
    let first = 0, last = 50, kind = '', patch: any
    const query = {
      select() { return query }, limit() { return query }, in() { return query },
      eq(key: string, value: string) { if (key === 'event_kind') kind = value; return query },
      gte() { return query }, lt() { return query }, order() { return query },
      range(start: number, end: number) { first = start; last = end; return query },
      upsert(value: any) { patch = value; return query },
      then(resolve: (value: unknown) => void) {
        if (patch) {
          if (params.has('save-error')) return Promise.resolve({ data: null, error: { message: '검증용 저장 실패' } }).then(resolve)
          state.updates.push(patch)
          state.reviews = [{ ...patch, reviewed_at: new Date().toISOString() }]
        }
        const data = table === 'access_ip_reviewers' ? denied ? [] : [{ profile_id: 'owner' }]
          : table === 'access_ip_events' ? records.filter(row => !kind || row.event_kind === kind).slice(first, last + 1)
          : table === 'office_ip_reviews' ? state.reviews : []
        return Promise.resolve({ data, error: null }).then(resolve)
      },
    }
    return query
  },
}
