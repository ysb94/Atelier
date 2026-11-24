import { useQuery } from '@tanstack/react-query'
import { canViewMembers, DEFAULT_COMPANY_ID, WORK_CAPABILITIES, WORK_CAPABILITY_LABEL } from '@/lib/company/capabilities'
import { LOGISTICS_OPERATIONS_MANAGER_ID } from '@/lib/company/workforce-management'
import { hasPermission } from '@/lib/company/permissions'
import { RELEASE_EXCEPTION_IDS } from '@/lib/company/release-access'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import { listAttendanceExemptions } from '@/lib/supabase/attendance-exemptions'
import { loadBasicWorkAccess, type BasicWorkDomain } from '@/lib/supabase/basic-work-access'
import { listChinaWorkAssignees } from '@/lib/supabase/china-work-assignees'
import { getSupabase } from '@/lib/supabase/client'
import { listDepartmentApprovers, type DepartmentApprover } from '@/lib/supabase/department-approvers'
import { listMaterialNudgeRecipients } from '@/lib/supabase/material-nudge-recipients'
import { fetchAllPages } from '@/lib/supabase/paged-select'
import type { PermissionDirectory } from '@/lib/supabase/permission-grants'
import type { Profile } from '@/lib/supabase/profiles'
import { loadWorkRequestSettings } from '@/lib/supabase/work-request-settings'
import { listDepartmentWorkforceManagement } from '@/lib/supabase/workforce-management'
import type { PermissionMatrixRow, PermissionMatrixSection } from './permission-matrix-model'

type MatrixQuery<T> = { data: T | undefined; isError: boolean; refetch: () => Promise<unknown> }
type Availability = 'allowed' | 'loading' | 'unavailable' | 'error'

function readSection<T>(
  id: string,
  label: string,
  query: MatrixQuery<T>,
  toRows: (data: T) => PermissionMatrixRow[] | null,
  availability: Availability = 'allowed',
  retry = query.refetch,
): PermissionMatrixSection {
  if (availability === 'loading' || availability === 'unavailable') return { id, label, status: availability, rows: [] }
  const reload = () => { void retry() }
  if (availability === 'error' || query.isError) return { id, label, status: 'error', rows: [], retry: reload }
  if (!query.data) return { id, label, status: 'loading', rows: [] }
  const rows = toRows(query.data)
  return rows === null ? { id, label, status: 'unavailable', rows: [], retry: reload } : { id, label, rows, retry: reload }
}

function approvalRows(settings: readonly DepartmentApprover[], departments: PermissionDirectory['scopes']): PermissionMatrixRow[] {
  const byDepartment = new Map(settings.map(setting => [`${setting.departmentId}:${setting.type}`, setting]))
  return departments.filter(department => department.kind === 'department').flatMap(department => {
    const rows = ([['leave', '출퇴근 정정'], ['overtime', '야근']] as const).flatMap(([type, label]) => {
      const setting = byDepartment.get(`${department.id}:${type}`)
      return [
        { id: `${department.id}:${type}:primary`, label: `${label} 승인자`, scope: department.name, memberIds: setting?.approverId ? [setting.approverId] : [] },
        { id: `${department.id}:${type}:substitute`, label: `${label} 대체 승인자`, scope: department.name, memberIds: setting?.substituteId ? [setting.substituteId] : [] },
      ]
    })
    const ids = rows.flatMap(row => row.memberIds)
    return [...rows, { id: `${department.id}:attendance-settings`, label: '담당 부서 출근시간 설정', scope: department.name, memberIds: [...new Set(ids)] }]
  })
}

type ExistingAssignments = {
  profiles: { id: string; is_admin: boolean }[]
  capabilities: { profile_id: string; capability: string }[]
  memberships: { profile_id: string; brand_id: string; is_lead: boolean }[]
}

/** Apply the members screen's existing read rights to just the matrix's three stored role fields. */
async function listExistingAssignments(company: string, profileIds: string[]): Promise<ExistingAssignments> {
  if (!profileIds.length) return { profiles: [], capabilities: [], memberships: [] }
  const supabase = getSupabase()
  const [profiles, capabilities, memberships] = await Promise.all([
    fetchAllPages<ExistingAssignments['profiles'][number]>({ fetchPage: async (from, to, count) => {
      const result = await supabase.from('profiles').select('id,is_admin', count ? { count: 'exact' } : undefined)
        .eq('company_id', company).eq('status', 'active').order('id').range(from, to)
      if (result.error) throw new Error('사이트 관리자 지정을 불러오지 못했습니다.')
      return { rows: result.data ?? [], count: result.count }
    } }),
    fetchAllPages<ExistingAssignments['capabilities'][number]>({ fetchPage: async (from, to, count) => {
      const result = await supabase.from('profile_capabilities').select('profile_id,capability', count ? { count: 'exact' } : undefined)
        .in('profile_id', profileIds).order('profile_id').order('capability').range(from, to)
      if (result.error) throw new Error('직원 업무 권한 지정을 불러오지 못했습니다.')
      return { rows: result.data ?? [], count: result.count }
    } }),
    fetchAllPages<ExistingAssignments['memberships'][number]>({ fetchPage: async (from, to, count) => {
      const result = await supabase.from('brand_members').select('profile_id,brand_id,is_lead', count ? { count: 'exact' } : undefined)
        .in('profile_id', profileIds).order('profile_id').order('brand_id').range(from, to)
      if (result.error) throw new Error('브랜드 이용 대상과 책임자 지정을 불러오지 못했습니다.')
      return { rows: result.data ?? [], count: result.count }
    } }),
  ])
  return { profiles, capabilities, memberships }
}

