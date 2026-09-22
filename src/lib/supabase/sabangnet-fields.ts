import type {
  SabangnetField,
  SabangnetFieldInput,
  SabangnetFieldSystemKey,
} from '@/lib/types'
import {
  SABANGNET_SYSTEM_FIELDS,
  isLockedSabangnetField,
} from '@/lib/codes/sabangnet-fields'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS = 'id, brand_id, label, system_key, type, sort_order'

type SabangnetFieldRow = {
  id: string
  brand_id: string
  label: string
  system_key: SabangnetFieldSystemKey | null
  type: SabangnetField['type']
  sort_order: number
}

export class SabangnetFieldStoreError extends Error {
  readonly code: 'not_found' | 'invalid' | 'locked'

  constructor(message: string, code: 'not_found' | 'invalid' | 'locked') {
    super(message)
    this.name = 'SabangnetFieldStoreError'
    this.code = code
  }
}

function toField(row: SabangnetFieldRow): SabangnetField {
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
  return SABANGNET_SYSTEM_FIELDS.map((field, index) => ({
    brand_id: brandId,
    label: field.label,
    system_key: field.systemKey,
    type: field.type,
    sort_order: index,
  }))
}

async function readFields(brandId: string): Promise<SabangnetFieldRow[]> {
  const { data, error } = await getSupabase()
    .from('sabangnet_fields')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new SabangnetFieldStoreError(
      errorMessage(error, '사방넷 항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return (data as SabangnetFieldRow[]) ?? []
}

/**
 * 새 브랜드는 처음 사방넷 화면을 열 때만 기본 항목을 만든다.
 * 사용자가 삭제한 기본 항목은 다시 만들지 않는다.
 */
async function ensureSystemFields(brandId: string) {
  const existing = await readFields(brandId)
  if (existing.length > 0) return existing

  const { error } = await getSupabase()
    .from('sabangnet_fields')
    .upsert(systemFieldRows(brandId), {
      onConflict: 'brand_id,system_key',
      ignoreDuplicates: true,
    })
  if (error) {
    throw new SabangnetFieldStoreError(
      errorMessage(error, '기본 사방넷 항목을 만들지 못했습니다.'),
      'invalid',
    )
  }
  return readFields(brandId)
}

export async function listSabangnetFields(brandId: string) {
  const rows = await ensureSystemFields(brandId)
  return rows.map(toField).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ko'))
}

export async function createSabangnetField(
  brandId: string,
  input: SabangnetFieldInput,
): Promise<SabangnetField> {
  const fields = await listSabangnetFields(brandId)
  const label = input.label.trim()
  if (!label) {
    throw new SabangnetFieldStoreError('항목 이름을 입력하세요.', 'invalid')
  }
  if (
    fields.some(
      (field) =>
        field.label.toLocaleLowerCase('ko') === label.toLocaleLowerCase('ko'),
    )
  ) {
    throw new SabangnetFieldStoreError('이미 같은 이름의 항목이 있습니다.', 'invalid')
  }

  const order = fields.reduce((max, field) => Math.max(max, field.order), -1) + 1
  const { data, error } = await getSupabase()
    .from('sabangnet_fields')
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
    throw new SabangnetFieldStoreError(
      isUniqueViolation(error)
        ? '이미 같은 이름의 항목이 있습니다.'
        : errorMessage(error, '사방넷 항목을 만들지 못했습니다.'),
      'invalid',
    )
  }
  return toField(data as SabangnetFieldRow)
}

export async function updateSabangnetField(
  id: string,
  patch: SabangnetFieldInput,
): Promise<SabangnetField> {
  const { data: existing, error: readError } = await getSupabase()
    .from('sabangnet_fields')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    throw new SabangnetFieldStoreError(
      errorMessage(readError, '사방넷 항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!existing) {
    throw new SabangnetFieldStoreError('사방넷 항목을 찾을 수 없습니다.', 'not_found')
  }

  const field = toField(existing as SabangnetFieldRow)
  const label = patch.label.trim()
  if (!label) {
    throw new SabangnetFieldStoreError('항목 이름을 입력하세요.', 'invalid')
  }

  const siblings = await listSabangnetFields(field.brandId)
  if (
    siblings.some(
      (sibling) =>
        sibling.id !== id &&
        sibling.label.toLocaleLowerCase('ko') === label.toLocaleLowerCase('ko'),
    )
  ) {
    throw new SabangnetFieldStoreError('이미 같은 이름의 항목이 있습니다.', 'invalid')
  }

  const { data, error } = await getSupabase()
    .from('sabangnet_fields')
    .update({
      label,
      type: field.systemKey ? field.type : patch.type,
    })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) {
    throw new SabangnetFieldStoreError(
      errorMessage(error, '사방넷 항목을 저장하지 못했습니다.'),
      'invalid',
    )
  }
  return toField(data as SabangnetFieldRow)
}

export async function deleteSabangnetField(id: string): Promise<void> {
  const { data, error: readError } = await getSupabase()
    .from('sabangnet_fields')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (readError) {
    throw new SabangnetFieldStoreError(
      errorMessage(readError, '사방넷 항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!data) {
    throw new SabangnetFieldStoreError('사방넷 항목을 찾을 수 없습니다.', 'not_found')
  }
  if (isLockedSabangnetField(toField(data as SabangnetFieldRow))) {
    throw new SabangnetFieldStoreError(
      '사방넷 코드와 사방넷 상품명은 삭제할 수 없습니다.',
      'locked',
    )
  }

  const { error } = await getSupabase()
    .from('sabangnet_fields')
    .delete()
    .eq('id', id)
  if (error) {
    throw new SabangnetFieldStoreError(
      errorMessage(error, '사방넷 항목을 삭제하지 못했습니다.'),
      'invalid',
    )
  }
}

export async function moveSabangnetField(
  id: string,
  direction: 'up' | 'down',
): Promise<void> {
  const { data, error } = await getSupabase()
    .from('sabangnet_fields')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    throw new SabangnetFieldStoreError(
      errorMessage(error, '사방넷 항목을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!data) {
    throw new SabangnetFieldStoreError('사방넷 항목을 찾을 수 없습니다.', 'not_found')
  }

  const current = toField(data as SabangnetFieldRow)
  const fields = await listSabangnetFields(current.brandId)
  const index = fields.findIndex((field) => field.id === id)
  const target = fields[index + (direction === 'up' ? -1 : 1)]
  if (!target) return

  const supabase = getSupabase()
  const [currentResult, targetResult] = await Promise.all([
    supabase
      .from('sabangnet_fields')
      .update({ sort_order: target.order })
      .eq('id', current.id),
    supabase
      .from('sabangnet_fields')
      .update({ sort_order: current.order })
      .eq('id', target.id),
  ])
  const moveError = currentResult.error ?? targetResult.error
  if (moveError) {
    throw new SabangnetFieldStoreError(
      errorMessage(moveError, '사방넷 항목 순서를 바꾸지 못했습니다.'),
      'invalid',
    )
  }
}
