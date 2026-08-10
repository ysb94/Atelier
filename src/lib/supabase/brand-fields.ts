import type { BrandField, BrandFieldInput, FieldOwner } from '@/lib/types'
import { IMPORT_FIELDS } from '@/lib/import/fields'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, label, system_key, type, owner, required, sort_order, level'

type BrandFieldRow = {
  id: string
  brand_id: string
  label: string
  system_key: string | null
  type: BrandField['type']
  owner: FieldOwner
  required: boolean
  sort_order: number
  level: BrandField['level']
}

export class BrandFieldStoreError extends Error {
  readonly code: 'not_found' | 'invalid' | 'locked'

  constructor(message: string, code: 'not_found' | 'invalid' | 'locked') {
    super(message)
    this.name = 'BrandFieldStoreError'
    this.code = code
  }
}

function toField(row: BrandFieldRow): BrandField {
  return {
    id: row.id,
    brandId: row.brand_id,
    label: row.label,
    systemKey: row.system_key,
    type: row.type,
    owner: row.owner,
    required: row.required,
    order: row.sort_order,
    level: row.level ?? 'style',
  }
}

function systemFieldRows(brandId: string) {
  return IMPORT_FIELDS.map((field, index) => ({
    brand_id: brandId,
    label: field.label,
    system_key: field.key,
    type: field.type,
    owner: field.owner,
    required: Boolean(field.requiredForNew),
    sort_order: index,
    level: 'style' as const,
  }))
}

/**
 * 브랜드에 항목이 없으면 시스템 항목만 깐다.
 * 이미 있으면 사용자가 지운 기본 항목을 다시 넣지 않는다.
 */
async function ensureSystemFields(brandId: string): Promise<BrandFieldRow[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('brand_fields')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new BrandFieldStoreError(
      errorMessage(error, '브랜드 항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }

  const existing = (data as BrandFieldRow[]) ?? []
  if (existing.length > 0) return existing

  const { data: seeded, error: seedError } = await supabase
    .from('brand_fields')
    .insert(systemFieldRows(brandId))
    .select(COLUMNS)
  if (seedError) {
    throw new BrandFieldStoreError(
      errorMessage(seedError, '기본 항목을 만들지 못했습니다.'),
      'invalid',
    )
  }
  return (seeded as BrandFieldRow[]) ?? []
}

export async function listBrandFields(brandId: string): Promise<BrandField[]> {
  const rows = await ensureSystemFields(brandId)
  return rows.map(toField).sort((a, b) => a.order - b.order)
}

export async function createBrandField(
  brandId: string,
  input: BrandFieldInput,
): Promise<BrandField> {
  const existing = await listBrandFields(brandId)
  const label = input.label.trim()
  if (!label) {
    throw new BrandFieldStoreError('항목 이름을 입력하세요.', 'invalid')
  }
  if (
    existing.some((field) => field.label.toLocaleLowerCase('ko') === label.toLocaleLowerCase('ko'))
  ) {
    throw new BrandFieldStoreError('이미 같은 이름의 항목이 있습니다.', 'invalid')
  }

  const maxOrder = existing.reduce((max, f) => Math.max(max, f.order), -1)
  const { data, error } = await getSupabase()
    .from('brand_fields')
    .insert({
      brand_id: brandId,
      label,
      system_key: null,
      type: input.type,
      owner: input.owner,
      required: Boolean(input.required),
      sort_order: maxOrder + 1,
      level: input.level ?? 'style',
    })
    .select(COLUMNS)
    .single()

  if (error) {
    throw new BrandFieldStoreError(
      isUniqueViolation(error)
        ? '이미 같은 이름의 항목이 있습니다.'
        : errorMessage(error, '항목을 만들지 못했습니다.'),
      'invalid',
    )
  }

  return toField(data as BrandFieldRow)
}

export async function updateBrandField(
  id: string,
  patch: Partial<Pick<BrandField, 'label' | 'required' | 'type' | 'owner'>>,
): Promise<BrandField> {
  const { data: existing, error: readError } = await getSupabase()
    .from('brand_fields')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    throw new BrandFieldStoreError(
      errorMessage(readError, '항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!existing) {
    throw new BrandFieldStoreError('항목을 찾을 수 없습니다.', 'not_found')
  }

  const row = existing as BrandFieldRow
  const isStyleNo = row.system_key === 'styleNo'

  let label = row.label
  if (patch.label !== undefined) {
    label = patch.label.trim()
    if (!label) {
      throw new BrandFieldStoreError('항목 이름을 입력하세요.', 'invalid')
    }
    const siblings = await listBrandFields(row.brand_id)
    if (
      siblings.some(
        (field) =>
          field.id !== id &&
          field.label.toLocaleLowerCase('ko') === label.toLocaleLowerCase('ko'),
      )
    ) {
      throw new BrandFieldStoreError(
        '이미 같은 이름의 항목이 있습니다.',
        'invalid',
      )
    }
  }

  // styleNo는 표시 이름만 바꿀 수 있다. 유형·부서·필수는 고정.
  const { data, error } = await getSupabase()
    .from('brand_fields')
    .update(
      isStyleNo
        ? { label }
        : {
            label,
            required: patch.required ?? row.required,
            type: patch.type ?? row.type,
            owner: patch.owner ?? row.owner,
          },
    )
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) {
    throw new BrandFieldStoreError(
      errorMessage(error, '항목을 저장하지 못했습니다.'),
      'invalid',
    )
  }

  return toField(data as BrandFieldRow)
}

export async function deleteBrandField(id: string): Promise<void> {
  const { data: existing, error: readError } = await getSupabase()
    .from('brand_fields')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    throw new BrandFieldStoreError(
      errorMessage(readError, '항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!existing) {
    throw new BrandFieldStoreError('항목을 찾을 수 없습니다.', 'not_found')
  }
  if ((existing as BrandFieldRow).system_key === 'styleNo') {
    throw new BrandFieldStoreError('품번 항목은 삭제할 수 없습니다.', 'locked')
  }

  const { error } = await getSupabase()
    .from('brand_fields')
    .delete()
    .eq('id', id)
  if (error) {
    throw new BrandFieldStoreError(
      errorMessage(error, '항목을 삭제하지 못했습니다.'),
      'invalid',
    )
  }
}
