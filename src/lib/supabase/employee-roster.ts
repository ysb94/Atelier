import { DEFAULT_COMPANY_ID } from '@/lib/supabase/brands'
import { getSupabase } from '@/lib/supabase/client'
import { listExtraLeave } from './employee-extra-leave'

export const ROSTER_FIELDS = [
  { key: 'phone', column: 'phone', label: '전화번호', max: 40, width: 'min-w-36' },
  { key: 'bankName', column: 'bank_name', label: '은행명', max: 40, width: 'min-w-28' },
  { key: 'bankAccount', column: 'bank_account', label: '계좌번호', max: 40, width: 'min-w-40' },
  { key: 'residentId', column: 'resident_id', label: '주민등록번호', max: 20, width: 'min-w-36' },
  { key: 'homeAddress', column: 'home_address', label: '집주소', max: 300, width: 'min-w-64' },
  { key: 'gmail', column: 'gmail', label: 'G메일', max: 200, width: 'min-w-52' },
  { key: 'naverEmail', column: 'naver_email', label: '네이버메일', max: 200, width: 'min-w-52' },
  { key: 'workplace', column: 'workplace', label: '근무지', max: 80, width: 'min-w-24' },
  { key: 'employmentType', column: 'employment_type', label: '근로형태', max: 40, width: 'min-w-28' },
  { key: 'gender', column: 'gender', label: '성별', max: 10, width: 'min-w-16' },
  { key: 'resignedOn', column: 'resigned_on', label: '퇴사일', max: 10, width: 'min-w-36' },
  { key: 'jobDescription', column: 'job_description', label: '업무내용', max: 200, width: 'min-w-40' },
  { key: 'workDays', column: 'work_days', label: '근로일', max: 80, width: 'min-w-28' },
  { key: 'workHours', column: 'work_hours', label: '근로시간', max: 80, width: 'min-w-36' },
  { key: 'breakTime', column: 'break_time', label: '휴게시간', max: 80, width: 'min-w-40' },
  { key: 'payBasis', column: 'pay_basis', label: '연봉기준', max: 40, width: 'min-w-28' },
  { key: 'annualSalary', column: 'annual_salary', label: '연봉', max: 20, width: 'min-w-28' },
  { key: 'monthlyWage', column: 'monthly_wage', label: '월 임금', max: 30, width: 'min-w-28' },
  { key: 'mealAllowance', column: 'meal_allowance', label: '식대', max: 20, width: 'min-w-24' },
  { key: 'carAllowance', column: 'car_allowance', label: '차량유지비', max: 20, width: 'min-w-24' },
  { key: 'childcareAllowance', column: 'childcare_allowance', label: '육아수당', max: 20, width: 'min-w-24' },
  { key: 'dutyAllowance', column: 'duty_allowance', label: '직책수당', max: 20, width: 'min-w-24' },
  { key: 'note', column: 'note', label: '비고', max: 500, width: 'min-w-40' },
  { key: 'extra', column: 'extra', label: '기타', max: 200, width: 'min-w-32' },
] as const

export type RosterColumnKind = 'text' | 'number' | 'money'
export type RosterHeaderKind = RosterColumnKind | 'date' | 'choice'
export type RosterHeaderSetting = { key: string; label: string; hidden: boolean }
export const FIXED_OVERTIME_PLANS = ['유형 1', '유형 2'] as const
export const ROSTER_BASE_HEADERS: readonly { key: string; label: string; kind: RosterHeaderKind }[] = [
  { key: 'name', label: '이름', kind: 'text' },
  { key: 'department', label: '부서', kind: 'choice' },
  { key: 'duty', label: '직책', kind: 'choice' },
  { key: 'grade', label: '직급', kind: 'choice' },
  { key: 'hire', label: '입사일', kind: 'date' },
  { key: 'fixedOvertimePlan', label: '고정OT 설계', kind: 'choice' },
  { key: 'inclusiveOvertimeHours', label: '약정 연장근로시간(포괄임금)', kind: 'number' },
  { key: 'accruedAnnualLeave', label: '발생일수', kind: 'number' },
  { key: 'additionalAnnualLeave', label: '추가 연차', kind: 'number' },
  { key: 'remainingAnnualLeave', label: '남은 연차', kind: 'number' },
  ...ROSTER_FIELDS.map(field => ({ key: field.key, label: field.label, kind: (field.key === 'resignedOn' ? 'date' : ['annualSalary', 'monthlyWage', 'mealAllowance', 'carAllowance', 'childcareAllowance', 'dutyAllowance'].includes(field.key) ? 'money' : 'text') as RosterHeaderKind })),
  { key: 'loginEmail', label: '로그인 아이디(구글)', kind: 'text' },
]
export type RosterColumn = { id: string; label: string; kind: RosterColumnKind; sortOrder: number }
export type RosterColumnValue = { columnId: string; profileId: string; value: string }
export type RosterFieldKey = (typeof ROSTER_FIELDS)[number]['key']
export type RosterWriteFieldKey = RosterFieldKey | 'remainingAnnualLeave' | 'inclusiveOvertimeHours' | 'fixedOvertimePlan'

