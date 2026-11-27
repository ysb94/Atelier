import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { useHolidayWork } from '@/features/operations-support/use-holiday-work'
import {
  holidayCredit, holidayTime, HOLIDAY_COMPENSATION_METHODS, HOLIDAY_LOCATIONS,
  type HolidayCompensationChoice, type HolidayWorkConfirmation,
} from '@/features/operations-support/holiday-work'
import { useHolidayConfirmationRequests, useReadMyHomeNotification, type HolidayConfirmationRequest } from './use-my-home-notifications'
import { dateLabel } from './personal-requests'

const confirmationDateLabel = (date: string) => `${date.slice(0, 4)}년 ${dateLabel(date)}`

export function HolidayWorkConfirmationHeaderButton() {
  const active = useWorkspaceTabActivity()
  const requests = useHolidayConfirmationRequests(active)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [success, setSuccess] = useState('')
  const selected = requests.find(item => item.event_key === selectedKey)

  function finish(choice: HolidayCompensationChoice | 'correction') {
    setSelectedKey(null)
    setSuccess(choice === 'correction' ? '근무정보 정정 요청을 제출했습니다.' : '휴일근무 보상 확인서를 제출했습니다.')
  }

  return <>
    {(requests.length > 0 || success) && <div className="flex flex-col items-center gap-1">
      {requests.length > 0 && <Button type="button" size="lg" className="px-7 text-base font-semibold shadow-none"
        aria-haspopup="dialog" onClick={() => { setSuccess(''); setSelectedKey(requests[0].event_key) }}>
        휴일근무 보상 확인서 작성{requests.length > 1 ? ` (${requests.length})` : ''}
      </Button>}
      {success && <span className="text-center text-xs text-success" role="status">{success}</span>}
    </div>}
    {selected && <WorkspaceTabOverlay><ConfirmationDialog requests={requests} selected={selected}
      choose={setSelectedKey} close={() => setSelectedKey(null)} finish={finish} /></WorkspaceTabOverlay>}
  </>
}

function ConfirmationDialog({ requests, selected, choose, close, finish }: {
  requests: readonly HolidayConfirmationRequest[]; selected: HolidayConfirmationRequest; choose: (key: string) => void
  close: () => void; finish: (choice: HolidayCompensationChoice | 'correction') => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => { if (element?.open) element.close() }
  }, [])

  return <dialog ref={dialog} aria-labelledby={title}
    onCancel={event => { event.preventDefault(); close() }}
    className="m-auto max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-[794px] overflow-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40">
    <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-8">
      <h2 id={title} className="text-lg font-semibold leading-tight sm:text-xl">주말·휴일근로 보상방법 선택 및 확인서</h2>
      <Button type="button" size="sm" variant="outline" onClick={close}>닫기</Button>
    </header>
    {requests.length > 1 && <fieldset className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-8" aria-label="확인할 근무일">
      {requests.map(request => <Button key={request.event_key} type="button" size="sm" variant={request.event_key === selected.event_key ? 'default' : 'outline'}
        aria-pressed={request.event_key === selected.event_key} onClick={() => choose(request.event_key)}>{confirmationDateLabel(request.from_date)}</Button>)}
    </fieldset>}
    <ConfirmationDetail key={selected.event_key} request={selected} finish={finish} />
  </dialog>
}

function ConfirmationDetail({ request, finish }: {
  request: HolidayConfirmationRequest; finish: (choice: HolidayCompensationChoice | 'correction') => void
}) {
  const work = useHolidayWork(request.from_date.slice(0, 7), 'mine', undefined, true)
  const row = work.rows.find(item => item.id === request.entity_id)
  const confirmation = row?.confirmation
  const current = Boolean(work.isFetchedAfterMount && !work.error && work.data?.confirmationWorkflow && row?.state === 'approved' &&
    confirmation && !confirmation.choice && Date.parse(confirmation.requestedAt) <= Date.parse(request.created_at))
  const read = useReadMyHomeNotification('request', request.entity_id, request.event_key, current)

  return <div className="space-y-4 px-4 py-5 sm:px-8">
    {work.error ? <p role="alert" className="text-sm text-danger">확인서를 불러오지 못했습니다. <Button type="button" size="sm" variant="outline" onClick={() => void work.refetch()}>다시 조회</Button></p>
      : !work.isFetchedAfterMount || work.isPending ? <p role="status" className="text-sm">확인서를 불러오는 중입니다.</p>
      : current && row?.id && confirmation ? <CompensationForm
        confirmation={confirmation} canCorrect={row.settlements.length === 0}
        submit={async (choice, reason) => {
          await work.save.mutateAsync({ action: 'confirmation-respond', payload: { workId: row.id, confirmationId: confirmation.id, choice, reason } })
          finish(choice)
        }} />
      : <p role="status" className="text-sm">이미 처리됐거나 확인서가 변경되었습니다. 상단에서 진행 중인 건을 다시 확인해 주세요.</p>}
    {current && read.error && <p role="alert" className="text-sm text-danger">{read.error} <Button type="button" size="sm" variant="outline" onClick={read.retry}>읽음 저장 재시도</Button></p>}
  </div>
}

