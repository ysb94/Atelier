import type { Brand, BrandInput } from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'

/**
 * 브랜드 저장소. 원본은 Supabase다.
 * styleCount는 여기서 채우지 않는다. api 계층이 styles COUNT로 붙인다.
 */

const BRANDS_TABLE = 'brands'

/** 브랜드 4개 seed와 같은 값. 상위 소유자가 하나뿐이라 조회 없이 쓴다. */
export const DEFAULT_COMPANY_ID = 'e0000000-0000-4000-8000-000000000001'

const BRAND_COLUMNS =
  'id, slug, name, name_ko, description, color, founded_year, logo_url, created_at, updated_at'

type BrandRow = {
  id: string
  slug: string
  name: string
  name_ko: string
  description: string
  color: string
  founded_year: number
  logo_url: string | null
  created_at: string
  updated_at: string
}

export class BrandStoreError extends Error {
  readonly code: 'slug_taken' | 'not_found' | 'invalid' | 'unknown'

  constructor(
    message: string,
    code: 'slug_taken' | 'not_found' | 'invalid' | 'unknown',
  ) {
    super(message)
    this.name = 'BrandStoreError'
    this.code = code
  }
}

/** styleCount는 상위 계층이 채운다. */
function toBrand(row: BrandRow): Omit<Brand, 'styleCount'> {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    nameKo: row.name_ko,
    description: row.description,
    color: row.color,
    foundedYear: row.founded_year,
    logoUrl: row.logo_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeSlug(slug: string) {
  return slug.trim().toLowerCase()
}

function clampFoundedYear(year: number) {
  const current = new Date().getFullYear()
  if (!Number.isFinite(year)) return current
  return Math.min(Math.max(Math.trunc(year), 1800), current + 1)
}

function normalizeLogoUrl(logoUrl?: string | null) {
  if (!logoUrl) return null
  return logoUrl.trim() || null
}

function toRowInput(input: BrandInput) {
  return {
    slug: normalizeSlug(input.slug),
    name: input.name.trim(),
    name_ko: input.nameKo.trim(),
    description: input.description.trim(),
    color: input.color.trim().toUpperCase() || '#1A1A1A',
    founded_year: clampFoundedYear(input.foundedYear),
    logo_url: normalizeLogoUrl(input.logoUrl),
  }
}

/** Postgres 오류를 화면에서 쓸 수 있는 메시지로 바꾼다. */
function toStoreError(error: { code?: string; message: string }) {
  if (error.code === '23505' || error.code === '23000') {
    return new BrandStoreError('이미 사용 중인 slug입니다.', 'slug_taken')
  }
  if (error.code === '23514') {
    return new BrandStoreError(
      'slug, 색상 또는 연도 형식이 올바르지 않습니다.',
      'invalid',
    )
  }
  if (error.code === '42501' || error.code === 'PGRST301') {
    return new BrandStoreError(
      '권한이 없습니다. 다시 로그인해 주세요.',
      'unknown',
    )
  }
  return new BrandStoreError(error.message, 'unknown')
}

export async function listBrands(): Promise<Omit<Brand, 'styleCount'>[]> {
  const { data, error } = await getSupabase()
    .from(BRANDS_TABLE)
    .select(BRAND_COLUMNS)
    .order('name', { ascending: true })

  if (error) throw toStoreError(error)
  return (data ?? []).map(toBrand)
}

export async function getBrandBySlug(
  slug: string,
): Promise<Omit<Brand, 'styleCount'> | undefined> {
  const { data, error } = await getSupabase()
    .from(BRANDS_TABLE)
    .select(BRAND_COLUMNS)
    .eq('slug', normalizeSlug(slug))
    .maybeSingle()

  if (error) throw toStoreError(error)
  return data ? toBrand(data) : undefined
}

export async function createBrand(
  input: BrandInput,
): Promise<Omit<Brand, 'styleCount'>> {
  const row = toRowInput(input)
  if (!row.slug) {
    throw new BrandStoreError('slug는 필수입니다.', 'invalid')
  }

  const { data, error } = await getSupabase()
    .from(BRANDS_TABLE)
    .insert({ ...row, company_id: DEFAULT_COMPANY_ID })
    .select(BRAND_COLUMNS)
    .single()

  if (error) throw toStoreError(error)
  return toBrand(data)
}

export async function updateBrand(
  id: string,
  input: BrandInput,
): Promise<Omit<Brand, 'styleCount'>> {
  const row = toRowInput(input)
  if (!row.slug) {
    throw new BrandStoreError('slug는 필수입니다.', 'invalid')
  }

  const { data, error } = await getSupabase()
    .from(BRANDS_TABLE)
    .update(row)
    .eq('id', id)
    .select(BRAND_COLUMNS)
    .maybeSingle()

  if (error) throw toStoreError(error)
  if (!data) {
    throw new BrandStoreError('브랜드를 찾을 수 없습니다.', 'not_found')
  }
  return toBrand(data)
}

export async function deleteBrand(id: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from(BRANDS_TABLE)
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) throw toStoreError(error)
  if (!data) {
    throw new BrandStoreError('브랜드를 찾을 수 없습니다.', 'not_found')
  }
}
