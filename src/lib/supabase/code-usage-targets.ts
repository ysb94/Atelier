import type {
  CodeUsageTarget,
  CodeUsageTargetAlias,
  CodeUsageTargetInput,
  OutboundChannelType,
  OutboundShippingMethod,
} from '@/lib/types'
import {
  compactOutboundPartnerKey,
  normalizeOutboundPartnerName,
  outboundPartnerDeleteBlockedMessage,
} from '@/lib/codes/outbound-partner'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, name, normalized_name, active, is_one_time, channel_type, shipping_method, folder_id, group_id, site_name, normalized_site_name, outbound_partner_groups(name), contact_name, contact_phone, contact_email, address, note, sort_order, created_at, updated_at'

const ALIAS_COLUMNS =
  'id, brand_id, target_id, alias, normalized_alias, note, created_at, updated_at'

const PAGE_SIZE = 1000

type TargetRow = {
  id: string
  brand_id: string
  name: string
  normalized_name: string
  active: boolean
  is_one_time: boolean
  channel_type: string
  shipping_method: string
  folder_id: string | null
  group_id: string | null
  site_name: string
  normalized_site_name: string
  outbound_partner_groups: { name: string } | { name: string }[] | null
  contact_name: string
  contact_phone: string
  contact_email: string
  address: string
  note: string
  sort_order: number
  created_at: string
  updated_at: string
}

type AliasRow = {
  id: string
  brand_id: string
  target_id: string
  alias: string
  normalized_alias: string
  note: string
  created_at: string
  updated_at: string
}

export class CodeUsageTargetStoreError extends Error {
  readonly code: 'duplicate' | 'not_found' | 'invalid'

  constructor(message: string, code: 'duplicate' | 'not_found' | 'invalid') {
    super(message)
    this.name = 'CodeUsageTargetStoreError'
    this.code = code
  }
}

