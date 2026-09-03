import type {
  InvoiceOptionComponentRole,
  InvoiceOptionMap,
  InvoiceOptionMapComponent,
} from '@/lib/types'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isMissingRpc, isUniqueViolation } from '@/lib/supabase/map-error'
import type { OptionMapLookupCombo } from '@/lib/invoice/invoice-item-criteria-keys'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const MAP_COLUMNS =
  'id, brand_id, mall_name, normalized_mall_name, product_name, normalized_product_name, item_name, normalized_item_name, own_product_code, normalized_own_product_code, display_item_name, is_active, note, created_at, updated_at'
const COMPONENT_EMBED =
  'invoice_option_map_components(id, map_id, style_id, role, quantity, sort_order, styles!invoice_option_map_components_style_fkey(id, style_no, name))'
const MAP_SELECT = `${MAP_COLUMNS}, ${COMPONENT_EMBED}`
const PAGE_SIZE = 1000
const LOOKUP_CHUNK = 400

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type ComponentRow = {
  id: string
  map_id: string
  style_id: string
  role: string
  quantity: number
  sort_order: number
  styles?: StyleEmbed | StyleEmbed[] | null
}

type MapRow = {
  id: string
  brand_id: string
  mall_name: string
  normalized_mall_name: string
  product_name: string
  normalized_product_name: string
  item_name: string
  normalized_item_name: string
  own_product_code: string
  normalized_own_product_code: string
  display_item_name: string
  is_active: boolean
  note: string
  created_at: string
  updated_at: string
  invoice_option_map_components?: ComponentRow[] | null
}

export class InvoiceOptionMapStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceOptionMapStoreError'
  }
}

