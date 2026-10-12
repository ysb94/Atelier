import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BARCODE_DATA_ENTRY_SOURCE_REF_PREFIX,
  type BarcodeDataEntryLedgerRow,
  type BarcodeDataEntryRun,
} from '@/lib/outbound/barcode-outbound-data-entry'
import type { ProductOutboundShipment } from '@/lib/outbound/product-outbound'
import {
  outboundPartnerDisplayName,
  outboundPartnerUnitLabel,
} from '@/lib/codes/outbound-partner'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'
import { timeBarcodeHistoryAsync } from '@/lib/outbound/barcode-history-perf'

export class OutboundShipmentStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboundShipmentStoreError'
  }
}

type ShipmentRow = {
  id: string
  brand_id: string
  style_id: string
  usage_target_id: string
  shipped_on: string
  quantity: number
  source: ProductOutboundShipment['source']
  source_ref: string | null
  note: string
}

type StyleEmbed = {
  style_no: string
  name: string
}

type PartnerGroupEmbed = {
  name: string
}

type PartnerTargetEmbed = {
  name: string
  site_name: string
  outbound_partner_groups: PartnerGroupEmbed | PartnerGroupEmbed[] | null
}

type PartnerUnitEmbed = {
  name: string
  group_id: string | null
  site_name: string
}

type OutboundShipmentJoinedRow = ShipmentRow & {
  style: StyleEmbed | StyleEmbed[] | null
  target: PartnerTargetEmbed | PartnerTargetEmbed[] | null
}

type BarcodeLedgerRow = ShipmentRow & {
  created_at: string
}

function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

const OUTBOUND_SHIPMENT_SELECT =
  'id, brand_id, style_id, usage_target_id, shipped_on, quantity, source, source_ref, note, style:styles!outbound_shipments_style_fkey(style_no, name), target:code_usage_targets!outbound_shipments_target_fkey(name, site_name, outbound_partner_groups(name))'

const OUTBOUND_SHIPMENT_SELECT_INNER =
  'id, brand_id, style_id, usage_target_id, shipped_on, quantity, source, source_ref, note, style:styles!inner(style_no, name), target:code_usage_targets!outbound_shipments_target_fkey(name, site_name, outbound_partner_groups(name))'

const OUTBOUND_SOURCES = ['invoice', 'bulk', 'manual'] as const

export type OutboundShipmentListQuery = {
  brandId: string
  dateFrom: string
  dateTo: string
  partnerId: string
  search: string
}

const BARCODE_LEDGER_SELECT =
  'id, brand_id, style_id, usage_target_id, shipped_on, quantity, source, source_ref, note, created_at'

/** IN 목록과 응답을 200건 이하로 제한하고, 동일 ID는 한 번만 조회한다. */
async function barcodeLedgerReferences<T extends { id: string }>(
  supabase: SupabaseClient,
  brandId: string,
  table: 'styles' | 'code_usage_targets',
  select: string,
  ids: readonly string[],
): Promise<Map<string, T>> {
  const uniqueIds = [...new Set(ids)]
  const result = new Map<string, T>()
  for (let from = 0; from < uniqueIds.length; from += 200) {
    const batch = uniqueIds.slice(from, from + 200)
    const rows = await timeBarcodeHistoryAsync(
      `참조 조회 ${table}`,
      async () => {
        const { data, error } = await supabase
          .from(table)
          .select(select)
          .eq('brand_id', brandId)
          .in('id', batch)
        if (error) {
          throw new OutboundShipmentStoreError(
            errorMessage(error, '등록 이력의 상품·업체 정보를 불러오지 못했습니다.'),
          )
        }
        return (data as unknown as T[]) ?? []
      },
      { brandId, from, size: batch.length },
    )
    for (const row of rows) result.set(row.id, row)
  }
  return result
}

function isSource(
  value: string,
): value is ProductOutboundShipment['source'] {
  return value === 'invoice' || value === 'bulk' || value === 'manual'
}

export async function listOutboundShipments(
  brandId: string,
): Promise<ProductOutboundShipment[]> {
  const rows = await fetchAllPages<OutboundShipmentJoinedRow>({
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await getSupabase()
        .from('outbound_shipments')
        .select(
          OUTBOUND_SHIPMENT_SELECT,
          withCount ? { count: 'exact' } : undefined,
        )
        .eq('brand_id', brandId)
        .order('shipped_on', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
      if (error) {
        throw new OutboundShipmentStoreError(
          errorMessage(error, '출고 원장을 불러오지 못했습니다.'),
        )
      }
      return {
        rows: (data as OutboundShipmentJoinedRow[]) ?? [],
        count: count ?? null,
      }
    },
  })

  return rows.flatMap((row) => {
    const mapped = mapOutboundShipment(row)
    return mapped ? [mapped] : []
  })
}

