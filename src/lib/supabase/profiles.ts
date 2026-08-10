import { getSupabase } from '@/lib/supabase/client'

export type ProfileStatus = 'pending' | 'active' | 'rejected' | 'disabled'

export type Department = {
  id: string
  companyId: string
  name: string
  sortOrder: number
  isActive: boolean
}

export type BrandDirectoryItem = {
  id: string
  slug: string
  name: string
  nameKo: string
  color: string
  foundedYear: number
}

export type BrandMembership = {
  brandId: string
  isLead: boolean
}

export type Profile = {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  departmentId: string | null
  position: string | null
  isAdmin: boolean
  status: ProfileStatus
  requestedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  requestNote: string | null
  createdAt: string
  updatedAt: string
  departmentName?: string | null
  memberships: BrandMembership[]
}

export type AccessRequestInput = {
  displayName: string
  departmentId: string
  position: string
  brandIds: string[]
  requestNote?: string
}

export type ApproveMemberInput = {
  profileId: string
  departmentId: string
  position: string
  brandIds: string[]
  leadBrandIds: string[]
  isAdmin: boolean
  displayName?: string
}

export const POSITION_OPTIONS = [
  '사원',
  '대리',
  '과장',
  '팀장',
  '이사',
] as const

type ProfileRow = {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  department_id: string | null
  position: string | null
  is_admin: boolean
  status: ProfileStatus
  requested_at: string | null
  approved_by: string | null
  approved_at: string | null
  request_note: string | null
  created_at: string
  updated_at: string
  departments?: { name: string } | { name: string }[] | null
}

type DepartmentRow = {
  id: string
  company_id: string
  name: string
  sort_order: number
  is_active: boolean
}

type BrandDirectoryRow = {
  id: string
  slug: string
  name: string
  name_ko: string
  color: string
  founded_year: number
}

const PROFILE_COLUMNS =
  'id, email, display_name, avatar_url, department_id, position, is_admin, status, requested_at, approved_by, approved_at, request_note, created_at, updated_at, departments(name)'

function departmentNameFrom(
  value: ProfileRow['departments'],
): string | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0]?.name ?? null
  return value.name ?? null
}

function toProfile(
  row: ProfileRow,
  memberships: BrandMembership[] = [],
): Profile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    departmentId: row.department_id,
    position: row.position,
    isAdmin: row.is_admin,
    status: row.status,
    requestedAt: row.requested_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    requestNote: row.request_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    departmentName: departmentNameFrom(row.departments),
    memberships,
  }
}

function toStoreError(error: { message: string }) {
  return new Error(error.message)
}

async function membershipsFor(
  profileIds: string[],
): Promise<Map<string, BrandMembership[]>> {
  const map = new Map<string, BrandMembership[]>()
  if (profileIds.length === 0) return map

  const { data, error } = await getSupabase()
    .from('brand_members')
    .select('brand_id, profile_id, is_lead')
    .in('profile_id', profileIds)

  if (error) throw toStoreError(error)

  for (const row of data ?? []) {
    const list = map.get(row.profile_id) ?? []
    list.push({ brandId: row.brand_id, isLead: row.is_lead })
    map.set(row.profile_id, list)
  }
  return map
}

export async function listDepartments(
  activeOnly = true,
): Promise<Department[]> {
  let query = getSupabase()
    .from('departments')
    .select('id, company_id, name, sort_order, is_active')
    .order('sort_order', { ascending: true })

  if (activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) throw toStoreError(error)

  return ((data ?? []) as DepartmentRow[]).map((row) => ({
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }))
}

/** 승인 전에도 쓸 수 있는 브랜드 이름 목록 */
export async function listBrandDirectory(): Promise<BrandDirectoryItem[]> {
  const { data, error } = await getSupabase()
    .from('brands')
    .select('id, slug, name, name_ko, color, founded_year')
    .order('name', { ascending: true })

  if (error) throw toStoreError(error)

  return ((data ?? []) as BrandDirectoryRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    nameKo: row.name_ko,
    color: row.color,
    foundedYear: row.founded_year,
  }))
}

export async function getMyProfile(): Promise<Profile | null> {
  const { data: userData, error: userError } = await getSupabase().auth.getUser()
  if (userError) throw toStoreError(userError)
  const userId = userData.user?.id
  if (!userId) return null

  const { data, error } = await getSupabase()
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle()

  if (error) throw toStoreError(error)
  if (!data) return null

  const memberships = await membershipsFor([userId])
  return toProfile(data as ProfileRow, memberships.get(userId) ?? [])
}

export async function submitAccessRequest(
  input: AccessRequestInput,
): Promise<Profile> {
  const { data: userData, error: userError } = await getSupabase().auth.getUser()
  if (userError) throw toStoreError(userError)
  const userId = userData.user?.id
  if (!userId) throw new Error('로그인이 필요합니다.')

  if (!input.departmentId) throw new Error('팀을 선택하세요.')
  if (!input.position.trim()) throw new Error('직책을 선택하세요.')
  if (input.brandIds.length === 0) {
    throw new Error('담당 브랜드를 하나 이상 선택하세요.')
  }

  const { error: deleteError } = await getSupabase()
    .from('brand_members')
    .delete()
    .eq('profile_id', userId)

  if (deleteError) throw toStoreError(deleteError)

  const { error: insertError } = await getSupabase()
    .from('brand_members')
    .insert(
      input.brandIds.map((brandId) => ({
        brand_id: brandId,
        profile_id: userId,
        is_lead: false,
      })),
    )

  if (insertError) throw toStoreError(insertError)

  const { data, error } = await getSupabase()
    .from('profiles')
    .update({
      display_name: input.displayName.trim(),
      department_id: input.departmentId,
      position: input.position.trim(),
      request_note: input.requestNote?.trim() || null,
      requested_at: new Date().toISOString(),
      status: 'pending',
      approved_by: null,
      approved_at: null,
    })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single()

  if (error) throw toStoreError(error)

  const memberships = await membershipsFor([userId])
  return toProfile(data as ProfileRow, memberships.get(userId) ?? [])
}

