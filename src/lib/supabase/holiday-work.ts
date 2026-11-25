import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'
import { diagnosticOperation, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import type { HolidayWorkList } from '@/features/operations-support/holiday-work'

export type HolidayAction = 'plan' | 'submit' | 'review' | 'cancel' | 'settle' | 'policy' | 'paid' | 'offsite-settle'
  | 'confirmation-request' | 'confirmation-respond' | 'confirmation-return' | 'confirmation-file'
async function call<T>(action: string, payload: object, context?: DiagnosticContext): Promise<T> {
  return diagnosticQuery<T>('offsite', `holiday_${action}`, getSupabase().rpc('holiday_work', { p_action: action, p_payload: payload }), context)
}
export async function listHolidayWork(month: string, scope: 'mine' | 'review' | 'operations', requestId?: string): Promise<HolidayWorkList> {
  try { return await call<HolidayWorkList>('list', { month: `${month}-01`, scope, ...(requestId ? { request: requestId } : {}) }) }
  catch (error) {
    const code = (error as Error & { cause?: { code?: string } }).cause?.code
    if (['PGRST202', '42883'].includes(code ?? '')) return { ready: false, rows: [], isOperations: false, policy: null }
    throw error
  }
}
export async function changeHolidayWork(action: HolidayAction, payload: object) {
  return diagnosticOperation('offsite', `holiday_${action}`, async trace => {
    trace.step('validate_input')
    const result = await trace.run('save', context => call<{ id?: string; saved?: boolean }>(action, payload, context))
    trace.done({ writeOutcome: 'committed' })
    return result
  })
}

const confirmationBucket = 'holiday-work-confirmations'
export async function uploadHolidayConfirmationFile(companyId: string, confirmationId: string, file: File) {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('10MB 이하의 서명본을 선택해 주세요.')
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const matches = (bytes: number[]) => bytes.every((value, index) => header[index] === value)
  const format = matches([0x25, 0x50, 0x44, 0x46, 0x2d]) ? { extension: 'pdf', type: 'application/pdf' }
    : matches([0xff, 0xd8, 0xff]) ? { extension: 'jpg', type: 'image/jpeg' }
      : matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? { extension: 'png', type: 'image/png' } : null
  if (!format) throw new Error('PDF, JPG, PNG 형식의 서명본을 선택해 주세요.')
  const path = `${companyId}/${confirmationId}/${crypto.randomUUID()}.${format.extension}`
  await diagnosticOperation('offsite', 'holiday_confirmation_upload', async trace => {
    const { error } = await trace.run('upload', () => getSupabase().storage.from(confirmationBucket).upload(path, file, { contentType: format.type }))
    if (error) throw new Error('서명본 업로드에 실패했습니다. 다시 시도해 주세요.', { cause: error })
    trace.done({ writeOutcome: 'committed' })
  })
  return path
}

export async function downloadHolidayConfirmationFile(path: string) {
  const { data, error } = await getSupabase().storage.from(confirmationBucket).download(path)
  if (error || !data) throw new Error('서명본을 내려받지 못했습니다.')
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = `휴일근무-서명본.${path.split('.').at(-1)}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
