import type {
  CodeUsageTarget,
  CodeUsageTargetInput,
} from '@/lib/types'
import {
  CODE_USAGE_TARGETS_STORE,
  idbRequest,
  withStore,
} from '@/lib/db/client'

export class CodeUsageTargetStoreError extends Error {
  readonly code: 'duplicate' | 'not_found' | 'invalid'

  constructor(message: string, code: 'duplicate' | 'not_found' | 'invalid') {
    super(message)
    this.name = 'CodeUsageTargetStoreError'
    this.code = code
  }
}

function newTargetId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `usage-${crypto.randomUUID()}`
  }
  return `usage-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, ' ')
}

async function readAll(brandId: string): Promise<CodeUsageTarget[]> {
  return withStore(CODE_USAGE_TARGETS_STORE, 'readonly', (store) => {
    const index = store.index('brandId')
    return idbRequest<CodeUsageTarget[]>(index.getAll(brandId))
  })
}

export async function listCodeUsageTargets(
  brandId: string,
): Promise<CodeUsageTarget[]> {
  const rows = await readAll(brandId)
  return rows.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.order - b.order ||
      a.name.localeCompare(b.name, 'ko'),
  )
}

async function assertNameAvailable(
  brandId: string,
  name: string,
  excludeId?: string,
) {
  const normalized = name.toLocaleLowerCase('ko')
  const rows = await readAll(brandId)
  const duplicate = rows.find(
    (row) =>
      row.id !== excludeId &&
      row.name.toLocaleLowerCase('ko') === normalized,
  )
  if (duplicate) {
    throw new CodeUsageTargetStoreError(
      `"${duplicate.name}" 사용처가 이미 있습니다.`,
      'duplicate',
    )
  }
}

export async function createCodeUsageTarget(
  brandId: string,
  input: CodeUsageTargetInput,
): Promise<CodeUsageTarget> {
  const name = normalizeName(input.name)
  if (!name) {
    throw new CodeUsageTargetStoreError('사용처 이름을 입력하세요.', 'invalid')
  }
  await assertNameAvailable(brandId, name)

  const rows = await readAll(brandId)
  const maxOrder = rows.reduce((max, row) => Math.max(max, row.order), -1)
  const timestamp = nowIso()
  const target: CodeUsageTarget = {
    id: newTargetId(),
    brandId,
    name,
    active: true,
    order: maxOrder + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await withStore(CODE_USAGE_TARGETS_STORE, 'readwrite', (store) => {
    store.add(target)
    return target
  })
  return target
}

export async function updateCodeUsageTarget(
  id: string,
  patch: Partial<Pick<CodeUsageTarget, 'name' | 'active'>>,
): Promise<CodeUsageTarget> {
  const existing = await withStore(
    CODE_USAGE_TARGETS_STORE,
    'readonly',
    (store) => idbRequest<CodeUsageTarget | undefined>(store.get(id)),
  )
  if (!existing) {
    throw new CodeUsageTargetStoreError(
      '사용처를 찾을 수 없습니다.',
      'not_found',
    )
  }

  const name =
    patch.name === undefined ? existing.name : normalizeName(patch.name)
  if (!name) {
    throw new CodeUsageTargetStoreError('사용처 이름을 입력하세요.', 'invalid')
  }
  if (name !== existing.name) {
    await assertNameAvailable(existing.brandId, name, id)
  }

  const next: CodeUsageTarget = {
    ...existing,
    name,
    active: patch.active ?? existing.active,
    updatedAt: nowIso(),
  }
  await withStore(CODE_USAGE_TARGETS_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
}
