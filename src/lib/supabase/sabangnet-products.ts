import type {
  SabangnetProduct,
  SabangnetProductInput,
  StyleRef,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const PRODUCT_COLUMNS =
  'id, brand_id, code, name, values, created_at, updated_at'
const PRODUCT_PAGE_SIZE = 1000
const LINK_QUERY_SIZE = 100
const STYLE_QUERY_SIZE = 200
const BULK_CHUNK_SIZE = 200

type ProductRow = {
  id: string
  brand_id: string
  code: string
  name: string
  values: unknown
  created_at: string
  updated_at: string
}

type LinkRow = {
  product_id: string
  style_id: string
  sort_order: number
}

type StyleRow = {
  id: string
  style_no: string
  name: string
}

export class SabangnetProductStoreError extends Error {
  readonly code: 'duplicate' | 'not_found' | 'invalid'

  constructor(
    message: string,
    code: 'duplicate' | 'not_found' | 'invalid' = 'invalid',
  ) {
    super(message)
    this.name = 'SabangnetProductStoreError'
    this.code = code
  }
}

function uniqueStyleIds(styleIds: string[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const raw of styleIds) {
    const styleId = raw.trim()
    if (!styleId) continue
    if (seen.has(styleId)) {
      throw new SabangnetProductStoreError(
        '같은 상품에 M번호가 반복됩니다.',
        'invalid',
      )
    }
    seen.add(styleId)
    ids.push(styleId)
  }
  return ids
}

function normalizeValues(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null) continue
    const text = String(value).trim()
    if (!text) continue
    values[key] = text
  }
  return values
}

function validate(input: SabangnetProductInput) {
  const code = input.code.trim()
  const name = input.name.trim()
  if (!code) {
    throw new SabangnetProductStoreError('사방넷 코드를 입력하세요.', 'invalid')
  }
  if (!name) {
    throw new SabangnetProductStoreError(
      '사방넷 상품명을 입력하세요.',
      'invalid',
    )
  }
  return {
    code,
    name,
    styleIds: uniqueStyleIds(input.styleIds),
    values:
      input.values === undefined ? undefined : normalizeValues(input.values),
  }
}

function toProduct(
  row: ProductRow,
  styles: StyleRef[],
): SabangnetProduct {
  return {
    id: row.id,
    brandId: row.brand_id,
    code: row.code,
    name: row.name,
    values: normalizeValues(row.values),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    styles,
  }
}

function storeError(
  error: { code?: string; message?: string } | null,
  fallback: string,
) {
  if (error && isUniqueViolation(error)) {
    return new SabangnetProductStoreError(
      '이미 등록된 사방넷 코드입니다.',
      'duplicate',
    )
  }
  return new SabangnetProductStoreError(errorMessage(error, fallback), 'invalid')
}

async function loadStylesByIds(styleIds: string[]) {
  const map = new Map<string, StyleRef>()
  const uniqueIds = Array.from(new Set(styleIds.filter(Boolean)))
  if (uniqueIds.length === 0) return map

  for (let start = 0; start < uniqueIds.length; start += STYLE_QUERY_SIZE) {
    const chunk = uniqueIds.slice(start, start + STYLE_QUERY_SIZE)
    const { data, error } = await getSupabase()
      .from('styles')
      .select('id, style_no, name')
      .in('id', chunk)
    if (error) {
      throw storeError(error, '연결 M번호를 불러오지 못했습니다.')
    }
    for (const row of (data as StyleRow[]) ?? []) {
      map.set(row.id, {
        styleId: row.id,
        styleNo: row.style_no,
        name: row.name,
      })
    }
  }
  return map
}

async function loadProductStyles(productIds: string[]) {
  const map = new Map<string, StyleRef[]>()
  if (productIds.length === 0) return map

  const links: LinkRow[] = []
  for (let start = 0; start < productIds.length; start += LINK_QUERY_SIZE) {
    const chunk = productIds.slice(start, start + LINK_QUERY_SIZE)
    const { data, error } = await getSupabase()
      .from('sabangnet_product_styles')
      .select('product_id, style_id, sort_order')
      .in('product_id', chunk)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
    if (error) {
      throw storeError(error, '사방넷 M번호 연결을 불러오지 못했습니다.')
    }
    links.push(...((data as LinkRow[]) ?? []))
  }

  const styles = await loadStylesByIds(links.map((link) => link.style_id))
  for (const link of links) {
    const list = map.get(link.product_id) ?? []
    list.push(
      styles.get(link.style_id) ?? {
        styleId: link.style_id,
        styleNo: '',
        name: '삭제된 단품',
      },
    )
    map.set(link.product_id, list)
  }
  return map
}

async function saveViaRpc(
  brandId: string,
  id: string | null,
  input: SabangnetProductInput,
  preservedValues?: Record<string, string>,
): Promise<string> {
  const { code, name, styleIds, values } = validate(input)
  const { data, error } = await getSupabase().rpc('save_sabangnet_product', {
    p_brand_id: brandId,
    p_id: id,
    p_code: code,
    p_name: name,
    p_style_ids: styleIds,
    p_values: values ?? preservedValues ?? {},
  })
  if (error) {
    throw storeError(error, '사방넷 코드를 저장하지 못했습니다.')
  }
  return data as string
}

