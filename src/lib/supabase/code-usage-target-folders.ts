import type { CodeUsageTargetFolder } from '@/lib/types'
import {
  canCreateChildFolder,
  wouldCreateFolderCycle,
} from '@/lib/codes/outbound-folder'
import {
  compactOutboundPartnerKey,
  normalizeOutboundPartnerName,
} from '@/lib/codes/outbound-partner'
import { getSupabase } from '@/lib/supabase/client'
import { CodeUsageTargetStoreError } from '@/lib/supabase/code-usage-targets'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, parent_id, name, normalized_name, sort_order, created_at, updated_at'

const PAGE_SIZE = 1000

type FolderRow = {
  id: string
  brand_id: string
  parent_id: string | null
  name: string
  normalized_name: string
  sort_order: number
  created_at: string
  updated_at: string
}

function toFolder(row: FolderRow): CodeUsageTargetFolder {
  return {
    id: row.id,
    brandId: row.brand_id,
    parentId: row.parent_id,
    name: row.name,
    normalizedName: row.normalized_name,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function folderError(error: { code?: string; message?: string } | null) {
  if (error && isUniqueViolation(error)) {
    return new CodeUsageTargetStoreError(
      '같은 위치의 폴더 이름이 이미 있습니다.',
      'duplicate',
    )
  }
  return new CodeUsageTargetStoreError(
    errorMessage(error, '폴더를 저장하지 못했습니다.'),
    'invalid',
  )
}

export async function listCodeUsageTargetFolders(
  brandId: string,
): Promise<CodeUsageTargetFolder[]> {
  const rows: FolderRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await getSupabase()
      .from('code_usage_target_folders')
      .select(COLUMNS)
      .eq('brand_id', brandId)
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new CodeUsageTargetStoreError(
        errorMessage(error, '분류 폴더를 불러오지 못했습니다.'),
        'invalid',
      )
    }

    const page = (data as FolderRow[]) ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return rows.map(toFolder).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'))
}

export async function createCodeUsageTargetFolder(
  brandId: string,
  input: { name: string; parentId?: string | null },
): Promise<CodeUsageTargetFolder> {
  const name = normalizeOutboundPartnerName(input.name)
  const normalizedName = compactOutboundPartnerKey(name)
  if (!name) {
    throw new CodeUsageTargetStoreError('폴더 이름을 입력하세요.', 'invalid')
  }
  if (!normalizedName) {
    throw new CodeUsageTargetStoreError(
      '폴더 이름에 글자나 숫자가 있어야 합니다.',
      'invalid',
    )
  }

  const existing = await listCodeUsageTargetFolders(brandId)
  const parentId = input.parentId ?? null
  if (parentId && !existing.some((folder) => folder.id === parentId)) {
    throw new CodeUsageTargetStoreError(
      '상위 폴더를 찾을 수 없습니다.',
      'not_found',
    )
  }
  if (!canCreateChildFolder(existing, parentId)) {
    throw new CodeUsageTargetStoreError(
      '폴더는 네 단까지만 만들 수 있습니다.',
      'invalid',
    )
  }

  const maxOrder = existing
    .filter((folder) => folder.parentId === parentId)
    .reduce((max, folder) => Math.max(max, folder.order), -1)

  const { data, error } = await getSupabase()
    .from('code_usage_target_folders')
    .insert({
      brand_id: brandId,
      parent_id: parentId,
      name,
      normalized_name: normalizedName,
      sort_order: maxOrder + 1,
    })
    .select(COLUMNS)
    .single()

  if (error) throw folderError(error)
  return toFolder(data as FolderRow)
}

export async function updateCodeUsageTargetFolder(
  id: string,
  patch: { name?: string; parentId?: string | null },
): Promise<CodeUsageTargetFolder> {
  const { data: existing, error: readError } = await getSupabase()
    .from('code_usage_target_folders')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    throw new CodeUsageTargetStoreError(
      errorMessage(readError, '폴더를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!existing) {
    throw new CodeUsageTargetStoreError('폴더를 찾을 수 없습니다.', 'not_found')
  }

  const row = existing as FolderRow
  const folders = await listCodeUsageTargetFolders(row.brand_id)
  const name =
    patch.name !== undefined ? normalizeOutboundPartnerName(patch.name) : row.name
  const normalizedName = compactOutboundPartnerKey(name)
  if (!name) {
    throw new CodeUsageTargetStoreError('폴더 이름을 입력하세요.', 'invalid')
  }
  if (!normalizedName) {
    throw new CodeUsageTargetStoreError(
      '폴더 이름에 글자나 숫자가 있어야 합니다.',
      'invalid',
    )
  }

  const parentId = patch.parentId !== undefined ? patch.parentId : row.parent_id
  if (parentId && !folders.some((folder) => folder.id === parentId)) {
    throw new CodeUsageTargetStoreError(
      '상위 폴더를 찾을 수 없습니다.',
      'not_found',
    )
  }
  if (wouldCreateFolderCycle(folders, id, parentId)) {
    throw new CodeUsageTargetStoreError(
      '폴더를 자기 자신이나 하위 폴더 안으로 옮길 수 없습니다.',
      'invalid',
    )
  }
  if (parentId && !canCreateChildFolder(folders, parentId) && parentId !== row.parent_id) {
    throw new CodeUsageTargetStoreError(
      '폴더는 네 단까지만 만들 수 있습니다.',
      'invalid',
    )
  }

  const { data, error } = await getSupabase()
    .from('code_usage_target_folders')
    .update({
      name,
      normalized_name: normalizedName,
      parent_id: parentId,
    })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) throw folderError(error)
  return toFolder(data as FolderRow)
}

/** 하위 폴더가 있으면 막는다. 안의 업체는 미분류로 돌아간다. */
export async function deleteCodeUsageTargetFolder(id: string): Promise<void> {
  const { data: existing, error: readError } = await getSupabase()
    .from('code_usage_target_folders')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    throw new CodeUsageTargetStoreError(
      errorMessage(readError, '폴더를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!existing) {
    throw new CodeUsageTargetStoreError('폴더를 찾을 수 없습니다.', 'not_found')
  }

  const row = existing as FolderRow
  const folders = await listCodeUsageTargetFolders(row.brand_id)
  if (folders.some((folder) => folder.parentId === id)) {
    throw new CodeUsageTargetStoreError(
      '안쪽 폴더를 먼저 지우거나 옮기세요.',
      'invalid',
    )
  }

  const { error: clearError } = await getSupabase()
    .from('code_usage_targets')
    .update({ folder_id: null })
    .eq('folder_id', id)
    .eq('brand_id', row.brand_id)

  if (clearError) {
    throw new CodeUsageTargetStoreError(
      errorMessage(clearError, '폴더 안 업체를 미분류로 옮기지 못했습니다.'),
      'invalid',
    )
  }

  const { error } = await getSupabase()
    .from('code_usage_target_folders')
    .delete()
    .eq('id', id)

  if (error) {
    throw new CodeUsageTargetStoreError(
      errorMessage(error, '폴더를 지우지 못했습니다.'),
      'invalid',
    )
  }
}
