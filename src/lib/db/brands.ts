import type { Brand, BrandInput } from '@/lib/types'
import {
  BRANDS_STORE,
  META_STORE,
  idbRequest,
  openDb,
  withStore,
} from '@/lib/db/client'

const SEED_FLAG_KEY = 'brands_seeded_v1'
const MIGRATE_FLAG_KEY = 'brands_schema_v2'

/** 목업 상품·시즌 brandId와 맞추기 위해 고정 id로 1회만 seed */
const SEED_BRANDS: Brand[] = [
  {
    id: 'brand-atelier',
    slug: 'atelier',
    name: 'ATELIER',
    nameKo: '아틀리에',
    description: '시티 모던 여성복',
    color: '#2C3E50',
    styleCount: 24,
    foundedYear: 2018,
    logoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'brand-noir',
    slug: 'noir',
    name: 'NOIR',
    nameKo: '느와르',
    description: '미니멀 블랙 라인',
    color: '#1A1A1A',
    styleCount: 18,
    foundedYear: 2020,
    logoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'brand-lumen',
    slug: 'lumen',
    name: 'LUMEN',
    nameKo: '루멘',
    description: '라이트 캐주얼',
    color: '#6B7C6E',
    styleCount: 31,
    foundedYear: 2016,
    logoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'brand-form',
    slug: 'form',
    name: 'FORM',
    nameKo: '폼',
    description: '유틸리티 워크웨어',
    color: '#4A5568',
    styleCount: 15,
    foundedYear: 2021,
    logoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

type LegacyBrand = Partial<Brand> & {
  seasonLabel?: string
}

let readyPromise: Promise<void> | null = null

function parseFoundedYear(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const asYear = Number(value.trim())
    if (Number.isFinite(asYear)) return Math.trunc(asYear)
    // 구 seasonLabel("26SS") 같은 값은 설립년으로 쓰지 않음
  }
  return fallback
}

const SEED_FOUNDED_YEAR: Record<string, number> = {
  'brand-atelier': 2018,
  'brand-noir': 2020,
  'brand-lumen': 2016,
  'brand-form': 2021,
}

/** 기존 IndexedDB 레코드(seasonLabel 등)를 현재 스키마로 정규화 */
export function normalizeBrand(raw: LegacyBrand): Brand {
  const fallbackYear =
    (raw.id && SEED_FOUNDED_YEAR[raw.id]) || new Date().getFullYear()
  const name = (raw.name ?? '').trim() || 'BRAND'
  return {
    id: raw.id ?? `brand-unknown`,
    slug: raw.slug ?? 'unknown',
    name,
    nameKo: raw.nameKo ?? name,
    description: raw.description ?? '',
    color: raw.color ?? '#1A1A1A',
    styleCount: typeof raw.styleCount === 'number' ? raw.styleCount : 0,
    foundedYear: parseFoundedYear(raw.foundedYear, fallbackYear),
    logoUrl: raw.logoUrl ?? null,
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  }
}

async function ensureSeeded() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const db = await openDb()
      const meta = await withStore(META_STORE, 'readonly', (store) =>
        idbRequest<{ key: string; value: boolean } | undefined>(
          store.get(SEED_FLAG_KEY),
        ),
      )
      if (!meta?.value) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([BRANDS_STORE, META_STORE], 'readwrite')
          const brandsStore = tx.objectStore(BRANDS_STORE)
          const metaStore = tx.objectStore(META_STORE)

          for (const brand of SEED_BRANDS) {
            brandsStore.put(brand)
          }
          metaStore.put({ key: SEED_FLAG_KEY, value: true })
          metaStore.put({ key: MIGRATE_FLAG_KEY, value: true })

          tx.oncomplete = () => resolve()
          tx.onerror = () =>
            reject(tx.error ?? new Error('Brand seed failed'))
        })
        return
      }

      const migrated = await withStore(META_STORE, 'readonly', (store) =>
        idbRequest<{ key: string; value: boolean } | undefined>(
          store.get(MIGRATE_FLAG_KEY),
        ),
      )
      if (migrated?.value) return

      const rows = await withStore(BRANDS_STORE, 'readonly', (store) =>
        idbRequest<LegacyBrand[]>(store.getAll()),
      )
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([BRANDS_STORE, META_STORE], 'readwrite')
        const brandsStore = tx.objectStore(BRANDS_STORE)
        const metaStore = tx.objectStore(META_STORE)

        for (const row of rows) {
          brandsStore.put(normalizeBrand(row))
        }
        metaStore.put({ key: MIGRATE_FLAG_KEY, value: true })

        tx.oncomplete = () => resolve()
        tx.onerror = () =>
          reject(tx.error ?? new Error('Brand migrate failed'))
      })
    })().catch((error) => {
      readyPromise = null
      throw error
    })
  }
  return readyPromise
}

