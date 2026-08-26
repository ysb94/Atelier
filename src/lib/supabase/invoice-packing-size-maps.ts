import type {
  InvoicePackingSizeMap,
  InvoicePackingSizeSourceValue,
} from '@/lib/types'
import {
  normalizePackingSizeValue,
  type InvoicePackingSizeMapInput,
} from '@/lib/invoice/packing-size-map'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const MAP_COLUMNS =
  'id, brand_id, field_id, source_value, normalized_source_value, display_value, created_at, updated_at'
const PAGE_SIZE = 1000

type PackingSizeMapRow = {
  id: string
  brand_id: string
  field_id: string
  source_value: string
  normalized_source_value: string
  display_value: string
  created_at: string
  updated_at: string
}

type PackingSizeSourceRow = {
  field_id: string
  source_value: string
  normalized_source_value: string
  style_count: number
}

export class InvoicePackingSizeMapStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoicePackingSizeMapStoreError'
  }
}

function toMap(row: PackingSizeMapRow): InvoicePackingSizeMap {
  return {
    id: row.id,
    brandId: row.brand_id,
    fieldId: row.field_id,
    sourceValue: row.source_value,
    normalizedSourceValue: row.normalized_source_value,
    displayValue: row.display_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toSourceValue(
  row: PackingSizeSourceRow,
): InvoicePackingSizeSourceValue {
  return {
    fieldId: row.field_id,
    sourceValue: row.source_value,
    normalizedSourceValue: row.normalized_source_value,
    styleCount: Number(row.style_count) || 0,
  }
}

export async function listInvoicePackingSizeMaps(
  brandId: string,
  fieldId: string,
): Promise<InvoicePackingSizeMap[]> {
  const supabase = getSupabase()
  const all: InvoicePackingSizeMap[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('invoice_packing_size_maps')
      .select(MAP_COLUMNS)
      .eq('brand_id', brandId)
      .eq('field_id', fieldId)
      .order('source_value', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      throw new InvoicePackingSizeMapStoreError(
        errorMessage(error, '포장 규격 매핑을 불러오지 못했습니다.'),
      )
    }
    const rows = (data as PackingSizeMapRow[]) ?? []
    all.push(...rows.map(toMap))
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

export async function listInvoicePackingSizeSourceValues(
  brandId: string,
  fieldId: string,
): Promise<InvoicePackingSizeSourceValue[]> {
  const supabase = getSupabase()
  const all: InvoicePackingSizeSourceValue[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc('list_invoice_packing_size_source_values', {
        p_brand_id: brandId,
        p_field_id: fieldId,
      })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      throw new InvoicePackingSizeMapStoreError(
        errorMessage(error, '포장 규격 고유값을 불러오지 못했습니다.'),
      )
    }
    const rows = (data as PackingSizeSourceRow[]) ?? []
    all.push(...rows.map(toSourceValue))
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

function prepareMappings(
  mappings: InvoicePackingSizeMapInput[],
): InvoicePackingSizeMapInput[] {
  const prepared: InvoicePackingSizeMapInput[] = []
  const seen = new Set<string>()
  for (const mapping of mappings) {
    const sourceValue = mapping.sourceValue.trim()
    const normalized = normalizePackingSizeValue(sourceValue)
    if (!normalized) {
      throw new InvoicePackingSizeMapStoreError(
        '원본 포장 규격을 확인해주세요.',
      )
    }
    if (seen.has(normalized)) {
      throw new InvoicePackingSizeMapStoreError(
        `같은 원본 포장 규격이 중복됐습니다: ${sourceValue}`,
      )
    }
    seen.add(normalized)
    prepared.push({
      sourceValue,
      displayValue: mapping.displayValue.trim(),
    })
  }
  return prepared
}

export async function saveInvoicePackingSizeMaps(
  brandId: string,
  fieldId: string,
  mappings: InvoicePackingSizeMapInput[],
): Promise<InvoicePackingSizeMap[]> {
  const prepared = prepareMappings(mappings)
  if (prepared.length > 0) {
    const { error } = await getSupabase().rpc(
      'save_invoice_packing_size_maps',
      {
        p_brand_id: brandId,
        p_field_id: fieldId,
        p_mappings: prepared.map((mapping) => ({
          source_value: mapping.sourceValue,
          display_value: mapping.displayValue,
        })),
      },
    )
    if (error) {
      throw new InvoicePackingSizeMapStoreError(
        isUniqueViolation(error)
          ? '같은 원본 포장 규격의 매핑이 이미 있습니다.'
          : errorMessage(error, '포장 규격 매핑을 저장하지 못했습니다.'),
      )
    }
  }
  return listInvoicePackingSizeMaps(brandId, fieldId)
}

export type { InvoicePackingSizeMapInput }
