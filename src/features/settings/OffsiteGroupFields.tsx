import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOffsiteGroups, refreshOffsiteQueries } from './offsite-group-state'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/supabase/auth'
import { setMyOffsiteStart } from '@/lib/supabase/offsite-groups'
import { OffsiteWorkdayStartField } from './OffsiteWorkdayStartField'
import type { PersonalRequest, RequestForm } from './personal-requests'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'

export function OffsiteGroupHistory() {
  const groups = useOffsiteGroups()
  const { profile } = useAuth()
  return <section className="my-3 space-y-2" aria-label="내가 등록한 단체 외근">{groups.data?.filter(group => group.createdBy === profile?.id).map(group => <details key={group.id} className="rounded-xl border border-border bg-card p-3"><summary className="cursor-pointer text-sm">단체 외근 · {group.participants.length}명 · {new Date(group.createdAt).toLocaleDateString('ko-KR')}</summary><ul className="mt-2 text-sm">{group.participants.map(person => <li key={person.requestId}>{person.name} · {person.state}</li>)}</ul></details>)}</section>
}
export function OffsiteStartEditor({ request, requests, onSaved }: { request: PersonalRequest; requests: PersonalRequest[]; onSaved: () => void }) {
  const groups = useOffsiteGroups()
  const cache = useQueryClient()
  const [draft, setDraft] = useState<RequestForm>({ ...request })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    if (busy || !groups.isSuccess) return
    const trace = startWorkflow('offsite', 'change_workday_start', { configured: Boolean(draft.offsiteWorkStart) })
    setBusy(true); setError('')
    try {
      await trace.run('save', context => setMyOffsiteStart(request.id, draft.offsiteWorkStart, context))
      await trace.run('refresh_queries', () => refreshOffsiteQueries(cache), { writeOutcome: 'committed' })
      onSaved()
      trace.done({ writeOutcome: 'committed' })
    } catch (failure) { trace.fail(failure); setError(failure instanceof Error ? failure.message : '출근 기준을 저장하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <section className="my-3 space-y-2"><OffsiteWorkdayStartField form={draft} requests={requests} onChange={patch => setDraft(current => ({ ...current, ...patch }))}/>{!groups.isSuccess && <p role="status" className="text-sm text-warning">{groups.error?.message ?? '서버 연결 확인 중…'}</p>}<Button type="button" variant="outline" disabled={busy || !groups.isSuccess || draft.offsiteWorkStart === request.offsiteWorkStart} onClick={() => void save()}>{busy ? '저장 중…' : '당일 출근 기준 저장'}</Button>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</section>
}
