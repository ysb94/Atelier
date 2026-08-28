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
} from '@/lib/codes/outbound-partner'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, name, normalized_name, active, is_one_time, channel_type, shipping_method, folder_id, note, sort_order, created_at, updated_at'

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

    const page = (data as TargetRow[]) ?? []
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

  const { data, error } = await getSupabase().rpc(
    'save_outbound_partner_with_aliases',
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

  return toTarget(row as TargetRow)
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

  const row = existing as TargetRow
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
