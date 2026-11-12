import { canViewMembers, canViewOperationsSupportPart, isOperationsDepartmentMember } from '../../lib/company/capabilities.ts'
import { releaseAccess } from '../../lib/company/release-access.ts'

export const OPERATIONS_SUPPORT_ROOT = '/operations-support'

/** 운영지원 사이드 메뉴 순서. 권한·담당자 설정은 별도 화면(`/settings/permissions`)이다. */
export const OPERATIONS_SECTIONS = [
  { id: 'attendance', label: '근태', description: '월별 직원 근태와 야근·외근·주말 근무를 확인합니다.' },
  { id: 'leave', label: '연차', description: '직원 휴가 신청과 연차 현황을 확인합니다.' },
  { id: 'people', label: '조직·멤버', description: '부서 배치와 직책·직급, 직원 계정을 관리합니다.' },
  { id: 'settings', label: '회사 설정', description: '회사 공지, 운영시간과 출근 기준, 출퇴근 제외자를 관리합니다.' },
] as const

export type OperationsSection = (typeof OPERATIONS_SECTIONS)[number]['id']
type OpsProfile = Parameters<typeof canViewOperationsSupportPart>[0]

export function isOperationsSection(value: string | null | undefined): value is OperationsSection {
  return OPERATIONS_SECTIONS.some(section => section.id === value)
}

export function operationsSectionHref(section: OperationsSection) {
  return `${OPERATIONS_SUPPORT_ROOT}/${section}`
}

/** `/operations-support/<section>` 경로의 업무. 다른 경로는 null. */
export function operationsSectionFromPath(pathname: string): OperationsSection | null {
  const section = pathname.replace(/\/+$/, '').split('/')[2]
  return pathname.startsWith(`${OPERATIONS_SUPPORT_ROOT}/`) && isOperationsSection(section) ? section : null
}

export function canViewPeopleOrg(profile: OpsProfile) {
  return canViewOperationsSupportPart(profile, 'org')
}

export function canViewPeopleMembers(profile: OpsProfile) {
  return canViewMembers(profile) || releaseAccess(profile).operations
}

/** 메뉴 노출과 화면 진입에 같은 판정을 쓴다. 기존 파트별 권한을 그대로 따른다. */
export function canViewOperationsSection(profile: OpsProfile, section: OperationsSection) {
  if (section === 'people') return canViewPeopleOrg(profile) || canViewPeopleMembers(profile)
  if (section === 'settings') return canViewOperationsSupportPart(profile, 'notices')
  if (section === 'leave' && isOperationsDepartmentMember(profile)) return true
  return canViewOperationsSupportPart(profile, section)
}

export function defaultOperationsSection(profile: OpsProfile): OperationsSection {
  return OPERATIONS_SECTIONS.find(({ id }) => id === 'leave'
    ? canViewOperationsSupportPart(profile, id)
    : canViewOperationsSection(profile, id))?.id ?? 'people'
}

/** 옛 `/operations-support?part=…` 주소를 업무별 주소로 바꾼다. 나머지 조회 조건은 유지한다. */
export function legacyOperationsHref(search: string, fallback: OperationsSection) {
  const params = new URLSearchParams(search)
  const part = params.get('part')
  params.delete('part')
  let section: OperationsSection = fallback
  if (part === 'org') section = 'people'
  else if (part === 'leave') section = 'leave'
  else if (part === 'hours' || part === 'notices') {
    section = 'settings'
    params.set('settingsView', part)
  } else if (part === 'attendance') {
    const view = params.get('attendanceView')
    if (view === 'settings' || view === 'exemptions') {
      section = 'settings'
      params.delete('attendanceView')
      params.set('settingsView', view === 'settings' ? 'hours' : 'exemptions')
    } else section = 'attendance'
  }
  const query = params.toString()
  return `${operationsSectionHref(section)}${query ? `?${query}` : ''}`
}
