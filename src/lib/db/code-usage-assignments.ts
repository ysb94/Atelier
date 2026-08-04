import type {
  CodeUsageAssignment,
  CodeUsageAssignmentInput,
  CodeUsageStatus,
} from '@/lib/types'
import {
  CODE_USAGE_ASSIGNMENTS_STORE,
  META_STORE,
  idbRequest,
  openDb,
  withStore,
} from '@/lib/db/client'
import {
  listLegacyUsageLinks,
  stripLegacyUsageTargetIds,
} from '@/lib/db/product-codes'

const MIGRATE_FLAG_KEY = 'usage_assignments_v1'

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

function newAssignmentId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `assign-${crypto.randomUUID()}`
  }
  return `assign-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeStatus(status?: CodeUsageStatus): CodeUsageStatus {
  return status === 'paused' ? 'paused' : 'active'
}

let migratePromise: Promise<void> | null = null

/**
 * 구 ProductCode.usageTargetIds → CodeUsageAssignment 이전.
 * 한 번만 실행한다.
 */
export async function ensureUsageAssignmentMigrated() {
  if (!migratePromise) {
    migratePromise = (async () => {
      const meta = await withStore(META_STORE, 'readonly', (store) =>
        idbRequest<{ key: string; value: boolean } | undefined>(
          store.get(MIGRATE_FLAG_KEY),
        ),
      )
      if (meta?.value) return

      const links = await listLegacyUsageLinks()
      if (links.length > 0) {
        const db = await openDb()
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(CODE_USAGE_ASSIGNMENTS_STORE, 'readwrite')
          const store = tx.objectStore(CODE_USAGE_ASSIGNMENTS_STORE)
          const timestamp = nowIso()

          for (const link of links) {
            for (const usageTargetId of link.usageTargetIds) {
              const record: CodeUsageAssignment = {
                id: newAssignmentId(),
                brandId: link.brandId,
                productCodeId: link.productCodeId,
                usageTargetId,
                status: 'active',
                createdAt: timestamp,
                updatedAt: timestamp,
              }
              store.put(record)
            }
          }

          tx.oncomplete = () => resolve()
          tx.onerror = () =>
            reject(tx.error ?? new Error('Usage assignment migrate failed'))
        })
      }

      await stripLegacyUsageTargetIds()
      await withStore(META_STORE, 'readwrite', (store) => {
        store.put({ key: MIGRATE_FLAG_KEY, value: true })
      })
    })().catch((error) => {
      migratePromise = null
      throw error
    })
  }
  return migratePromise
}

async function readAll(brandId: string): Promise<CodeUsageAssignment[]> {
  await ensureUsageAssignmentMigrated()
  return withStore(CODE_USAGE_ASSIGNMENTS_STORE, 'readonly', (store) => {
    const index = store.index('brandId')
    return idbRequest<CodeUsageAssignment[]>(index.getAll(brandId))
  })
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
  await ensureUsageAssignmentMigrated()
  return withStore(CODE_USAGE_ASSIGNMENTS_STORE, 'readonly', (store) =>
    idbRequest<CodeUsageAssignment | undefined>(store.get(id)),
  )
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
    // 이미 있으면 상태만 갱신 (중복 생성 금지)
    if (input.status && input.status !== existing.status) {
      return updateCodeUsageAssignmentStatus(existing.id, input.status)
    }
    return existing
  }

  const timestamp = nowIso()
  const record: CodeUsageAssignment = {
    id: newAssignmentId(),
    brandId,
    productCodeId,
    usageTargetId,
    status: normalizeStatus(input.status),
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await withStore(CODE_USAGE_ASSIGNMENTS_STORE, 'readwrite', (store) => {
    store.add(record)
    return record
  })
  return record
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

  const next: CodeUsageAssignment = {
    ...existing,
    status: normalizeStatus(status),
    updatedAt: nowIso(),
  }

  await withStore(CODE_USAGE_ASSIGNMENTS_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
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

/** 한 사용처에 여러 바코드를 일괄 등록·상태 반영 */
export async function applyBulkUsageAssignments(
  brandId: string,
  usageTargetId: string,
  rows: BulkUsageApplyRow[],
): Promise<BulkUsageApplyResult> {
  await ensureUsageAssignmentMigrated()
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
