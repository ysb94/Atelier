import type {
  ProductCode,
  ProductCodeComponent,
  ProductCodeInput,
  ProductCodeKind,
} from '@/lib/types'
import { describeEan13Problem } from '@/lib/codes/ean'
import {
  PRODUCT_CODES_STORE,
  idbRequest,
  withStore,
} from '@/lib/db/client'

export class ProductCodeStoreError extends Error {
  readonly code: 'duplicate' | 'not_found' | 'invalid'

  constructor(message: string, code: 'duplicate' | 'not_found' | 'invalid') {
    super(message)
    this.name = 'ProductCodeStoreError'
    this.code = code
  }
}

type LegacyProductCode = ProductCode & {
  usageTargetIds?: string[]
}

function newCodeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `pcode-${crypto.randomUUID()}`
  }
  return `pcode-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function nowIso() {
  return new Date().toISOString()
}

function normalizePositive(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return rounded > 0 ? rounded : null
}

function normalizeComponents(
  components: ProductCodeComponent[],
): ProductCodeComponent[] {
  const merged = new Map<string, ProductCodeComponent>()
  for (const component of components) {
    const styleId = component.styleId.trim()
    if (!styleId) continue
    const qty = Math.trunc(component.qty)
    if (!Number.isFinite(qty) || qty < 1) {
      throw new ProductCodeStoreError(
        '구성 수량은 1 이상이어야 합니다.',
        'invalid',
      )
    }
    const existing = merged.get(styleId)
    if (existing) {
      existing.qty += qty
      continue
    }
    merged.set(styleId, {
      styleId,
      styleNo: component.styleNo.trim(),
      qty,
    })
  }
  return Array.from(merged.values())
}

function normalizeProductCode(row: LegacyProductCode): ProductCode {
  const { usageTargetIds: _legacy, ...rest } = row
  return {
    ...rest,
    components: rest.components ?? [],
    note: rest.note ?? '',
  }
}

/** 마이그레이션용: 구 usageTargetIds 배열을 그대로 읽어온다. */
export async function listLegacyUsageLinks(
  brandId?: string,
): Promise<{ productCodeId: string; brandId: string; usageTargetIds: string[] }[]> {
  const rows = await withStore(PRODUCT_CODES_STORE, 'readonly', (store) =>
    idbRequest<LegacyProductCode[]>(store.getAll()),
  )
  return rows
    .filter((row) => (!brandId || row.brandId === brandId) && row.usageTargetIds?.length)
    .map((row) => ({
      productCodeId: row.id,
      brandId: row.brandId,
      usageTargetIds: Array.from(
        new Set((row.usageTargetIds ?? []).map((id) => id.trim()).filter(Boolean)),
      ),
    }))
}

/** 마이그레이션 후 코드 레코드에서 usageTargetIds 필드를 제거한다. */
export async function stripLegacyUsageTargetIds(): Promise<void> {
  const rows = await withStore(PRODUCT_CODES_STORE, 'readonly', (store) =>
    idbRequest<LegacyProductCode[]>(store.getAll()),
  )
  const dirty = rows.filter((row) => 'usageTargetIds' in row)
  if (dirty.length === 0) return

  await withStore(PRODUCT_CODES_STORE, 'readwrite', (store) => {
    for (const row of dirty) {
      store.put(normalizeProductCode(row))
    }
  })
}

function validate(input: ProductCodeInput) {
  const code = input.code.trim()
  const name = input.name.trim()

  if (!name) {
    throw new ProductCodeStoreError('코드명을 입력하세요.', 'invalid')
  }
  if (input.kind === 'own') {
    const problem = describeEan13Problem(code)
    if (problem) throw new ProductCodeStoreError(problem, 'invalid')
  } else if (!code) {
    throw new ProductCodeStoreError('코드값을 입력하세요.', 'invalid')
  }

  const components = normalizeComponents(input.components)
  if (components.length === 0) {
    throw new ProductCodeStoreError(
      '구성품을 한 개 이상 담아 주세요.',
      'invalid',
    )
  }

  return { code, name, components }
}

async function readAll(brandId: string): Promise<ProductCode[]> {
  const rows = await withStore(PRODUCT_CODES_STORE, 'readonly', (store) => {
    const index = store.index('brandId')
    return idbRequest<LegacyProductCode[]>(index.getAll(brandId))
  })
  return rows.map(normalizeProductCode)
}

export async function listProductCodes(
  brandId: string,
  kind?: ProductCodeKind,
): Promise<ProductCode[]> {
  const rows = await readAll(brandId)
  return rows
    .filter((row) => !kind || row.kind === kind)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getProductCode(
  id: string,
): Promise<ProductCode | undefined> {
  const row = await withStore(PRODUCT_CODES_STORE, 'readonly', (store) =>
    idbRequest<LegacyProductCode | undefined>(store.get(id)),
  )
  return row ? normalizeProductCode(row) : undefined
}

async function assertCodeAvailable(
  brandId: string,
  kind: ProductCodeKind,
  code: string,
  excludeId?: string,
) {
  const rows = await readAll(brandId)
  const clash = rows.find(
    (row) => row.kind === kind && row.code === code && row.id !== excludeId,
  )
  if (clash) {
    throw new ProductCodeStoreError(
      `이미 등록된 코드입니다. (${clash.name})`,
      'duplicate',
    )
  }
}

export async function createProductCode(
  brandId: string,
  input: ProductCodeInput,
): Promise<ProductCode> {
  const { code, name, components } = validate(input)
  await assertCodeAvailable(brandId, input.kind, code)

  const timestamp = nowIso()
  const record: ProductCode = {
    id: newCodeId(),
    brandId,
    kind: input.kind,
    code,
    name,
    weightG: normalizePositive(input.weightG),
    widthMm: normalizePositive(input.widthMm),
    depthMm: normalizePositive(input.depthMm),
    heightMm: normalizePositive(input.heightMm),
    note: input.note.trim(),
    components,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await withStore(PRODUCT_CODES_STORE, 'readwrite', (store) => {
    store.add(record)
    return record
  })
  return record
}

export async function updateProductCode(
  id: string,
  input: ProductCodeInput,
): Promise<ProductCode> {
  const existing = await getProductCode(id)
  if (!existing) {
    throw new ProductCodeStoreError('코드를 찾을 수 없습니다.', 'not_found')
  }

  const { code, name, components } = validate(input)
  await assertCodeAvailable(existing.brandId, input.kind, code, id)

  const next: ProductCode = {
    ...existing,
    kind: input.kind,
    code,
    name,
    weightG: normalizePositive(input.weightG),
    widthMm: normalizePositive(input.widthMm),
    depthMm: normalizePositive(input.depthMm),
    heightMm: normalizePositive(input.heightMm),
    note: input.note.trim(),
    components,
    updatedAt: nowIso(),
  }

  await withStore(PRODUCT_CODES_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
}

export async function deleteProductCode(id: string): Promise<void> {
  const existing = await getProductCode(id)
  if (!existing) {
    throw new ProductCodeStoreError('코드를 찾을 수 없습니다.', 'not_found')
  }
  await withStore(PRODUCT_CODES_STORE, 'readwrite', (store) => {
    store.delete(id)
  })
}
