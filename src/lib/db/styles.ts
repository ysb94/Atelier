import type { Style, StyleInput } from '@/lib/types'
import {
  META_STORE,
  STYLES_STORE,
  idbRequest,
  openDb,
  withStore,
} from '@/lib/db/client'
import { SEED_STYLES } from '@/lib/db/seed-catalog'
import { setBrandStyleCount } from '@/lib/db/brands'
import {
  isStyleStatus,
  parseColors,
  parseGender,
  parseNumber,
  STYLE_TYPED_KEYS,
} from '@/lib/products/style-fields'

const SEED_FLAG_KEY = 'styles_seeded_v1'
const ZERO_TO_NULL_FLAG_KEY = 'styles_zero_to_null_v1'

let seedPromise: Promise<void> | null = null
let migratePromise: Promise<void> | null = null

async function readFlag(key: string) {
  const meta = await withStore(META_STORE, 'readonly', (store) =>
    idbRequest<{ key: string; value: boolean } | undefined>(store.get(key)),
  )
  return Boolean(meta?.value)
}

function normalizeStyle(raw: Style): Style {
  return {
    ...raw,
    colors: Array.isArray(raw.colors) ? raw.colors : [],
    values: raw.values ?? {},
    customFields: raw.customFields ?? {},
    weightG: raw.weightG ?? null,
    targetCost: raw.targetCost ?? null,
    plannedQty: raw.plannedQty ?? null,
    retailPrice: raw.retailPrice ?? null,
  }
}

async function ensureSeedData() {
  if (!seedPromise) {
    seedPromise = (async () => {
      if (await readFlag(SEED_FLAG_KEY)) return

      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STYLES_STORE, META_STORE], 'readwrite')
        const stylesStore = tx.objectStore(STYLES_STORE)
        const metaStore = tx.objectStore(META_STORE)
        for (const style of SEED_STYLES) {
          stylesStore.put(normalizeStyle(style))
        }
        metaStore.put({ key: SEED_FLAG_KEY, value: true })
        tx.oncomplete = () => resolve()
        tx.onerror = () =>
          reject(tx.error ?? new Error('Style seed failed'))
      })

      const byBrand = new Map<string, number>()
      for (const style of SEED_STYLES) {
        byBrand.set(style.brandId, (byBrand.get(style.brandId) ?? 0) + 1)
      }
      for (const [brandId, count] of byBrand) {
        await setBrandStyleCount(brandId, count)
      }
    })().catch((error) => {
      seedPromise = null
      throw error
    })
  }
  return seedPromise
}

/**
 * 예전에는 미입력 숫자를 0으로 저장해서 "0원"과 "아직 아무도 안 넣음"이
 * 구분되지 않았다. 기존 0을 한 번만 미입력으로 되돌린다.
 */
async function ensureNumbersMigrated() {
  if (!migratePromise) {
    migratePromise = (async () => {
      if (await readFlag(ZERO_TO_NULL_FLAG_KEY)) return

      const rows = await withStore(STYLES_STORE, 'readonly', (store) =>
        idbRequest<Style[]>(store.getAll()),
      )
      const stale = rows.filter(
        (row) =>
          row.targetCost === 0 ||
          row.plannedQty === 0 ||
          row.retailPrice === 0,
      )

      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STYLES_STORE, META_STORE], 'readwrite')
        const stylesStore = tx.objectStore(STYLES_STORE)
        for (const row of stale) {
          stylesStore.put({
            ...row,
            targetCost: row.targetCost === 0 ? null : row.targetCost,
            plannedQty: row.plannedQty === 0 ? null : row.plannedQty,
            retailPrice: row.retailPrice === 0 ? null : row.retailPrice,
          })
        }
        tx.objectStore(META_STORE).put({
          key: ZERO_TO_NULL_FLAG_KEY,
          value: true,
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () =>
          reject(tx.error ?? new Error('Style number migration failed'))
      })
    })().catch((error) => {
      migratePromise = null
      throw error
    })
  }
  return migratePromise
}

async function ensureSeeded() {
  await ensureSeedData()
  await ensureNumbersMigrated()
}