function existingAssignmentRows(assignments: ExistingAssignments, directory: PermissionDirectory, profileIds: readonly string[]): PermissionMatrixRow[] | null {
  const active = new Set(assignments.profiles.map(profile => profile.id))
  if (profileIds.some(id => !active.has(id))) return null
  return [
    { id: 'account-admin', label: '사이트 관리자 지정', memberIds: assignments.profiles.filter(member => member.is_admin).map(member => member.id) },
    ...WORK_CAPABILITIES.map(capability => ({
      id: `capability:${capability}`, label: `${WORK_CAPABILITY_LABEL[capability]} 업무 권한 지정`,
      memberIds: assignments.capabilities.filter(item => item.capability === capability).map(item => item.profile_id),
    })),
    ...directory.scopes.filter(scope => scope.kind === 'brand').flatMap(scope => {
      const members = assignments.memberships.filter(item => item.brand_id === scope.id)
      return [
        { id: `brand-member:${scope.id}`, label: '브랜드 이용 대상', scope: scope.name, memberIds: members.map(item => item.profile_id) },
        { id: `brand-lead:${scope.id}`, label: '브랜드 책임자', scope: scope.name, memberIds: members.filter(item => item.is_lead).map(item => item.profile_id) },
      ]
    }),
  ]
}

type PartnerEditor = { brand_id: string; usage_target_id: string; profile_id: string }

function listPartnerEditors(brandIds: string[]) {
  if (!brandIds.length) return Promise.resolve([])
  return fetchAllPages<PartnerEditor>({ fetchPage: async (from, to, count) => {
    const result = await getSupabase().from('usage_partner_editors')
      .select('brand_id,usage_target_id,profile_id', count ? { count: 'exact' } : undefined)
      .in('brand_id', brandIds).order('brand_id').order('usage_target_id').order('profile_id').range(from, to)
    if (result.error) throw new Error('업체 담당 지정 내역을 불러오지 못했습니다.')
    return { rows: result.data ?? [], count: result.count }
  } })
}

function partnerEditorRows(editors: readonly PartnerEditor[], directory: PermissionDirectory): PermissionMatrixRow[] {
  const byTarget = new Map<string, string[]>()
  for (const editor of editors) {
    const assigned = byTarget.get(editor.usage_target_id)
    if (assigned) assigned.push(editor.profile_id)
    else byTarget.set(editor.usage_target_id, [editor.profile_id])
  }
  return directory.scopes.filter(scope => scope.kind === 'partner').map(scope => ({
    id: `partner-editor:${scope.id}`, label: '업체 헤더·전용값 담당자', scope: scope.name,
    memberIds: byTarget.get(scope.id) ?? [],
  }))
}

