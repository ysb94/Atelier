import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { isOperationsDepartmentMember } from '@/lib/company/capabilities'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import { useAuth } from '@/lib/supabase/auth'
import { readLateAppeal, refreshLateAppeals, reviewLateAppeal, submitLateAppeal, useLateAppeals, type LateArrivalAppeal } from '@/lib/supabase/late-arrival-appeals'

const STATUS_LABEL = { pending: '처리 대기', corrected: '지각 제외', kept: '기존 판정 유지' } as const

export function LateArrivalAppealEntry({ date }: { date: string }) {
  const { profile } = useAuth()
  const preview = usePagePreview()
  const cache = useQueryClient()
  const query = useLateAppeals(!preview?.active, undefined, 30_000)
  const own = query.data?.rows.find(row => !row.can_review && row.work_date === date)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const guard = useRef(false)

  async function submit() {
    if (guard.current || !reason.trim() || preview?.active || profile?.status !== 'active') return
    guard.current = true
    setBusy(true)
    setError('')
    try {
      await submitLateAppeal(date, reason.trim())
      await refreshLateAppeals(cache)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '이의신청을 제출하지 못했습니다.')
      void query.refetch()
    } finally {
      guard.current = false
      setBusy(false)
    }
  }

  if (preview?.active) return null
  return <section className="space-y-2 border-b border-border bg-card px-4 py-3 text-sm" aria-label="지각 이의신청">
    {own ? <p role="status">지각 이의신청 · {STATUS_LABEL[own.status]}{own.status === 'pending' && ' · 운영지원에 전달했습니다.'}</p>
      : <div className="flex flex-wrap items-center justify-between gap-2">
          <p>지각이 아닌 경우 운영지원에 이의신청할 수 있습니다.</p>
          <Button type="button" variant="outline" size="sm" disabled={!query.data?.supported || busy} onClick={() => setOpen(value => !value)} aria-expanded={open}>이의신청</Button>
        </div>}
    {!own && query.data?.supported === false && <p className="text-muted-foreground">이의신청 서버 연결 대기</p>}
    {query.isError && <button type="button" className="text-danger underline" onClick={() => void query.refetch()}>이의신청 조회 실패 · 다시 조회</button>}
    {!own && open && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void submit() }}>
      <label className="block space-y-1"><span>이의신청 사유</span><Textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={300} required disabled={busy} /></label>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>취소</Button>
        <Button type="submit" size="sm" disabled={busy || !reason.trim()}>{busy ? '제출 중…' : '이의신청 제출'}</Button>
      </div>
    </form>}
  </section>
}

export function LateArrivalAppealsQueue() {
  const { profile } = useAuth()
  const preview = usePagePreview()
  const active = useNotificationDetailVisibility()
  const [, setParams] = useSearchParams()
  const enabled = active && !preview?.active && isOperationsDepartmentMember(profile)
  const appeals = useLateAppeals(enabled, undefined, 30_000)
  const pending = appeals.data?.rows.filter(row => row.can_review && row.status === 'pending') ?? []
  if (!enabled || (!pending.length && !appeals.isError)) return null
  return <section className="rounded-xl border border-border bg-card px-4 py-3" aria-label="처리할 지각 이의신청">
    <h3 className="text-sm font-semibold">지각 이의신청 {pending.length}건</h3>
    {appeals.isError && <Button size="sm" variant="outline" onClick={() => void appeals.refetch()}>조회 다시 시도</Button>}
    <ul className="mt-2 divide-y divide-border">
      {pending.map(row => <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
        <span>{row.employee_name || '직원'} · {row.work_date} · {row.minutes}분</span>
        <Button type="button" size="sm" variant="outline" onClick={() => setParams(current => {
          const next = new URLSearchParams(current)
          next.set('lateAppeal', row.id)
          return next
        }, { replace: true })}>상세 보기</Button>
      </li>)}
    </ul>
  </section>
}

