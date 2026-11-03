import type { CompanyInformation } from './NewEmployeeCompanyInformation'

/** 엑셀 임금설계(2026) B4:R5. 실제 연장시간과 가산 산정시간은 구분한다. */
export const WAGE_PLANS = [
  { value: '유형 1', label: '유형 1 · 주 2.5시간', weeklyHours: 2.5 },
  { value: '유형 2', label: '유형 2 · 주 5시간', weeklyHours: 5 },
] as const
export const WAGE_PLAN_MONTHLY_THRESHOLD = 3_000_000
export const CALCULATED_WAGE_KEYS = ['monthlyWage', 'baseHours', 'basePay', 'overtimeHours', 'overtimeAllowance', 'nightHours', 'nightAllowance', 'holidayHours', 'holidayAllowance', 'annualLeaveHours', 'annualLeaveAllowance'] as const
const ordinaryAllowances = ['mealAllowance', 'carAllowance', 'researchAllowance', 'childcareAllowance', 'dutyAllowance'] as const

export const CALCULATED_PERIOD_KEYS = ['contractStart', 'contractEnd', 'wageStart', 'wageEnd', 'probationStart', 'probationEnd'] as const
function dateParts(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toISOString().slice(0, 10) === value ? [year, month, day] as const : null
}
/** 출력용 시트의 EDATE(시작일, 개월 수)-1. 월말 보정 뒤 하루를 뺀다. */
export function contractPeriodEnd(start: string, months: string) {
  const parts = dateParts(start), count = Number(months)
  if (!parts || !Number.isInteger(count) || count < 1 || count > 1200) return ''
  const [year, month, day] = parts
  const targetMonth = month - 1 + count
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate()
  const date = new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay)))
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
export function calculateCompanyPeriods(input: CompanyInformation): CompanyInformation {
  if (input.periodMode !== 'auto') return { ...input }
  const start = dateParts(input.hireDate) ? input.hireDate : ''
  const written = dateParts(input.documentDate) ? input.documentDate : ''
  const wageStart = [start, written].sort().at(-1) || ''
  return { ...input, contractStart: start,
    contractEnd: input.contractTerm === 'fixed' ? contractPeriodEnd(start, input.contractMonths) : '',
    wageStart, wageEnd: input.wageTerm === 'fixed' ? contractPeriodEnd(wageStart, input.wageMonths) : '',
    probationStart: input.probationApply === 'yes' ? start : '',
    probationEnd: input.probationApply === 'yes' ? contractPeriodEnd(start, input.probationMonths) : '',
  }
}

