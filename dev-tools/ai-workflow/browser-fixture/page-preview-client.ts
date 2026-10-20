import { getSupabase as general } from './client'
import { getSupabase as usage } from './usage-headers-client'
export const isSupabaseConfigured = () => true
export function getSupabase() {
  if (location.pathname === '/usage-codes') return usage()
  const base = general()
  return { ...base, rpc(name: string, args?: Record<string, unknown>) {
    if (name !== 'list_my_approval_requests') return base.rpc(name, args)
    const data = ['fixture-user', 'other-user'].map((employee_id, index) => ({
      id: `request-${index}`, employee_id, employee_name: index ? '검증 동료' : '화면 검수', department_id: null, department_name: '기획팀',
      kind: 'annual', from_date: '2026-10-20', to_date: '2026-10-20', start_time: '09:00', end_time: '18:00', status: 'pending', created_at: '2026-10-20T00:00:00Z', note: '',
    }))
    const chain = { order: () => chain, range: () => chain, then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) }
    return chain
  } }
}
