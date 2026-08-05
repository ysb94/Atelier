import type {
  DraftColorRow,
  DraftOptionRow,
  DraftSpecKey,
  ProductDraft,
  ProductDraftInput,
} from '@/lib/types'
import {
  META_STORE,
  PRODUCT_DRAFTS_STORE,
  idbRequest,
  openDb,
  withStore,
} from '@/lib/db/client'

/** 기획안에서 최대 몇 색까지 잡는지. 기획 시트가 9줄이다. */
export const MAX_DRAFT_COLORS = 9

const SPEC_KEYS: DraftSpecKey[] = ['size', 'weight', 'fabric', 'coating']

export class ProductDraftStoreError extends Error {
  readonly code: 'not_found' | 'invalid'

  constructor(message: string, code: 'not_found' | 'invalid') {
    super(message)
    this.name = 'ProductDraftStoreError'
    this.code = code
  }
}

function newId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function newColorRow(): DraftColorRow {
  return { id: newId('color'), name: '', orderQty: null }
}

export function newOptionRow(): DraftOptionRow {
  return { id: newId('option'), styleId: '', name: '', price: null }
}

export function emptyDraftInput(): ProductDraftInput {
  return {
    seasonId: null,
    status: 'open',
    owner: '',
    nameKo: '',
    nameEn: '',
    imageUrl: null,
    colors: [newColorRow()],
    sampleDone: false,
    orderDone: false,
    photoSampleDone: false,
    held: false,
    holdReason: '',
    heldAt: null,
    targetCost: null,
    costCurrency: 'CNY',
    costConfirmed: false,
    retailPrice: null,
    discountPrice: null,
    originCountry: '',
    registerType: '',
    openType: '',
    openTypeDetail: '',
    releaseIssue: '',
    specs: {
      size: { value: '', confirmed: false, note: '' },
      weight: { value: '', confirmed: false, note: '' },
      fabric: { value: '', confirmed: false, note: '' },
      coating: { value: '', confirmed: false, note: '' },
    },
    hasOptions: false,
    options: [],
    note: '',
  }
}

type LegacyProductDraft = ProductDraft & {
  discountRate?: number | null
  optionsNote?: string
}

function parseLegacyOptions(note: string): DraftOptionRow[] {
  return note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(.*?)[_\s]+([\d,]+)\s*원?$/)
      return {
        id: `legacy-option-${index}`,
        styleId: '',
        name: (match?.[1] ?? line).trim(),
        price: match ? Number(match[2].replace(/,/g, '')) : null,
      }
    })
}

function normalizeDraft(raw: LegacyProductDraft): ProductDraft {
  const base = emptyDraftInput()
  const specs = { ...base.specs }
  for (const key of SPEC_KEYS) {
    const spec = raw.specs?.[key]
    specs[key] = {
      value: spec?.value ?? '',
      confirmed: Boolean(spec?.confirmed),
      note: spec?.note ?? '',
    }
  }
  const options = Array.isArray(raw.options)
    ? raw.options.map((row) => ({
        id: row.id || newId('option'),
        styleId: row.styleId ?? '',
        name: row.name ?? '',
        price: row.price ?? null,
      }))
    : parseLegacyOptions(raw.optionsNote ?? '')
  const discountPrice =
    raw.discountPrice ??
    (raw.discountRate != null && raw.retailPrice != null
      ? Math.round(raw.retailPrice * (1 - raw.discountRate / 100))
      : null)
  return {
    ...base,
    ...raw,
    colors: Array.isArray(raw.colors) ? raw.colors : [],
    specs,
    discountPrice,
    options,
    promotedStyleId: raw.promotedStyleId ?? null,
  }
}

/** 지워진 번호를 다시 쓰지 않도록 저장된 마지막 번호와 실제 최대값 중 큰 값을 쓴다. */
function seqKey(brandId: string) {
  return `draft_seq_${brandId}`
}

function parseDraftNo(value: string) {
  const match = /^PL-(\d+)$/.exec(value.trim().toUpperCase())
  return match ? Number(match[1]) : 0
}

async function issueDraftNo(brandId: string): Promise<string> {
  const rows = await listProductDrafts(brandId)
  const maxUsed = rows.reduce(
    (max, row) => Math.max(max, parseDraftNo(row.draftNo)),
    0,
  )

  const db = await openDb()
  const next = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite')
    const store = tx.objectStore(META_STORE)
    const key = seqKey(brandId)
    const getRequest = store.get(key)
    let value = 0
    getRequest.onsuccess = () => {
      const stored = getRequest.result as { value?: number } | undefined
      value = Math.max(stored?.value ?? 0, maxUsed) + 1
      store.put({ key, value })
    }
    tx.oncomplete = () => resolve(value)
    tx.onerror = () =>
      reject(tx.error ?? new Error('Draft number issue failed'))
  })

  return `PL-${String(next).padStart(4, '0')}`
}

