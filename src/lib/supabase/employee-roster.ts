import { DEFAULT_COMPANY_ID } from '@/lib/supabase/brands'
import { getSupabase } from '@/lib/supabase/client'

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

export type RosterFieldKey = (typeof ROSTER_FIELDS)[number]['key']

export type EmployeeRoster = {
  profileId: string
} & Record<RosterFieldKey, string>

type RosterRow = {
  profile_id: string
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
  'profile_id, phone, bank_name, bank_account, resident_id, home_address, gmail, naver_email, workplace, employment_type, gender, resigned_on, job_description, work_days, work_hours, break_time, pay_basis, annual_salary, monthly_wage, meal_allowance, car_allowance, childcare_allowance, duty_allowance, note, extra'

export function emptyRoster(profileId: string): EmployeeRoster {
  return {
    profileId,
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
  return ((data ?? []) as RosterRow[]).map(fromRow)
}

export async function saveEmployeeRosterField(
  profileId: string,
  field: RosterFieldKey,
  value: string,
): Promise<void> {
  const spec = ROSTER_FIELDS.find((item) => item.key === field)
  if (!spec) throw new Error('저장할 명부 항목을 찾지 못했습니다.')
  const stored = field === 'resignedOn' ? value || null : value
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