export type EmployeeRoster = {
  profileId: string
  /** undefined: server field unavailable; null: not registered. */
  accruedAnnualLeave?: number | null
  remainingAnnualLeave: number | null
  additionalAnnualLeave?: number
  inclusiveOvertimeHours: number | null
  fixedOvertimePlan: string
} & Record<RosterFieldKey, string>

type RosterRow = {
  profile_id: string
  remaining_annual_leave: number | null
  inclusive_overtime_hours: number | null
  fixed_overtime_plan: string
  phone: string
  bank_name: string
  bank_account: string
  resident_id: string
  home_address: string
  gmail: string
  naver_email: string
  workplace: string
  employment_type: string
  gender: string
  resigned_on: string | null
  job_description: string
  work_days: string
  work_hours: string
  break_time: string
  pay_basis: string
  annual_salary: string
  monthly_wage: string
  meal_allowance: string
  car_allowance: string
  childcare_allowance: string
  duty_allowance: string
  note: string
  extra: string
}

const ROSTER_COLUMNS =
  'profile_id, remaining_annual_leave, fixed_overtime_plan, inclusive_overtime_hours, phone, bank_name, bank_account, resident_id, home_address, gmail, naver_email, workplace, employment_type, gender, resigned_on, job_description, work_days, work_hours, break_time, pay_basis, annual_salary, monthly_wage, meal_allowance, car_allowance, childcare_allowance, duty_allowance, note, extra'

export function emptyRoster(profileId: string): EmployeeRoster {
  return {
    profileId,
    remainingAnnualLeave: null,
    inclusiveOvertimeHours: null,
    fixedOvertimePlan: '',
    phone: '',
    bankName: '',
    bankAccount: '',
    residentId: '',
    homeAddress: '',
    gmail: '',
    naverEmail: '',
    workplace: '',
    employmentType: '',
    gender: '',
    resignedOn: '',
    jobDescription: '',
    workDays: '',
    workHours: '',
    breakTime: '',
    payBasis: '',
    annualSalary: '',
    monthlyWage: '',
    mealAllowance: '',
    carAllowance: '',
    childcareAllowance: '',
    dutyAllowance: '',
    note: '',
    extra: '',
  }
}

function fromRow(row: RosterRow): EmployeeRoster {
  return {
    profileId: row.profile_id,
    remainingAnnualLeave: row.remaining_annual_leave == null ? null : Number(row.remaining_annual_leave),
    inclusiveOvertimeHours: row.inclusive_overtime_hours == null ? null : Number(row.inclusive_overtime_hours),
    fixedOvertimePlan: row.fixed_overtime_plan ?? '',
    phone: row.phone,
    bankName: row.bank_name,
    bankAccount: row.bank_account,
    residentId: row.resident_id,
    homeAddress: row.home_address,
    gmail: row.gmail,
    naverEmail: row.naver_email,
    workplace: row.workplace,
    employmentType: row.employment_type,
    gender: row.gender,
    resignedOn: row.resigned_on ?? '',
    jobDescription: row.job_description,
    workDays: row.work_days,
    workHours: row.work_hours,
    breakTime: row.break_time,
    payBasis: row.pay_basis,
    annualSalary: row.annual_salary,
    monthlyWage: row.monthly_wage,
    mealAllowance: row.meal_allowance,
    carAllowance: row.car_allowance,
    childcareAllowance: row.childcare_allowance,
    dutyAllowance: row.duty_allowance,
    note: row.note,
    extra: row.extra,
  }
}