function mapOutboundShipment(
  row: OutboundShipmentJoinedRow,
): ProductOutboundShipment | null {
  if (!isSource(row.source) || row.quantity <= 0) return null
  const style = firstEmbed(row.style)
  const target = firstEmbed(row.target)
  const group = firstEmbed(target?.outbound_partner_groups)
  return {
    id: row.id,
    brandId: row.brand_id,
    styleId: row.style_id,
    styleNo: style?.style_no ?? '',
    styleName: style?.name ?? '',
    partnerId: row.usage_target_id,
    partnerName: target
      ? outboundPartnerDisplayName({
          name: target.name,
          groupName: group?.name ?? '',
          siteName: target.site_name,
        })
      : '',
    shippedOn: row.shipped_on.slice(0, 10),
    quantity: row.quantity,
    source: row.source,
    note: row.note || undefined,
  }
}

function styleSearchOr(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '')
    .replace(/[%_]/g, (char) => `\\${char}`)
    .replace(/[(),]/g, ' ')
    .trim()
  if (!escaped) return null
  const pattern = `"%${escaped}%"`
  return `style_no.ilike.${pattern},name.ilike.${pattern}`
}

/** 기간·업체·상품 조건에 맞는 출고를 모두 읽는다. 화면에서는 이 결과를 페이지로 나눈다. */
export async function listFilteredOutboundShipments(
  query: OutboundShipmentListQuery,
): Promise<ProductOutboundShipment[]> {
  const rows = await fetchAllPages<OutboundShipmentJoinedRow>({
    fetchPage: async (from, to, withCount) => {
      let request = getSupabase()
        .from('outbound_shipments')
        .select(
          OUTBOUND_SHIPMENT_SELECT_INNER,
          withCount ? { count: 'exact' } : undefined,
        )
        .eq('brand_id', query.brandId)
        .gt('quantity', 0)
        .in('source', [...OUTBOUND_SOURCES])
        .order('shipped_on', { ascending: false })
        .order('id', { ascending: false })

      if (query.dateFrom) request = request.gte('shipped_on', query.dateFrom)
      if (query.dateTo) request = request.lte('shipped_on', query.dateTo)
      if (query.partnerId) {
        request = request.eq('usage_target_id', query.partnerId)
      }
      const searchFilter = styleSearchOr(query.search)
      if (searchFilter) {
        request = request.or(searchFilter, { referencedTable: 'style' })
      }

      const { data, error, count } = await request.range(from, to)
      if (error) {
        throw new OutboundShipmentStoreError(
          errorMessage(error, '출고 원장을 불러오지 못했습니다.'),
        )
      }
      return {
        rows: (data as OutboundShipmentJoinedRow[]) ?? [],
        count: count ?? null,
      }
    },
  })

  return rows.flatMap((row) => {
    const mapped = mapOutboundShipment(row)
    return mapped ? [mapped] : []
  })
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type BarcodeDataEntryShipmentEntry = {
  usageTargetId: string
  styleId: string
  quantity: number
}

/** 등록 이력 목록. 화면은 이 메타로 등록자·등록시각을 보여 준다. */
export async function listBarcodeDataEntryRuns(
  brandId: string,
): Promise<BarcodeDataEntryRun[]> {
  const rows = await fetchAllPages<{
    id: string
    company_key: string
    shipped_on: string
    note: string
    worker_label: string
    registered_at: string
  }>({
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await getSupabase()
        .from('barcode_data_entry_runs')
        .select(
          'id, company_key, shipped_on, note, worker_label, registered_at',
          withCount ? { count: 'exact' } : undefined,
        )
        .eq('brand_id', brandId)
        .order('shipped_on', { ascending: false })
        .order('registered_at', { ascending: false })
        .range(from, to)
      if (error) {
        throw new OutboundShipmentStoreError(
          errorMessage(error, '등록 이력을 불러오지 못했습니다.'),
        )
      }
      return { rows: data ?? [], count: count ?? null }
    },
  })

  return rows.map((row) => ({
    id: row.id,
    companyKey: row.company_key,
    shippedOn: row.shipped_on.slice(0, 10),
    note: row.note || '',
    workerLabel: row.worker_label || '',
    registeredAt: row.registered_at,
  }))
}

