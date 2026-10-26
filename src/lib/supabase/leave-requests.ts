import { getSupabase } from './client'
import { DEFAULT_COMPANY_ID } from './brands'
import type { PersonalRequest, RequestForm, RequestKind } from '@/features/settings/personal-requests'

export type LeaveRequest = PersonalRequest & {
  employeeId: string; employeeName: string; departmentId: string | null; departmentName: string
  decidedAt: string | null; decidedByName: string | null
}
type LeaveRow = {
  id: string; employee_id: string; employee_name: string; department_id: string | null; department_name: string
  kind: RequestKind; from_date: string; to_date: string; start_time: string; end_time: string
  note: string; place: string | null; status: PersonalRequest['status']; created_at: string; decision_note: string | null
  decided_at: string | null; decided_by_name: string | null
}
function mapRow(row: LeaveRow): LeaveRequest {
  return { id: row.id, employeeId: row.employee_id, employeeName: row.employee_name,
    departmentId: row.department_id, departmentName: row.department_name, kind: row.kind,
    from: row.from_date, to: row.to_date, start: row.start_time.slice(0,5), end: row.end_time.slice(0,5),
    note: row.note, place: row.place ?? '', status: row.status, createdAt: row.created_at,
    decisionNote: row.decision_note ?? undefined, decidedAt: row.decided_at, decidedByName: row.decided_by_name }
}
function fail(action: string, error: { message: string }): never {
  console.warn('[leave-requests] ' + action, { message: error.message })
  throw new Error(error.message)
}
export async function listLeaveRequests(employeeId?: string, approvals = false, period?: { from: string; to: string; approvedOnly?: boolean }): Promise<LeaveRequest[]> {
  const rows: LeaveRequest[] = []
  for (let offset = 0; ; offset += 500) {
    let query = (approvals ? getSupabase().rpc('list_my_approval_requests') : getSupabase().from('company_leave_requests').select('*')).order('created_at', { ascending: false }).order('id').range(offset, offset + 499)
    if (employeeId) query = query.eq('employee_id', employeeId)
    if (period) {
      query = query.lte('from_date', period.to).gte('to_date', period.from)
      if (period.approvedOnly) query = query.eq('status', 'approved')
    }
    const { data, error } = await query
    if (error) fail('신청 목록 조회 실패', error)
    rows.push(...(data as LeaveRow[]).map(mapRow))
    if (data.length < 500) return rows
  }
}
export async function submitLeaveRequest(employeeId: string, form: RequestForm): Promise<LeaveRequest> {
  const { data, error } = await getSupabase().from('company_leave_requests').insert({
    employee_id: employeeId, kind: form.kind, from_date: form.from, to_date: form.to,
    start_time: form.start, end_time: form.end, note: form.note.trim(), place: form.place.trim(),
    // The database replaces these with the authenticated employee's company and department.
    company_id: DEFAULT_COMPANY_ID, employee_name: '', department_name: '',
  }).select().single()
  if (error) fail('신청 저장 실패', error)
  return mapRow(data as LeaveRow)
}
export type LeaveFile = { id: string; requestId: string; name: string; type: string; size: number; path: string }
const LEAVE_FILES = 'company-leave-files'
export async function uploadLeaveFile(requestId: string, file: File): Promise<LeaveFile> {
  if (file.size < 1 || file.size > 20 * 1024 * 1024 || /\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$/i.test(file.name)) {
    throw new Error('20MB 이하의 실행 파일이 아닌 서류만 올려 주세요.')
  }
  const pending = await checked<{ id: string; path: string }>(getSupabase().rpc('begin_leave_file', {
    p_request: requestId, p_name: file.name, p_type: file.type, p_size: file.size,
  }))
  try {
    const { error } = await getSupabase().storage.from(LEAVE_FILES).upload(pending.path, file, { contentType: file.type || 'application/octet-stream', upsert: false, cacheControl: '0' })
    if (error) fail('공가 서류 업로드 실패', error)
    await checked(getSupabase().rpc('finish_leave_file', { p_id: pending.id }))
    return { id: pending.id, requestId, name: file.name, type: file.type, size: file.size, path: pending.path }
  } catch (error) {
    try { await checked(getSupabase().rpc('remove_unfinished_leave_file', { p_id: pending.id })) }
    catch (cleanupError) { console.warn('[leave-requests] 미완료 공가 서류 정리 실패', { id: pending.id, error: cleanupError }) }
    throw error
  }
}
export async function listLeaveFiles(requestId: string): Promise<LeaveFile[]> {
  const { data, error } = await getSupabase().from('company_leave_files').select('id,request_id,file_name,mime_type,size_bytes,storage_path').eq('request_id', requestId).eq('ready', true)
  if (error) fail('공가 서류 조회 실패', error)
  return (data ?? []).map(row => ({ id: row.id, requestId: row.request_id, name: row.file_name, type: row.mime_type, size: row.size_bytes, path: row.storage_path }))
}
export async function downloadLeaveFile(file: LeaveFile): Promise<void> {
  const { data, error } = await getSupabase().storage.from(LEAVE_FILES).download(file.path)
  if (error || !data) fail('공가 서류 받기 실패', error ?? { message: '파일 내용이 없습니다.' })
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function checked<T>(request: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  return request.then(({ data, error }) => {
    if (error) fail('공가 서류 요청 실패', error)
    return data as T
  })
}
export async function transitionLeaveRequest(id: string, status: 'approved' | 'rejected' | 'cancelled', decisionNote = ''): Promise<LeaveRequest> {
  let query = getSupabase().from('company_leave_requests').update({ status, decision_note: decisionNote }).eq('id', id)
  query = status === 'cancelled' ? query.in('status', ['pending', 'approved']) : query.eq('status', 'pending')
  const { data, error } = await query.select().maybeSingle()
  if (error) fail('신청 처리 실패', error)
  if (!data) throw new Error('이미 처리되었거나 처리 권한이 없는 신청입니다. 목록을 새로고침해 주세요.')
  return mapRow(data as LeaveRow)
}