export async function listEmployeeRosters(): Promise<EmployeeRoster[]> {
  const { data, error } = await getSupabase()
    .from('employee_roster')
    .select(ROSTER_COLUMNS)

  if (error) {
    console.warn('[org] 근로자 명부 조회 실패', { message: error.message })
    throw new Error('근로자 명부를 불러오지 못했습니다.')
  }
  // Read the additive field separately so a pending migration never breaks the existing roster.
  const grants = await getSupabase().from('employee_roster').select('profile_id, accrued_annual_leave')
  if (grants.error) console.warn('[org] 연차 발생일수 조회 실패', { code: grants.error.code, message: grants.error.message })
  const byEmployee = new Map<string, number | null>((grants.data ?? []).map(row => [row.profile_id, row.accrued_annual_leave == null ? null : Number(row.accrued_annual_leave)]))
  const extras = await listExtraLeave()
  const available = new Map(extras.balances.map(row => [row.profileId, row.available]))
  return ((data ?? []) as RosterRow[]).map(row => ({
    ...fromRow(row),
    remainingAnnualLeave: row.remaining_annual_leave == null ? null : Number((Number(row.remaining_annual_leave) + (available.get(row.profile_id) ?? 0)).toFixed(2)),
    additionalAnnualLeave: extras.ready ? available.get(row.profile_id) ?? 0 : undefined,
    accruedAnnualLeave: grants.error ? undefined : byEmployee.get(row.profile_id) ?? null,
  }))
}

export async function saveEmployeeRosterField(
  profileId: string,
  field: RosterWriteFieldKey,
  value: string,
): Promise<void> {
  const numericColumn = field === 'remainingAnnualLeave' ? 'remaining_annual_leave' : field === 'inclusiveOvertimeHours' ? 'inclusive_overtime_hours' : null
  const spec = field === 'fixedOvertimePlan' ? { column: 'fixed_overtime_plan' } : numericColumn ? { column: numericColumn } : ROSTER_FIELDS.find((item) => item.key === field)
  if (!spec) throw new Error('저장할 명부 항목을 찾지 못했습니다.')
  let stored: string | number | null = field === 'resignedOn' ? value || null : value
  if (field === 'fixedOvertimePlan') {
    const plan = value.trim()
    if (plan && !FIXED_OVERTIME_PLANS.some(option => option === plan)) throw new Error('고정OT 설계는 유형 1 또는 유형 2를 선택해 주세요.')
    stored = plan
  }
  if (numericColumn) {
    const text = value.trim()
    if (text && (!/^[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text) || !Number.isFinite(Number(text)) || Math.abs(Number(text)) > 99999.99)) {
      throw new Error(field === 'inclusiveOvertimeHours' ? '약정 연장근로시간은 소수 둘째 자리까지 숫자로 입력해 주세요.' : '남은 연차는 소수 둘째 자리까지 숫자로 입력해 주세요.')
    }
    stored = text ? Number(text) : null
  }
  if (field === 'remainingAnnualLeave') {
    const { error: totalError } = await getSupabase().rpc('save_employee_leave_total', { p_employee: profileId, p_total: stored })
    if (!totalError) return
    if (!['PGRST202', '42883'].includes(totalError.code)) {
      console.warn('[org] 연차 합계 저장 실패', totalError)
      throw new Error(totalError.message)
    }
    // Before the additive migration, preserve the original base-only save path.
  }
  const { error } = await getSupabase()
    .from('employee_roster')
    .upsert(
      {
        profile_id: profileId,
        company_id: DEFAULT_COMPANY_ID,
        [spec.column]: stored,
      },
      { onConflict: 'profile_id' },
    )

  if (error) {
    console.warn('[org] 근로자 명부 저장 실패', {
      field,
      message: error.message,
    })
    throw new Error('근로자 명부를 저장하지 못했습니다.')
  }
}

