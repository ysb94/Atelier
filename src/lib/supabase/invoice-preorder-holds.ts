import type {
  InvoicePreorderHold,
  InvoicePreorderHoldExtension,
  InvoicePreorderHoldStatus,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const COLUMNS =
  'id, brand_id, style_id, started_on, ship_on, reason, status, ended_on, ended_reason, cleared_at, created_at, updated_at'
const STYLE_EMBED =
  'styles!invoice_preorder_holds_style_fkey(id, style_no, name)'
const EXTENSION_EMBED =
  'invoice_preorder_hold_extensions!invoice_preorder_hold_extensions_hold_fkey(id, hold_id, previous_ship_on, new_ship_on, reason, created_at)'
const SELECT = `${COLUMNS}, ${STYLE_EMBED}, ${EXTENSION_EMBED}`
const PAGE_SIZE = 1000

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type ExtensionRow = {
  id: string
  hold_id: string
  previous_ship_on: string
  new_ship_on: string
  reason: string
  created_at: string
}

type HoldRow = {
  id: string
  brand_id: string
  style_id: string
  started_on: string
  ship_on: string
  reason: string
  status: string
  ended_on: string | null
  ended_reason: string
  cleared_at: string | null
  created_at: string
  updated_at: string
  styles?: StyleEmbed | StyleEmbed[] | null
  invoice_preorder_hold_extensions?: ExtensionRow[] | null
}

export class InvoicePreorderHoldStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoicePreorderHoldStoreError'
  }
}

export type InvoicePreorderHoldInput = {
  styleId: string
  startedOn: string
  shipOn: string
  reason: string
}

export type InvoicePreorderHoldUpdateInput = {
  startedOn: string
  shipOn: string
  reason: string
}

export type InvoicePreorderHoldExtendInput = {
  newShipOn: string
  reason: string
}

export type InvoicePreorderHoldEndInput = {
  endedOn: string
  endedReason?: string
}

function styleFromEmbed(
  embed: StyleEmbed | StyleEmbed[] | null | undefined,
): { styleId: string; styleNo: string; name: string } | null {
  if (!embed) return null
  const row = Array.isArray(embed) ? (embed[0] ?? null) : embed
  if (!row) return null
  return { styleId: row.id, styleNo: row.style_no, name: row.name }
}

function toExtension(row: ExtensionRow): InvoicePreorderHoldExtension {
  return {
    id: row.id,
    holdId: row.hold_id,
    previousShipOn: row.previous_ship_on,
    newShipOn: row.new_ship_on,
    reason: row.reason,
    createdAt: row.created_at,
  }
}

function toHold(row: HoldRow): InvoicePreorderHold {
  const style = styleFromEmbed(row.styles)
  const status: InvoicePreorderHoldStatus =
    row.status === 'ended'
      ? 'ended'
      : row.status === 'cleared'
        ? 'cleared'
        : 'active'
  const extensions = [...(row.invoice_preorder_hold_extensions ?? [])]
    .map(toExtension)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.previousShipOn.localeCompare(right.previousShipOn),
    )
  return {
    id: row.id,
    brandId: row.brand_id,
    styleId: row.style_id,
    styleNo: style?.styleNo ?? '',
    name: style?.name ?? '',
    startedOn: row.started_on,
    shipOn: row.ship_on,
    reason: row.reason,
    status,
    endedOn: row.ended_on,
    endedReason: row.ended_reason ?? '',
    clearedAt: row.cleared_at,
    extensions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function assertYmd(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new InvoicePreorderHoldStoreError(`${label}을(를) 확인하세요.`)
  }
}

function validateDates(startedOn: string, shipOn: string) {
  assertYmd(startedOn, '예발 시작일')
  assertYmd(shipOn, '출고 예정일')
  if (shipOn < startedOn) {
    throw new InvoicePreorderHoldStoreError(
      '출고 예정일은 예발 시작일 이후여야 합니다.',
    )
  }
}