function CompensationForm({ confirmation, canCorrect, submit }: {
  confirmation: HolidayWorkConfirmation; canCorrect: boolean
  submit: (choice: HolidayCompensationChoice | 'correction', reason: string) => Promise<void>
}) {
  const { work, allowLeave } = confirmation
  const [choice, setChoice] = useState<HolidayCompensationChoice | 'correction' | ''>('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const valid = choice && (choice !== 'correction' || reason.trim()) && (choice !== 'leave' || allowLeave)
  const facts = [
    ['성명', work.name], ['소속', work.department], ['직급', work.grade], ['근무일', confirmationDateLabel(work.date)],
    ['근무 구간', work.intervals.map(interval => `${holidayTime(interval.start)}~${holidayTime(interval.end)}`).join(' / ')],
    ['근무 장소', HOLIDAY_LOCATIONS[work.location]], ['실제 근무시간', holidayCredit(work.actualMinutes * 2)],
    ['가산 보상시간', holidayCredit(work.creditUnits)],
  ]

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!choice || !valid || saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try { await submit(choice, reason.trim()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '확인서를 제출하지 못했습니다.') }
    finally { saving.current = false; setBusy(false) }
  }

  return <form className="space-y-4" onSubmit={event => void save(event)} aria-label="주말·휴일근로 보상방법 확인서">
    <section aria-label="근로내역">
      <h3 className="mb-2 font-semibold">근로내역</h3>
      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        {facts.map(([label, value]) => <div key={label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] bg-card text-sm">
          <dt className="break-keep bg-muted px-3 py-2 font-medium">{label}</dt>
          <dd className="break-words px-3 py-2">{value || '—'}</dd>
        </div>)}
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] bg-card text-sm sm:col-span-2">
          <dt className="bg-muted px-3 py-2 font-medium">근무 사유</dt>
          <dd className="whitespace-pre-wrap break-words px-3 py-2">{work.reason}</dd>
        </div>
        {work.remainingUnits !== work.creditUnits && <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] bg-card text-sm sm:col-span-2">
          <dt className="bg-muted px-3 py-2 font-medium">이번 정산 대상</dt><dd className="px-3 py-2">{holidayCredit(work.remainingUnits)}</dd>
        </div>}
      </dl>
    </section>
    <fieldset disabled={busy} className="space-y-2">
      <legend className="mb-2 font-semibold">보상방법 선택</legend>
      <div className="flex flex-wrap gap-2">
        {(['cash', 'leave'] as const).map(method => <label key={method}
          className="flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm has-checked:border-primary has-disabled:opacity-50">
          <input type="radio" name="holiday-compensation" checked={choice === method} disabled={method === 'leave' && !allowLeave} onChange={() => setChoice(method)} />
          {HOLIDAY_COMPENSATION_METHODS[method]}
        </label>)}
      </div>
      {!allowLeave && <p className="text-xs text-muted-foreground">이 근무 건은 가산임금 지급으로 제출할 수 있습니다.</p>}
      {canCorrect && <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="holiday-compensation" checked={choice === 'correction'} onChange={() => setChoice('correction')} />근무정보 정정 요청
      </label>}
      {choice === 'correction' && <label className="block text-sm">정정 사유<Textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <span className="text-sm">제출자 <strong>{work.name}</strong></span>
      <Button type="submit" disabled={busy || !valid}>{busy ? '제출 중…' : '제출'}</Button>
    </footer>
  </form>
}
