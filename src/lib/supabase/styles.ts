import type { Style, StyleInput, StyleStatus } from '@/lib/types'
import {
  isStyleStatus,
  parseColors,
  parseGender,
  parseNumber,
  STYLE_TYPED_KEYS,
} from '@/lib/products/style-fields'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, season_id, style_no, name, category, gender, colors, target_cost, planned_qty, retail_price, status, designer, planner, thumbnail_color, description, weight_g, values, custom_fields, created_at, updated_at'

type StyleRow = {
  id: string
  brand_id: string
  season_id: string
  style_no: string
  name: string
  category: string
  gender: Style['gender']
  colors: string[] | null
  target_cost: number | null
  planned_qty: number | null
  retail_price: number | null
  status: StyleStatus
  designer: string | null
  planner: string | null
  thumbnail_color: string
  description: string | null
  weight_g: number | null
  values: Record<string, string> | null
  custom_fields: Record<string, string> | null
  created_at: string
  updated_at: string
}

const THUMBNAIL_PALETTE = [
  '#D8CFC0',
  '#B9C2B0',
  '#C7B8A6',
  '#A9B4C0',
  '#CBBEB4',
  '#9FA9A0',
]

export function pickThumbnailColor(seed: string) {
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

function toStyle(row: StyleRow): Style {
  return {
    id: row.id,
    brandId: row.brand_id,
    seasonId: row.season_id,
    styleNo: row.style_no,
    name: row.name,
    category: row.category,
    gender: row.gender,
    colors: Array.isArray(row.colors) ? row.colors : [],
    targetCost: row.target_cost,
    plannedQty: row.planned_qty,
    retailPrice: row.retail_price,
    status: row.status,
    designer: row.designer ?? undefined,
    planner: row.planner ?? undefined,
    thumbnailColor: row.thumbnail_color,
    description: row.description ?? undefined,
    weightG: row.weight_g,
    values: row.values ?? {},
    customFields: row.custom_fields ?? {},
  }
}

function toRowPatch(style: Style) {
  return {
    brand_id: style.brandId,
    season_id: style.seasonId,
    style_no: style.styleNo,
    name: style.name,
    category: style.category,
    gender: style.gender,
    colors: style.colors,
    target_cost: style.targetCost,
    planned_qty: style.plannedQty,
    retail_price: style.retailPrice,
    status: style.status,
    designer: style.designer ?? null,
    planner: style.planner ?? null,
    thumbnail_color: style.thumbnailColor,
    description: style.description ?? null,
    weight_g: style.weightG ?? null,
    values: style.values ?? {},
    custom_fields: style.customFields ?? {},
  }
}

export async function countStylesByBrand(): Promise<Record<string, number>> {
  const { data, error } = await getSupabase().from('styles').select('brand_id')
  if (error) {
    throw new StyleStoreError(
      errorMessage(error, '상품 수를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const brandId = (row as { brand_id: string }).brand_id
    counts[brandId] = (counts[brandId] ?? 0) + 1
  }
  return counts
}

export async function countStylesBySeason(seasonId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('styles')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
  if (error) {
    throw new StyleStoreError(
      errorMessage(error, '상품 수를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return count ?? 0
}

/** PostgREST 응답 상한에 걸리지 않도록 나눠 읽는 크기 */
const PAGE_SIZE = 1000

export async function listStyles(
  brandId: string,
  seasonId?: string,
): Promise<Style[]> {
  const rows: StyleRow[] = []

  // 상품이 수천 건이면 한 번에 다 오지 않는다. 끝까지 이어 읽는다.
  for (let page = 0; ; page += 1) {
    let query = getSupabase()
      .from('styles')
      .select(COLUMNS)
      .eq('brand_id', brandId)
    if (seasonId) query = query.eq('season_id', seasonId)

    const { data, error } = await query
      .order('style_no', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) {
      throw new StyleStoreError(
        errorMessage(error, '상품을 불러오지 못했습니다.'),
        'invalid',
      )
    }

    const batch = (data as StyleRow[]) ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  return rows
    .map(toStyle)
    .sort((a, b) => a.styleNo.localeCompare(b.styleNo, 'en'))
}

export type StyleFilter = {
  seasonId?: string
  status?: StyleStatus
  /** 품번·상품명 부분 일치 */
  search?: string
}

/**
 * or() 문법이 쉼표와 괄호로 끊기고 %는 와일드카드라 그대로 넘길 수 없다.
 * 검색어에서 문법을 깨는 문자를 공백으로 바꾼다.
 */
function sanitizeSearch(raw: string): string {
  return raw
    .replace(/[,()%*\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 화면에 보이는 만큼만 읽는다.
 * 전체를 받아 브라우저에서 걸러내면 상품이 수천 건일 때 첫 화면이 느려진다.
 */
export async function listStylesPage(
  brandId: string,
  filter: StyleFilter,
  offset: number,
  limit: number,
): Promise<{ rows: Style[]; total: number }> {
  let query = getSupabase()
    .from('styles')
    .select(COLUMNS, { count: 'exact' })
    .eq('brand_id', brandId)

  if (filter.seasonId) query = query.eq('season_id', filter.seasonId)
  if (filter.status) query = query.eq('status', filter.status)

  const keyword = filter.search ? sanitizeSearch(filter.search) : ''
  if (keyword) {
    query = query.or(`style_no.ilike.%${keyword}%,name.ilike.%${keyword}%`)
  }

  const { data, error, count } = await query
    .order('style_no', { ascending: true })
    .range(offset, offset + Math.max(limit, 1) - 1)

  if (error) {
    throw new StyleStoreError(
      errorMessage(error, '상품을 불러오지 못했습니다.'),
      'invalid',
    )
  }

  return {
    rows: ((data as StyleRow[]) ?? []).map(toStyle),
    total: count ?? 0,
  }
}

/** 같은 조건으로 전부 읽는다. 내보내기처럼 한 번에 다 필요할 때만 쓴다. */
export async function listStylesFiltered(
  brandId: string,
  filter: StyleFilter,
): Promise<Style[]> {
  const all: Style[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { rows, total } = await listStylesPage(
      brandId,
      filter,
      offset,
      PAGE_SIZE,
    )
    all.push(...rows)
    if (rows.length < PAGE_SIZE || all.length >= total) break
  }
  return all
}

export async function getStyleById(id: string): Promise<Style | undefined> {
  const { data, error } = await getSupabase()
    .from('styles')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    throw new StyleStoreError(
      errorMessage(error, '상품을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return data ? toStyle(data as StyleRow) : undefined
}

export async function getStyleByStyleNo(
  brandId: string,
  styleNo: string,
): Promise<Style | undefined> {
  const normalized = styleNo.trim()
  if (!normalized) return undefined
  const { data, error } = await getSupabase()
    .from('styles')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .ilike('style_no', normalized)
    .maybeSingle()
  if (error) {
    throw new StyleStoreError(
      errorMessage(error, '상품을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return data ? toStyle(data as StyleRow) : undefined
}

function toInsertRow(brandId: string, input: StyleInput) {
  const styleNo = input.styleNo.trim()
  return {
    brand_id: brandId,
    season_id: input.seasonId,
    style_no: styleNo,
    name: input.name.trim(),
    category: input.category?.trim() || '미분류',
    gender: input.gender ?? 'U',
    colors: input.colors ?? [],
    target_cost: input.targetCost ?? null,
    planned_qty: input.plannedQty ?? null,
    retail_price: input.retailPrice ?? null,
    status: input.status ?? 'draft',
    designer: input.designer ?? null,
    planner: input.planner ?? null,
    thumbnail_color: pickThumbnailColor(styleNo),
    description: input.description ?? null,
    weight_g: input.weightG ?? null,
    values: input.values ?? {},
    custom_fields: input.customFields ?? {},
  }
}

export async function createStyle(
  brandId: string,
  input: StyleInput,
): Promise<Style> {
  const styleNo = input.styleNo.trim()
  const name = input.name.trim()
  if (!styleNo || !name) {
    throw new StyleStoreError('품번과 상품명을 입력하세요.', 'invalid')
  }
  if (!input.seasonId) {
    throw new StyleStoreError('시즌을 선택하세요.', 'invalid')
  }

  const { data, error } = await getSupabase()
    .from('styles')
    .insert(toInsertRow(brandId, input))
    .select(COLUMNS)
    .single()

  if (error) {
    throw new StyleStoreError(
      isUniqueViolation(error)
        ? '이미 같은 품번이 있습니다.'
        : errorMessage(error, '상품을 만들지 못했습니다.'),
      isUniqueViolation(error) ? 'duplicate' : 'invalid',
    )
  }

  return toStyle(data as StyleRow)
}

export async function updateStyle(
  id: string,
  input: Partial<StyleInput>,
): Promise<Style> {
  const existing = await getStyleById(id)
  if (!existing) {
    throw new StyleStoreError('상품을 찾을 수 없습니다.', 'not_found')
  }

  if (input.styleNo !== undefined) {
    const styleNo = input.styleNo.trim()
    if (!styleNo) {
      throw new StyleStoreError('품번을 입력하세요.', 'invalid')
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

  const { data, error } = await getSupabase()
    .from('styles')
    .update(toRowPatch(next))
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) {
    throw new StyleStoreError(
      isUniqueViolation(error)
        ? '이미 같은 품번이 있습니다.'
        : errorMessage(error, '상품을 저장하지 못했습니다.'),
      isUniqueViolation(error) ? 'duplicate' : 'invalid',
    )
  }

  return toStyle(data as StyleRow)
}

export type EmptyValuePolicy = 'clear' | 'keep'

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
 * 문자열 패치를 이미 읽어 둔 상품에 적용한다. 저장은 하지 않는다.
 * 대량 반영에서 상품을 다시 읽지 않고 메모리에서 병합하려고 분리했다.
 */
export function applyStyleFieldPatch(
  existing: Style,
  patch: Record<string, string>,
  options?: {
    seasonIdByCode?: Map<string, string>
    emptyMeans?: EmptyValuePolicy
  },
): Style {
  const emptyMeans = options?.emptyMeans ?? 'clear'
  const next: Style = {
    ...existing,
    colors: [...existing.colors],
    values: { ...existing.values },
    customFields: { ...(existing.customFields ?? {}) },
  }
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
          (/^[0-9a-f-]{36}$/i.test(trimmed) ? trimmed : undefined)
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
  return next
}

export async function updateStyleFields(
  id: string,
  patch: Record<string, string>,
  options?: {
    seasonIdByCode?: Map<string, string>
    emptyMeans?: EmptyValuePolicy
  },
): Promise<Style> {
  const existing = await getStyleById(id)
  if (!existing) {
    throw new StyleStoreError('상품을 찾을 수 없습니다.', 'not_found')
  }

  const next = applyStyleFieldPatch(existing, patch, options)
  return updateStyle(id, {
    seasonId: next.seasonId,
    styleNo: next.styleNo,
    name: next.name,
    category: next.category,
    gender: next.gender,
    colors: next.colors,
    targetCost: next.targetCost,
    plannedQty: next.plannedQty,
    retailPrice: next.retailPrice,
    status: next.status,
    designer: next.designer,
    planner: next.planner,
    description: next.description,
    weightG: next.weightG,
    values: next.values,
    customFields: next.customFields,
  })
}

/** 대량 반영에서 어느 파일 행이 실패했는지 되짚기 위한 참조 번호 */
export type BulkRef = { ref: number }
export type BulkFailure = BulkRef & { message: string }

/** 요청 하나에 담는 행 수. 늘리면 빠르지만 실패 시 재시도 범위가 커진다. */
const BULK_CHUNK = 200

function chunked<T>(items: T[], size = BULK_CHUNK): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size))
  }
  return out
}

/**
 * 여러 상품을 청크 단위로 한 번에 넣는다.
 * 청크가 실패하면 그 청크만 한 건씩 다시 넣어 문제 행을 골라낸다.
 */
export async function insertStylesBulk(
  brandId: string,
  items: (BulkRef & { input: StyleInput })[],
): Promise<{ created: number; failures: BulkFailure[] }> {
  const supabase = getSupabase()
  let created = 0
  const failures: BulkFailure[] = []

  for (const chunk of chunked(items)) {
    const valid: typeof chunk = []
    for (const item of chunk) {
      if (!item.input.styleNo.trim() || !item.input.name.trim()) {
        failures.push({ ref: item.ref, message: '품번과 상품명을 입력하세요.' })
      } else if (!item.input.seasonId) {
        failures.push({ ref: item.ref, message: '시즌을 선택하세요.' })
      } else {
        valid.push(item)
      }
    }
    if (valid.length === 0) continue

    const { error } = await supabase
      .from('styles')
      .insert(valid.map((item) => toInsertRow(brandId, item.input)))

    if (!error) {
      created += valid.length
      continue
    }

    for (const item of valid) {
      try {
        await createStyle(brandId, item.input)
        created += 1
      } catch (rowError) {
        failures.push({
          ref: item.ref,
          message:
            rowError instanceof Error
              ? rowError.message
              : '상품을 만들지 못했습니다.',
        })
      }
    }
  }

  return { created, failures }
}

/** 메모리에서 병합해 둔 상품을 청크 단위로 저장한다. */
export async function saveStylesBulk(
  items: (BulkRef & { style: Style })[],
): Promise<{ updated: number; failures: BulkFailure[] }> {
  const supabase = getSupabase()
  let updated = 0
  const failures: BulkFailure[] = []

  for (const chunk of chunked(items)) {
    const { error } = await supabase.from('styles').upsert(
      chunk.map((item) => ({ id: item.style.id, ...toRowPatch(item.style) })),
      { onConflict: 'id' },
    )

    if (!error) {
      updated += chunk.length
      continue
    }

    for (const item of chunk) {
      const { error: rowError } = await supabase
        .from('styles')
        .update(toRowPatch(item.style))
        .eq('id', item.style.id)
      if (rowError) {
        failures.push({
          ref: item.ref,
          message: isUniqueViolation(rowError)
            ? '이미 같은 품번이 있습니다.'
            : errorMessage(rowError, '상품을 저장하지 못했습니다.'),
        })
      } else {
        updated += 1
      }
    }
  }

  return { updated, failures }
}

/** 여러 상품을 청크 단위로 지운다. */
export async function deleteStylesBulk(
  items: (BulkRef & { id: string })[],
): Promise<{ deleted: number; failures: BulkFailure[] }> {
  const supabase = getSupabase()
  let deleted = 0
  const failures: BulkFailure[] = []

  for (const chunk of chunked(items)) {
    const { error } = await supabase
      .from('styles')
      .delete()
      .in(
        'id',
        chunk.map((item) => item.id),
      )

    if (!error) {
      deleted += chunk.length
      continue
    }

    for (const item of chunk) {
      const { error: rowError } = await supabase
        .from('styles')
        .delete()
        .eq('id', item.id)
      if (rowError) {
        failures.push({
          ref: item.ref,
          message: errorMessage(rowError, '상품을 삭제하지 못했습니다.'),
        })
      } else {
        deleted += 1
      }
    }
  }

  return { deleted, failures }
}

export async function deleteStyle(id: string): Promise<void> {
  const existing = await getStyleById(id)
  if (!existing) {
    throw new StyleStoreError('상품을 찾을 수 없습니다.', 'not_found')
  }
  const { error } = await getSupabase().from('styles').delete().eq('id', id)
  if (error) {
    throw new StyleStoreError(
      errorMessage(error, '상품을 삭제하지 못했습니다.'),
      'invalid',
    )
  }
}