function newStyleId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `style-${crypto.randomUUID()}`
  }
  return `style-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const THUMBNAIL_PALETTE = [
  '#D8CFC0',
  '#B9C2B0',
  '#C7B8A6',
  '#A9B4C0',
  '#CBBEB4',
  '#9FA9A0',
]

function pickThumbnailColor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000
  }
  return THUMBNAIL_PALETTE[hash % THUMBNAIL_PALETTE.length]
}

export class StyleStoreError extends Error {
  readonly code: 'not_found' | 'invalid' | 'duplicate'

  constructor(message: string, code: 'not_found' | 'invalid' | 'duplicate') {
    super(message)
    this.name = 'StyleStoreError'
    this.code = code
  }
}

async function recountBrand(brandId: string) {
  const rows = await listStyles(brandId)
  await setBrandStyleCount(brandId, rows.length)
}

export async function listStyles(
  brandId: string,
  seasonId?: string,
): Promise<Style[]> {
  await ensureSeeded()
  const rows = await withStore(STYLES_STORE, 'readonly', (store) => {
    const index = store.index('brandId')
    return idbRequest<Style[]>(index.getAll(brandId))
  })
  return rows
    .map(normalizeStyle)
    .filter((s) => !seasonId || s.seasonId === seasonId)
    .sort((a, b) => a.styleNo.localeCompare(b.styleNo, 'en'))
}

export async function getStyleById(id: string): Promise<Style | undefined> {
  await ensureSeeded()
  const row = await withStore(STYLES_STORE, 'readonly', (store) =>
    idbRequest<Style | undefined>(store.get(id)),
  )
  return row ? normalizeStyle(row) : undefined
}

export async function getStyleByStyleNo(
  brandId: string,
  styleNo: string,
): Promise<Style | undefined> {
  const rows = await listStyles(brandId)
  const normalized = styleNo.trim().toLowerCase()
  return rows.find((s) => s.styleNo.toLowerCase() === normalized)
}

export async function countStylesBySeason(seasonId: string): Promise<number> {
  await ensureSeeded()
  const rows = await withStore(STYLES_STORE, 'readonly', (store) => {
    const index = store.index('seasonId')
    return idbRequest<Style[]>(index.getAll(seasonId))
  })
  return rows.length
}

export async function createStyle(
  brandId: string,
  input: StyleInput,
): Promise<Style> {
  await ensureSeeded()
  const styleNo = input.styleNo.trim()
  const name = input.name.trim()
  if (!styleNo || !name) {
    throw new StyleStoreError('품번과 상품명을 입력하세요.', 'invalid')
  }
  if (!input.seasonId) {
    throw new StyleStoreError('시즌을 선택하세요.', 'invalid')
  }

  const existing = await getStyleByStyleNo(brandId, styleNo)
  if (existing) {
    throw new StyleStoreError('이미 같은 품번이 있습니다.', 'duplicate')
  }

  const style: Style = {
    id: newStyleId(),
    brandId,
    seasonId: input.seasonId,
    styleNo,
    name,
    category: input.category?.trim() || '미분류',
    gender: input.gender ?? 'U',
    colors: input.colors ?? [],
    targetCost: input.targetCost ?? null,
    plannedQty: input.plannedQty ?? null,
    retailPrice: input.retailPrice ?? null,
    status: input.status ?? 'draft',
    designer: input.designer,
    planner: input.planner,
    thumbnailColor: pickThumbnailColor(styleNo),
    description: input.description,
    weightG: input.weightG ?? null,
    values: input.values ?? {},
    customFields: input.customFields ?? {},
  }

  await withStore(STYLES_STORE, 'readwrite', (store) => {
    store.add(style)
    return style
  })
  await recountBrand(brandId)
  return style
}

export async function updateStyle(
  id: string,
  input: Partial<StyleInput>,
): Promise<Style> {
  await ensureSeeded()
  const existing = await getStyleById(id)
  if (!existing) {
    throw new StyleStoreError('상품을 찾을 수 없습니다.', 'not_found')
  }

  if (input.styleNo !== undefined) {
    const styleNo = input.styleNo.trim()
    if (!styleNo) {
      throw new StyleStoreError('품번을 입력하세요.', 'invalid')
    }
    const conflict = await getStyleByStyleNo(existing.brandId, styleNo)
    if (conflict && conflict.id !== id) {
      throw new StyleStoreError('이미 같은 품번이 있습니다.', 'duplicate')
    }
  }

  const next: Style = {
    ...existing,
    seasonId: input.seasonId ?? existing.seasonId,
    styleNo: input.styleNo?.trim() ?? existing.styleNo,
    name: input.name?.trim() ?? existing.name,
    category: input.category?.trim() ?? existing.category,
    gender: input.gender ?? existing.gender,
    colors: input.colors ?? existing.colors,
    targetCost:
      input.targetCost !== undefined ? input.targetCost : existing.targetCost,
    plannedQty:
      input.plannedQty !== undefined ? input.plannedQty : existing.plannedQty,
    retailPrice:
      input.retailPrice !== undefined
        ? input.retailPrice
        : existing.retailPrice,
    status: input.status ?? existing.status,
    designer:
      input.designer !== undefined ? input.designer : existing.designer,
    planner: input.planner !== undefined ? input.planner : existing.planner,
    description:
      input.description !== undefined
        ? input.description
        : existing.description,
    weightG: input.weightG !== undefined ? input.weightG : existing.weightG,
    values: input.values ?? existing.values,
    customFields: input.customFields ?? existing.customFields,
  }

  await withStore(STYLES_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
}

/** 값이 비어 있을 때의 처리. 화면 편집은 지우기, 일괄 가져오기는 유지 */
export type EmptyValuePolicy = 'clear' | 'keep'

/** 숫자로 읽을 수 없는 값은 조용히 넘기지 않고 알린다. */
function requireNumber(label: string, value: string): number {
  const num = parseNumber(value)
  if (num === null) {
    throw new StyleStoreError(
      `${label}: 숫자로 읽을 수 없습니다 ("${value}")`,
      'invalid',
    )
  }
  return num
}

/**
 * BrandField 키 → 문자열 패치.
 * 타입 속성이면 그쪽에, 아니면 values에 저장한다.
 */
export async function updateStyleFields(
  id: string,
  patch: Record<string, string>,
  options?: {
    seasonIdByCode?: Map<string, string>
    emptyMeans?: EmptyValuePolicy
  },
): Promise<Style> {
  await ensureSeeded()
  const existing = await getStyleById(id)
  if (!existing) {
    throw new StyleStoreError('상품을 찾을 수 없습니다.', 'not_found')
  }

  const emptyMeans = options?.emptyMeans ?? 'clear'
  const next = normalizeStyle({ ...existing })
  const values = { ...next.values }

  for (const [key, raw] of Object.entries(patch)) {
    const value = raw ?? ''
    const isEmpty = !value.trim()

    if (isEmpty && emptyMeans === 'keep') continue

    if (!STYLE_TYPED_KEYS.has(key)) {
      if (!isEmpty) values[key] = value
      else delete values[key]
      continue
    }

    switch (key) {
      case 'styleNo': {
        const styleNo = value.trim()
        if (!styleNo) {
          throw new StyleStoreError('품번을 입력하세요.', 'invalid')
        }
        const conflict = await getStyleByStyleNo(existing.brandId, styleNo)
        if (conflict && conflict.id !== id) {
          throw new StyleStoreError('이미 같은 품번이 있습니다.', 'duplicate')
        }
        next.styleNo = styleNo
        break
      }
      case 'name': {
        if (isEmpty) {
          throw new StyleStoreError('상품명은 비울 수 없습니다.', 'invalid')
        }
        next.name = value.trim()
        break
      }
      case 'category':
        next.category = value.trim() || '미분류'
        break
      case 'seasonCode':
      case 'seasonId': {
        if (isEmpty) {
          throw new StyleStoreError('시즌은 비울 수 없습니다.', 'invalid')
        }
        const trimmed = value.trim()
        const seasonId =
          options?.seasonIdByCode?.get(trimmed.toUpperCase()) ??
          (trimmed.startsWith('season-') ? trimmed : undefined)
        if (!seasonId) {
          throw new StyleStoreError(
            `시즌 "${trimmed}"을 찾을 수 없습니다. 설정 → 시즌에서 먼저 추가하세요.`,
            'invalid',
          )
        }
        next.seasonId = seasonId
        break
      }
      case 'gender': {
        if (isEmpty) {
          throw new StyleStoreError('성별을 선택하세요.', 'invalid')
        }
        const gender = parseGender(value)
        if (!gender) {
          throw new StyleStoreError(
            `성별을 알 수 없습니다 ("${value.trim()}")`,
            'invalid',
          )
        }
        next.gender = gender
        break
      }
      case 'colors':
        next.colors = parseColors(value)
        break
      case 'plannedQty':
        next.plannedQty = isEmpty ? null : requireNumber('기획수량', value)
        break
      case 'targetCost':
        next.targetCost = isEmpty ? null : requireNumber('목표원가', value)
        break
      case 'retailPrice':
        next.retailPrice = isEmpty ? null : requireNumber('소비자가', value)
        break
      case 'planner':
        next.planner = value.trim() || undefined
        break
      case 'designer':
        next.designer = value.trim() || undefined
        break
      case 'description':
        next.description = value.trim() || undefined
        break
      case 'weightG': {
        if (isEmpty) {
          next.weightG = null
          break
        }
        const num = requireNumber('단품무게(g)', value)
        if (num <= 0) {
          throw new StyleStoreError(
            '단품무게(g)는 0보다 커야 합니다.',
            'invalid',
          )
        }
        next.weightG = num
        break
      }
      case 'status': {
        const status = value.trim()
        if (!isStyleStatus(status)) {
          throw new StyleStoreError(
            `상태를 알 수 없습니다 ("${status}")`,
            'invalid',
          )
        }
        next.status = status
        break
      }
      default:
        break
    }
  }

  next.values = values

  await withStore(STYLES_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
}

export async function deleteStyle(id: string): Promise<void> {
  await ensureSeeded()
  const existing = await getStyleById(id)
  if (!existing) {
    throw new StyleStoreError('상품을 찾을 수 없습니다.', 'not_found')
  }
  await withStore(STYLES_STORE, 'readwrite', (store) => {
    store.delete(id)
  })
  await recountBrand(existing.brandId)
}

export async function putStyle(style: Style): Promise<Style> {
  await ensureSeeded()
  const next = normalizeStyle(style)
  await withStore(STYLES_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
}

export { pickThumbnailColor, newStyleId }