export async function listProductDrafts(
  brandId: string,
): Promise<ProductDraft[]> {
  const rows = await withStore(PRODUCT_DRAFTS_STORE, 'readonly', (store) => {
    const index = store.index('brandId')
    return idbRequest<ProductDraft[]>(index.getAll(brandId))
  })
  return rows
    .map(normalizeDraft)
    .sort((a, b) => parseDraftNo(b.draftNo) - parseDraftNo(a.draftNo))
}

export async function getProductDraftById(
  id: string,
): Promise<ProductDraft | undefined> {
  const row = await withStore(PRODUCT_DRAFTS_STORE, 'readonly', (store) =>
    idbRequest<ProductDraft | undefined>(store.get(id)),
  )
  return row ? normalizeDraft(row) : undefined
}

function sanitize(input: ProductDraftInput): ProductDraftInput {
  const held = Boolean(input.held)
  return {
    ...input,
    owner: input.owner.trim(),
    nameKo: input.nameKo.trim(),
    nameEn: input.nameEn.trim(),
    originCountry: input.originCountry.trim(),
    registerType: input.registerType.trim(),
    openType: input.openType.trim(),
    openTypeDetail: input.openTypeDetail.trim(),
    releaseIssue: input.releaseIssue.trim(),
    note: input.note.trim(),
    holdReason: held ? input.holdReason.trim() : '',
    colors: input.colors
      .filter((color) => color.name.trim() || color.orderQty != null)
      .map((color) => ({ ...color, name: color.name.trim() })),
    options: input.options
      .filter((row) => row.styleId || row.name.trim() || row.price != null)
      .map((row) => ({ ...row, name: row.name.trim() })),
  }
}

export async function createProductDraft(
  brandId: string,
  input: ProductDraftInput,
): Promise<ProductDraft> {
  const clean = sanitize(input)
  if (!clean.nameKo && !clean.nameEn) {
    throw new ProductDraftStoreError(
      '한글명이나 영문명 중 하나는 입력하세요.',
      'invalid',
    )
  }

  const now = new Date().toISOString()
  const draft: ProductDraft = {
    ...clean,
    id: newId('draft'),
    brandId,
    draftNo: await issueDraftNo(brandId),
    heldAt: clean.held ? now : null,
    promotedStyleId: null,
    createdAt: now,
    updatedAt: now,
  }

  await withStore(PRODUCT_DRAFTS_STORE, 'readwrite', (store) => {
    store.add(draft)
    return draft
  })
  return draft
}

export async function updateProductDraft(
  id: string,
  input: ProductDraftInput,
): Promise<ProductDraft> {
  const existing = await getProductDraftById(id)
  if (!existing) {
    throw new ProductDraftStoreError('기획안을 찾을 수 없습니다.', 'not_found')
  }

  const clean = sanitize(input)
  if (!clean.nameKo && !clean.nameEn) {
    throw new ProductDraftStoreError(
      '한글명이나 영문명 중 하나는 입력하세요.',
      'invalid',
    )
  }

  const next: ProductDraft = {
    ...existing,
    ...clean,
    // 보류를 새로 걸 때만 시각을 남기고, 해제하면 지운다.
    heldAt: clean.held
      ? (existing.heldAt ?? new Date().toISOString())
      : null,
    updatedAt: new Date().toISOString(),
  }

  await withStore(PRODUCT_DRAFTS_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
}

export async function deleteProductDraft(id: string): Promise<void> {
  const existing = await getProductDraftById(id)
  if (!existing) {
    throw new ProductDraftStoreError('기획안을 찾을 수 없습니다.', 'not_found')
  }
  await withStore(PRODUCT_DRAFTS_STORE, 'readwrite', (store) => {
    store.delete(id)
  })
}

export async function countProductDraftsBySeason(
  seasonId: string,
): Promise<number> {
  const rows = await withStore(PRODUCT_DRAFTS_STORE, 'readonly', (store) =>
    idbRequest<ProductDraft[]>(store.getAll()),
  )
  return rows.filter((row) => row.seasonId === seasonId).length
}