function LateAppealDetail({ row }: { row: LateArrivalAppeal }) {
  const cache = useQueryClient()
  const [exclude, setExclude] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const guard = useRef(false)
  async function save() {
    if (exclude === null || !note.trim() || guard.current) return
    guard.current = true
    setBusy(true)
    setError('')
    try {
      await reviewLateAppeal(row, exclude, note.trim())
      await refreshLateAppeals(cache, true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.')
      void refreshLateAppeals(cache, true)
    } finally {
      guard.current = false
      setBusy(false)
    }
  }
  return <>
    <p className="text-sm">{row.employee_name || '직원'} · {row.work_date} · {STATUS_LABEL[row.status]}</p>
    <p className="text-sm text-muted-foreground">신청 당시 기준 {row.baseline} · 실제 출근 {row.actual} · 지각 {row.minutes}분</p>
    <div className="space-y-1"><h3 className="text-sm font-medium">이의신청 사유</h3><p className="whitespace-pre-wrap break-words rounded-md border border-border p-3 text-sm">{row.reason}</p></div>
    {row.review_note && <div className="space-y-1"><h3 className="text-sm font-medium">운영지원 처리 사유</h3><p className="whitespace-pre-wrap break-words text-sm">{row.review_note}</p></div>}
    {row.can_review && row.status === 'pending' && (exclude === null
      ? <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => { setExclude(true); setNote(row.reason) }}>수정</Button>
          <Button type="button" variant="outline" onClick={() => { setExclude(false); setNote('') }}>판정 유지</Button>
        </div>
      : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save() }}>
          <label className="block space-y-1 text-sm"><span>처리 사유</span><Textarea aria-label="처리 사유" value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={300} required disabled={busy} /></label>
          {exclude && <p className="text-sm text-muted-foreground">지각 집계에서 제외하며 실제 출퇴근 기록은 보존합니다.</p>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setExclude(null); setError('') }}>취소</Button>
            <Button type="submit" disabled={busy || !note.trim()}>{busy ? '저장 중…' : exclude ? '지각 제외 저장' : '판정 유지 저장'}</Button>
          </div>
        </form>)}
  </>
}

export function LateArrivalAppealNoticeDialog() {
  const cache = useQueryClient()
  const { profile, session } = useAuth()
  const preview = usePagePreview()
  const active = useNotificationDetailVisibility()
  const [params, setParams] = useSearchParams()
  const id = params.get('lateAppeal')
  const enabled = Boolean(id && active && !preview?.active && profile?.status === 'active' && profile.id === session?.user.id)
  const query = useLateAppeals(enabled, id ?? undefined, 30_000)
  const row = query.data?.rows[0]
  const event = row?.event_key
  const received = row?.read_at
  const [failedRead, setFailedRead] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!enabled || !id || !event || received) return
    let mounted = true
    void readLateAppeal(id, event).then(() => refreshLateAppeals(cache)).then(() => {
      if (mounted) setFailedRead(null)
    }).catch(() => { if (mounted) setFailedRead(event) })
    return () => { mounted = false }
  }, [enabled, id, event, received, retry, cache])
  if (!enabled) return null
  function close() {
    setParams(current => { const next = new URLSearchParams(current); next.delete('lateAppeal'); return next }, { replace: true })
  }
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-background/75 p-4" role="dialog" aria-modal="true" aria-label="지각 이의신청 상세">
    <section className="max-h-[90dvh] w-full max-w-lg space-y-3 overflow-auto rounded-xl border border-border bg-card p-5 shadow-sm">
      <header className="flex items-center justify-between gap-3"><h2 className="font-semibold">지각 이의신청</h2><Button type="button" size="sm" variant="outline" onClick={close}>닫기</Button></header>
      {query.isPending ? <p role="status">불러오는 중입니다.</p> : row
        ? <LateAppealDetail key={`${profile?.id}:${row.id}:${row.status}`} row={row} />
        : <p role="alert">{query.data?.supported === false ? '이의신청 서버 연결 대기' : '이의신청을 확인할 수 없습니다.'}</p>}
      {failedRead && failedRead === event && !received && <Button type="button" size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>읽음 저장 다시 시도</Button>}
    </section>
  </div>
}
