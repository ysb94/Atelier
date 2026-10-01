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

export const PERSONNEL_SCOPES = ['leaders', 'members'] as const

export type PersonnelScope = (typeof PERSONNEL_SCOPES)[number]

export const DEFAULT_COMPANY_ID = 'e0000000-0000-4000-8000-000000000001'
export const ATELIER_BRAND_ID = 'b0000000-0000-4000-8000-000000000001'

/** 조직도의 부서·직책·직급을 고칠 수 있는 개발자 계정. DB 함수와 같다. */
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
  return isApprovedCompanyMember(profile) && Boolean(profile?.isAdmin)
}

export function isCompanyManager(profile: CapabilityProfile | null) {
  return (
    isApprovedCompanyMember(profile) &&
    (isCompanyAdmin(profile) || isCompanyManagerPosition(profile?.position))
  )
}

/**
 * 조직도에서 다른 직원의 부서·직책·직급을 고친다.
 * 개발자 계정과 운영지원팀 소속만 해당한다. 다른 관리자는 해당하지 않는다.
 * DB `app.can_edit_org_assignment`과 같은 조건이다.
 */
export function canEditOrgAssignment(
  profile: (CapabilityProfile & {
    email?: string | null
    departmentName?: string | null
  }) | null,
) {
  if (!isApprovedCompanyMember(profile)) return false
  const email = profile?.email?.trim().toLowerCase()
  if (email === ORG_ASSIGNMENT_EDITOR_EMAIL) return true
  return profile?.departmentName === OPERATIONS_SUPPORT_DEPARTMENT
}

/** 가입 승인과 직책·소속 변경. DB `app.can_manage_personnel`과 같은 조건이다. */
export function canManagePersonnel(profile: CapabilityProfile | null) {
  if (!isApprovedCompanyMember(profile)) return false
  if (isCompanyAdmin(profile)) return true
  if (profile?.departmentPersonnelScope === 'members') return true
  return (
    profile?.departmentPersonnelScope === 'leaders' &&
    isCompanyManagerPosition(profile.position)
  )
}

/** 기획안을 직원별로 보는 권한. 관리자여도 직급이 팀장·이사여야 한다. */
export function canViewDraftsByOwner(profile: CapabilityProfile | null) {
  return (
    isApprovedCompanyMember(profile) &&
    isCompanyManagerPosition(profile?.position)
  )
}

export function profileCapabilities(
  profile: CapabilityProfile | null,
): WorkCapability[] {
  return uniqueCapabilities(profile?.capabilities ?? [])
}

export function hasCapability(
  profile: CapabilityProfile | null,
  capability: WorkCapability,
) {
  if (!isApprovedCompanyMember(profile)) return false
  if (isCompanyAdmin(profile)) return true
  return profileCapabilities(profile).includes(capability)
}

export function hasAnyCapability(profile: CapabilityProfile | null) {
  if (!isApprovedCompanyMember(profile)) return false
  if (isCompanyAdmin(profile)) return true
  return profileCapabilities(profile).length > 0
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
