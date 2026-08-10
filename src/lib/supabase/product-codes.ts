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
  'id, brand_id, kind, code, name, weight_g, width_mm, depth_mm, height_mm, note, created_at, updated_at'

type CodeRow = {
  id: string
  brand_id: string
  kind: ProductCodeKind
  code: string
  name: string
  weight_g: number | null
  width_mm: number | null
  depth_mm: number | null
  height_mm: number | null
  note: string
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

function toCode(row: CodeRow, components: ProductCodeComponent[]): ProductCode {
  return {
    id: row.id,
    brandId: row.brand_id,
    kind: row.kind,
    code: row.code,
    name: row.name,
    weightG: row.weight_g,
    widthMm: row.width_mm,
    depthMm: row.depth_mm,
    heightMm: row.height_mm,
    note: row.note ?? '',
    components,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function loadComponents(codeIds: string[]) {
  const map = new Map<string, ProductCodeComponent[]>()
  if (codeIds.length === 0) return map

  const { data, error } = await getSupabase()
    .from('product_code_components')
    .select('product_code_id, style_id, style_no, qty, sort_order')
    .in('product_code_id', codeIds)
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
  return map
}

async function saveViaRpc(
  brandId: string,
  id: string | null,
  input: ProductCodeInput,
): Promise<string> {
  const { code, name, components } = validate(input)
  const { data, error } = await getSupabase().rpc(
    'save_product_code_with_components',
    {
      p_brand_id: brandId,
      p_id: id,
      p_kind: input.kind,
      p_code: code,
      p_name: name,
      p_weight_g: normalizePositive(input.weightG),
      p_width_mm: normalizePositive(input.widthMm),
      p_depth_mm: normalizePositive(input.depthMm),
      p_height_mm: normalizePositive(input.heightMm),
      p_note: input.note.trim(),
      p_components: components,
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
): Promise<ProductCode[]> {
  let query = getSupabase()
    .from('product_codes')
    .select(CODE_COLUMNS)
    .eq('brand_id', brandId)
  if (kind) query = query.eq('kind', kind)

  const { data, error } = await query
  if (error) {
    throw new ProductCodeStoreError(
      errorMessage(error, '코드를 불러오지 못했습니다.'),
      'invalid',
    )
  }

  const rows = (data as CodeRow[]) ?? []
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