export async function listRosterColumns(): Promise<RosterColumn[]> {
  const { data, error } = await getSupabase()
    .from('employee_roster_columns')
    .select('id, label, kind, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    console.warn('[org] 추가 헤더 조회 실패', { message: error.message })
    throw new Error('추가 헤더를 불러오지 못했습니다.')
  }
  return ((data ?? []) as { id: string; label: string; kind: RosterColumnKind; sort_order: number }[]).map((row) => ({
    id: row.id,
    label: row.label,
    kind: row.kind,
    sortOrder: row.sort_order,
  }))
}

export async function listRosterColumnValues(): Promise<RosterColumnValue[]> {
  const rows: RosterColumnValue[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await getSupabase()
      .from('employee_roster_values')
      .select('column_id, profile_id, value')
      .range(offset, offset + 999)
    if (error) {
      console.warn('[org] 추가 헤더 값 조회 실패', { message: error.message })
      throw new Error('추가 헤더 값을 불러오지 못했습니다.')
    }
    rows.push(...((data ?? []) as { column_id: string; profile_id: string; value: string }[]).map((row) => ({
      columnId: row.column_id,
      profileId: row.profile_id,
      value: row.value,
    })))
    if ((data ?? []).length < 1000) return rows
  }
}

export async function addRosterColumn(label: string, kind: RosterColumnKind): Promise<void> {
  const existing = await listRosterColumns()
  const sortOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1
  const { error } = await getSupabase().from('employee_roster_columns').insert({
    company_id: DEFAULT_COMPANY_ID,
    label: label.trim(),
    kind,
    sort_order: sortOrder,
  })
  if (error) {
    console.warn('[org] 추가 헤더 저장 실패', { message: error.message })
    throw new Error(error.code === '23505' ? '같은 이름의 헤더가 있습니다.' : '헤더를 추가하지 못했습니다.')
  }
}

export async function listRosterHeaderSettings(): Promise<{ ready: boolean; settings: RosterHeaderSetting[] }> {
  const { data, error } = await getSupabase().from('employee_roster_header_settings').select('header_key,label,hidden')
  if (error?.code === 'PGRST205' || error?.code === '42P01') {
    console.warn('[org] 전체 헤더 설정 저장소 적용 전: 기본 헤더 표시 유지')
    return { ready: false, settings: [] }
  }
  if (error) { console.warn('[org] 헤더 설정 조회 실패', error); throw new Error('헤더 설정을 불러오지 못했습니다.') }
  return { ready: true, settings: ((data ?? []) as { header_key: string; label: string; hidden: boolean }[]).map(row => ({ key: row.header_key, label: row.label, hidden: row.hidden })) }
}

export async function saveRosterHeaderSetting(key: string, label: string, hidden: boolean): Promise<void> {
  const next = label.trim()
  if (!next || next.length > 40) throw new Error('헤더 이름은 1자에서 40자까지 입력해 주세요.')
  if (!ROSTER_BASE_HEADERS.some(header => header.key === key) && !(key.startsWith('column:') && key.length > 7 && key.length <= 80)) throw new Error('헤더를 다시 확인해 주세요.')
  const { error } = await getSupabase().from('employee_roster_header_settings').upsert({ company_id: DEFAULT_COMPANY_ID, header_key: key, label: next, hidden }, { onConflict: 'company_id,header_key' })
  if (error) { console.warn('[org] 헤더 설정 저장 실패', { key, message: error.message }); throw new Error('헤더 설정을 저장하지 못했습니다.') }
}

export async function removeRosterColumn(columnId: string): Promise<void> {
  const { error } = await getSupabase().from('employee_roster_columns').delete().eq('id', columnId)
  if (error) {
    console.warn('[org] 추가 헤더 삭제 실패', { columnId, message: error.message })
    throw new Error('헤더를 삭제하지 못했습니다.')
  }
}

export async function saveRosterColumnValue(profileId: string, columnId: string, value: string): Promise<void> {
  const { error } = await getSupabase().from('employee_roster_values').upsert({
    column_id: columnId,
    profile_id: profileId,
    value,
  }, { onConflict: 'column_id,profile_id' })
  if (error) {
    console.warn('[org] 추가 헤더 값 저장 실패', { columnId, message: error.message })
    throw new Error('헤더 값을 저장하지 못했습니다.')
  }
}