export function splitWorkTime(text: string): [string, string] {
  const match = text.match(/^\s*(\d{1,2}):(\d{2})\s*[~～\-–]\s*(\d{1,2}):(\d{2})(?:\s|,|$)/)
  if (!match || +match[1] > 23 || +match[3] > 23 || +match[2] > 59 || +match[4] > 59) return ['', '']
  return [`${match[1].padStart(2, '0')}:${match[2]}`, `${match[3].padStart(2, '0')}:${match[4]}`]
}
export function normalizeMoney(text = '') {
  const cleaned = text.replace(/[,\s원]/g, '')
  return /^\d+(\.\d+)?$/.test(cleaned) ? cleaned : ''
}
export function companyRosterValues(row: Record<string, unknown>): Partial<CompanyInformation> {
  const result: Partial<CompanyInformation> = {}
  const fields = { workplace: 'workplace', employmentType: 'employment_type', jobDescription: 'job_description', workDays: 'work_days', workHours: 'work_hours', breakTime: 'break_time', payBasis: 'pay_basis', annualSalary: 'annual_salary', monthlyWage: 'monthly_wage', mealAllowance: 'meal_allowance', carAllowance: 'car_allowance', childcareAllowance: 'childcare_allowance', dutyAllowance: 'duty_allowance', fixedOvertimePlan: 'fixed_overtime_plan' } as const
  for (const [key, column] of Object.entries(fields)) {
    const raw = String(row[column] ?? '')
    result[key as keyof CompanyInformation] = /Salary|Wage|Allowance/.test(key) ? normalizeMoney(raw) : raw
  }
  ;[result.workStart, result.workEnd] = splitWorkTime(result.workHours || '')
  ;[result.breakStart, result.breakEnd] = splitWorkTime(result.breakTime || '')
  return result
}
/** 최초 조회가 늦게 끝나도 사용자가 편집한 칸은 유지한다. */
export function fillCompanyInformation(current: CompanyInformation, incoming: Partial<CompanyInformation>, touched: ReadonlySet<string>): CompanyInformation {
  const next = { ...current }
  for (const [key, value] of Object.entries(incoming)) if (!touched.has(key) && !current[key as keyof CompanyInformation]) next[key as keyof CompanyInformation] = value ?? ''
  return next
}
export function calculateCompanyWage(input: CompanyInformation) {
  const value = { ...input }
  if (input.wageMode !== 'excel') return { value, error: '', actualOvertimeHours: '' }
  for (const key of CALCULATED_WAGE_KEYS) value[key] = ''
  const fail = (error: string) => ({ value, error, actualOvertimeHours: '' })
  const salary = normalizeMoney(input.annualSalary), salaryValue = Number(salary), monthly = salaryValue / 12
  // 고정OT 설계(안) version2: 반올림 전 월 급여로 경계를 판정한다.
  const plan = salaryValue > 0 && Number.isSafeInteger(salaryValue) ? WAGE_PLANS[monthly < WAGE_PLAN_MONTHLY_THRESHOLD ? 0 : 1] : undefined
  value.fixedOvertimePlan = plan?.value ?? ''
  if (salaryValue > 0 && Number.isSafeInteger(salaryValue)) value.monthlyWage = String(Math.round(monthly))
  // 원본 O2의 ‘월급x12개월’은 연봉 설명이며 세전/세후 구분이 아니다.
  // 직원 배치에서 가져온 원본 표현과 이전 시안의 ‘세전’을 모두 유지한다.
  const payBasis = (input.payBasis || '').replace(/\s/g, '').replace(/[xX×*]/g, 'x')
  if (!['월급x12개월', '세전'].includes(payBasis)) return fail('연봉기준을 ‘월급x12개월’로 선택해 주세요. 세후 금액이나 다른 임금 기준은 예외 조건에서 직접 입력합니다.')
  const minutes = (s: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : NaN
  const start = minutes(input.workStart), end = minutes(input.workEnd), lunchStart = minutes(input.breakStart), lunchEnd = minutes(input.breakEnd)
  if (!/^주\s*5일/.test(input.workDays) || !(start <= lunchStart && lunchStart < lunchEnd && lunchEnd <= end) || end - start - (lunchEnd - lunchStart) !== 480)
    return fail('엑셀 자동 계산은 주 5일·하루 실근무 8시간 기준입니다. 근로일·근무·휴게시간을 확인하거나 직접 입력을 선택해 주세요.')
  value.baseHours = '209'
  if (!plan) return fail('연봉을 입력하면 근로유형과 임금 항목을 자동 계산합니다.')
  const weighted = Math.round(plan.weeklyHours * (365 / 12 / 7) * 1.5 * 10) / 10
  value.overtimeHours = String(weighted)
  if (!salary || Number(salary) <= 0) return fail('연봉을 입력하면 임금 항목을 계산합니다.')
  if (ordinaryAllowances.some(key => input[key] && !normalizeMoney(input[key]))) return fail('수당은 0 이상의 숫자로 입력해 주세요.')
  const hourly = monthly / (209 + weighted)
  const overtime = Math.round(weighted * hourly)
  const allowances = ordinaryAllowances.reduce((sum, key) => sum + Math.round(Number(normalizeMoney(input[key]) || 0)), 0)
  const base = Math.round(monthly) - overtime - allowances
  if (!Number.isSafeInteger(salaryValue) || !Number.isSafeInteger(base) || base < 0) return fail('연봉과 수당 합계를 확인해 주세요. 기본급이 음수가 되거나 계산 범위를 벗어납니다.')
  Object.assign(value, { monthlyWage: String(Math.round(monthly)), basePay: String(base), baseHours: '209', overtimeHours: String(weighted), overtimeAllowance: String(overtime), nightHours: '0', nightAllowance: '0', holidayHours: '0', holidayAllowance: '0', annualLeaveHours: '0', annualLeaveAllowance: '0' })
  return { value, error: '', actualOvertimeHours: (plan.weeklyHours * 365 / 12 / 7).toFixed(2) }
}
