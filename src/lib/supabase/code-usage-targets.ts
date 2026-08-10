import type {
  CodeUsageTarget,
  CodeUsageTargetInput,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, name, active, sort_order, created_at, updated_at'

type TargetRow = {
  id: string
  brand_id: string
  name: string
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export class CodeUsageTargetStoreError extends Error {
  readonly code: 'duplicate' | 'not_found' | 'invalid'

  constructor(message: string, code: 'duplicate' | 'not_found' | 'invalid') {
    super(message)
    this.name = 'CodeUsageTargetStoreError'
    this.code = code
  }
}

function toTarget(row: TargetRow): CodeUsageTarget {
  return {
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    active: row.active,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, ' ')
}

export async function listCodeUsageTargets(
  brandId: string,
): Promise<CodeUsageTarget[]> {
  const { data, error } = await getSupabase()
    .from('code_usage_targets')
    .select(COLUMNS)
    .eq('brand_id', brandId)

  if (error) {
    throw new CodeUsageTargetStoreError(
      errorMessage(error, '사용처를 불러오지 못했습니다.'),
      'invalid',
    )
  }

  return ((data as TargetRow[]) ?? [])
    .map(toTarget)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.order - b.order ||
        a.name.localeCompare(b.name, 'ko'),
    )
}

export async function createCodeUsageTarget(
  brandId: string,
  input: CodeUsageTargetInput,
): Promise<CodeUsageTarget> {
  const name = normalizeName(input.name)
  if (!name) {
    throw new CodeUsageTargetStoreError('사용처 이름을 입력하세요.', 'invalid')
  }

  const existing = await listCodeUsageTargets(brandId)
  const maxOrder = existing.reduce((max, row) => Math.max(max, row.order), -1)

  const { data, error } = await getSupabase()
    .from('code_usage_targets')
    .insert({
      brand_id: brandId,
      name,
      active: true,
      sort_order: maxOrder + 1,
    })
    .select(COLUMNS)
    .single()

  if (error) {
    throw new CodeUsageTargetStoreError(
      isUniqueViolation(error)
        ? `"${name}" 사용처가 이미 있습니다.`
        : errorMessage(error, '사용처를 만들지 못했습니다.'),
      isUniqueViolation(error) ? 'duplicate' : 'invalid',
    )
  }

  return toTarget(data as TargetRow)
}

export async function updateCodeUsageTarget(
  id: string,
  patch: Partial<Pick<CodeUsageTarget, 'name' | 'active'>>,
): Promise<CodeUsageTarget> {
  const { data: existing, error: readError } = await getSupabase()
    .from('code_usage_targets')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    throw new CodeUsageTargetStoreError(
      errorMessage(readError, '사용처를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!existing) {
    throw new CodeUsageTargetStoreError(
      '사용처를 찾을 수 없습니다.',
      'not_found',
    )
  }

  const row = existing as TargetRow
  const name =
    patch.name !== undefined ? normalizeName(patch.name) : row.name
  if (!name) {
    throw new CodeUsageTargetStoreError('사용처 이름을 입력하세요.', 'invalid')
  }

  const { data, error } = await getSupabase()
    .from('code_usage_targets')
    .update({
      name,
      active: patch.active ?? row.active,
    })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) {
    throw new CodeUsageTargetStoreError(
      isUniqueViolation(error)
        ? `"${name}" 사용처가 이미 있습니다.`
        : errorMessage(error, '사용처를 저장하지 못했습니다.'),
      isUniqueViolation(error) ? 'duplicate' : 'invalid',
    )
  }

  return toTarget(data as TargetRow)
}
