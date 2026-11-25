import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { downloadHolidayConfirmationFile, uploadHolidayConfirmationFile } from '@/lib/supabase/holiday-work'
import { useAuth } from '@/lib/supabase/auth'
import type { HolidaySave } from './HolidayWorkEditor'
import { holidayCredit, holidayTime, HOLIDAY_COMPENSATION_METHODS, HOLIDAY_LOCATIONS, type HolidayConfirmationWork, type HolidayWork, type HolidayWorkConfirmation } from './holiday-work'
import { renderHolidayConfirmation } from './holiday-work-confirmation-print'

function workDetails(row: HolidayWork): HolidayConfirmationWork {
  return {
    name: row.employeeName, department: row.departmentName, grade: row.jobGrade ?? null, date: row.date, location: row.location,
    intervals: row.intervals, actualMinutes: row.actualMinutes ?? 0, creditUnits: row.creditUnits ?? 0,
    remainingUnits: row.remainingUnits, reason: row.reason,
  }
}

function WorkDetails({ work }: { work: HolidayConfirmationWork }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
    <dt>직원</dt><dd>{[work.name, work.department, work.grade].filter(Boolean).join(' · ')}</dd>
    <dt>근무일</dt><dd>{work.date} · {HOLIDAY_LOCATIONS[work.location]}</dd>
    <dt>근무 구간</dt><dd>{work.intervals.map(interval => `${holidayTime(interval.start)}~${holidayTime(interval.end)}`).join(' / ')}</dd>
    <dt>근무시간</dt><dd>실제 {holidayCredit(work.actualMinutes * 2)} · 가산 반영 {holidayCredit(work.creditUnits)}</dd>
    {work.remainingUnits !== work.creditUnits && <><dt>정산 대상</dt><dd>잔여 {holidayCredit(work.remainingUnits)}</dd></>}
    <dt>근무 사유</dt><dd className="whitespace-pre-wrap break-words">{work.reason}</dd>
  </dl>
}

function PrintConfirmation({ confirmation }: { confirmation: HolidayWorkConfirmation }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [preview, setPreview] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  return <div className="space-y-2">
    {preview ? <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!ready} onClick={() => {
          const target = frame.current?.contentWindow
          if (!target) return
          try { target.focus(); target.print() } catch { setError('인쇄창을 열지 못했습니다. 다시 시도해 주세요.') }
        }}>인쇄</Button>
        <Button type="button" variant="outline" onClick={() => { setPreview(false); setReady(false); setError('') }}>미리보기 닫기</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <iframe ref={frame} title="주말·휴일근로 보상방법 선택 및 확인서 미리보기"
        sandbox="allow-same-origin allow-modals" srcDoc={renderHolidayConfirmation(confirmation)}
        onLoad={event => setReady(Boolean(event.currentTarget.contentDocument?.querySelector('article')))}
        className="h-[65dvh] w-full rounded-lg border border-border bg-white" />
    </> : <Button type="button" variant="outline" onClick={() => setPreview(true)}>확인서 출력</Button>}
  </div>
}

