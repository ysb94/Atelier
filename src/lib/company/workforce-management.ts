export const WORKFORCE_COMPANY_ID = 'e0000000-0000-4000-8000-000000000001'
export const LOGISTICS_DEPARTMENT_ID = 'c5d4cfca-97ce-4ca7-b30a-6beed842cf1e'
export const CHINA_DEPARTMENT_ID = 'bf926822-910c-422f-9c17-5fd3d8ddb3ba'
export const LOGISTICS_OPERATIONS_MANAGER_ID = '7f159ac7-9e05-41a4-8891-f9929d3af806'
export const LOGISTICS_OPERATIONS_HREF = '/logistics/operations'

export type WorkforceMode = 'head-office' | 'logistics' | 'external'
export type WorkforceMember = { departmentId?: string | null; workforceMode?: WorkforceMode }
export function workforceMode(member: WorkforceMember | null | undefined): WorkforceMode {
  if (member?.workforceMode) return member.workforceMode
  return member?.departmentId === CHINA_DEPARTMENT_ID ? 'external'
    : member?.departmentId === LOGISTICS_DEPARTMENT_ID ? 'logistics' : 'head-office'
}
export function isHeadOfficeMember(member: WorkforceMember | null | undefined) {
  return workforceMode(member) === 'head-office'
}
export function isPersonnelMember(member: WorkforceMember | null | undefined) {
  return workforceMode(member) !== 'external'
}
/** Named manager for this new area only; existing permission grants are unchanged. */
export function canManageLogisticsOperations(profile: (WorkforceMember & { id?: string | null; companyId?: string | null; status?: string | null }) | null | undefined) {
  return Boolean(profile?.status === 'active' && profile.companyId === WORKFORCE_COMPANY_ID
    && profile.id === LOGISTICS_OPERATIONS_MANAGER_ID)
}