function normalizeSlug(slug: string) {
  return slug.trim().toLowerCase()
}

function nowIso() {
  return new Date().toISOString()
}

function newBrandId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `brand-${crypto.randomUUID()}`
  }
  return `brand-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function clampFoundedYear(year: number) {
  const current = new Date().getFullYear()
  if (!Number.isFinite(year)) return current
  return Math.min(Math.max(Math.trunc(year), 1800), current + 1)
}

function normalizeLogoUrl(logoUrl?: string | null) {
  if (!logoUrl) return null
  const trimmed = logoUrl.trim()
  return trimmed || null
}

export async function listBrands(): Promise<Brand[]> {
  await ensureSeeded()
  const rows = await withStore(BRANDS_STORE, 'readonly', (store) =>
    idbRequest<LegacyBrand[]>(store.getAll()),
  )
  return rows
    .map(normalizeBrand)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

export async function getBrandById(id: string): Promise<Brand | undefined> {
  await ensureSeeded()
  const row = await withStore(BRANDS_STORE, 'readonly', (store) =>
    idbRequest<LegacyBrand | undefined>(store.get(id)),
  )
  return row ? normalizeBrand(row) : undefined
}

export async function getBrandBySlug(
  slug: string,
): Promise<Brand | undefined> {
  await ensureSeeded()
  const normalized = normalizeSlug(slug)
  const row = await withStore(BRANDS_STORE, 'readonly', async (store) => {
    const index = store.index('slug')
    return idbRequest<LegacyBrand | undefined>(index.get(normalized))
  })
  return row ? normalizeBrand(row) : undefined
}

export async function isSlugTaken(
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const existing = await getBrandBySlug(slug)
  if (!existing) return false
  return existing.id !== excludeId
}

export class BrandStoreError extends Error {
  readonly code: 'slug_taken' | 'not_found' | 'invalid'

  constructor(
    message: string,
    code: 'slug_taken' | 'not_found' | 'invalid',
  ) {
    super(message)
    this.name = 'BrandStoreError'
    this.code = code
  }
}

export async function createBrand(input: BrandInput): Promise<Brand> {
  await ensureSeeded()
  const slug = normalizeSlug(input.slug)
  if (!slug) {
    throw new BrandStoreError('slug는 필수입니다.', 'invalid')
  }
  if (await isSlugTaken(slug)) {
    throw new BrandStoreError('이미 사용 중인 slug입니다.', 'slug_taken')
  }

  const timestamp = nowIso()
  const brand: Brand = {
    id: newBrandId(),
    slug,
    name: input.name.trim(),
    nameKo: input.nameKo.trim(),
    description: input.description.trim(),
    color: input.color.trim() || '#1A1A1A',
    foundedYear: clampFoundedYear(input.foundedYear),
    logoUrl: normalizeLogoUrl(input.logoUrl),
    styleCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await withStore(BRANDS_STORE, 'readwrite', (store) => {
    store.add(brand)
    return brand
  })
  return brand
}

export async function updateBrand(
  id: string,
  input: BrandInput,
): Promise<Brand> {
  await ensureSeeded()
  const existing = await getBrandById(id)
  if (!existing) {
    throw new BrandStoreError('브랜드를 찾을 수 없습니다.', 'not_found')
  }

  const slug = normalizeSlug(input.slug)
  if (!slug) {
    throw new BrandStoreError('slug는 필수입니다.', 'invalid')
  }
  if (await isSlugTaken(slug, id)) {
    throw new BrandStoreError('이미 사용 중인 slug입니다.', 'slug_taken')
  }

  const next: Brand = {
    ...existing,
    slug,
    name: input.name.trim(),
    nameKo: input.nameKo.trim(),
    description: input.description.trim(),
    color: input.color.trim() || existing.color,
    foundedYear: clampFoundedYear(input.foundedYear),
    logoUrl: normalizeLogoUrl(input.logoUrl),
    updatedAt: nowIso(),
  }

  await withStore(BRANDS_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
}

export async function deleteBrand(id: string): Promise<void> {
  await ensureSeeded()
  const existing = await getBrandById(id)
  if (!existing) {
    throw new BrandStoreError('브랜드를 찾을 수 없습니다.', 'not_found')
  }
  await withStore(BRANDS_STORE, 'readwrite', (store) => {
    store.delete(id)
  })
}

export async function setBrandStyleCount(
  id: string,
  styleCount: number,
): Promise<void> {
  await ensureSeeded()
  const existing = await getBrandById(id)
  if (!existing) return

  const next: Brand = {
    ...existing,
    styleCount,
    updatedAt: nowIso(),
  }
  await withStore(BRANDS_STORE, 'readwrite', (store) => {
    store.put(next)
  })
}
