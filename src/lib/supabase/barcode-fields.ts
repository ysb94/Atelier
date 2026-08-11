import type {
  BarcodeField,
  BarcodeFieldInput,
  BarcodeFieldSystemKey,
} from '@/lib/types'
import {
  BARCODE_SYSTEM_FIELDS,
  isLockedBarcodeField,
} from '@/lib/codes/barcode-fields'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS = 'id, brand_id, label, system_key, type, sort_order'

type BarcodeFieldRow = {
  id: string
  brand_id: string
  label: string
  system_key: BarcodeFieldSystemKey | null
  type: BarcodeField['type']
  sort_order: number
}

export class BarcodeFieldStoreError extends Error {
  readonly code: 'not_found' | 'invalid' | 'locked'

  constructor(message: string, code: 'not_found' | 'invalid' | 'locked') {
    super(message)
    this.name = 'BarcodeFieldStoreError'
    this.code = code
  }
}

function toField(row: BarcodeFieldRow): BarcodeField {
  return {
    id: row.id,
    brandId: row.brand_id,
    label: row.label,
    systemKey: row.system_key,
    type: row.type,
    order: row.sort_order,
  }
}

function systemFieldRows(brandId: string) {
  return BARCODE_SYSTEM_FIELDS.map((field, index) => ({
    brand_id: brandId,
    label: field.label,
    system_key: field.systemKey,
    type: field.type,
    sort_order: index,
  }))
}

async function readFields(brandId: string): Promise<BarcodeFieldRow[]> {
  const { data, error } = await getSupabase()
    .from('barcode_fields')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new BarcodeFieldStoreError(
      errorMessage(error, '바코드 항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return (data as BarcodeFieldRow[]) ?? []
}

/**
 * 새 브랜드는 처음 바코드 화면을 열 때만 기본 항목을 만든다.
 * 사용자가 삭제한 기본 항목은 다시 만들지 않는다.
 */
async function ensureSystemFields(brandId: string) {
  const existing = await readFields(brandId)
  if (existing.length > 0) return existing

  const { error } = await getSupabase()
    .from('barcode_fields')
    .upsert(systemFieldRows(brandId), {
      onConflict: 'brand_id,system_key',
      ignoreDuplicates: true,
    })
  if (error) {
    throw new BarcodeFieldStoreError(
      errorMessage(error, '기본 바코드 항목을 만들지 못했습니다.'),
      'invalid',
    )
  }
  return readFields(brandId)
}

export async function listBarcodeFields(brandId: string) {
  const rows = await ensureSystemFields(brandId)
  return rows.map(toField).sort((a, b) => a.order - b.order)
}

export async function createBarcodeField(
  brandId: string,
  input: BarcodeFieldInput,
): Promise<BarcodeField> {
  const fields = await listBarcodeFields(brandId)
  const label = input.label.trim()
  if (!label) {
    throw new BarcodeFieldStoreError('항목 이름을 입력하세요.', 'invalid')
  }
  if (
    fields.some(
      (field) =>
        field.label.toLocaleLowerCase('ko') === label.toLocaleLowerCase('ko'),
    )
  ) {
    throw new BarcodeFieldStoreError('이미 같은 이름의 항목이 있습니다.', 'invalid')
  }

  const order = fields.reduce((max, field) => Math.max(max, field.order), -1) + 1
  const { data, error } = await getSupabase()
    .from('barcode_fields')
    .insert({
      brand_id: brandId,
      label,
      system_key: null,
      type: input.type,
      sort_order: order,
    })
    .select(COLUMNS)
    .single()

  if (error) {
    throw new BarcodeFieldStoreError(
      isUniqueViolation(error)
        ? '이미 같은 이름의 항목이 있습니다.'
        : errorMessage(error, '바코드 항목을 만들지 못했습니다.'),
      'invalid',
    )
  }
  return toField(data as BarcodeFieldRow)
}

export async function updateBarcodeField(
  id: string,
  patch: BarcodeFieldInput,
): Promise<BarcodeField> {
  const { data: existing, error: readError } = await getSupabase()
    .from('barcode_fields')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    throw new BarcodeFieldStoreError(
      errorMessage(readError, '바코드 항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!existing) {
    throw new BarcodeFieldStoreError('바코드 항목을 찾을 수 없습니다.', 'not_found')
  }

  const field = toField(existing as BarcodeFieldRow)
  const label = patch.label.trim()
  if (!label) {
    throw new BarcodeFieldStoreError('항목 이름을 입력하세요.', 'invalid')
  }

  const siblings = await listBarcodeFields(field.brandId)
  if (
    siblings.some(
      (sibling) =>
        sibling.id !== id &&
        sibling.label.toLocaleLowerCase('ko') === label.toLocaleLowerCase('ko'),
    )
  ) {
    throw new BarcodeFieldStoreError('이미 같은 이름의 항목이 있습니다.', 'invalid')
  }

  const { data, error } = await getSupabase()
    .from('barcode_fields')
    .update({
      label,
      type: field.systemKey ? field.type : patch.type,
    })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) {
    throw new BarcodeFieldStoreError(
      errorMessage(error, '바코드 항목을 저장하지 못했습니다.'),
      'invalid',
    )
  }
  return toField(data as BarcodeFieldRow)
}

export async function deleteBarcodeField(id: string): Promise<void> {
  const { data, error: readError } = await getSupabase()
    .from('barcode_fields')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (readError) {
    throw new BarcodeFieldStoreError(
      errorMessage(readError, '바코드 항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!data) {
    throw new BarcodeFieldStoreError('바코드 항목을 찾을 수 없습니다.', 'not_found')
  }
  if (isLockedBarcodeField(toField(data as BarcodeFieldRow))) {
    throw new BarcodeFieldStoreError(
      '88코드와 바코드 상품명은 삭제할 수 없습니다.',
      'locked',
    )
  }

  const { error } = await getSupabase()
    .from('barcode_fields')
    .delete()
    .eq('id', id)
  if (error) {
    throw new BarcodeFieldStoreError(
      errorMessage(error, '바코드 항목을 삭제하지 못했습니다.'),
      'invalid',
    )
  }
}

export async function moveBarcodeField(
  id: string,
  direction: 'up' | 'down',
): Promise<void> {
  const { data, error } = await getSupabase()
    .from('barcode_fields')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    throw new BarcodeFieldStoreError(
      errorMessage(error, '바코드 항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!data) {
    throw new BarcodeFieldStoreError('바코드 항목을 찾을 수 없습니다.', 'not_found')
  }

  const current = toField(data as BarcodeFieldRow)
  const fields = await listBarcodeFields(current.brandId)
  const index = fields.findIndex((field) => field.id === id)
  const target = fields[index + (direction === 'up' ? -1 : 1)]
  if (!target) return

  const supabase = getSupabase()
  const [currentResult, targetResult] = await Promise.all([
    supabase
      .from('barcode_fields')
      .update({ sort_order: target.order })
      .eq('id', current.id),
    supabase
      .from('barcode_fields')
      .update({ sort_order: current.order })
      .eq('id', target.id),
  ])
  const moveError = currentResult.error ?? targetResult.error
  if (moveError) {
    throw new BarcodeFieldStoreError(
      errorMessage(moveError, '바코드 항목 순서를 바꾸지 못했습니다.'),
      'invalid',
    )
  }
}
