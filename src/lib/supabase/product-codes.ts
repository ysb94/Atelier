import type {
  ProductCode,
  ProductCodeComponent,
  ProductCodeInput,
  ProductCodeKind,
} from '@/lib/types'
import { describeEan13Problem } from '@/lib/codes/ean'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const CODE_COLUMNS =
  'id, brand_id, kind, usage_target_id, code, name, weight_g, width_cm, depth_cm, height_cm, note, values, created_at, updated_at'

/** PostgREST 응답 상한에 걸리지 않도록 코드 목록을 나눠 읽는다. */
const CODE_PAGE_SIZE = 1000
/** UUID IN 필터가 URL 길이 제한을 넘지 않도록 구성품 조회를 더 작게 나눈다. */
const COMPONENT_QUERY_SIZE = 100

type CodeRow = {
  id: string
  brand_id: string
  kind: ProductCodeKind
  usage_target_id: string | null
  code: string
  name: string
  weight_g: number | null
  width_cm: number | string | null
  depth_cm: number | string | null
  height_cm: number | string | null
  note: string
  values: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type ComponentRow = {
  product_code_id: string
  style_id: string
  style_no: string
  qty: number
  sort_order: number
}

export class ProductCodeStoreError extends Error {
  readonly code: 'duplicate' | 'not_found' | 'invalid'

  constructor(message: string, code: 'duplicate' | 'not_found' | 'invalid') {
    super(message)
    this.name = 'ProductCodeStoreError'
    this.code = code
  }
}

function normalizePositiveInteger(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return rounded > 0 ? rounded : null
}

/** 규격(cm). 0보다 크고 소수 첫째 자리까지만 허용한다. */
function normalizePositiveCm(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  if (value <= 0) {
    throw new ProductCodeStoreError(
      '규격은 0보다 큰 수여야 합니다.',
      'invalid',
    )
  }
  const tenths = Math.round(value * 10)
  if (Math.abs(value * 10 - tenths) > 1e-8) {
    throw new ProductCodeStoreError(
      '규격은 소수 첫째 자리까지 입력하세요.',
      'invalid',
    )
  }
  return tenths / 10
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

function normalizeValues(
  values: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    const id = key.trim()
    if (!id || typeof value !== 'string') continue
    const text = value.trim()
    if (text) normalized[id] = text
  }
  return normalized
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

  if (input.kind === 'partner' && !input.usageTargetId?.trim()) {
    throw new ProductCodeStoreError(
      '거래처 코드는 업체가 필요합니다.',
      'invalid',
    )
  }

  const components = normalizeComponents(input.components)
  const values = normalizeValues(input.values)

  return { code, name, components, values }
}

function toCode(row: CodeRow, components: ProductCodeComponent[]): ProductCode {
  return {
    id: row.id,
    brandId: row.brand_id,
    kind: row.kind,
    usageTargetId: row.usage_target_id,
    code: row.code,
    name: row.name,
    weightG: row.weight_g,
    widthCm: toNullableNumber(row.width_cm),
    depthCm: toNullableNumber(row.depth_cm),
    heightCm: toNullableNumber(row.height_cm),
    note: row.note ?? '',
    values: Object.fromEntries(
      Object.entries(row.values ?? {}).flatMap(([key, value]) =>
        typeof value === 'string' ? [[key, value]] : [],
      ),
    ),
    components,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function loadComponents(codeIds: string[]) {
  const map = new Map<string, ProductCodeComponent[]>()
  if (codeIds.length === 0) return map

  for (let start = 0; start < codeIds.length; start += COMPONENT_QUERY_SIZE) {
    const chunk = codeIds.slice(start, start + COMPONENT_QUERY_SIZE)
    const { data, error } = await getSupabase()
      .from('product_code_components')
      .select('product_code_id, style_id, style_no, qty, sort_order')
      .in('product_code_id', chunk)
      .order('sort_order', { ascending: true })

    if (error) {
      throw new ProductCodeStoreError(
        errorMessage(error, '코드 구성품을 불러오지 못했습니다.'),
        'invalid',
      )
    }

    for (const row of (data as ComponentRow[]) ?? []) {
      const list = map.get(row.product_code_id) ?? []
      list.push({
        styleId: row.style_id,
        styleNo: row.style_no,
        qty: row.qty,
      })
      map.set(row.product_code_id, list)
    }
  }
  return map
}

async function saveViaRpc(
  brandId: string,
  id: string | null,
  input: ProductCodeInput,
): Promise<string> {
  const { code, name, components, values } = validate(input)
  const { data, error } = await getSupabase().rpc(
    'save_product_code_with_components',
    {
      p_brand_id: brandId,
      p_id: id,
      p_kind: input.kind,
      p_code: code,
      p_name: name,
      p_weight_g: normalizePositiveInteger(input.weightG),
      p_width_cm: normalizePositiveCm(input.widthCm),
      p_depth_cm: normalizePositiveCm(input.depthCm),
      p_height_cm: normalizePositiveCm(input.heightCm),
      p_note: input.note.trim(),
      p_values: values,
      p_components: components,
      p_usage_target_id:
        input.kind === 'partner' ? input.usageTargetId?.trim() ?? null : null,
    },
  )

  if (error) {
    throw new ProductCodeStoreError(
      isUniqueViolation(error)
        ? '이미 등록된 코드입니다.'
        : errorMessage(error, '코드를 저장하지 못했습니다.'),
      isUniqueViolation(error) ? 'duplicate' : 'invalid',
    )
  }

  return data as string
}

export async function listProductCodes(
  brandId: string,
  kind?: ProductCodeKind,
  usageTargetId?: string,
): Promise<ProductCode[]> {
  const rows: CodeRow[] = []

  for (let page = 0; ; page += 1) {
    let query = getSupabase()
      .from('product_codes')
      .select(CODE_COLUMNS)
      .eq('brand_id', brandId)
    if (kind) query = query.eq('kind', kind)
    if (usageTargetId) query = query.eq('usage_target_id', usageTargetId)

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(
        page * CODE_PAGE_SIZE,
        (page + 1) * CODE_PAGE_SIZE - 1,
      )

    if (error) {
      throw new ProductCodeStoreError(
        errorMessage(error, '코드를 불러오지 못했습니다.'),
        'invalid',
      )
    }

    const batch = (data as CodeRow[]) ?? []
    rows.push(...batch)
    if (batch.length < CODE_PAGE_SIZE) break
  }

  const components = await loadComponents(rows.map((row) => row.id))
  return rows
    .map((row) => toCode(row, components.get(row.id) ?? []))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getProductCode(
  id: string,
): Promise<ProductCode | undefined> {
  const { data, error } = await getSupabase()
    .from('product_codes')
    .select(CODE_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    throw new ProductCodeStoreError(
      errorMessage(error, '코드를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!data) return undefined
  const row = data as CodeRow
  const components = await loadComponents([row.id])
  return toCode(row, components.get(row.id) ?? [])
}

export async function createProductCode(
  brandId: string,
  input: ProductCodeInput,
): Promise<ProductCode> {
  const id = await saveViaRpc(brandId, null, input)
  const created = await getProductCode(id)
  if (!created) {
    throw new ProductCodeStoreError('코드를 저장하지 못했습니다.', 'invalid')
  }
  return created
}

export async function updateProductCode(
  id: string,
  input: ProductCodeInput,
): Promise<ProductCode> {
  const existing = await getProductCode(id)
  if (!existing) {
    throw new ProductCodeStoreError('코드를 찾을 수 없습니다.', 'not_found')
  }
  await saveViaRpc(existing.brandId, id, input)
  const updated = await getProductCode(id)
  if (!updated) {
    throw new ProductCodeStoreError('코드를 저장하지 못했습니다.', 'invalid')
  }
  return updated
}

export async function replacePartnerCodes(
  brandId: string,
  usageTargetId: string,
  codes: Array<{
    id?: string
    code: string
    name: string
    values: Record<string, string>
    components: ProductCodeComponent[]
  }>,
): Promise<void> {
  const { error } = await getSupabase().rpc('replace_partner_codes', {
    p_brand_id: brandId,
    p_usage_target_id: usageTargetId,
    p_codes: codes.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      values: normalizeValues(row.values),
      components: normalizeComponents(row.components),
    })),
  })
  if (error) {
    throw new ProductCodeStoreError(
      isUniqueViolation(error)
        ? '이미 등록된 코드입니다.'
        : errorMessage(error, '거래처 코드를 저장하지 못했습니다.'),
      isUniqueViolation(error) ? 'duplicate' : 'invalid',
    )
  }
}

export async function deleteProductCode(id: string): Promise<void> {
  const existing = await getProductCode(id)
  if (!existing) {
    throw new ProductCodeStoreError('코드를 찾을 수 없습니다.', 'not_found')
  }
  const { error } = await getSupabase()
    .from('product_codes')
    .delete()
    .eq('id', id)
  if (error) {
    throw new ProductCodeStoreError(
      errorMessage(error, '코드를 삭제하지 못했습니다.'),
      'invalid',
    )
  }
}