/**
 * 등록 1건과 그 출고 원장을 저장한다. `runId`가 없으면 새 등록으로 남기므로
 * 같은 업체·출고일을 또 등록해도 앞 등록을 덮어쓰지 않는다. 재고는 건드리지 않는다.
 */
export async function saveBarcodeDataEntryRun(input: {
  brandId: string
  runId?: string | null
  companyKey: string
  shippedOn: string
  note: string
  workerLabel: string
  entries: readonly BarcodeDataEntryShipmentEntry[]
}): Promise<string> {
  if (!UUID_RE.test(input.brandId)) {
    throw new OutboundShipmentStoreError('브랜드 정보가 올바르지 않습니다.')
  }
  if (input.runId != null && !UUID_RE.test(input.runId)) {
    throw new OutboundShipmentStoreError('등록 이력을 찾지 못했습니다.')
  }
  if (!ISO_DATE_RE.test(input.shippedOn)) {
    throw new OutboundShipmentStoreError('출고일을 확인하세요.')
  }
  if (!input.companyKey.trim()) {
    throw new OutboundShipmentStoreError('출고업체 정보가 올바르지 않습니다.')
  }

  const merged = new Map<string, BarcodeDataEntryShipmentEntry>()
  for (const entry of input.entries) {
    const usageTargetId = entry.usageTargetId.trim()
    const styleId = entry.styleId.trim()
    const quantity = Math.trunc(entry.quantity)
    if (
      !UUID_RE.test(usageTargetId) ||
      !UUID_RE.test(styleId) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      continue
    }
    const key = `${usageTargetId}|${styleId}`
    const existing = merged.get(key)
    if (existing) {
      existing.quantity += quantity
      continue
    }
    merged.set(key, { usageTargetId, styleId, quantity })
  }

  const rows = [...merged.values()]
  if (rows.length === 0) {
    throw new OutboundShipmentStoreError('반영할 출고 행이 없습니다.')
  }

  const { data, error } = await getSupabase().rpc(
    'save_barcode_data_entry_run',
    {
      p_brand_id: input.brandId,
      p_run_id: input.runId ?? null,
      p_company_key: input.companyKey.trim(),
      p_shipped_on: input.shippedOn,
      p_note: input.note.trim(),
      p_worker_label: input.workerLabel.trim(),
      p_entries: rows,
    },
  )

  if (error) {
    throw new OutboundShipmentStoreError(
      errorMessage(error, '출고 데이터에 반영하지 못했습니다.'),
    )
  }
  if (typeof data !== 'string') {
    throw new OutboundShipmentStoreError('등록 이력을 저장하지 못했습니다.')
  }
  return data
}

/** 등록 1건과 같은 등록 ID의 출고 원장만 지운다. 재고는 건드리지 않는다. */
export async function deleteBarcodeDataEntryRun(input: {
  brandId: string
  runId: string
}): Promise<number> {
  if (!UUID_RE.test(input.brandId) || !UUID_RE.test(input.runId)) {
    throw new OutboundShipmentStoreError('등록 이력을 찾지 못했습니다.')
  }

  const { data, error } = await getSupabase().rpc(
    'delete_barcode_data_entry_run',
    {
      p_brand_id: input.brandId,
      p_run_id: input.runId,
    },
  )

  if (error) {
    throw new OutboundShipmentStoreError(
      errorMessage(error, '등록을 지우지 못했습니다.'),
    )
  }

  return typeof data === 'number' ? data : 0
}

export type InvoiceOutboundShipmentEntry = {
  usageTargetId: string
  styleId: string
  shippedOn: string
  quantity: number
}

