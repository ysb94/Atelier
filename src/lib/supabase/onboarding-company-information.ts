import { getSupabase } from './client'
import { companyRosterValues } from '@/features/org/company-information-values'

/** 선택한 직원의 회사 입력정보만 조회한다. 연차 정산 RPC와 개인정보 조회는 실행하지 않는다. */
export async function loadOnboardingCompanyInformation(profileId: string, companyId: string) {
  const { data, error } = await getSupabase().from('employee_roster')
    .select('workplace,employment_type,job_description,work_days,work_hours,break_time,pay_basis,annual_salary,monthly_wage,meal_allowance,car_allowance,childcare_allowance,duty_allowance,fixed_overtime_plan')
    .eq('company_id', companyId).eq('profile_id', profileId).maybeSingle()
  if (error) {
    console.warn('[onboarding] 회사 입력정보 조회 실패', { code: error.code })
    throw new Error('직원 배치 정보를 불러오지 못했습니다.')
  }
  return data ? companyRosterValues(data) : null
}
