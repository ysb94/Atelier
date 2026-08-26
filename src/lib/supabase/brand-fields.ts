import type {
  BrandField,
  BrandFieldInput,
  BrandFieldOption,
  BrandFieldOptionInput,
  FieldOwner,
} from '@/lib/types'
import { IMPORT_FIELDS } from '@/lib/import/fields'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'
import {
  canConvertFieldToSelect,
  prepareSelectOptionSave,
  withRenameAlias,
} from '@/lib/products/brand-field-select'

const COLUMNS =
  'id, brand_id, label, system_key, type, owner, required, sort_order, level'
const OPTION_COLUMNS =
  'id, brand_id, field_id, label, aliases, sort_order, is_active'
const PAGE_SIZE = 1000

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

type BrandFieldOptionRow = {
  id: string
  brand_id: string
  field_id: string
  label: string
  aliases: string[] | null
  sort_order: number
  is_active: boolean
}

export class BrandFieldStoreError extends Error {
  readonly code: 'not_found' | 'invalid' | 'locked'

  constructor(message: string, code: 'not_found' | 'invalid' | 'locked') {
    super(message)
    this.name = 'BrandFieldStoreError'
    this.code = code
  }
}

function toOption(row: BrandFieldOptionRow): BrandFieldOption {
  return {
    id: row.id,
    brandId: row.brand_id,
    fieldId: row.field_id,
    label: row.label,
    aliases: row.aliases ?? [],
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function toField(
  row: BrandFieldRow,
  options: BrandFieldOption[] = [],
): BrandField {
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
    options,
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

async function listBrandFieldOptions(
  brandId: string,
): Promise<BrandFieldOption[]> {
  const supabase = getSupabase()
  const all: BrandFieldOption[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('brand_field_options')
      .select(OPTION_COLUMNS)
      .eq('brand_id', brandId)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      throw new BrandFieldStoreError(
        errorMessage(error, '선택지를 불러오지 못했습니다.'),
        'invalid',
      )
    }
    const rows = (data as BrandFieldOptionRow[]) ?? []
    all.push(...rows.map(toOption))
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

function attachOptions(
  fields: BrandField[],
  options: BrandFieldOption[],
): BrandField[] {
  const byField = new Map<string, BrandFieldOption[]>()
  for (const option of options) {
    const list = byField.get(option.fieldId) ?? []
    list.push(option)
    byField.set(option.fieldId, list)
  }
  return fields.map((field) => ({
    ...field,
    options: byField.get(field.id) ?? [],
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
  const options = await listBrandFieldOptions(brandId)
  return attachOptions(
    rows.map((row) => toField(row)).sort((a, b) => a.order - b.order),
    options,
  )
}

async function reloadField(id: string): Promise<BrandField> {
  const { data, error } = await getSupabase()
    .from('brand_fields')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    throw new BrandFieldStoreError(
      errorMessage(error, '항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!data) {
    throw new BrandFieldStoreError('항목을 찾을 수 없습니다.', 'not_found')
  }
  const row = data as BrandFieldRow
  const options = (await listBrandFieldOptions(row.brand_id)).filter(
    (option) => option.fieldId === id,
  )
  return toField(row, options)
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
    existing.some(
      (field) =>
        field.label.toLocaleLowerCase('ko') === label.toLocaleLowerCase('ko'),
    )
  ) {
    throw new BrandFieldStoreError('이미 같은 이름의 항목이 있습니다.', 'invalid')
  }

  const maxOrder = existing.reduce((max, field) => Math.max(max, field.order), -1)
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

  return toField(data as BrandFieldRow, [])
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
  const current = toField(row)

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

  let nextType = patch.type ?? row.type
  if (patch.type !== undefined && patch.type !== row.type) {
    if (isStyleNo || !canConvertFieldToSelect(current)) {
      throw new BrandFieldStoreError(
        '이 항목의 유형은 바꿀 수 없습니다.',
        'locked',
      )
    }
    if (row.system_key && patch.type !== 'text' && patch.type !== 'select') {
      throw new BrandFieldStoreError(
        '이 항목은 텍스트 또는 단일 선택만 사용할 수 있습니다.',
        'invalid',
      )
    }
    nextType = patch.type
  }

  const { data, error } = await getSupabase()
    .from('brand_fields')
    .update(
      isStyleNo
        ? { label }
        : {
            label,
            required: patch.required ?? row.required,
            type: nextType,
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

  return reloadField((data as BrandFieldRow).id)
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

export async function saveBrandFieldOptions(
  brandId: string,
  fieldId: string,
  options: BrandFieldOptionInput[],
): Promise<BrandField> {
  const field = await reloadField(fieldId)
  if (field.brandId !== brandId) {
    throw new BrandFieldStoreError('항목을 찾을 수 없습니다.', 'not_found')
  }
  if (field.type !== 'select') {
    throw new BrandFieldStoreError(
      '선택형 항목만 선택지를 저장할 수 있습니다.',
      'invalid',
    )
  }

  const originalById = new Map(field.options.map((option) => [option.id, option]))
  const withAliases = options.map((option) =>
    withRenameAlias(
      option.id ? originalById.get(option.id) : undefined,
      option,
    ),
  )
  const prepared = prepareSelectOptionSave(withAliases)
  if (!prepared.ok) {
    throw new BrandFieldStoreError(prepared.message, 'invalid')
  }

  const { error } = await getSupabase().rpc('save_brand_field_options', {
    p_brand_id: brandId,
    p_field_id: fieldId,
    p_options: prepared.options.map((option) => ({
      id: option.id ?? null,
      label: option.label,
      aliases: option.aliases ?? [],
      sort_order: option.sortOrder,
      is_active: option.isActive,
    })),
  })
  if (error) {
    throw new BrandFieldStoreError(
      isUniqueViolation(error)
        ? '같은 이름의 선택지가 있습니다.'
        : errorMessage(error, '선택지를 저장하지 못했습니다.'),
      'invalid',
    )
  }

  return reloadField(fieldId)
}