export function HolidayWorkConfirmationPanel({ row, scope, offlineCompensation, save }: {
  row: HolidayWork; scope: 'mine' | 'operations'; offlineCompensation: boolean; save: HolidaySave
}) {
  const { profile } = useAuth()
  const confirmation = row.confirmation
  const work = confirmation?.work ?? workDetails(row)
  const operations = scope === 'operations'
  const [allowLeave, setAllowLeave] = useState(false)
  const [reason, setReason] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [verified, setVerified] = useState(false)
  const [returning, setReturning] = useState(false)
  const [uploaded, setUploaded] = useState<{ file: File; path: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  if (!row.id || row.legacySettled || (!confirmation && (!operations || !row.canSettle || row.remainingUnits <= 0))) return null
  const canEnableLeave = operations && offlineCompensation && row.state === 'approved' && row.canSettle &&
    Boolean(confirmation && !confirmation.choice && !confirmation.allowLeave) && row.settlements.length === 0

  async function run(action: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '처리하지 못했습니다. 다시 시도해 주세요.') }
    finally { setBusy(false); running.current = false }
  }

  return <section className="space-y-3 rounded-lg border border-border p-3" aria-label="주말·휴일근로 보상방법 확인서">
    <h4 className="font-semibold">주말·휴일근로 보상방법 선택 및 확인서</h4>
    <WorkDetails work={work} />
    {!confirmation ? <fieldset disabled={busy} className="space-y-2">
      {offlineCompensation && <label className="block text-sm">직원에게 제공할 보상방법
        <Select value={allowLeave ? 'both' : 'cash'} onChange={event => setAllowLeave(event.target.value === 'both')}>
          <option value="cash">가산임금 지급</option><option value="both">가산임금 지급 또는 보상휴가 부여</option>
        </Select>
      </label>}
      {allowLeave && offlineCompensation && <p className="text-xs text-muted-foreground">오프라인으로 확인한 기준이 이 근무일에 적용되는 경우에 선택해 주세요.</p>}
      <Button type="button" onClick={() => void run(() => save('confirmation-request', { workId: row.id, version: row.version,
        ...(offlineCompensation && allowLeave ? { leaveAuthorized: true } : {}) }))}>직원에게 확인 요청</Button>
    </fieldset> : row.state !== 'approved' ? <p role="status" className="whitespace-pre-wrap text-sm">{confirmation.correctionReason ?? row.reviewNote ?? '근무정보 정정 중'}</p>
      : !confirmation.choice ? <>
        <p role="status" className="text-sm">{operations ? '직원 제출 대기' : 'My home 상단의 휴일근무 보상 확인서에서 보상방법을 제출해 주세요.'}</p>
        {canEnableLeave && <fieldset disabled={busy} className="space-y-2">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowLeave} onChange={event => setAllowLeave(event.target.checked)} />이 근무일에 보상휴가 선택을 허용합니다.</label>
          <Button type="button" variant="outline" disabled={!allowLeave} onClick={() => void run(() => save('confirmation-request', {
            workId: row.id, version: row.version, confirmationId: confirmation.id, leaveAuthorized: true,
          }))}>선택 범위 변경</Button>
        </fieldset>}
      </>
      : confirmation.choice === 'correction' ? <p role="status" className="whitespace-pre-wrap text-sm">정정 요청 제출 · {confirmation.correctionReason}</p>
      : <>
        <p className="text-sm"><strong>{HOLIDAY_COMPENSATION_METHODS[confirmation.choice]}</strong> · {row.remainingUnits === 0 ? '정산 확정' : confirmation.signedAt ? '서명본 등록 완료' : '운영지원 확인 대기'}</p>
        {operations && <PrintConfirmation confirmation={confirmation} />}
        {operations && (confirmation.signedPath ? <Button type="button" variant="outline" disabled={busy}
          onClick={() => void run(() => downloadHolidayConfirmationFile(confirmation.signedPath!))}>서명본 받기</Button>
          : <fieldset disabled={busy} className="space-y-2">
            <label className="block text-sm">서명본<Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} />직원과 회사의 서명 및 선택 내용을 확인했습니다.</label>
            <Button type="button" variant="outline" disabled={!file || !verified || !profile?.companyId} onClick={() => void run(async () => {
              if (!file || !profile?.companyId) return
              const path = uploaded?.file === file ? uploaded.path : await uploadHolidayConfirmationFile(profile.companyId, confirmation.id, file)
              setUploaded({ file, path })
              await save('confirmation-file', { workId: row.id, confirmationId: confirmation.id, path, verified })
            })}>서명본 등록</Button>
          </fieldset>)}
      </>}
    {operations && confirmation && row.state === 'approved' && row.settlements.length === 0 && <fieldset disabled={busy} className="space-y-2">
      {returning ? <>
        <label className="block text-sm">재확인 요청 사유<Textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label>
        <Button type="button" variant="outline" disabled={!reason.trim()} onClick={() => void run(() =>
          save('confirmation-return', { workId: row.id, confirmationId: confirmation.id, reason: reason.trim() }))}>근무정보 다시 확인 요청</Button>
      </> : <Button type="button" variant="ghost" onClick={() => setReturning(true)}>재확인 요청</Button>}
    </fieldset>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>
}