function toTarget(row: TargetRow): CodeUsageTarget {
  const group = Array.isArray(row.outbound_partner_groups)
    ? row.outbound_partner_groups[0]
    : row.outbound_partner_groups
  return {
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    normalizedName: row.normalized_name,
    active: row.active,
    isOneTime: row.is_one_time,
    channelType: row.channel_type as OutboundChannelType,
    shippingMethod: row.shipping_method as OutboundShippingMethod,
    folderId: row.folder_id,
    groupId: row.group_id,
    groupName: group?.name ?? '',
    siteName: row.site_name,
    normalizedSiteName: row.normalized_site_name,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    address: row.address,
    note: row.note,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toAlias(row: AliasRow): CodeUsageTargetAlias {
  return {
    id: row.id,
    brandId: row.brand_id,
    targetId: row.target_id,
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listCodeUsageTargets(
  brandId: string,
): Promise<CodeUsageTarget[]> {
  const rows: TargetRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await getSupabase()
      .from('code_usage_targets')
      .select(COLUMNS)
      .eq('brand_id', brandId)
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new CodeUsageTargetStoreError(
        errorMessage(error, '출고업체를 불러오지 못했습니다.'),
        'invalid',
      )
    }

    const page = (data as unknown as TargetRow[]) ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return rows
    .map(toTarget)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        Number(a.isOneTime) - Number(b.isOneTime) ||
        a.order - b.order ||
        a.name.localeCompare(b.name, 'ko'),
    )
}

export async function listCodeUsageTargetAliases(
  brandId: string,
): Promise<CodeUsageTargetAlias[]> {
  const rows: AliasRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await getSupabase()
      .from('code_usage_target_aliases')
      .select(ALIAS_COLUMNS)
      .eq('brand_id', brandId)
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new CodeUsageTargetStoreError(
        errorMessage(error, '업체 별칭을 불러오지 못했습니다.'),
        'invalid',
      )
    }

    const page = (data as AliasRow[]) ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return rows
    .map(toAlias)
    .sort(
      (a, b) =>
        a.targetId.localeCompare(b.targetId) ||
        a.alias.localeCompare(b.alias, 'ko'),
    )
}

function aliasPayload(aliases: readonly string[]) {
  const seen = new Set<string>()
  const payload: { alias: string; normalized_alias: string }[] = []
  aliases.forEach((raw) => {
    const alias = normalizeOutboundPartnerName(raw)
    const key = compactOutboundPartnerKey(alias)
    if (!alias || !key || seen.has(key)) return
    seen.add(key)
    payload.push({ alias, normalized_alias: key })
  })
  return payload
}

type PostgrestErrorLike = {
  code?: string
  message?: string
  details?: string
} | null

function rpcError(error: PostgrestErrorLike, fallback: string) {
  if (error && isUniqueViolation(error)) {
    const context = `${error.message ?? ''} ${error.details ?? ''}`
    if (context.includes('brand_alias_key')) {
      return new CodeUsageTargetStoreError(
        '이미 다른 업체에 등록된 별칭입니다.',
        'duplicate',
      )
    }
    return new CodeUsageTargetStoreError(
      '같은 이름의 업체가 이미 있습니다.',
      'duplicate',
    )
  }
  return new CodeUsageTargetStoreError(errorMessage(error, fallback), 'invalid')
}

export type SaveCodeUsageTargetInput = CodeUsageTargetInput & {
  id?: string | null
  active?: boolean
  aliases?: readonly string[]
  folderId?: string | null
}

/** 업체와 별칭을 한 트랜잭션으로 저장한다. 별칭 배열이 곧 최종 상태다. */
export async function saveCodeUsageTarget(
  brandId: string,
  input: SaveCodeUsageTargetInput,
): Promise<CodeUsageTarget> {
  const name = normalizeOutboundPartnerName(input.name)
  const normalizedName = compactOutboundPartnerKey(name)
  if (!name) {
    throw new CodeUsageTargetStoreError('업체 이름을 입력하세요.', 'invalid')
  }
  if (!normalizedName) {
    throw new CodeUsageTargetStoreError(
      '업체 이름에 글자나 숫자가 있어야 합니다.',
      'invalid',
    )
  }

  const siteName = normalizeOutboundPartnerName(input.siteName ?? '')
  const normalizedSiteName = compactOutboundPartnerKey(siteName)

  const { data, error } = await getSupabase().rpc(
    'save_outbound_partner_unit_with_aliases',
    {
      p_brand_id: brandId,
      p_id: input.id ?? null,
      p_name: name,
      p_normalized_name: normalizedName,
      p_channel_type: input.channelType ?? null,
      p_shipping_method: input.shippingMethod ?? null,
      p_is_one_time: input.isOneTime ?? null,
      p_active: input.active ?? null,
      p_note: input.note ?? null,
      p_folder_id: input.folderId ?? null,
      p_group_id: input.groupId ?? null,
      p_site_name: siteName,
      p_normalized_site_name: normalizedSiteName,
      p_contact_name: normalizeOutboundPartnerName(input.contactName ?? ''),
      p_contact_phone: normalizeOutboundPartnerName(input.contactPhone ?? ''),
      p_contact_email: (input.contactEmail ?? '').trim(),
      p_address: normalizeOutboundPartnerName(input.address ?? ''),
      p_aliases: aliasPayload(input.aliases ?? []),
    },
  )

  if (error) {
    throw rpcError(error, '업체를 저장하지 못했습니다.')
  }

  const savedId = data as string | null
  if (!savedId) {
    throw new CodeUsageTargetStoreError(
      '업체를 저장하지 못했습니다.',
      'invalid',
    )
  }

  const { data: row, error: readError } = await getSupabase()
    .from('code_usage_targets')
    .select(COLUMNS)
    .eq('id', savedId)
    .maybeSingle()

  if (readError || !row) {
    throw new CodeUsageTargetStoreError(
      errorMessage(readError, '저장한 업체를 다시 읽지 못했습니다.'),
      'invalid',
    )
  }

  return toTarget(row as unknown as TargetRow)
}

export async function createCodeUsageTarget(
  brandId: string,
  input: CodeUsageTargetInput,
): Promise<CodeUsageTarget> {
  return saveCodeUsageTarget(brandId, { ...input, id: null })
}

export type BulkCodeUsageTargetRow = {
  name: string
  aliases: readonly string[]
  folderId?: string | null
}

export type BulkCodeUsageTargetResult = {
  created: CodeUsageTarget[]
  failed: { name: string; message: string }[]
}

/**
 * 초기 목록을 한 번에 넣는 경로.
 * 업체 1건씩 RPC로 저장하므로 한 건이 실패해도 다른 업체는 그대로 남는다.
 */
export async function createCodeUsageTargetsBulk(
  brandId: string,
  rows: readonly BulkCodeUsageTargetRow[],
): Promise<BulkCodeUsageTargetResult> {
  const created: CodeUsageTarget[] = []
  const failed: { name: string; message: string }[] = []

  for (const row of rows) {
    try {
      created.push(
        await saveCodeUsageTarget(brandId, {
          id: null,
          name: row.name,
          aliases: row.aliases,
          folderId: row.folderId ?? null,
        }),
      )
    } catch (error) {
      failed.push({
        name: row.name,
        message:
          error instanceof CodeUsageTargetStoreError
            ? error.message
            : '저장하지 못했습니다.',
      })
    }
  }

  return { created, failed }
}

export async function updateCodeUsageTarget(
  id: string,
  patch: Partial<
    Pick<
      CodeUsageTarget,
      | 'name'
      | 'active'
      | 'isOneTime'
      | 'channelType'
      | 'shippingMethod'
      | 'note'
      | 'folderId'
      | 'groupId'
      | 'siteName'
      | 'contactName'
      | 'contactPhone'
      | 'contactEmail'
      | 'address'
    >
  > & { aliases?: readonly string[] },
): Promise<CodeUsageTarget> {
  const { data: existing, error: readError } = await getSupabase()
    .from('code_usage_targets')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    throw new CodeUsageTargetStoreError(
      errorMessage(readError, '출고업체를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!existing) {
    throw new CodeUsageTargetStoreError(
      '출고업체를 찾을 수 없습니다.',
      'not_found',
    )
  }

  const row = existing as unknown as TargetRow
  const current = toTarget(row)

  // 별칭을 안 넘기면 기존 별칭을 그대로 유지한다. RPC가 통째 교체하기 때문이다.
  const aliases =
    patch.aliases ??
    (await listCodeUsageTargetAliases(row.brand_id))
      .filter((alias) => alias.targetId === id)
      .map((alias) => alias.alias)

  return saveCodeUsageTarget(row.brand_id, {
    id,
    name: patch.name !== undefined ? patch.name : current.name,
    active: patch.active ?? current.active,
    isOneTime: patch.isOneTime ?? current.isOneTime,
    channelType: patch.channelType ?? current.channelType,
    shippingMethod: patch.shippingMethod ?? current.shippingMethod,
    note: patch.note ?? current.note,
    folderId: patch.folderId !== undefined ? patch.folderId : current.folderId,
    groupId: patch.groupId !== undefined ? patch.groupId : current.groupId,
    siteName: patch.siteName !== undefined ? patch.siteName : current.siteName,
    contactName:
      patch.contactName !== undefined ? patch.contactName : current.contactName,
    contactPhone:
      patch.contactPhone !== undefined
        ? patch.contactPhone
        : current.contactPhone,
    contactEmail:
      patch.contactEmail !== undefined
        ? patch.contactEmail
        : current.contactEmail,
    address: patch.address !== undefined ? patch.address : current.address,
    aliases,
  })
}

/** 기존 별칭을 지우지 않고 쇼핑몰 표기 하나만 연결한다. */
export async function addCodeUsageTargetAlias(
  brandId: string,
  targetId: string,
  alias: string,
): Promise<void> {
  const name = normalizeOutboundPartnerName(alias)
  const key = compactOutboundPartnerKey(name)
  if (!name) {
    throw new CodeUsageTargetStoreError('연결할 이름을 입력하세요.', 'invalid')
  }
  if (!key) {
    throw new CodeUsageTargetStoreError(
      '이름에 글자나 숫자가 있어야 합니다.',
      'invalid',
    )
  }

  const { error } = await getSupabase().rpc('add_outbound_partner_alias', {
    p_brand_id: brandId,
    p_target_id: targetId,
    p_alias: name,
    p_normalized_alias: key,
  })

  if (error) {
    throw rpcError(error, '별칭을 연결하지 못했습니다.')
  }
}

const LINK_CHECKS = [
  { table: 'code_usage_assignments', label: '바코드 연결' },
  { table: 'product_codes', label: '거래처 바코드' },
  { table: 'outbound_shipments', label: '출고 이력' },
  { table: 'invoice_work_site_summaries', label: '송장 작업 이력' },
  { table: 'bulk_outbound_jobs', label: '바코드 출고 작업' },
  { table: 'bulk_outbound_partner_configs', label: '바코드 출고 등록' },
  { table: 'partner_barcode_fields', label: '거래처 바코드 항목' },
] as const

/** 비어 있으면 이 출고 단위를 삭제할 수 있다. */
export async function listCodeUsageTargetLinkLabels(
  id: string,
): Promise<string[]> {
  const db = getSupabase()
  const results = await Promise.all(
    LINK_CHECKS.map(async (check) => {
      const { count, error } = await db
        .from(check.table)
        .select('id', { count: 'exact', head: true })
        .eq('usage_target_id', id)

      if (error) {
        throw new CodeUsageTargetStoreError(
          errorMessage(error, '연결 이력을 확인하지 못했습니다.'),
          'invalid',
        )
      }

      return count && count > 0 ? check.label : null
    }),
  )

  return results.filter((label) => label !== null)
}

/** 연결된 이력이 없는 출고 단위만 지운다. */
export async function deleteCodeUsageTarget(id: string): Promise<void> {
  const db = getSupabase()
  const blocked = outboundPartnerDeleteBlockedMessage(
    await listCodeUsageTargetLinkLabels(id),
  )
  if (blocked) {
    throw new CodeUsageTargetStoreError(blocked, 'invalid')
  }

  const { data: existing, error: readError } = await db
    .from('code_usage_targets')
    .select('id, brand_id, group_id')
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    throw new CodeUsageTargetStoreError(
      errorMessage(readError, '출고업체를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (!existing) {
    throw new CodeUsageTargetStoreError(
      '출고업체를 찾을 수 없습니다.',
      'not_found',
    )
  }

  const row = existing as {
    id: string
    brand_id: string
    group_id: string | null
  }

  let remainingId: string | null = null
  if (row.group_id) {
    const { data: remaining, error: remainingError } = await db
      .from('code_usage_targets')
      .select('id')
      .eq('brand_id', row.brand_id)
      .eq('group_id', row.group_id)
      .eq('active', true)
      .neq('id', id)

    if (remainingError) {
      throw new CodeUsageTargetStoreError(
        errorMessage(remainingError, '업체를 삭제하지 못했습니다.'),
        'invalid',
      )
    }
    const leftover = (remaining as { id: string }[] | null) ?? []
    if (leftover.length === 1) remainingId = leftover[0]?.id ?? null
  }

  const { error: deleteError } = await db
    .from('code_usage_targets')
    .delete()
    .eq('id', id)
    .eq('brand_id', row.brand_id)

  if (deleteError) {
    throw rpcError(deleteError, '업체를 삭제하지 못했습니다.')
  }

  if (!row.group_id) return

  const { count, error: countError } = await db
    .from('code_usage_targets')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', row.brand_id)
    .eq('group_id', row.group_id)

  if (countError) {
    throw new CodeUsageTargetStoreError(
      errorMessage(countError, '업체를 삭제하지 못했습니다.'),
      'invalid',
    )
  }

  if ((count ?? 0) === 0) {
    const { error: groupError } = await db
      .from('outbound_partner_groups')
      .delete()
      .eq('id', row.group_id)
      .eq('brand_id', row.brand_id)
    if (groupError) {
      throw new CodeUsageTargetStoreError(
        errorMessage(groupError, '빈 업체 그룹을 정리하지 못했습니다.'),
        'invalid',
      )
    }
    return
  }

  if (remainingId) {
    const { error: collapseError } = await db
      .from('code_usage_targets')
      .update({ site_name: '', normalized_site_name: '' })
      .eq('id', remainingId)
      .eq('brand_id', row.brand_id)
    if (collapseError) {
      throw new CodeUsageTargetStoreError(
        errorMessage(collapseError, '남은 업체를 정리하지 못했습니다.'),
        'invalid',
      )
    }
  }
}
