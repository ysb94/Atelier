import type {
  CodeUsageAssignment,
  CodeUsageAssignmentInput,
  CodeUsageStatus,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, product_code_id, usage_target_id, status, created_at, updated_at'

type AssignmentRow = {
  id: string
  brand_id: string
  product_code_id: string
  usage_target_id: string
  status: CodeUsageStatus
  created_at: string
  updated_at: string
}

export class CodeUsageAssignmentStoreError extends Error {
  readonly code: 'duplicate' | 'not_found' | 'invalid'

  constructor(
    message: string,
    code: 'duplicate' | 'not_found' | 'invalid',
  ) {
    super(message)
    this.name = 'CodeUsageAssignmentStoreError'
    this.code = code
  }
}

function normalizeStatus(status?: CodeUsageStatus): CodeUsageStatus {
  return status === 'paused' ? 'paused' : 'active'
}

function toAssignment(row: AssignmentRow): CodeUsageAssignment {
  return {
    id: row.id,
    brandId: row.brand_id,
    productCodeId: row.product_code_id,
    usageTargetId: row.usage_target_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function readAll(brandId: string): Promise<CodeUsageAssignment[]> {
  const { data, error } = await getSupabase()
    .from('code_usage_assignments')
    .select(COLUMNS)
    .eq('brand_id', brandId)

  if (error) {
    throw new CodeUsageAssignmentStoreError(
      errorMessage(error, '사용처 연결을 불러오지 못했습니다.'),
      'invalid',
    )
  }

  return ((data as AssignmentRow[]) ?? []).map(toAssignment)
}

export async function listCodeUsageAssignments(
  brandId: string,
  options?: {
    usageTargetId?: string
    productCodeId?: string
    status?: CodeUsageStatus
  },
): Promise<CodeUsageAssignment[]> {
  const rows = await readAll(brandId)
  return rows
    .filter((row) => {
      if (options?.usageTargetId && row.usageTargetId !== options.usageTargetId) {
        return false
      }
      if (
        options?.productCodeId &&
        row.productCodeId !== options.productCodeId
      ) {
        return false
      }
      if (options?.status && row.status !== options.status) return false
      return true
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getCodeUsageAssignment(
  id: string,
): Promise<CodeUsageAssignment | undefined> {
  const { data, error } = await getSupabase()
    .from('code_usage_assignments')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new CodeUsageAssignmentStoreError(
      errorMessage(error, '사용처 연결을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return data ? toAssignment(data as AssignmentRow) : undefined
}

async function findExisting(
  brandId: string,
  productCodeId: string,
  usageTargetId: string,
): Promise<CodeUsageAssignment | undefined> {
  const rows = await readAll(brandId)
  return rows.find(
    (row) =>
      row.productCodeId === productCodeId &&
      row.usageTargetId === usageTargetId,
  )
}

export async function createCodeUsageAssignment(
  brandId: string,
  input: CodeUsageAssignmentInput,
): Promise<CodeUsageAssignment> {
  const productCodeId = input.productCodeId.trim()
  const usageTargetId = input.usageTargetId.trim()
  if (!productCodeId || !usageTargetId) {
    throw new CodeUsageAssignmentStoreError(
      '바코드와 사용처를 지정하세요.',
      'invalid',
    )
  }

  const existing = await findExisting(brandId, productCodeId, usageTargetId)
  if (existing) {
    if (input.status && input.status !== existing.status) {
      return updateCodeUsageAssignmentStatus(existing.id, input.status)
    }
    return existing
  }

  const { data, error } = await getSupabase()
    .from('code_usage_assignments')
    .insert({
      brand_id: brandId,
      product_code_id: productCodeId,
      usage_target_id: usageTargetId,
      status: normalizeStatus(input.status),
    })
    .select(COLUMNS)
    .single()

  if (error) {
    throw new CodeUsageAssignmentStoreError(
      isUniqueViolation(error)
        ? '이미 등록된 연결입니다.'
        : errorMessage(error, '사용처 연결을 만들지 못했습니다.'),
      isUniqueViolation(error) ? 'duplicate' : 'invalid',
    )
  }

  return toAssignment(data as AssignmentRow)
}

export async function updateCodeUsageAssignmentStatus(
  id: string,
  status: CodeUsageStatus,
): Promise<CodeUsageAssignment> {
  const existing = await getCodeUsageAssignment(id)
  if (!existing) {
    throw new CodeUsageAssignmentStoreError(
      '등록 기록을 찾을 수 없습니다.',
      'not_found',
    )
  }

  const { data, error } = await getSupabase()
    .from('code_usage_assignments')
    .update({ status: normalizeStatus(status) })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) {
    throw new CodeUsageAssignmentStoreError(
      errorMessage(error, '상태를 저장하지 못했습니다.'),
      'invalid',
    )
  }

  return toAssignment(data as AssignmentRow)
}

export type BulkUsageApplyRow = {
  productCodeId: string
  status: CodeUsageStatus
}

export type BulkUsageApplyResult = {
  created: number
  updated: number
  skipped: number
}

export async function applyBulkUsageAssignments(
  brandId: string,
  usageTargetId: string,
  rows: BulkUsageApplyRow[],
): Promise<BulkUsageApplyResult> {
  let created = 0
  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const existing = await findExisting(
      brandId,
      row.productCodeId,
      usageTargetId,
    )
    if (existing) {
      if (existing.status === row.status) {
        skipped += 1
        continue
      }
      await updateCodeUsageAssignmentStatus(existing.id, row.status)
      updated += 1
      continue
    }
    await createCodeUsageAssignment(brandId, {
      productCodeId: row.productCodeId,
      usageTargetId,
      status: row.status,
    })
    created += 1
  }

  return { created, updated, skipped }
}