export function usePermissionMatrixSources(profile: Profile | null, directory: PermissionDirectory | undefined): PermissionMatrixSection[] {
  const { session } = useAuth()
  const visible = useWorkspaceTabActivity()
  const actor = profile?.id
  const company = profile?.companyId
  const full = hasPermission(profile, 'permissions.manage') || (profile?.permissionMode === 'legacy' && profile.isAdmin)
  const authorized = Boolean(full && directory && directory.canManageAll !== false && profile?.status === 'active' && company && actor && actor === session?.user.id)
  const enabled = authorized && visible
  const atelier = company === DEFAULT_COMPANY_ID
  const peopleAllowed = canViewMembers(profile)
  const legacyPartners = profile?.permissionMode === 'legacy'
  const brandIds = directory?.scopes.filter(scope => scope.kind === 'brand').map(scope => scope.id) ?? []
  const profileIds = directory?.profiles.filter(member => member.status === 'active').map(member => member.id) ?? []

  const access = useQuery({ ...sharedReadPolicy, queryKey: ['basic-work-access', actor, profile?.updatedAt], queryFn: loadBasicWorkAccess, enabled: enabled && atelier })
  const domainState = (domain: BasicWorkDomain): Availability => {
    if (!atelier) return 'unavailable'
    if (access.isError) return 'error'
    if (!access.data) return 'loading'
    return access.data.profileId === actor && access.data.domains.includes(domain) ? 'allowed' : 'unavailable'
  }
  const planning = domainState('planning')
  const china = domainState('china')

  const approvals = useQuery({ ...sharedReadPolicy, queryKey: ['department-approvers', actor, true], queryFn: listDepartmentApprovers, enabled })
  const exemptions = useQuery({ ...sharedReadPolicy, queryKey: ['orgChartMembers', actor, 'attendance-exemptions'], queryFn: listAttendanceExemptions, enabled })
  const visual = useQuery({ ...sharedReadPolicy, queryKey: ['work-request-settings', actor, 'design'], queryFn: loadWorkRequestSettings, enabled })
  const workforce = useQuery({ ...sharedReadPolicy, queryKey: ['department-workforce-management', actor, company], queryFn: listDepartmentWorkforceManagement, enabled })
  const nudge = useQuery({ ...sharedReadPolicy, queryKey: ['material-nudge-recipients', actor, company], queryFn: listMaterialNudgeRecipients, enabled: enabled && planning === 'allowed' })
  const chinaAssignees = useQuery({ ...sharedReadPolicy, queryKey: ['china-work-assignees', actor, company], queryFn: listChinaWorkAssignees, enabled: enabled && china === 'allowed' })
  const people = useQuery({ ...sharedReadPolicy, queryKey: ['manageable-profiles', actor, company, 'permission-matrix', profileIds],
    queryFn: () => listExistingAssignments(company!, profileIds), enabled: enabled && peopleAllowed })
  const partnerEditors = useQuery({ ...sharedReadPolicy, queryKey: ['usagePartnerSettings', 'editors', actor, brandIds],
    queryFn: () => listPartnerEditors(brandIds), enabled: enabled && legacyPartners && Boolean(profile?.isAdmin) })

  if (!directory || !authorized) return []
  const departmentName = (id: string) => directory.scopes.find(scope => scope.kind === 'department' && scope.id === id)?.name ?? '부서'
  const sections = [
    readSection('approval', '부서별 승인·근태 담당', approvals, data => approvalRows(data, directory.scopes)),
    readSection('attendance-exemptions', '근태 예외', exemptions, ids => [{ id: 'exempt', label: '출퇴근 기록 제외자', memberIds: ids }]),
    readSection('visual', 'Visual 작업 요청', visual, settings => settings.available ? [
      { id: 'visual-supervisor', label: '총괄 관리자', memberIds: settings.activeSupervisorIds ?? settings.supervisorIds ?? [] },
      ...settings.categories.filter(category => category.enabled).map(category => ({
        id: `visual:${category.id}`, label: '중간 관리자', scope: category.label, memberIds: category.assigneeId ? [category.assigneeId] : [],
      })),
    ] : null),
    readSection('material-nudge', '기획 · 자재요청', nudge,
      ids => [{ id: 'nudge-recipient', label: '자재요청 조르기 수신자', memberIds: ids }], planning, access.isError ? access.refetch : nudge.refetch),
    readSection('china', '중국 업무', chinaAssignees,
      ids => [{ id: 'china-assignment', label: '업무 배정 대상', scope: '작업지시서 · 자재요청', memberIds: ids.map(id => id.profileId) }], china, access.isError ? access.refetch : chinaAssignees.refetch),
    readSection('external-contacts', '조직 · 외부 협력사', workforce, data => data.ready
      ? data.items.filter(item => item.mode === 'external').map(item => ({
        id: `contact:${item.departmentId}`, label: '외부 협력사 소통 담당', scope: departmentName(item.departmentId), memberIds: item.contactIds,
      })) : null),
    readSection('accounts-and-brands', '직원·브랜드 직접 지정', people, data => existingAssignmentRows(data, directory, profileIds), peopleAllowed ? 'allowed' : 'unavailable'),
  ]
  if (legacyPartners) sections.push(readSection('legacy-partner-editors', '업체별 기존 담당 지정', partnerEditors,
    data => partnerEditorRows(data, directory), profile.isAdmin ? 'allowed' : 'unavailable'))
  if (atelier) sections.push({ id: 'logistics-operations', label: '물류 운영', rows: [
    { id: 'logistics-operations-manager', label: '물류 운영 담당자', memberIds: [LOGISTICS_OPERATIONS_MANAGER_ID] },
  ] }, { id: 'screen-release', label: '화면 공개', rows: [
    { id: 'release-exceptions', label: '화면 공개 범위 예외', memberIds: RELEASE_EXCEPTION_IDS },
  ] })
  sections.push(
    { id: 'access-ip-reviewers', label: '접속 기록 조회 담당', status: 'unavailable', rows: [] },
    { id: 'impersonation-operators', label: '직원 계정 전환 운영자', status: 'unavailable', rows: [] },
  )
  return sections
}
