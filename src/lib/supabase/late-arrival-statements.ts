import { cumulativeLateText, cumulativeLateTotal, lateAttachmentError } from '@/features/home/late-arrival'
import { listEmployeeAttendanceClocks } from './attendance-clocks'
import { getSupabase } from './client'
import { startWorkflow, tracedQuery, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { diagnosticQuery } from './diagnostic-query'

const LATE_FILES = 'company-late-statements'

export type LateArrivalStatement = {
  id: string
  employeeId: string
  date: string
  department: string
  name: string
  position: string
  baseline: string
  actual: string
  minutes: number
  priorApproval: string
  reasonKind: string
  detail: string
  prevention: string
  writtenOn: string
  managerName: string
  managerConfirmedAt: string | null
  hrName: string
  hrConfirmedAt: string | null
}

type StatementRow = {
  id: string
  employee_id: string
  work_date: string
  department_name: string
  employee_name: string
  position_name: string
  baseline_time: string
  actual_time: string
  late_minutes: number
  prior_approval: string
  reason_kind: string
  detail: string
  prevention: string
  written_on: string
  manager_name: string | null
  manager_confirmed_at: string | null
  hr_name: string | null
  hr_confirmed_at: string | null
}

const STATEMENT_COLUMNS = 'id,employee_id,work_date,department_name,employee_name,position_name,baseline_time,actual_time,late_minutes,prior_approval,reason_kind,detail,prevention,written_on,manager_name,manager_confirmed_at,hr_name,hr_confirmed_at'

function mapRow(row: StatementRow): LateArrivalStatement {
  return {
    id: row.id,
    employeeId: row.employee_id,
    date: row.work_date,
    department: row.department_name,
    name: row.employee_name,
    position: row.position_name,
    baseline: row.baseline_time.slice(0, 5),
    actual: row.actual_time.slice(0, 5),
    minutes: row.late_minutes,
    priorApproval: row.prior_approval,
    reasonKind: row.reason_kind,
    detail: row.detail,
    prevention: row.prevention,
    writtenOn: row.written_on,
    managerName: row.manager_name ?? '',
    managerConfirmedAt: row.manager_confirmed_at,
    hrName: row.hr_name ?? '',
    hrConfirmedAt: row.hr_confirmed_at,
  }
}

export async function listLateArrivalStatements(from: string, to: string): Promise<LateArrivalStatement[]> {
  const { data, error } = await getSupabase().from('late_arrival_statements')
    .select(STATEMENT_COLUMNS)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date', { ascending: false })
  if (error) {
    console.warn('[late-arrival] 지각 사유서 조회 실패', error)
    throw new Error('지각 사유서를 불러오지 못했습니다.')
  }
  return ((data ?? []) as StatementRow[]).map(mapRow)
}

export async function saveMyLateStatement(input: { priorApproval: string; reasonKind: string; detail: string; prevention: string }) {
  const { data, error } = await getSupabase().rpc('save_my_late_statement', {
    p_prior: input.priorApproval,
    p_reason: input.reasonKind,
    p_detail: input.detail,
    p_prevention: input.prevention,
  })
  const row = Array.isArray(data) ? data[0] : data
  const id = (row as { id?: string } | null)?.id
  if (error || !id) {
    console.warn('[late-arrival] 지각 사유서 저장 실패', error)
    throw new Error(error?.message || '사유서를 저장하지 못했습니다.')
  }
  return id
}

export type LateStatementFile = { id: string; statementId: string; name: string; path: string }

type LateFileUpload = { owner: string; statementId: string; pending?: LateStatementFile; attempted: boolean; uploaded: boolean; task?: Promise<LateStatementFile> }
// An uncertain upload lives only as long as its selected File. Account and
// statement checks prevent reuse after an account switch; nothing is persisted.
const pendingLateFiles = new WeakMap<File, LateFileUpload>()

async function confirmedLateFile(file: LateStatementFile, context: DiagnosticContext): Promise<LateStatementFile | null> {
  const row = await diagnosticQuery<{ id: string; statement_id: string; file_name: string; storage_path: string } | null>('db', 'verify_late_attachment',
    getSupabase().from('late_arrival_statement_files').select('id,statement_id,file_name,storage_path')
      .eq('statement_id', file.statementId).eq('id', file.id).eq('ready', true).maybeSingle(), context)
  return row ? { id: row.id, statementId: row.statement_id, name: row.file_name, path: row.storage_path } : null
}

export async function listLateStatementFiles(statementId: string): Promise<LateStatementFile[]> {
  const { data, error } = await getSupabase().from('late_arrival_statement_files')
    .select('id,statement_id,file_name,storage_path')
    .eq('statement_id', statementId)
    .eq('ready', true)
    .order('created_at')
  if (error) {
    console.warn('[late-arrival] 첨부 조회 실패', error)
    throw new Error('첨부파일을 불러오지 못했습니다.')
  }
  return ((data ?? []) as { id: string; statement_id: string; file_name: string; storage_path: string }[]).map(row => ({
    id: row.id, statementId: row.statement_id, name: row.file_name, path: row.storage_path,
  }))
}

export async function uploadLateStatementFile(statementId: string, file: File): Promise<LateStatementFile> {
  const message = lateAttachmentError(file.name, file.size)
  if (message) throw new Error(message)
  const db = getSupabase()
  const { data: auth, error: authError } = await db.auth.getSession()
  const owner = auth.session?.user.id
  if (authError || !owner) throw new Error('로그인 상태를 확인한 뒤 다시 제출해 주세요.')
  let upload = pendingLateFiles.get(file)
  if (!upload || upload.owner !== owner || upload.statementId !== statementId) {
    upload = { owner, statementId, attempted: false, uploaded: false }
    pendingLateFiles.set(file, upload)
  }
  if (upload.task) return upload.task
  const state = upload
  const run = async () => {
    const trace = startWorkflow('db', 'late_attachment')
    const complete = (saved: LateStatementFile) => {
      if (pendingLateFiles.get(file) === state) pendingLateFiles.delete(file)
      trace.done({ writeOutcome: 'committed' })
      return saved
    }
    try {
      if (!state.pending) {
        const pending = await trace.run('prepare_file', context => diagnosticQuery<{ id: string; path: string }>('db', 'begin_late_attachment', db.rpc('begin_late_statement_file', {
          p_statement: statementId, p_name: file.name, p_type: file.type, p_size: file.size,
        }), context))
        state.pending = { ...pending, statementId, name: file.name }
      } else {
        const saved = await trace.run('check_saved', context => confirmedLateFile(state.pending!, context))
        if (saved) return complete(saved)
        if (state.attempted && !state.uploaded) {
          // On explicit retry verify an upload whose response may have been lost
          // before sending the same bytes again. Existing server rules apply.
          const result = await trace.run('check_uploaded', context => tracedQuery(db.rpc('finish_late_statement_file', { p_id: state.pending!.id }), context))
          if (!result.error) return complete(state.pending)
          if (result.error.message !== '첨부파일이 저장소에 없습니다.') throw new Error(result.error.message, { cause: result.error })
        }
      }
      if (!state.uploaded) {
        state.attempted = true
        await trace.run('upload_file', async () => {
          const { error } = await db.storage.from(LATE_FILES).upload(state.pending!.path, file, { contentType: file.type || 'application/octet-stream', upsert: false, cacheControl: '0' })
          if (error) throw new Error(error.message, { cause: error })
        })
        state.uploaded = true
      }
      await trace.run('finish_file', context => diagnosticQuery('db', 'finish_late_attachment', db.rpc('finish_late_statement_file', { p_id: state.pending!.id }), context))
      return complete(state.pending)
    } catch (caught) {
      if (state.pending) {
        try {
          const saved = await confirmedLateFile(state.pending, trace.step('check_saved'))
          if (saved) {
            startWorkflow('db', 'late_attachment_recovered', {}, trace.context()).done({ writeOutcome: 'committed' })
            return complete(saved)
          }
        } catch (verificationError) {
          trace.fail(verificationError, { writeOutcome: 'unknown' })
        }
      }
      trace.fail(caught, { writeOutcome: 'unknown' })
      // Never delete an object/row after an uncertain response. Retain its
      // reservation for explicit retry; only an explicit remove deletes files.
      throw new Error(state.pending ? '첨부파일 저장 확인이 필요합니다. 같은 창에서 다시 제출해 주세요. 새로고침했다면 사유서를 열어 첨부파일을 추가해 주세요.' : caught instanceof Error ? caught.message : '첨부파일을 준비하지 못했습니다.', { cause: caught })
    }
  }
  state.task = run()
  try { return await state.task }
  finally { state.task = undefined }
}

export async function removeLateStatementFile(file: LateStatementFile) {
  const removed = await getSupabase().storage.from(LATE_FILES).remove([file.path])
  if (removed.error && !/not found|does not exist/i.test(removed.error.message)) {
    console.warn('[late-arrival] 첨부 삭제 실패', removed.error)
    throw new Error('첨부파일을 빼지 못했습니다.')
  }
  const { error } = await getSupabase().rpc('remove_my_late_statement_file', { p_id: file.id })
  if (error) {
    console.warn('[late-arrival] 첨부 기록 삭제 실패', error)
    throw new Error(error.message)
  }
}

export async function downloadLateStatementFile(file: LateStatementFile) {
  const { data, error } = await getSupabase().storage.from(LATE_FILES).download(file.path)
  if (error || !data) {
    console.warn('[late-arrival] 첨부 받기 실패', error)
    throw new Error(error?.message || '첨부파일을 받지 못했습니다.')
  }
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function loadCumulativeLate(employeeId: string, through: string) {
  const from = `${through.slice(0, 4)}-01-01`
  const [clocks, starts] = await Promise.all([
    listEmployeeAttendanceClocks(employeeId, from, through),
    listAttendanceStartsBetween(employeeId, from, through),
  ])
  const startByDate = new Map(starts.map(item => [item.date, item.start]))
  return cumulativeLateText(cumulativeLateTotal(clocks, date => startByDate.get(date) ?? startByDate.get(date.slice(0, 7)) ?? '', through))
}

async function listAttendanceStartsBetween(employeeId: string, from: string, to: string) {
  let { data, error } = await getSupabase().rpc('attendance_workday_starts_between', { p_employee: employeeId, p_from: from, p_to: to })
  // 서버 적용 전에는 기존 월별 기준으로 동작한다. 새 당일 기준 입력은 화면에서 차단된다.
  if (error && ['PGRST202', '42883'].includes(error.code)) ({ data, error } = await getSupabase().rpc('attendance_starts_between', { p_employee: employeeId, p_from: from, p_to: to }))
  if (error) {
    console.warn('[late-arrival] 출근 기준 조회 실패', error)
    throw new Error('누적 지각을 계산하지 못했습니다.')
  }
  return ((data ?? []) as { work_date?: string; month?: string; start_time: string | null }[]).map(row => ({
    date: row.work_date ? String(row.work_date).slice(0, 10) : String(row.month).slice(0, 7),
    start: row.start_time?.slice(0, 5) ?? '',
  }))
}

function statementFromRpc(data: unknown): LateArrivalStatement {
  const row = (Array.isArray(data) ? data[0] : data) as StatementRow | null
  if (!row?.id) throw new Error('사유서를 저장하지 못했습니다.')
  return mapRow(row)
}

export async function getLateArrivalStatement(id: string): Promise<LateArrivalStatement | null> {
  const { data, error } = await getSupabase().from('late_arrival_statements').select(STATEMENT_COLUMNS).eq('id', id).maybeSingle()
  if (error) {
    console.warn('[late-arrival] 지각 사유서 조회 실패', error)
    throw new Error('지각 사유서를 불러오지 못했습니다.')
  }
  return data ? mapRow(data as StatementRow) : null
}

export type LateStatementReview = { canManagerConfirm: boolean; canHrConfirm: boolean; waitingForManager: boolean }

export async function lateStatementReview(id: string): Promise<LateStatementReview> {
  const { data, error } = await getSupabase().rpc('late_statement_review', { p_statement: id })
  if (error) {
    console.warn('[late-arrival] 사유서 확인 권한 조회 실패', error)
    throw new Error(error.message)
  }
  const review = (data ?? {}) as Partial<LateStatementReview>
  return { canManagerConfirm: review.canManagerConfirm === true, canHrConfirm: review.canHrConfirm === true, waitingForManager: review.waitingForManager === true }
}

export async function confirmLateStatementManager(id: string) {
  const { data, error } = await getSupabase().rpc('confirm_late_statement_manager', { p_statement: id })
  if (error) {
    console.warn('[late-arrival] 부서장 확인 실패', error)
    throw new Error(error.message)
  }
  return statementFromRpc(data)
}

export async function confirmLateStatementHr(id: string) {
  const { data, error } = await getSupabase().rpc('confirm_late_statement_hr', { p_statement: id })
  if (error) {
    console.warn('[late-arrival] 인사 확인 실패', error)
    throw new Error(error.message)
  }
  return statementFromRpc(data)
}

export type LateStatementNotice = {
  kind: 'manager' | 'employee'
  noticeId: string
  statementId: string
  employeeName: string
  date: string
  minutes: number
  createdAt: string
  readAt: string | null
}

export async function listMyLateStatementNotices(): Promise<LateStatementNotice[]> {
  const { data, error } = await getSupabase().rpc('list_my_late_statement_notices')
  if (error) {
    console.warn('[late-arrival] 사유서 알림 조회 실패', error)
    throw new Error('지각 사유서 알림을 불러오지 못했습니다.')
  }
  return ((data ?? []) as { kind: string; notice_id: string; statement_id: string; employee_name: string; work_date: string; late_minutes: number; created_at: string; read_at: string | null }[]).map(row => ({
    kind: row.kind === 'employee' ? 'employee' : 'manager',
    noticeId: row.notice_id,
    statementId: row.statement_id,
    employeeName: row.employee_name,
    date: row.work_date,
    minutes: row.late_minutes,
    createdAt: row.created_at,
    readAt: row.read_at,
  }))
}

export type ManageableLateStatement = { id: string; employeeName: string; date: string; minutes: number; reasonKind: string; createdAt: string }

export async function listMyManageableLateStatements(): Promise<ManageableLateStatement[]> {
  const { data, error } = await getSupabase().rpc('list_my_manageable_late_statements')
  if (error) {
    console.warn('[late-arrival] 확인할 사유서 조회 실패', error)
    throw new Error('확인할 지각 사유서를 불러오지 못했습니다.')
  }
  return ((data ?? []) as { id: string; employee_name: string; work_date: string; late_minutes: number; reason_kind: string; created_at: string }[]).map(row => ({
    id: row.id, employeeName: row.employee_name, date: row.work_date, minutes: row.late_minutes, reasonKind: row.reason_kind, createdAt: row.created_at,
  }))
}

export async function countLateStatementsAwaitingHr(): Promise<number> {
  const { data, error } = await getSupabase().rpc('count_late_statements_awaiting_hr')
  if (error) {
    console.warn('[late-arrival] 인사 확인 대기 조회 실패', error)
    throw new Error('인사 확인 대기를 불러오지 못했습니다.')
  }
  return Number(data ?? 0)
}

export async function readLateStatementNotice(kind: 'manager' | 'employee' | 'all', id: string | null) {
  const { error } = await getSupabase().rpc('read_late_statement_notice', { p_kind: kind, p_id: id })
  if (error) {
    console.warn('[late-arrival] 사유서 알림 읽음 실패', error)
    throw new Error(error.message)
  }
}
