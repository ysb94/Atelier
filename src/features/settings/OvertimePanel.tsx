import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { useLeaveRequests } from '@/features/operations-support/use-leave-requests'
import { useDepartmentApprovers } from '@/features/operations-support/use-department-approvers'
import { useOpsDirectory } from '@/features/operations-support/ops-directory'
import { DEFAULT_REMINDER_BASIS, dateLabel, validateRequest, type RequestForm } from './personal-requests'
import { koreaDateKey } from './my-attendance'
import { OvertimeTimeFields } from './RequestTimeFields'

const STATUS_LABELS = { pending: '승인 대기', approved: '승인', rejected: '반려', cancelled: '취소' }

function overtimeForm(day: string): RequestForm {
  return { kind: 'overtime', from: day, to: day, start: '18:00', end: '21:00', place: '', note: '' }
}

export function OvertimePanel() {
  useRenderWatch('OvertimePanel')
  const { session, profile } = useAuth()
  const allowed = Boolean(session?.user.id) && profile?.status === 'active'
  const today = koreaDateKey()
  const leave = useLeaveRequests()
  const approvals = useDepartmentApprovers()
  const directory = useOpsDirectory()
  const [form, setForm] = useState<RequestForm | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const rows = useMemo(
    () => leave.requests.filter(item => item.kind === 'overtime').sort((left, right) => right.from.localeCompare(left.from) || right.createdAt.localeCompare(left.createdAt)),
    [leave.requests],
  )
  const route = useMemo(() => {
    if (approvals.loading || directory.loading) return '승인 담당자 확인 중…'
    if (approvals.error || directory.error) return '승인 담당자를 불러오지 못했습니다.'
    const setting = approvals.settings.find(item => item.departmentId === profile?.departmentId && item.type === 'overtime')
    const names = [setting?.approverId, setting?.substituteId].filter(id => id && id !== leave.userId)
      .map(id => directory.members.find(member => member.id === id)?.displayName).filter(Boolean)
    return names.length ? `야근 승인자 · ${names.join(' / ')}` : '야근 승인자 미지정 · 운영지원에 담당자 설정을 요청해 주세요.'
  }, [approvals.error, approvals.loading, approvals.settings, directory.error, directory.loading, directory.members, leave.userId, profile?.departmentId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form || leave.busy) return
    const message = validateRequest(form, leave.requests, DEFAULT_REMINDER_BASIS, today)
    if (message) { setError(message); return }
    try {
      await leave.create.mutateAsync(form)
      setForm(null)
      setNotice('야근 신청을 저장했습니다. 야근 승인자가 처리하면 반영됩니다.')
    } catch (caught) {
      console.warn('[leave-requests] 야근 신청 실패', caught)
      setError(caught instanceof Error ? caught.message : '야근 신청을 저장하지 못했습니다.')
    }
  }

  async function cancel(id: string) {
    setError('')
    try {
      await leave.transition.mutateAsync({ id, status: 'cancelled' })
      setNotice('야근 신청을 취소했습니다.')
    } catch (caught) {
      console.warn('[leave-requests] 야근 신청 취소 실패', caught)
      setError(caught instanceof Error ? caught.message : '야근 신청을 취소하지 못했습니다.')
    }
  }

  return <section className="personal-requests" aria-label="야근">
    <div className="personal-request-draft-row">
      <div className="personal-request-draft"><strong>야근</strong><span>야근은 근태 신청과 따로 관리합니다. 신청하면 야근 승인자가 처리합니다.</span></div>
      <Button type="button" size="sm" disabled={!allowed || leave.busy} onClick={() => { setForm(overtimeForm(today)); setError(''); setNotice('') }}><Plus size={14}/>야근 신청</Button>
    </div>
    {!allowed && <p role="status" className="personal-request-error">활성 직원 계정으로 로그인해 주세요.</p>}
    {leave.error && <p role="alert" className="personal-request-error">야근 목록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void leave.refresh()}>다시 불러오기</Button></p>}
    {notice && <p className="personal-request-notice" role="status">{notice}</p>}
    {error && !form && <p role="alert" className="personal-request-error">{error}</p>}
    <section className="personal-request-board">
      <div className="personal-request-list">
        <table>
          <caption className="sr-only">내 야근 신청</caption>
          <thead><tr><th scope="col">날짜</th><th scope="col">시간</th><th scope="col">사유</th><th scope="col">상태</th><th scope="col">관리</th></tr></thead>
          <tbody>
            {leave.loading ? <tr><td colSpan={5}>불러오는 중…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={5}>신청한 야근이 없습니다.</td></tr>
              : rows.map(item => <tr key={item.id}>
                <th scope="row">{dateLabel(item.from)}</th>
                <td>{item.start}–{item.end}</td>
                <td>{item.note || '—'}</td>
                <td>{STATUS_LABELS[item.status]}</td>
                <td>{item.status === 'pending' ? <Button type="button" variant="outline" size="sm" disabled={leave.busy} onClick={() => void cancel(item.id)}>취소</Button> : '—'}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </section>
    {form && <OvertimeDialog form={form} busy={leave.busy} error={error} route={route} onChange={next => { setForm(next); setError('') }} onClose={() => { if (!leave.busy) setForm(null) }} onSubmit={event => void submit(event)} />}
  </section>
}

function OvertimeDialog({ form, busy, error, route, onChange, onClose, onSubmit }: {
  form: RequestForm
  busy: boolean
  error: string
  route: string
  onChange: (form: RequestForm) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <WorkspaceTabOverlay><dialog ref={ref} aria-labelledby="overtime-request-title" className="personal-request-overlay" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="personal-request-compose">
      <header><div><span>야근</span><h2 id="overtime-request-title">야근 신청</h2></div><button type="button" aria-label="야근 신청 닫기" disabled={busy} onClick={onClose}><X size={19}/></button></header>
      <form onSubmit={onSubmit}><fieldset disabled={busy} className="min-w-0 border-0 p-0">
        <div className="personal-request-compose-body">
          <label>날짜<Input aria-label="야근 날짜" type="date" value={form.from} onChange={event => onChange({ ...form, from: event.target.value, to: event.target.value })}/></label>
          <OvertimeTimeFields start={form.start} end={form.end} onChange={patch => onChange({ ...form, ...patch })} />
          <label>신청 사유 · 필수<Textarea maxLength={2000} aria-label="야근 사유" value={form.note} rows={3} placeholder="예정된 야근 업무를 적어 주세요." onChange={event => onChange({ ...form, note: event.target.value })}/></label>
          <div className="personal-request-approval-route"><span>승인 경로</span><strong>{route}</strong><p>신청자의 화면에서는 본인 신청을 승인할 수 없습니다.</p></div>
          {error && <p role="alert" className="personal-request-error">{error}</p>}
        </div>
        <footer><Button type="button" variant="outline" onClick={onClose}>닫기</Button><Button type="submit" disabled={busy}><Send size={14}/>{busy ? '저장 중…' : '신청하기'}</Button></footer>
      </fieldset></form>
    </section>
  </dialog></WorkspaceTabOverlay>
}