function styleFromEmbed(
  embed: StyleEmbed | StyleEmbed[] | null | undefined,
): StyleEmbed | null {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

function parseRole(value: string): InvoiceOptionComponentRole | null {
  if (
    value === 'main' ||
    value === 'included' ||
    value === 'required' ||
    value === 'paid_add'
  ) {
    return value
  }
  return null
}

function toComponent(row: ComponentRow): InvoiceOptionMapComponent | null {
  const role = parseRole(row.role)
  const style = styleFromEmbed(row.styles)
  if (!role || !style) return null
  return {
    id: row.id,
    mapId: row.map_id,
    style: {
      styleId: style.id,
      styleNo: style.style_no,
      name: style.name,
    },
    role,
    quantity: row.quantity,
    sortOrder: row.sort_order,
  }
}

function toMap(row: MapRow): InvoiceOptionMap {
  const components = [...(row.invoice_option_map_components ?? [])]
    .map(toComponent)
    .filter((item): item is InvoiceOptionMapComponent => Boolean(item))
    .sort((left, right) => left.sortOrder - right.sortOrder)
  return {
    id: row.id,
    brandId: row.brand_id,
    mallName: row.mall_name,
    normalizedMallName: row.normalized_mall_name,
    productName: row.product_name,
    normalizedProductName: row.normalized_product_name,
    itemName: row.item_name,
    normalizedItemName: row.normalized_item_name,
    ownProductCode: row.own_product_code,
    normalizedOwnProductCode: row.normalized_own_product_code,
    displayItemName: row.display_item_name ?? '',
    isActive: row.is_active,
    note: row.note,
    components,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type InvoiceOptionComponentInput = {
  styleId: string
  role: InvoiceOptionComponentRole
  quantity: number
}

export type InvoiceOptionMapInput = {
  mallName?: string
  productName: string
  itemName?: string
  ownProductCode?: string
  displayItemName?: string
  isActive?: boolean
  note?: string
  components: InvoiceOptionComponentInput[]
}

function validateInput(input: InvoiceOptionMapInput) {
  const productName = input.productName.trim()
  if (!productName) {
    throw new InvoiceOptionMapStoreError('원본 품목명을 입력하세요.')
  }
  const mains = input.components.filter((item) => item.role === 'main')
  if (mains.length !== 1) {
    throw new InvoiceOptionMapStoreError('본품 M번호는 하나만 고르세요.')
  }
  for (const item of input.components) {
    if (!item.styleId) {
      throw new InvoiceOptionMapStoreError('구성품 M번호를 고르세요.')
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new InvoiceOptionMapStoreError('구성 수량은 1 이상이어야 합니다.')
    }
  }
}

function payloadFromInput(brandId: string, input: InvoiceOptionMapInput) {
  const mallName = input.mallName?.trim() ?? ''
  const productName = input.productName.trim()
  const itemName = input.itemName?.trim() ?? ''
  const ownProductCode = input.ownProductCode?.trim() ?? ''
  return {
    brand_id: brandId,
    mall_name: mallName,
    normalized_mall_name: normalizeInvoiceText(mallName),
    product_name: productName,
    normalized_product_name: normalizeInvoiceText(productName),
    item_name: itemName,
    normalized_item_name: normalizeInvoiceText(itemName),
    own_product_code: ownProductCode,
    normalized_own_product_code: normalizeInvoiceText(ownProductCode),
    display_item_name: input.displayItemName?.trim() ?? '',
    is_active: input.isActive ?? true,
    note: input.note?.trim() ?? '',
  }
}

async function replaceComponents(
  brandId: string,
  mapId: string,
  components: InvoiceOptionComponentInput[],
) {
  const supabase = getSupabase()
  const { error: deleteError } = await supabase
    .from('invoice_option_map_components')
    .delete()
    .eq('map_id', mapId)
  if (deleteError) {
    throw new InvoiceOptionMapStoreError(
      errorMessage(deleteError, '구성품을 바꾸지 못했습니다.'),
    )
  }
  if (components.length === 0) return
  const { error: insertError } = await supabase
    .from('invoice_option_map_components')
    .insert(
      components.map((item, index) => ({
        brand_id: brandId,
        map_id: mapId,
        style_id: item.styleId,
        role: item.role,
        quantity: item.quantity,
        sort_order: index,
      })),
    )
  if (insertError) {
    throw new InvoiceOptionMapStoreError(
      errorMessage(insertError, '구성품을 저장하지 못했습니다.'),
    )
  }
}

async function fetchMap(id: string): Promise<InvoiceOptionMap> {
  const { data, error } = await getSupabase()
    .from('invoice_option_maps')
    .select(MAP_SELECT)
    .eq('id', id)
    .single()
  if (error || !data) {
    throw new InvoiceOptionMapStoreError(
      errorMessage(error, '변환 기준을 불러오지 못했습니다.'),
    )
  }
  return toMap(data as MapRow)
}

function chunked<T>(items: T[], size = LOOKUP_CHUNK): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size))
  }
  return out
}

async function listInvoiceOptionMapsByIds(
  ids: string[],
): Promise<InvoiceOptionMap[]> {
  if (ids.length === 0) return []
  const supabase = getSupabase()
  const byId = new Map<string, InvoiceOptionMap>()
  for (const chunk of chunked(ids, 200)) {
    const { data, error } = await supabase
      .from('invoice_option_maps')
      .select(MAP_SELECT)
      .in('id', chunk)
    if (error) {
      throw new InvoiceOptionMapStoreError(
        errorMessage(error, '품목·옵션 변환 기준을 불러오지 못했습니다.'),
      )
    }
    for (const row of (data as MapRow[]) ?? []) {
      byId.set(row.id, toMap(row))
    }
  }
  return [...byId.values()]
}

export async function listInvoiceOptionMapsForCombos(
  brandId: string,
  combos: OptionMapLookupCombo[],
): Promise<InvoiceOptionMap[]> {
  if (combos.length === 0) return []
  const supabase = getSupabase()
  const byId = new Map<string, InvoiceOptionMap>()
  try {
    for (const chunk of chunked(combos)) {
      const { data, error } = await supabase.rpc(
        'list_invoice_option_map_ids_for_combos',
        {
          p_brand_id: brandId,
          p_malls: chunk.map((combo) => combo.mallName),
          p_products: chunk.map((combo) => combo.productName),
          p_items: chunk.map((combo) => combo.itemName),
        },
      )
      if (error) {
        if (isMissingRpc(error)) {
          return listInvoiceOptionMaps(brandId, { activeOnly: true })
        }
        throw new InvoiceOptionMapStoreError(
          errorMessage(error, '품목·옵션 변환 기준을 불러오지 못했습니다.'),
        )
      }
      const ids = ((data as Array<{ id: string }> | null) ?? []).map(
        (row) => row.id,
      )
      for (const map of await listInvoiceOptionMapsByIds(ids)) {
        byId.set(map.id, map)
      }
    }
    return [...byId.values()]
  } catch (error) {
    if (isMissingRpc(error as { code?: string; message?: string })) {
      return listInvoiceOptionMaps(brandId, { activeOnly: true })
    }
    throw error
  }
}