function validateInput(input: InvoicePreorderHoldInput) {
  if (!input.styleId.trim()) {
    throw new InvoicePreorderHoldStoreError('예발 상품을 선택하세요.')
  }
  validateDates(input.startedOn.trim(), input.shipOn.trim())
  if (!input.reason.trim()) {
    throw new InvoicePreorderHoldStoreError('예발 사유를 입력하세요.')
  }
}

async function fetchHoldById(
  brandId: string,
  holdId: string,
): Promise<InvoicePreorderHold> {
  const { data, error } = await getSupabase()
    .from('invoice_preorder_holds')
    .select(SELECT)
    .eq('brand_id', brandId)
    .eq('id', holdId)
    .maybeSingle()
  if (error) {
    throw new InvoicePreorderHoldStoreError(
      errorMessage(error, '예발을 불러오지 못했습니다.'),
    )
  }
  if (!data) {
    throw new InvoicePreorderHoldStoreError(
      '예발을 찾지 못했거나 권한이 없습니다.',
    )
  }
  return toHold(data as HoldRow)
}

export async function listInvoicePreorderHolds(
  brandId: string,
  options: { status?: InvoicePreorderHoldStatus | 'all' } = {},
): Promise<InvoicePreorderHold[]> {
  const supabase = getSupabase()
  const statusFilter = options.status ?? 'all'
  const rows = await fetchAllPages<HoldRow>({
    pageSize: PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      let query = supabase
        .from('invoice_preorder_holds')
        .select(SELECT, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('ship_on', { ascending: true })
        .order('started_on', { ascending: true })
        .range(from, to)
      if (statusFilter !== 'all') query = query.eq('status', statusFilter)
      const { data, error, count } = await query
      if (error) {
        throw new InvoicePreorderHoldStoreError(
          errorMessage(error, '예발 목록을 불러오지 못했습니다.'),
        )
      }
      return { rows: (data as HoldRow[]) ?? [], count: count ?? null }
    },
  })
  return rows.map(toHold)
}

export async function createInvoicePreorderHold(
  brandId: string,
  input: InvoicePreorderHoldInput,
): Promise<InvoicePreorderHold> {
  validateInput(input)
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('invoice_preorder_holds')
    .insert({
      brand_id: brandId,
      style_id: input.styleId.trim(),
      started_on: input.startedOn.trim(),
      ship_on: input.shipOn.trim(),
      reason: input.reason.trim(),
      status: 'active',
    })
    .select(SELECT)
    .single()
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoicePreorderHoldStoreError(
        '이미 진행 중인 예발이 있는 상품입니다.',
      )
    }
    throw new InvoicePreorderHoldStoreError(
      errorMessage(error, '예발을 추가하지 못했습니다.'),
    )
  }
  return toHold(data as HoldRow)
}

export async function updateInvoicePreorderHold(
  brandId: string,
  holdId: string,
  input: InvoicePreorderHoldUpdateInput,
): Promise<InvoicePreorderHold> {
  validateDates(input.startedOn.trim(), input.shipOn.trim())
  if (!input.reason.trim()) {
    throw new InvoicePreorderHoldStoreError('예발 사유를 입력하세요.')
  }
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('invoice_preorder_holds')
    .update({
      started_on: input.startedOn.trim(),
      ship_on: input.shipOn.trim(),
      reason: input.reason.trim(),
    })
    .eq('id', holdId)
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .select(SELECT)
    .maybeSingle()
  if (error) {
    throw new InvoicePreorderHoldStoreError(
      errorMessage(error, '예발 정보를 바꾸지 못했습니다.'),
    )
  }
  if (!data) {
    throw new InvoicePreorderHoldStoreError(
      '진행 중 예발을 찾지 못했거나 권한이 없습니다.',
    )
  }
  return toHold(data as HoldRow)
}

