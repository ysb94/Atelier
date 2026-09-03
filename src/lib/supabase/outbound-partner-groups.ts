import type { OutboundPartnerGroup } from '@/lib/types'
import {
  compactOutboundPartnerKey,
  normalizeOutboundPartnerName,
} from '@/lib/codes/outbound-partner'
import { getSupabase } from '@/lib/supabase/client'
import { CodeUsageTargetStoreError } from '@/lib/supabase/code-usage-targets'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, name, normalized_name, sort_order, created_at, updated_at'

type GroupRow = {
  id: string
  brand_id: string
  name: string
  normalized_name: string
  sort_order: number
  created_at: string
  updated_at: string
}

function toGroup(row: GroupRow): OutboundPartnerGroup {
  return {
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    normalizedName: row.normalized_name,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function groupError(error: { code?: string; message?: string } | null) {
  if (error && isUniqueViolation(error)) {
    return new CodeUsageTargetStoreError(
      '같은 이름의 업체 그룹이 이미 있습니다.',
      'duplicate',
    )
  }
  return new CodeUsageTargetStoreError(
    errorMessage(error, '업체 그룹을 저장하지 못했습니다.'),
    'invalid',
  )
}

export async function listOutboundPartnerGroups(
  brandId: string,
): Promise<OutboundPartnerGroup[]> {
  const { data, error } = await getSupabase()
    .from('outbound_partner_groups')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .order('sort_order')
    .order('name')

  if (error) {
    throw new CodeUsageTargetStoreError(
      errorMessage(error, '업체 그룹을 불러오지 못했습니다.'),
      'invalid',
    )
  }

  return ((data as GroupRow[]) ?? []).map(toGroup)
}

export async function createOutboundPartnerGroup(
  brandId: string,
  rawName: string,
): Promise<OutboundPartnerGroup> {
  const name = normalizeOutboundPartnerName(rawName)
  const normalizedName = compactOutboundPartnerKey(name)
  if (!name || !normalizedName) {
    throw new CodeUsageTargetStoreError(
      '업체 그룹 이름을 입력하세요.',
      'invalid',
    )
  }

  const groups = await listOutboundPartnerGroups(brandId)
  const existing = groups.find(
    (group) => group.normalizedName === normalizedName,
  )
  if (existing) return existing

  const nextOrder = groups.reduce(
    (max, group) => Math.max(max, group.order + 1),
    0,
  )
  const { data, error } = await getSupabase()
    .from('outbound_partner_groups')
    .insert({
      brand_id: brandId,
      name,
      normalized_name: normalizedName,
      sort_order: nextOrder,
    })
    .select(COLUMNS)
    .single()

  if (error) throw groupError(error)
  return toGroup(data as GroupRow)
}

export async function updateOutboundPartnerGroup(
  id: string,
  rawName: string,
): Promise<OutboundPartnerGroup> {
  const name = normalizeOutboundPartnerName(rawName)
  const normalizedName = compactOutboundPartnerKey(name)
  if (!name || !normalizedName) {
    throw new CodeUsageTargetStoreError(
      '업체 이름을 입력하세요.',
      'invalid',
    )
  }

  const { data: existing, error: readError } = await getSupabase()
    .from('outbound_partner_groups')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readError) throw groupError(readError)
  if (!existing) {
    throw new CodeUsageTargetStoreError('업체를 찾을 수 없습니다.', 'not_found')
  }

  const current = toGroup(existing as GroupRow)
  if (current.normalizedName === normalizedName && current.name === name) {
    return current
  }

  const { data, error } = await getSupabase()
    .from('outbound_partner_groups')
    .update({ name, normalized_name: normalizedName })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) throw groupError(error)
  return toGroup(data as GroupRow)
}