/** 승인자가 볼 수 있는 멤버 목록. RLS가 범위를 걸러 준다. */
export async function listManageableProfiles(): Promise<Profile[]> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .order('requested_at', { ascending: false, nullsFirst: false })

  if (error) throw toStoreError(error)

  const rows = (data ?? []) as ProfileRow[]
  const memberships = await membershipsFor(rows.map((row) => row.id))
  return rows.map((row) => toProfile(row, memberships.get(row.id) ?? []))
}

export async function approveMember(
  input: ApproveMemberInput,
): Promise<Profile> {
  if (input.brandIds.length === 0) {
    throw new Error('담당 브랜드를 하나 이상 지정하세요.')
  }

  const leadSet = new Set(input.leadBrandIds)
  for (const leadId of leadSet) {
    if (!input.brandIds.includes(leadId)) {
      throw new Error('팀장으로 지정한 브랜드는 담당에도 포함되어야 합니다.')
    }
  }

  const { data: userData, error: userError } = await getSupabase().auth.getUser()
  if (userError) throw toStoreError(userError)
  const actorId = userData.user?.id
  if (!actorId) throw new Error('로그인이 필요합니다.')

  const { error: deleteError } = await getSupabase()
    .from('brand_members')
    .delete()
    .eq('profile_id', input.profileId)

  if (deleteError) throw toStoreError(deleteError)

  const { error: insertError } = await getSupabase()
    .from('brand_members')
    .insert(
      input.brandIds.map((brandId) => ({
        brand_id: brandId,
        profile_id: input.profileId,
        is_lead: leadSet.has(brandId),
      })),
    )

  if (insertError) throw toStoreError(insertError)

  const patch: Record<string, unknown> = {
    department_id: input.departmentId,
    position: input.position.trim(),
    status: 'active',
    approved_by: actorId,
    approved_at: new Date().toISOString(),
    is_admin: input.isAdmin,
  }
  if (input.displayName?.trim()) {
    patch.display_name = input.displayName.trim()
  }

  const { data, error } = await getSupabase()
    .from('profiles')
    .update(patch)
    .eq('id', input.profileId)
    .select(PROFILE_COLUMNS)
    .single()

  if (error) throw toStoreError(error)

  const memberships = await membershipsFor([input.profileId])
  return toProfile(data as ProfileRow, memberships.get(input.profileId) ?? [])
}

export async function rejectMember(profileId: string): Promise<Profile> {
  const { data: userData, error: userError } = await getSupabase().auth.getUser()
  if (userError) throw toStoreError(userError)
  const actorId = userData.user?.id
  if (!actorId) throw new Error('로그인이 필요합니다.')

  const { data, error } = await getSupabase()
    .from('profiles')
    .update({
      status: 'rejected',
      approved_by: actorId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', profileId)
    .select(PROFILE_COLUMNS)
    .single()

  if (error) throw toStoreError(error)

  const memberships = await membershipsFor([profileId])
  return toProfile(data as ProfileRow, memberships.get(profileId) ?? [])
}

export async function setMemberDisabled(
  profileId: string,
  disabled: boolean,
): Promise<Profile> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .update({ status: disabled ? 'disabled' : 'active' })
    .eq('id', profileId)
    .select(PROFILE_COLUMNS)
    .single()

  if (error) throw toStoreError(error)

  const memberships = await membershipsFor([profileId])
  return toProfile(data as ProfileRow, memberships.get(profileId) ?? [])
}

export async function createDepartment(name: string): Promise<Department> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('팀 이름을 입력하세요.')

  const existing = await listDepartments(false)
  const maxOrder = existing.reduce(
    (max, dept) => Math.max(max, dept.sortOrder),
    0,
  )

  const { data, error } = await getSupabase()
    .from('departments')
    .insert({
      company_id: 'e0000000-0000-4000-8000-000000000001',
      name: trimmed,
      sort_order: maxOrder + 1,
      is_active: true,
    })
    .select('id, company_id, name, sort_order, is_active')
    .single()

  if (error) throw toStoreError(error)
  const row = data as DepartmentRow
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

export async function updateDepartment(
  id: string,
  patch: { name?: string; sortOrder?: number; isActive?: boolean },
): Promise<Department> {
  const payload: Record<string, unknown> = {}
  if (patch.name !== undefined) payload.name = patch.name.trim()
  if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder
  if (patch.isActive !== undefined) payload.is_active = patch.isActive

  const { data, error } = await getSupabase()
    .from('departments')
    .update(payload)
    .eq('id', id)
    .select('id, company_id, name, sort_order, is_active')
    .single()

  if (error) throw toStoreError(error)
  const row = data as DepartmentRow
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}
