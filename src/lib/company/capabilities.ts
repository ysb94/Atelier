import { hasPermission, type PermissionGrant, type PermissionCode } from './permissions'
export const WORK_CAPABILITIES = [
  'planning',
  'design',
  'md',
  'logistics',
  'data',
] as const

export type WorkCapability = (typeof WORK_CAPABILITIES)[number]

export const WORK_CAPABILITY_LABEL: Record<WorkCapability, string> = {
  planning: '기획',
  design: '디자인',
  md: 'MD',
  logistics: '물류',
  data: '데이터',
}

export const COMPANY_MANAGER_POSITIONS = ['팀장', '이사'] as const

/**
 * 이전 데이터·화면 사례의 직책 분류용 목록. 실제 출퇴근 제외는 attendance.exempt 지정으로 판정한다.
 */
export const ATTENDANCE_EXEMPT_POSITIONS: readonly string[] = [
  '대표이사',
  '부사장',
  '전무',
  '상무',
  '이사',
]

export const PERSONNEL_SCOPES = ['leaders', 'members'] as const

export type PersonnelScope = (typeof PERSONNEL_SCOPES)[number]

export const DEFAULT_COMPANY_ID = 'e0000000-0000-4000-8000-000000000001'
export const ATELIER_BRAND_ID = 'b0000000-0000-4000-8000-000000000001'

/** 이전 데이터와 화면 사례에서 사용하는 계정 이름. 권한 판정에는 사용하지 않는다. */
export const ORG_ASSIGNMENT_EDITOR_EMAIL = 'dev@atelier.local'
export const OPERATIONS_SUPPORT_DEPARTMENT = '운영지원팀'

export function isWorkCapability(value: string): value is WorkCapability {
  return (WORK_CAPABILITIES as readonly string[]).includes(value)
}

export function capabilityLabel(value: string) {
  return isWorkCapability(value) ? WORK_CAPABILITY_LABEL[value] : value
}

export function uniqueCapabilities(values: string[]): WorkCapability[] {
  return [...new Set(values.filter(isWorkCapability))]
}

export function isCompanyManagerPosition(position?: string | null) {
  return Boolean(
    position &&
      (COMPANY_MANAGER_POSITIONS as readonly string[]).includes(position),
  )
}

export function inferCapabilityFromDepartment(
  departmentName?: string | null,
): WorkCapability | null {
  if (!departmentName) return null
  const key = departmentName.replace(/\s|팀/g, '').toLowerCase()
  if (key.includes('기획')) return 'planning'
  if (
    key.includes('visual') ||
    key.includes('디자인') ||
    key.includes('비주얼')
  ) {
    return 'design'
  }
  if (key.includes('md') || key.includes('엠디')) return 'md'
  if (key.includes('물류')) return 'logistics'
  if (key.includes('데이터')) return 'data'
  return null
}

export type CapabilityProfile = {
  companyId?: string | null
  permissionGrants?: readonly PermissionGrant[]
  status?: string | null
  isAdmin?: boolean
  position?: string | null
  capabilities?: string[]
  departmentPersonnelScope?: PersonnelScope | null
}

export function isApprovedCompanyMember(profile: CapabilityProfile | null) {
  return Boolean(profile && profile.status === 'active')
}

export function isCompanyAdmin(profile: CapabilityProfile | null) {
  return hasPermission(profile, 'system.manage')
}

/** 명시적으로 지정한 회사 현황 조회. 업무 저장·승인 권한과 분리한다. */
export function isCompanyReviewer(profile: CapabilityProfile | null) {
  return hasPermission(profile, 'company.review')
}

/** 브랜드 생성·편집 또는 회사 현황 조회를 지정한 사람의 화면 진입. */
export function canAccessBrandManagement(
  profile: (CapabilityProfile & { email?: string | null }) | null,
) {
  return ['brand.manage','brand.edit','company.review'].some(code => hasPermission(profile, code as PermissionCode))
}

/** 공모전 접수함 조회를 지정한 사람만 허용한다. */
export function canAccessMamamIdeaInbox(
  profile: (CapabilityProfile & { email?: string | null }) | null,
) {
  return hasPermission(profile, 'ideas.read')
}

export function isAttendanceExemptPosition(position?: string | null) {
  const normalized = position?.trim()
  return Boolean(normalized && ATTENDANCE_EXEMPT_POSITIONS.includes(normalized))
}

/** 출퇴근 제외 설정을 지정한 활성 계정. 직책 이름은 판정하지 않는다. */
export function isAttendanceExempt(profile: CapabilityProfile | null) {
  return hasPermission(profile, 'attendance.exempt')
}

export function isCompanyManager(profile: CapabilityProfile | null) {
  return hasPermission(profile, 'work.manage')
}

/**
 * 조직도에서 다른 직원의 부서·직책·직급을 고친다.
 * org.manage 지정만 판정한다. 소속·직책·이메일 예외는 없다.
 * DB `app.can_edit_org_assignment`과 같은 조건이다.
 */
export function canEditOrgAssignment(
  profile: (CapabilityProfile & {
    email?: string | null
    departmentName?: string | null
  }) | null,
) {
  return hasPermission(profile, 'org.manage')
}

/** 운영지원 기능 권한으로 화면을 연다. 각 저장 작업은 별도의 지정 권한을 확인한다. */
export function canAccessOperationsSupport(
  profile: Parameters<typeof canEditOrgAssignment>[0],
) {
  return ['org.manage','personnel.manage','approvers.manage','attendance.manage','notice.company.write','notice.company.delete','company.review'].some(code => hasPermission(profile, code as PermissionCode))
}

/** 가입 승인과 직책·소속 변경. DB `app.can_manage_personnel`과 같은 조건이다. */
export function canManagePersonnel(profile: CapabilityProfile | null) {
  return hasPermission(profile, 'personnel.manage')
}

/** 직원별 기획안 조회를 지정한 사람에게 허용한다. */
export function canViewDraftsByOwner(profile: CapabilityProfile | null) {
  return hasPermission(profile, 'drafts.read')
}

export function profileCapabilities(
  profile: CapabilityProfile | null,
): WorkCapability[] {
  return WORK_CAPABILITIES.filter(key => hasPermission(profile, `data.${key}`))
}

export function hasCapability(
  profile: CapabilityProfile | null,
  capability: WorkCapability,
) {
  return hasPermission(profile, `data.${capability}`)
}

export function hasAnyCapability(profile: CapabilityProfile | null) {
  return WORK_CAPABILITIES.some(key => hasPermission(profile, `data.${key}`))
}

export function canEditBrandData(
  profile: CapabilityProfile | null,
  capability?: WorkCapability,
) {
  if (!hasAnyCapability(profile)) return false
  return capability ? hasCapability(profile, capability) : true
}

export function brandStorageRoot(slug?: string | null) {
  const normalized = slug?.trim().toLowerCase()
  if (!normalized || normalized === 'atelier') return 'masmarulez'
  return normalized
}