export async function listSabangnetProducts(
  brandId: string,
): Promise<SabangnetProduct[]> {
  const supabase = getSupabase()
  const rows = await fetchAllPages<ProductRow>({
    pageSize: PRODUCT_PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await supabase
        .from('sabangnet_products')
        .select(PRODUCT_COLUMNS, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
      if (error) {
        throw storeError(error, '사방넷 코드를 불러오지 못했습니다.')
      }
      return {
        rows: (data as ProductRow[]) ?? [],
        count: count ?? null,
      }
    },
  })
  const styles = await loadProductStyles(rows.map((row) => row.id))
  return rows.map((row) => toProduct(row, styles.get(row.id) ?? []))
}

export type SabangnetStyleCode = {
  styleId: string
  code: string
}

/** 데이터 시트용. M번호가 들어 있는 사방넷 코드만 가져온다. */
export async function listSabangnetStyleCodes(
  brandId: string,
): Promise<SabangnetStyleCode[]> {
  const supabase = getSupabase()
  const products = await fetchAllPages<{ id: string; code: string }>({
    pageSize: PRODUCT_PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await supabase
        .from('sabangnet_products')
        .select('id, code', withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('id', { ascending: true })
        .range(from, to)
      if (error) {
        throw storeError(error, '사방넷 코드를 불러오지 못했습니다.')
      }
      return {
        rows: (data as { id: string; code: string }[]) ?? [],
        count: count ?? null,
      }
    },
  })
  const codeByProductId = new Map(products.map((row) => [row.id, row.code]))
  const links = await fetchAllPages<{ style_id: string; product_id: string }>({
    pageSize: PRODUCT_PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await supabase
        .from('sabangnet_product_styles')
        .select('style_id, product_id', withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('id', { ascending: true })
        .range(from, to)
      if (error) {
        throw storeError(error, '사방넷 M번호 연결을 불러오지 못했습니다.')
      }
      return {
        rows: (data as { style_id: string; product_id: string }[]) ?? [],
        count: count ?? null,
      }
    },
  })

  const result: SabangnetStyleCode[] = []
  for (const link of links) {
    const code = codeByProductId.get(link.product_id)
    if (!code) continue
    result.push({ styleId: link.style_id, code })
  }
  return result
}

export async function getSabangnetProduct(
  id: string,
): Promise<SabangnetProduct | undefined> {
  const { data, error } = await getSupabase()
    .from('sabangnet_products')
    .select(PRODUCT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    throw storeError(error, '사방넷 코드를 불러오지 못했습니다.')
  }
  if (!data) return undefined
  const row = data as ProductRow
  const styles = await loadProductStyles([row.id])
  return toProduct(row, styles.get(row.id) ?? [])
}

export async function createSabangnetProduct(
  brandId: string,
  input: SabangnetProductInput,
): Promise<SabangnetProduct> {
  const id = await saveViaRpc(brandId, null, input)
  const created = await getSabangnetProduct(id)
  if (!created) {
    throw new SabangnetProductStoreError(
      '사방넷 코드를 저장하지 못했습니다.',
      'invalid',
    )
  }
  return created
}

export async function updateSabangnetProduct(
  id: string,
  input: SabangnetProductInput,
): Promise<SabangnetProduct> {
  const existing = await getSabangnetProduct(id)
  if (!existing) {
    throw new SabangnetProductStoreError(
      '사방넷 코드를 찾을 수 없습니다.',
      'not_found',
    )
  }
  await saveViaRpc(existing.brandId, id, input, existing.values)
  const updated = await getSabangnetProduct(id)
  if (!updated) {
    throw new SabangnetProductStoreError(
      '사방넷 코드를 저장하지 못했습니다.',
      'invalid',
    )
  }
  return updated
}

export async function deleteSabangnetProduct(id: string): Promise<void> {
  const existing = await getSabangnetProduct(id)
  if (!existing) {
    throw new SabangnetProductStoreError(
      '사방넷 코드를 찾을 수 없습니다.',
      'not_found',
    )
  }
  const { error } = await getSupabase()
    .from('sabangnet_products')
    .delete()
    .eq('id', id)
    .eq('brand_id', existing.brandId)
  if (error) {
    throw storeError(error, '사방넷 코드를 삭제하지 못했습니다.')
  }
}

export type SabangnetBulkCreateRow = {
  code: string
  name: string
  styleIds: string[]
  values?: Record<string, string>
}

export type SabangnetBulkCreateResult = {
  created: number
  updated: number
  skipped: number
}

export async function createSabangnetProductsBulk(
  brandId: string,
  rows: SabangnetBulkCreateRow[],
): Promise<SabangnetBulkCreateResult> {
  if (rows.length === 0) return { created: 0, updated: 0, skipped: 0 }
  if (rows.length > BULK_CHUNK_SIZE) {
    throw new SabangnetProductStoreError(
      '한 번에 200행까지 등록할 수 있습니다.',
      'invalid',
    )
  }

  const payload = rows.map((row) => {
    const { code, name, styleIds, values } = validate(row)
    return {
      code,
      name,
      style_ids: styleIds,
      ...(values === undefined ? {} : { values }),
    }
  })

  const { data, error } = await getSupabase().rpc(
    'create_sabangnet_products_bulk',
    {
      p_brand_id: brandId,
      p_rows: payload,
    },
  )
  if (error) {
    throw storeError(error, '사방넷 코드를 일괄 저장하지 못했습니다.')
  }

  const result = data as {
    created?: number
    updated?: number
    skipped?: number
  } | null
  return {
    created: Number(result?.created ?? 0),
    updated: Number(result?.updated ?? 0),
    skipped: Number(result?.skipped ?? 0),
  }
}
