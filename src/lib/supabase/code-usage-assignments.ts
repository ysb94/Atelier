import {
  compactCodeUsageChanges,
  planCodeUsageChanges,
} from '@/lib/codes/code-usage'
import type {
  CodeUsageAssignment,
  CodeUsageAssignmentChange,
  CodeUsageAssignmentInput,
  CodeUsageStatus,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const SAVE_CHUNK = 500

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
  const rows = await fetchAllPages<AssignmentRow>({
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await getSupabase()
        .from('code_usage_assignments')
        .select(COLUMNS, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
      if (error) {
        throw new CodeUsageAssignmentStoreError(
          errorMessage(error, '사용처 연결을 불러오지 못했습니다.'),
          'invalid',
        )
      }
      return {
        rows: (data as AssignmentRow[]) ?? [],
        count: count ?? null,
      }
    },
  })
  return rows.map(toAssignment)
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
    .sort((left, right) => {
      const byUpdated = right.updatedAt.localeCompare(left.updatedAt)
      if (byUpdated !== 0) return byUpdated
      return right.id.localeCompare(left.id)
    })
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
  const { data, error } = await getSupabase()
    .from('code_usage_assignments')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .eq('product_code_id', productCodeId)
    .eq('usage_target_id', usageTargetId)
    .maybeSingle()

  if (error) {
    throw new CodeUsageAssignmentStoreError(
      errorMessage(error, '사용처 연결을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return data ? toAssignment(data as AssignmentRow) : undefined
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

export async function saveCodeUsageAssignments(
  brandId: string,
  changes: readonly CodeUsageAssignmentChange[],
): Promise<CodeUsageAssignment[]> {
  const rows = compactCodeUsageChanges(changes).map((change) => ({
    brand_id: brandId,
    product_code_id: change.productCodeId,
    usage_target_id: change.usageTargetId,
    status: change.status,
  }))
  if (rows.length === 0) return []

  const saved: CodeUsageAssignment[] = []
  for (let index = 0; index < rows.length; index += SAVE_CHUNK) {
    const chunk = rows.slice(index, index + SAVE_CHUNK)
    const { data, error } = await getSupabase()
      .from('code_usage_assignments')
      .upsert(chunk, {
        onConflict: 'brand_id,product_code_id,usage_target_id',
      })
      .select(COLUMNS)
    if (error) {
      throw new CodeUsageAssignmentStoreError(
        errorMessage(error, '사용처 연결을 저장하지 못했습니다.'),
        'invalid',
      )
    }
    saved.push(...((data as AssignmentRow[]) ?? []).map(toAssignment))
  }
  return saved
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

  const saved = await saveCodeUsageAssignments(existing.brandId, [
    {
      productCodeId: existing.productCodeId,
      usageTargetId: existing.usageTargetId,
      status,
    },
  ])
  const row = saved[0]
  if (!row) {
    throw new CodeUsageAssignmentStoreError(
      '상태를 저장하지 못했습니다.',
      'invalid',
    )
  }
  return row
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
  const existing = await readAll(brandId)
  const plan = planCodeUsageChanges(
    existing.filter((row) => row.usageTargetId === usageTargetId),
    rows.map((row) => ({
      productCodeId: row.productCodeId,
      usageTargetId,
      status: row.status,
    })),
  )
  if (plan.changes.length > 0) {
    await saveCodeUsageAssignments(brandId, plan.changes)
  }
  return {
    created: plan.created,
    updated: plan.updated,
    skipped: plan.skipped,
  }
}
