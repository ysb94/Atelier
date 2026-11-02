import { useEffect, useId, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Info, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { isWorkday } from '@/features/operations-support/monthly-attendance'
import { getMyWorkdayBasis } from '@/lib/supabase/attendance-entry'
import { confirmLateStatementHr, confirmLateStatementManager, downloadLateStatementFile, lateStatementReview, listLateArrivalStatements, listLateStatementFiles, loadCumulativeLate, removeLateStatementFile, saveMyLateStatement, uploadLateStatementFile, type LateArrivalStatement, type LateStatementFile } from '@/lib/supabase/late-arrival-statements'
import { useAuth } from '@/lib/supabase/auth'
import { koreaDateKey } from '@/features/settings/my-attendance'
import { LATE_ATTACHMENT_LIMIT, lateAttachmentError, lateConfirmStamp, lateMinutes } from './late-arrival'
import { useMyClockIn } from './use-my-clock-in'
import './late-arrival-form.css'

type Preview = { date: string; start: string; actual: string; minutes: number; department: string; name: string; position: string }

function dateParts(date: string) {
  const [year = '', month = '', day = ''] = date.split('-')
  return { year, month: String(Number(month) || ''), day: String(Number(day) || '') }
}

function fileKey(file: File) {
  return `${file.name}\0${file.size}\0${file.lastModified}`
}

function AttachmentField({ editing, pending, saved, locked, onAdd, onRemove, onOpen }: {
  editing?: boolean
  pending: File[]
  saved: LateStatementFile[]
  locked?: boolean
  onAdd?: (files: FileList | null) => void
  onRemove?: (file: File) => void
  onOpen?: (file: LateStatementFile) => void
}) {
  if (!editing && saved.length === 0) return null
  return <div className="late-form-attach">
    {editing && <label>첨부파일<input aria-label="첨부파일" type="file" multiple disabled={locked} onChange={event => { onAdd?.(event.target.files); event.target.value = '' }} /></label>}
    {editing && pending.map(file => <span key={fileKey(file)} title={file.name}><span className="late-form-file-name">{file.name}</span><button type="button" className="late-form-file-remove" aria-label={`${file.name} 빼기`} disabled={locked} onClick={() => onRemove?.(file)}>×</button></span>)}
    {!editing && saved.map(file => <button key={file.id} type="button" className="late-form-file" onClick={() => onOpen?.(file)}>{file.name}</button>)}
  </div>
}

function useCumulativeLate(employeeId: string | undefined, through: string, enabled = true) {
  const query = useQuery({
    queryKey: ['late-arrival-cumulative', employeeId, through],
    queryFn: () => loadCumulativeLate(employeeId ?? '', through),
    enabled: enabled && Boolean(employeeId),
  })
  useEffect(() => {
    if (query.error) console.warn('[late-arrival] 누적 지각 조회 실패', query.error)
  }, [query.error])
  if (!enabled || !employeeId) return ''
  if (query.isPending) return '…'
  if (query.isError) return '확인 실패'
  return query.data ?? ''
}

function LateFormSheet({ department, name, date, position, baseline, actual, minutes, prior, reason, detail, prevention, writtenOn, cumulative = '', managerStamp = '', hrStamp = '', editing, pendingFiles = [], savedFiles = [], filesLocked, onPrior, onReason, onDetail, onPrevention, onAddFiles, onRemoveFile, onOpenFile }: {
  department: string
  name: string
  date: string
  position: string
  baseline: string
  actual: string
  minutes: string
  prior: string
  reason: string
  detail: string
  prevention: string
  writtenOn: string
  cumulative?: string
  managerStamp?: string
  hrStamp?: string
  editing?: boolean
  pendingFiles?: File[]
  savedFiles?: LateStatementFile[]
  filesLocked?: boolean
  onPrior?: (value: string) => void
  onReason?: (value: string) => void
  onDetail?: (value: string) => void
  onPrevention?: (value: string) => void
  onAddFiles?: (files: FileList | null) => void
  onRemoveFile?: (file: File) => void
  onOpenFile?: (file: LateStatementFile) => void
}) {
  const written = dateParts(writtenOn)
  const occurred = dateParts(date)
  return <div className="late-form">
    <h2>지각사유서</h2>
    <div className="late-form-rule" />
    <table>
      <tbody>
        <tr><th>소속</th><td>{department}</td><th>성명</th><td>{name}</td></tr>
        <tr><th>지각 일자</th><td>{occurred.year}년 {occurred.month}월 {occurred.day}일</td><th>직위</th><td>{position}</td></tr>
        <tr><th>출근 기준 시각</th><td>{baseline}</td><th>실제 출근 시각</th><td>{actual}</td></tr>
        <tr><th>지각 시간(분)</th><td>{minutes}</td><th>사전 승인</th><td>{editing ? <input aria-label="사전 승인" value={prior} maxLength={40} placeholder="예) 무" onChange={event => onPrior?.(event.target.value)} /> : prior}</td></tr>
        <tr><th>사유 구분</th><td colSpan={3}>{editing ? <input aria-label="사유 구분" value={reason} maxLength={40} placeholder="예) 대중교통 지연" onChange={event => onReason?.(event.target.value)} /> : reason}</td></tr>
        <tr className="late-form-banner"><th colSpan={4}>상 세 사 유</th></tr>
        <tr><td className="late-form-note" colSpan={4}>{editing ? <textarea aria-label="상세 사유" value={detail} maxLength={1000} placeholder="예) 출근길 지하철 2호선 운행 지연(약 15분)으로 지각하였습니다. (지연 증명서 첨부 가능)" onChange={event => onDetail?.(event.target.value)} /> : <p className="whitespace-pre-wrap">{detail}</p>}<AttachmentField editing={editing} pending={pendingFiles} saved={savedFiles} locked={filesLocked} onAdd={onAddFiles} onRemove={onRemoveFile} onOpen={onOpenFile} /></td></tr>
        <tr className="late-form-banner"><th colSpan={4}>재 발 방 지 대 책</th></tr>
        <tr><td className="late-form-plan" colSpan={4}>{editing ? <textarea aria-label="재발 방지 대책" value={prevention} maxLength={1000} placeholder="예) 출발 시각을 20분 앞당기겠습니다." onChange={event => onPrevention?.(event.target.value)} /> : <p className="whitespace-pre-wrap">{prevention}</p>}</td></tr>
      </tbody>
    </table>
    <p className="late-form-confirm">위와 같이 지각 사유를 제출하며, 사실과 다름이 없음을 확인합니다.<br />(취업규칙 제14조, 제15조에 따름)</p>
    <table className="late-form-sign">
      <tbody>
        <tr><td>작성일자:</td><td>{written.year}년 {written.month}월 {written.day}일</td></tr>
        <tr><td>작성자:</td><td>{name} (서명/인)</td></tr>
      </tbody>
    </table>
    <table className="late-form-foot">
      <thead><tr><th>부서장 확인</th><th>인사 담당</th><th>누적 제출 횟수 (인사 기재)</th></tr></thead>
      <tbody><tr><td>{managerStamp}</td><td>{hrStamp}</td><td>{cumulative}</td></tr></tbody>
    </table>
  </div>
}

export function LateArrivalStatementDocument({ statement, onClose, review = 'view', onUpdated }: { statement: LateArrivalStatement; onClose: () => void; review?: 'view' | 'manager' | 'hr'; onUpdated?: (statement: LateArrivalStatement) => void }) {
  const titleId = useId()
  const client = useQueryClient()
  const cumulative = useCumulativeLate(statement.employeeId, statement.date)
  const access = useQuery({
    queryKey: ['late-statement-review', statement.id],
    queryFn: () => lateStatementReview(statement.id),
    enabled: review !== 'view',
  })
  const [confirmError, setConfirmError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const files = useQuery({
    queryKey: ['late-arrival-statement-files', statement.id],
    queryFn: () => listLateStatementFiles(statement.id),
  })
  const [fileError, setFileError] = useState('')
  useEffect(() => {
    if (files.error) console.warn('[late-arrival] 첨부 조회 실패', files.error)
    if (access.error) console.warn('[late-arrival] 사유서 확인 권한 조회 실패', access.error)
  }, [files.error, access.error])
  async function openFile(file: LateStatementFile) {
    try {
      setFileError('')
      await downloadLateStatementFile(file)
    } catch (caught) {
      console.warn('[late-arrival] 첨부 받기 실패', caught)
      setFileError(caught instanceof Error ? caught.message : '첨부파일을 받지 못했습니다.')
    }
  }
  async function confirm() {
    if (confirming) return
    setConfirming(true)
    setConfirmError('')
    try {
      const saved = review === 'hr' ? await confirmLateStatementHr(statement.id) : await confirmLateStatementManager(statement.id)
      await client.invalidateQueries({ queryKey: ['late-arrival-statements'] })
      await client.invalidateQueries({ queryKey: ['late-statement-notices'] })
      await client.invalidateQueries({ queryKey: ['late-statement-tasks'] })
      await client.invalidateQueries({ queryKey: ['late-statements-awaiting-hr'] })
      await client.invalidateQueries({ queryKey: ['late-statement-review', statement.id] })
      onUpdated?.(saved)
    } catch (caught) {
      console.warn('[late-arrival] 사유서 확인 실패', caught)
      setConfirmError(caught instanceof Error ? caught.message : '사유서를 확인하지 못했습니다.')
    } finally {
      setConfirming(false)
    }
  }
  const managerStamp = lateConfirmStamp(statement.managerName, statement.managerConfirmedAt)
  const hrStamp = lateConfirmStamp(statement.hrName, statement.hrConfirmedAt)
  const showManager = review === 'manager' && access.data?.canManagerConfirm
  const showHr = review === 'hr' && (access.data?.canHrConfirm || access.data?.waitingForManager)
  const status = statement.hrConfirmedAt ? '인사 확인 완료' : statement.managerConfirmedAt ? '인사 확인 대기' : '부서장 확인 대기'
  return <section className="late-statement-dialog flex max-h-[90dvh] w-full min-w-0 max-w-[820px] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm" aria-labelledby={titleId}>
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText size={18} aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">지각 사유서 확인</h2>
          <p className="mt-1 break-words text-xs text-muted-foreground">{statement.name} · {statement.department} · {statement.date}</p>
          <StatusPill className="mt-2" tone={statement.hrConfirmedAt ? 'success' : 'warning'}>{status}</StatusPill>
        </div>
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label="지각 사유서 닫기" onClick={onClose}><X size={18} aria-hidden="true" /></Button>
    </header>
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-muted/40 p-2 sm:p-5" aria-label="사유서 본문" tabIndex={0}>
      <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-lg border border-border shadow-sm">
        <LateFormSheet department={statement.department} name={statement.name} date={statement.date} position={statement.position} baseline={statement.baseline} actual={statement.actual} minutes={String(statement.minutes)} prior={statement.priorApproval} reason={statement.reasonKind} detail={statement.detail} prevention={statement.prevention} writtenOn={statement.writtenOn} cumulative={cumulative} managerStamp={managerStamp} hrStamp={hrStamp} savedFiles={files.data ?? []} onOpenFile={file => void openFile(file)} />
      </div>
    </div>
    <footer className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
      {files.error && <p role="alert" className="mb-3 text-sm text-danger">첨부파일을 불러오지 못했습니다.</p>}
      {fileError && <p role="alert" className="mb-3 break-words text-sm text-danger">{fileError}</p>}
      {confirmError && <p role="alert" className="mb-3 break-words text-sm text-danger">{confirmError}</p>}
      {access.isError && review !== 'view' && <p role="alert" className="mb-3 text-sm text-danger">확인 권한을 불러오지 못했습니다. 창을 다시 열어 주세요.</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs leading-relaxed text-muted-foreground" role="status">
          {showHr && access.data?.waitingForManager && !access.data.canHrConfirm ? <p className="flex items-start gap-2"><Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>부서장 확인을 기다리고 있습니다.<br />확인 후 인사 확인을 진행할 수 있습니다.</span></p> : access.isPending && review !== 'view' ? '확인 권한을 확인하고 있습니다.' : statement.hrConfirmedAt ? '확인 완료된 사유서입니다.' : '제출한 사유서와 첨부파일을 확인해 주세요.'}
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
          {showManager && <Button type="button" disabled={confirming} onClick={() => void confirm()}>{confirming ? '확인 중…' : '부서장 확인'}</Button>}
          {showHr && access.data?.canHrConfirm && <Button type="button" disabled={confirming} onClick={() => void confirm()}>{confirming ? '확인 중…' : '인사 확인'}</Button>}
        </div>
      </div>
    </footer>
  </section>
}

function StatementFields({ preview, prior, reason, detail, prevention, files, cumulative, error, saving, onPrior, onReason, onDetail, onPrevention, onAddFiles, onRemoveFile, onSubmit, onCancel, submitLabel = '제출' }: {
  preview: Preview
  prior: string
  reason: string
  detail: string
  prevention: string
  files: File[]
  cumulative: string
  error: string
  saving: boolean
  onPrior: (value: string) => void
  onReason: (value: string) => void
  onDetail: (value: string) => void
  onPrevention: (value: string) => void
  onAddFiles: (files: FileList | null) => void
  onRemoveFile: (file: File) => void
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
  submitLabel?: string
  note?: string
}) {
  return <form className="max-h-[92dvh] w-full max-w-[820px] overflow-auto bg-white shadow-sm" onSubmit={onSubmit}>
    <LateFormSheet department={preview.department} name={preview.name} date={preview.date} position={preview.position} baseline={preview.start} actual={preview.actual} minutes={String(preview.minutes)} prior={prior} reason={reason} detail={detail} prevention={prevention} writtenOn={preview.date} cumulative={cumulative} editing pendingFiles={files} filesLocked={saving} onPrior={onPrior} onReason={onReason} onDetail={onDetail} onPrevention={onPrevention} onAddFiles={onAddFiles} onRemoveFile={onRemoveFile} />
    {error && <p role="alert" className="late-form-error px-8">{error}</p>}
    <div className="late-form-actions px-8 pb-6"><Button type="button" variant="outline" disabled={saving} onClick={onCancel}>취소</Button><Button type="submit" disabled={saving}>{saving ? '저장 중…' : submitLabel}</Button></div>
  </form>
}

export function LateArrivalHeaderButton() {
  const { profile, session } = useAuth()
  const client = useQueryClient()
  const clock = useMyClockIn()
  const today = koreaDateKey()
  const userId = session?.user.id
  const ready = profile?.status === 'active' && Boolean(userId) && Boolean(clock.todayClock) && isWorkday(today, {})
  const basis = useQuery({
    queryKey: ['my-workday-basis', userId, today, 'late-header'],
    queryFn: () => getMyWorkdayBasis(today),
    enabled: ready,
  })
  const statements = useQuery({
    queryKey: ['late-arrival-statements', userId, today],
    queryFn: () => listLateArrivalStatements(today, today),
    enabled: ready,
  })
  const minutes = basis.data?.start ? lateMinutes(basis.data.start, clock.todayClock) : 0
  const filed = statements.data?.some(item => item.date === today && item.employeeId === userId)
  const cumulative = useCumulativeLate(userId, today, ready && !basis.isPending && !statements.isPending && Boolean(basis.data?.start) && minutes > 0 && !filed)
  const [open, setOpen] = useState(false)
  const [prior, setPrior] = useState('')
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [prevention, setPrevention] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploaded, setUploaded] = useState<Record<string, LateStatementFile>>({})
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (statements.error) console.warn('[late-arrival] 오늘 사유서 조회 실패', statements.error)
  }, [statements.error])
  if (!ready || basis.isPending || statements.isPending || !basis.data?.start || minutes <= 0 || filed) return null
  const preview: Preview = {
    date: today,
    start: basis.data.start,
    actual: clock.todayClock,
    minutes,
    department: profile?.departmentName || '소속 없음',
    name: profile?.displayName || '이름 없음',
    position: profile?.position || '직위 미지정',
  }
  function addFiles(list: FileList | null) {
    if (!list?.length) return
    const next = [...files]
    let message = ''
    for (const file of Array.from(list)) {
      const invalid = lateAttachmentError(file.name, file.size)
      if (invalid) { message = invalid; continue }
      if (next.length >= LATE_ATTACHMENT_LIMIT) { message = '첨부파일은 5개까지 올릴 수 있습니다.'; break }
      if (next.some(item => fileKey(item) === fileKey(file))) continue
      next.push(file)
    }
    setFiles(next)
    setError(message)
  }
  async function removeFile(file: File) {
    if (saving) return
    const key = fileKey(file)
    const saved = uploaded[key]
    setFiles(current => current.filter(item => fileKey(item) !== key))
    if (!saved) return
    setSaving(true)
    try {
      await removeLateStatementFile(saved)
      setUploaded(current => {
        const next = { ...current }
        delete next[key]
        return next
      })
    } catch (caught) {
      console.warn('[late-arrival] 첨부 삭제 실패', caught)
      setFiles(current => current.some(item => fileKey(item) === key) ? current : [...current, file])
      setError(caught instanceof Error ? caught.message : '첨부파일을 빼지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    if (!prior.trim() || !detail.trim() || !prevention.trim()) { setError('사전 승인, 상세 사유, 재발 방지 대책을 입력해 주세요.'); return }
    setSaving(true)
    setError('')
    const done = { ...uploaded }
    try {
      const id = savedId ?? await saveMyLateStatement({ priorApproval: prior.trim(), reasonKind: reason.trim(), detail: detail.trim(), prevention: prevention.trim() })
      setSavedId(id)
      for (const file of files) {
        const key = fileKey(file)
        if (done[key]) continue
        done[key] = await uploadLateStatementFile(id, file)
        setUploaded({ ...done })
      }
      await client.invalidateQueries({ queryKey: ['late-arrival-statements'] })
      setOpen(false)
      setSavedId(null)
      setFiles([])
      setUploaded({})
    } catch (caught) {
      console.warn('[late-arrival] 지각 사유서 저장 실패', caught)
      setUploaded({ ...done })
      setError(caught instanceof Error ? caught.message : '사유서를 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }
  return <>
    <div className="flex flex-col items-center gap-1">
      <Button type="button" className="h-11 px-7 text-base font-semibold shadow-md" onClick={() => { if (!savedId) { setPrior(''); setReason(''); setDetail(''); setPrevention(''); setFiles([]); setUploaded({}) } setError(''); setOpen(true) }}>지각 사유서 작성</Button>
      <span className="text-xs font-medium text-danger">오늘 {minutes}분 지각</span>
    </div>
    {open && <div className="fixed inset-0 z-[70] grid place-items-center bg-background/75 p-4" role="dialog" aria-label="지각 사유서">
      <StatementFields preview={preview} prior={prior} reason={reason} detail={detail} prevention={prevention} files={files} cumulative={cumulative} error={error} saving={saving} submitLabel="사유서 제출" note="제출하면 오늘 지각 기록에 사유서가 첨부됩니다." onPrior={setPrior} onReason={setReason} onDetail={setDetail} onPrevention={setPrevention} onAddFiles={addFiles} onRemoveFile={file => void removeFile(file)} onSubmit={event => void submit(event)} onCancel={() => { if (!saving) setOpen(false) }} />
    </div>}
  </>
}