export async function listInvoiceOptionMaps(
  brandId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceOptionMap[]> {
  const supabase = getSupabase()
  const rows = await fetchAllPages<MapRow>({
    pageSize: PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      let query = supabase
        .from('invoice_option_maps')
        .select(MAP_SELECT, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('updated_at', { ascending: false })
        .range(from, to)
      if (options.activeOnly) query = query.eq('is_active', true)
      const { data, error, count } = await query
      if (error) {
        throw new InvoiceOptionMapStoreError(
          errorMessage(error, '품목·옵션 변환 기준을 불러오지 못했습니다.'),
        )
      }
      return { rows: (data as MapRow[]) ?? [], count: count ?? null }
    },
  })
  return rows.map(toMap)
}

export async function saveInvoiceOptionMap(
  brandId: string,
  input: InvoiceOptionMapInput,
  mapId?: string,
): Promise<InvoiceOptionMap> {
  validateInput(input)
  const supabase = getSupabase()
  const payload = payloadFromInput(brandId, input)

  const existingQuery = supabase
    .from('invoice_option_maps')
    .select('id')
    .eq('brand_id', brandId)
    .eq('normalized_mall_name', payload.normalized_mall_name)
    .eq('normalized_product_name', payload.normalized_product_name)
    .eq('normalized_item_name', payload.normalized_item_name)
    .maybeSingle()
  const { data: existing, error: existingError } = await existingQuery
  if (existingError) {
    throw new InvoiceOptionMapStoreError(
      errorMessage(existingError, '변환 기준을 확인하지 못했습니다.'),
    )
  }

  const targetId = mapId || existing?.id || null
  const writer = targetId
    ? supabase.from('invoice_option_maps').update(payload).eq('id', targetId)
    : supabase.from('invoice_option_maps').insert(payload)

  const { data, error } = await writer.select('id').single()
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoiceOptionMapStoreError(
        '같은 쇼핑몰·품목명·내품명 조합이 이미 있습니다.',
      )
    }
    throw new InvoiceOptionMapStoreError(
      errorMessage(error, '변환 기준을 저장하지 못했습니다.'),
    )
  }

  const savedId = (data as { id: string }).id
  await replaceComponents(brandId, savedId, input.components)
  return fetchMap(savedId)
}

export async function setInvoiceOptionMapActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from('invoice_option_maps')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) {
    throw new InvoiceOptionMapStoreError(
      errorMessage(error, '변환 기준 상태를 바꾸지 못했습니다.'),
    )
  }
}

export async function deleteInvoiceOptionMap(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('invoice_option_maps')
    .delete()
    .eq('id', id)
  if (error) {
    throw new InvoiceOptionMapStoreError(
      errorMessage(error, '변환 기준을 삭제하지 못했습니다.'),
    )
  }
}

export async function applyBulkInvoiceOptionMaps(
  brandId: string,
  rows: InvoiceOptionMapInput[],
): Promise<{ saved: number; failures: { index: number; message: string }[] }> {
  let saved = 0
  const failures: { index: number; message: string }[] = []
  for (const [index, input] of rows.entries()) {
    try {
      await saveInvoiceOptionMap(brandId, input)
      saved += 1
    } catch (reason) {
      failures.push({
        index,
        message:
          reason instanceof Error
            ? reason.message
            : '변환 기준을 저장하지 못했습니다.',
      })
    }
  }
  return { saved, failures }
}
