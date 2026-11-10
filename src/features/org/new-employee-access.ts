import type { Profile } from '@/lib/supabase/profiles'
import type { OnboardingEmployee } from '@/lib/supabase/employee-onboarding'
import { RELEASE_COMPANY_ID } from '@/lib/company/release-access'

export const EMPLOYEE_ACCESS_QUERY = 'employee-access-requests'
export const NEW_EMPLOYEES_HREF = '/operations-support/people?orgView=new'
export type NewEmployeeView = 'active' | 'complete' | 'rejected'
export type NewEmployeeRow = OnboardingEmployee & { connected: boolean }

/** 가입 대기자는 서류 기록·배치·근태 관리 범위와 관계없이 표시한다. */
export function newEmployeeRows(records: readonly OnboardingEmployee[], requests: readonly Profile[]): NewEmployeeRow[] {
  const cases = records.map(record => ({ ...record, connected: true }))
  const byProfile = new Map(cases.filter(row => !row.isTest).map(row => [row.profileId, row]))
  for (const profile of requests) {
    if (profile.companyId !== RELEASE_COMPANY_ID || !['pending', 'rejected'].includes(profile.status)) continue
    const existing = byProfile.get(profile.id)
    if (existing) {
      Object.assign(existing, { status: profile.status, displayName: profile.displayName || profile.email, email: profile.email,
        requestedAt: profile.requestedAt, departmentId: profile.departmentId, position: profile.position, jobGrade: profile.jobGrade, hireDate: profile.hireDate })
    } else {
      const row: NewEmployeeRow = { id: `access:${profile.id}`, profileId: profile.id, isTest: false,
        displayName: profile.displayName || profile.email, email: profile.email, status: profile.status,
        requestedAt: profile.requestedAt, departmentId: profile.departmentId, position: profile.position, jobGrade: profile.jobGrade, hireDate: profile.hireDate,
        submittedAt: null, companySaved: false, completedAt: null, version: 0, employeeFiles: 0, signedFiles: 0, connected: false }
      cases.push(row)
      byProfile.set(profile.id, row)
    }
  }
  return cases.sort((left,right)=>Number(right.status==='pending')-Number(left.status==='pending'))
}

export function inNewEmployeeView(row: NewEmployeeRow, view: NewEmployeeView) {
  if (row.status === 'rejected') return view === 'rejected'
  if (row.status === 'pending' && !row.isTest) return view === 'active'
  return view === 'complete' ? Boolean(row.completedAt) : view === 'active' && !row.completedAt
}

export function accessStatusLabel(status: string) {
  return ({ pending: '승인 대기', active: '승인 완료', rejected: '거절', disabled: '계정 정지' } as Record<string,string>)[status] ?? '상태 확인 필요'
}