/** 출고 예정일을 뒤로 미루고 연장 이력을 남긴다. */
export async function extendInvoicePreorderHold(
  brandId: string,
  holdId: string,
  input: InvoicePreorderHoldExtendInput,
): Promise<InvoicePreorderHold> {
  assertYmd(input.newShipOn, '연장 출고 예정일')
  if (!input.reason.trim()) {
    throw new InvoicePreorderHoldStoreError('연장 사유를 입력하세요.')
  }

  const current = await fetchHoldById(brandId, holdId)
  if (current.status !== 'active') {
    throw new InvoicePreorderHoldStoreError('진행 중 예발만 연장할 수 있습니다.')
  }
  const newShipOn = input.newShipOn.trim()
  if (newShipOn <= current.shipOn) {
    throw new InvoicePreorderHoldStoreError(
      '연장 출고 예정일은 현재 예정일보다 뒤여야 합니다.',
    )
  }
  if (newShipOn < current.startedOn) {
    throw new InvoicePreorderHoldStoreError(
      '출고 예정일은 예발 시작일 이후여야 합니다.',
    )
  }

  const supabase = getSupabase()
  const { error: insertError } = await supabase
    .from('invoice_preorder_hold_extensions')
    .insert({
      brand_id: brandId,
      hold_id: holdId,
      previous_ship_on: current.shipOn,
      new_ship_on: newShipOn,
      reason: input.reason.trim(),
    })
  if (insertError) {
    throw new InvoicePreorderHoldStoreError(
      errorMessage(insertError, '연장 이력을 남기지 못했습니다.'),
    )
  }

  const { data, error } = await supabase
    .from('invoice_preorder_holds')
    .update({ ship_on: newShipOn })
    .eq('id', holdId)
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .select(SELECT)
    .maybeSingle()
  if (error) {
    throw new InvoicePreorderHoldStoreError(
      errorMessage(error, '출고 예정일을 연장하지 못했습니다.'),
    )
  }
  if (!data) {
    throw new InvoicePreorderHoldStoreError(
      '진행 중 예발을 찾지 못했거나 권한이 없습니다.',
    )
  }
  return toHold(data as HoldRow)
}

/** 예발 구간을 끝낸다. 예정일보다 이를 수 있고, 예정일이 지나도 이 동작 전까지 active다. */
export async function endInvoicePreorderHold(
  brandId: string,
  holdId: string,
  input: InvoicePreorderHoldEndInput,
): Promise<InvoicePreorderHold> {
  assertYmd(input.endedOn, '종료일')
  const current = await fetchHoldById(brandId, holdId)
  if (current.status !== 'active') {
    throw new InvoicePreorderHoldStoreError('진행 중 예발만 종료할 수 있습니다.')
  }
  const endedOn = input.endedOn.trim()
  if (endedOn < current.startedOn) {
    throw new InvoicePreorderHoldStoreError(
      '종료일은 예발 시작일 이후여야 합니다.',
    )
  }
  const offSchedule = endedOn !== current.shipOn
  const endedReason = input.endedReason?.trim() ?? ''
  if (offSchedule && !endedReason) {
    throw new InvoicePreorderHoldStoreError(
      '종료일이 출고 예정일과 다르면 사유를 입력하세요.',
    )
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('invoice_preorder_holds')
    .update({
      status: 'ended',
      ended_on: endedOn,
      ended_reason: offSchedule ? endedReason : '',
      cleared_at: new Date().toISOString(),
    })
    .eq('id', holdId)
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .select(SELECT)
    .maybeSingle()
  if (error) {
    throw new InvoicePreorderHoldStoreError(
      errorMessage(error, '예발을 종료하지 못했습니다.'),
    )
  }
  if (!data) {
    throw new InvoicePreorderHoldStoreError(
      '진행 중 예발을 찾지 못했거나 권한이 없습니다.',
    )
  }
  return toHold(data as HoldRow)
}

/** 잘못 등록한 진행 중 예발을 지운다. 과거 기록에 남기지 않는다. */
export async function deleteInvoicePreorderHold(
  brandId: string,
  holdId: string,
): Promise<void> {
  const { data, error } = await getSupabase()
    .from('invoice_preorder_holds')
    .delete()
    .eq('id', holdId)
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .select('id')
  if (error) {
    throw new InvoicePreorderHoldStoreError(
      errorMessage(error, '예발을 삭제하지 못했습니다.'),
    )
  }
  if (!data?.length) {
    throw new InvoicePreorderHoldStoreError(
      '진행 중 예발을 찾지 못했거나 권한이 없습니다.',
    )
  }
}
