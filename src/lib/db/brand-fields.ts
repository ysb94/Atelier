import type { BrandField, BrandFieldInput, FieldOwner } from '@/lib/types'
import { IMPORT_FIELDS } from '@/lib/import/fields'
import {
  BRAND_FIELDS_STORE,
  idbRequest,
  openDb,
  withStore,
} from '@/lib/db/client'

function newFieldId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `field-${crypto.randomUUID()}`
  }
  return `field-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function seedFieldsForBrand(brandId: string): BrandField[] {
  return IMPORT_FIELDS.map((field, index) => ({
    id: `${brandId}-${field.key}`,
    brandId,
    label: field.label,
    systemKey: field.key,
    type: field.type,
    owner: field.owner,
    required: Boolean(field.requiredForNew),
    order: index,
  }))
}

async function putFields(fields: BrandField[]) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BRAND_FIELDS_STORE, 'readwrite')
    const store = tx.objectStore(BRAND_FIELDS_STORE)
    for (const field of fields) {
      store.put(field)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () =>
      reject(tx.error ?? new Error('Brand fields seed failed'))
  })
}

/**
 * 처음이면 기본 항목을 깔고, 이미 있으면 나중에 추가된 시스템 항목만 채운다.
 * 사용자가 만든 항목과 순서는 건드리지 않는다.
 */
async function ensureSeeded(brandId: string) {
  const existing = await withStore(BRAND_FIELDS_STORE, 'readonly', (store) => {
    const index = store.index('brandId')
    return idbRequest<BrandField[]>(index.getAll(brandId))
  })

  if (existing.length === 0) {
    const seeded = seedFieldsForBrand(brandId)
    await putFields(seeded)
    return seeded
  }

  const knownKeys = new Set(
    existing.map((field) => field.systemKey).filter(Boolean),
  )
  const missing = seedFieldsForBrand(brandId).filter(
    (field) => field.systemKey && !knownKeys.has(field.systemKey),
  )
  if (missing.length === 0) return existing

  const maxOrder = existing.reduce((max, f) => Math.max(max, f.order), -1)
  const appended = missing.map((field, index) => ({
    ...field,
    order: maxOrder + 1 + index,
  }))
  await putFields(appended)
  return [...existing, ...appended]
}

export class BrandFieldStoreError extends Error {
  readonly code: 'not_found' | 'invalid' | 'locked'

  constructor(message: string, code: 'not_found' | 'invalid' | 'locked') {
    super(message)
    this.name = 'BrandFieldStoreError'
    this.code = code
  }
}

export async function listBrandFields(brandId: string): Promise<BrandField[]> {
  const rows = await ensureSeeded(brandId)
  return [...rows].sort((a, b) => a.order - b.order)
}

export async function createBrandField(
  brandId: string,
  input: BrandFieldInput,
): Promise<BrandField> {
  const existing = await listBrandFields(brandId)
  const label = input.label.trim()
  if (!label) {
    throw new BrandFieldStoreError('항목 이름을 입력하세요.', 'invalid')
  }
  if (existing.some((f) => f.label === label)) {
    throw new BrandFieldStoreError('이미 같은 이름의 항목이 있습니다.', 'invalid')
  }

  const maxOrder = existing.reduce((max, f) => Math.max(max, f.order), -1)
  const field: BrandField = {
    id: newFieldId(),
    brandId,
    label,
    systemKey: null,
    type: input.type,
    owner: input.owner,
    required: Boolean(input.required),
    order: maxOrder + 1,
  }

  await withStore(BRAND_FIELDS_STORE, 'readwrite', (store) => {
    store.add(field)
    return field
  })
  return field
}

export async function updateBrandField(
  id: string,
  patch: Partial<Pick<BrandField, 'label' | 'required' | 'type' | 'owner'>>,
): Promise<BrandField> {
  const existing = await withStore(BRAND_FIELDS_STORE, 'readonly', (store) =>
    idbRequest<BrandField | undefined>(store.get(id)),
  )
  if (!existing) {
    throw new BrandFieldStoreError('항목을 찾을 수 없습니다.', 'not_found')
  }

  // 품번은 라벨/필수/타입 변경 금지
  if (existing.systemKey === 'styleNo') {
    throw new BrandFieldStoreError('품번 항목은 수정할 수 없습니다.', 'locked')
  }

  const nextLabel = patch.label?.trim()
  if (nextLabel !== undefined) {
    if (!nextLabel) {
      throw new BrandFieldStoreError('항목 이름을 입력하세요.', 'invalid')
    }
    const siblings = await listBrandFields(existing.brandId)
    if (siblings.some((f) => f.id !== id && f.label === nextLabel)) {
      throw new BrandFieldStoreError(
        '이미 같은 이름의 항목이 있습니다.',
        'invalid',
      )
    }
  }

  const next: BrandField = {
    ...existing,
    label: nextLabel ?? existing.label,
    required:
      patch.required !== undefined ? patch.required : existing.required,
    type: patch.type ?? existing.type,
    owner: patch.owner ?? existing.owner,
  }

  // 시스템 기본 항목은 타입 고정 (라벨/필수만 변경)
  if (existing.systemKey) {
    next.type = existing.type
    next.systemKey = existing.systemKey
  }

  await withStore(BRAND_FIELDS_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
}

export async function deleteBrandField(id: string): Promise<void> {
  const existing = await withStore(BRAND_FIELDS_STORE, 'readonly', (store) =>
    idbRequest<BrandField | undefined>(store.get(id)),
  )
  if (!existing) {
    throw new BrandFieldStoreError('항목을 찾을 수 없습니다.', 'not_found')
  }
  if (existing.systemKey) {
    throw new BrandFieldStoreError(
      '기본 항목은 삭제할 수 없습니다. 사용자 추가 항목만 삭제할 수 있습니다.',
      'locked',
    )
  }
  await withStore(BRAND_FIELDS_STORE, 'readwrite', (store) => {
    store.delete(id)
  })
}

/** 양식 다운로드용: 선택 부서 + 품번 항상 포함 */
export function filterFieldsForTemplate(
  fields: BrandField[],
  ownerFilter?: FieldOwner | 'all',
): BrandField[] {
  if (!ownerFilter || ownerFilter === 'all') return fields
  return fields.filter(
    (f) => f.systemKey === 'styleNo' || f.owner === ownerFilter || f.owner === 'common',
  )
}