/** 같은 송장 파일 지문의 출고 반영분을 주문일별로 교체한다. 재고는 건드리지 않는다. */
export async function replaceInvoiceOutboundShipments(input: {
  brandId: string
  sourceRef: string
  note?: string
  entries: readonly InvoiceOutboundShipmentEntry[]
}): Promise<number> {
  if (!UUID_RE.test(input.brandId)) {
    throw new OutboundShipmentStoreError('브랜드 정보가 올바르지 않습니다.')
  }
  if (!input.sourceRef.trim()) {
    throw new OutboundShipmentStoreError('출고 출처가 올바르지 않습니다.')
  }
  if (input.entries.length === 0) {
    throw new OutboundShipmentStoreError('반영할 출고 행이 없습니다.')
  }

  const seen = new Set<string>()
  const rows = input.entries.map((entry) => {
    const usageTargetId = entry.usageTargetId.trim()
    const styleId = entry.styleId.trim()
    const shippedOn = entry.shippedOn.trim()
    const quantity = Math.trunc(entry.quantity)
    if (!UUID_RE.test(usageTargetId)) {
      throw new OutboundShipmentStoreError('출고업체 정보가 올바르지 않습니다.')
    }
    if (!UUID_RE.test(styleId)) {
      throw new OutboundShipmentStoreError('상품 정보가 올바르지 않습니다.')
    }
    if (!ISO_DATE_RE.test(shippedOn)) {
      throw new OutboundShipmentStoreError('주문일을 확인하세요.')
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new OutboundShipmentStoreError('출고 수량은 1 이상이어야 합니다.')
    }
    const key = `${shippedOn}|${usageTargetId}|${styleId}`
    if (seen.has(key)) {
      throw new OutboundShipmentStoreError(
        '같은 상품·업체·주문일이 두 번 들어 있습니다.',
      )
    }
    seen.add(key)
    return { usageTargetId, styleId, shippedOn, quantity }
  })

  const { data, error } = await getSupabase().rpc(
    'replace_invoice_outbound_shipments',
    {
      p_brand_id: input.brandId,
      p_source_ref: input.sourceRef.trim(),
      p_note: (input.note ?? '').trim(),
      p_entries: rows,
    },
  )

  if (error) {
    throw new OutboundShipmentStoreError(
      errorMessage(error, '출고 데이터에 반영하지 못했습니다.'),
    )
  }

  return typeof data === 'number' ? data : rows.length
}

export async function listBarcodeDataEntryShipments(
  brandId: string,
  supabase: SupabaseClient = getSupabase(),
): Promise<BarcodeDataEntryLedgerRow[]> {
  // 조인 후 전체 정렬·권한 검사가 페이지마다 반복되지 않도록 원장부터 읽는다.
  // exact COUNT도 생략한다. 마지막 페이지까지 순차 조회하므로 1000행 상한에 잘리지 않는다.
  const rows = await fetchAllPages<BarcodeLedgerRow>({
    concurrency: 1,
    fetchPage: (from, to) =>
      timeBarcodeHistoryAsync(
        '출고 상세 페이지',
        async () => {
          const { data, error } = await supabase
            .from('outbound_shipments')
            .select(BARCODE_LEDGER_SELECT)
            .eq('brand_id', brandId)
            .eq('source', 'bulk')
            .like('source_ref', `${BARCODE_DATA_ENTRY_SOURCE_REF_PREFIX}%`)
            .order('shipped_on', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)
          if (error) {
            throw new OutboundShipmentStoreError(
              errorMessage(error, '등록 이력을 불러오지 못했습니다.'),
            )
          }
          return { rows: (data as BarcodeLedgerRow[]) ?? [], count: null }
        },
        { brandId, from, to },
      ),
  })

  const ledgerRows = rows.filter((row) => row.quantity > 0 && row.source_ref)
  // 모든 조회에 기존 사용자 클라이언트와 brand_id 필터를 사용해 각 테이블의 RLS를 유지한다.
  const styles = await barcodeLedgerReferences<StyleEmbed & { id: string }>(
    supabase,
    brandId,
    'styles',
    'id, style_no, name',
    ledgerRows.map((row) => row.style_id),
  )
  const targets = await barcodeLedgerReferences<PartnerUnitEmbed & { id: string }>(
    supabase,
    brandId,
    'code_usage_targets',
    'id, name, group_id, site_name',
    ledgerRows.map((row) => row.usage_target_id),
  )

  return ledgerRows.map((row) => {
    const style = styles.get(row.style_id)
    const target = targets.get(row.usage_target_id)
    return {
      id: row.id,
      sourceRef: row.source_ref ?? '',
      styleId: row.style_id,
      styleNo: style?.style_no ?? '',
      styleName: style?.name ?? '',
      usageTargetId: row.usage_target_id,
      partnerName: target
        ? outboundPartnerUnitLabel({
            name: target.name,
            groupId: target.group_id,
            siteName: target.site_name,
          })
        : '',
      shippedOn: row.shipped_on.slice(0, 10),
      quantity: row.quantity,
      note: row.note || '',
      createdAt: row.created_at,
    }
  })
}
