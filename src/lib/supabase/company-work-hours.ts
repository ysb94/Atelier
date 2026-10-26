import { getSupabase } from './client'

export type CompanyLunch = { start: string; end: string; saved: boolean }

type LunchRow = { lunch_start: string; lunch_end: string }

export async function loadCompanyLunch(): Promise<CompanyLunch> {
  const { data, error } = await getSupabase().from('company_work_hours').select('lunch_start, lunch_end').maybeSingle()
  if (error) {
    console.warn('[company-hours] 점심시간 조회 실패', error)
    throw new Error(error.message)
  }
  const row = data as LunchRow | null
  if (!row) return { start: '12:00', end: '13:00', saved: false }
  return { start: row.lunch_start.slice(0, 5), end: row.lunch_end.slice(0, 5), saved: true }
}

export async function saveCompanyLunch(start: string, end: string) {
  const { error } = await getSupabase().rpc('save_company_lunch', { p_start: start, p_end: end })
  if (error) {
    console.warn('[company-hours] 점심시간 저장 실패', error)
    throw new Error(error.message)
  }
}
