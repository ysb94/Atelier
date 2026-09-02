import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

export type BulkOutboundBarcodeSource = 'own' | 'partner'

export type BulkOutboundJobStatus =
  | 'draft'
  | 'converting'
  | 'backup'
  | 'docs'
  | 'done'

export type BulkOutboundPartnerConfig = {
  partnerId: string
  partnerName: string
  barcodeSource: BulkOutboundBarcodeSource
}

export type BulkOutboundTemplateField = {
  id: string
  label: string
  order: number
}

export type BulkOutboundJobLine = {
  barcode: string
  orderQty: number
  productName: string
  sourceRowNo: number
}

export type BulkOutboundJobFile = {
  id: string
  name: string
  fileSize: number
  keptOn: string
}

export type BulkOutboundJob = {
  id: string
  brandId: string
  partnerId: string
  partnerName: string
  barcodeSource: BulkOutboundBarcodeSource
  title: string
  assignee: string
  status: BulkOutboundJobStatus
  startedOn: string
  dueOn: string
  updatedOn: string
  plannedQty: number
  note: string
  evidenceFiles: BulkOutboundJobFile[]
  lines: BulkOutboundJobLine[]
}

export type BulkOutboundJobInput = {
  id?: string | null
  partnerId: string
  barcodeSource: BulkOutboundBarcodeSource
  title: string
  status: BulkOutboundJobStatus
  startedOn: string
  dueOn: string
  assignee: string
  note: string
  plannedQty: number
  lines: BulkOutboundJobLine[]
  files: Array<{
    id?: string
    name: string
    fileSize: number
    keptOn: string
  }>
}

export class BulkOutboundStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BulkOutboundStoreError'
  }
}

type ConfigRow = {
  usage_target_id: string
  barcode_source: BulkOutboundBarcodeSource
}

type TemplateFieldRow = {
  field_key: string
  label: string
  sort_order: number
}

type JobRow = {
  id: string
  brand_id: string
  usage_target_id: string
  title: string
  status: BulkOutboundJobStatus
  barcode_source: BulkOutboundBarcodeSource
  started_on: string
  due_on: string
  assignee: string
  note: string
  planned_qty: number
  updated_at: string
  bulk_outbound_job_lines?: Array<{
    barcode: string
    order_qty: number
    product_name: string
    source_row_no: number | null
  }> | null
  bulk_outbound_job_files?: Array<{
    id: string
    file_name: string
    file_size: number | string
    kept_on: string
  }> | null
}

function isBarcodeSource(
  value: string,
): value is BulkOutboundBarcodeSource {
  return value === 'own' || value === 'partner'
}

function isJobStatus(value: string): value is BulkOutboundJobStatus {
  return (
    value === 'draft' ||
    value === 'converting' ||
    value === 'backup' ||
    value === 'docs' ||
    value === 'done'
  )
}

function toIsoDate(value: string) {
  return value.slice(0, 10)
}

function toJob(
  row: JobRow,
  partnerNameById: Map<string, string>,
): BulkOutboundJob {
  const lines = (row.bulk_outbound_job_lines ?? [])
    .slice()
    .sort((left, right) => (left.source_row_no ?? 0) - (right.source_row_no ?? 0))
    .map((line, index) => ({
      barcode: line.barcode ?? '',
      orderQty: line.order_qty ?? 0,
      productName: line.product_name ?? '',
      sourceRowNo: line.source_row_no ?? index + 1,
    }))

  const evidenceFiles = (row.bulk_outbound_job_files ?? []).map((file) => ({
    id: file.id,
    name: file.file_name,
    fileSize: Number(file.file_size) || 0,
    keptOn: toIsoDate(file.kept_on),
  }))

  return {
    id: row.id,
    brandId: row.brand_id,
    partnerId: row.usage_target_id,
    partnerName: partnerNameById.get(row.usage_target_id) ?? '',
    barcodeSource: isBarcodeSource(row.barcode_source)
      ? row.barcode_source
      : 'own',
    title: row.title,
    assignee: row.assignee ?? '',
    status: isJobStatus(row.status) ? row.status : 'draft',
    startedOn: toIsoDate(row.started_on),
    dueOn: toIsoDate(row.due_on),
    updatedOn: toIsoDate(row.updated_at),
    plannedQty: row.planned_qty ?? 0,
    note: row.note ?? '',
    evidenceFiles,
    lines,
  }
}

export async function listBulkOutboundPartnerConfigs(
  brandId: string,
  partnerNameById: Map<string, string>,
): Promise<BulkOutboundPartnerConfig[]> {
  const { data, error } = await getSupabase()
    .from('bulk_outbound_partner_configs')
    .select('usage_target_id, barcode_source')
    .eq('brand_id', brandId)

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '대량출고 업체를 불러오지 못했습니다.'),
    )
  }

  return ((data as ConfigRow[]) ?? [])
    .filter((row) => partnerNameById.has(row.usage_target_id))
    .map((row) => ({
      partnerId: row.usage_target_id,
      partnerName: partnerNameById.get(row.usage_target_id) ?? '',
      barcodeSource: isBarcodeSource(row.barcode_source)
        ? row.barcode_source
        : 'own',
    }))
}

export async function replaceBulkOutboundPartnerConfigs(
  brandId: string,
  configs: Array<{
    partnerId: string
    barcodeSource: BulkOutboundBarcodeSource
  }>,
): Promise<void> {
  const { error: deleteError } = await getSupabase()
    .from('bulk_outbound_partner_configs')
    .delete()
    .eq('brand_id', brandId)
  if (deleteError) {
    throw new BulkOutboundStoreError(
      errorMessage(deleteError, '대량출고 업체를 저장하지 못했습니다.'),
    )
  }

  if (configs.length === 0) return

  const { error } = await getSupabase()
    .from('bulk_outbound_partner_configs')
    .insert(
      configs.map((config) => ({
        brand_id: brandId,
        usage_target_id: config.partnerId,
        barcode_source: config.barcodeSource,
      })),
    )
  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '대량출고 업체를 저장하지 못했습니다.'),
    )
  }
}

export async function listBulkOutboundTemplateFields(
  brandId: string,
  partnerId: string,
  barcodeSource: BulkOutboundBarcodeSource,
): Promise<BulkOutboundTemplateField[]> {
  const { data, error } = await getSupabase()
    .from('bulk_outbound_template_fields')
    .select('field_key, label, sort_order')
    .eq('brand_id', brandId)
    .eq('usage_target_id', partnerId)
    .eq('barcode_source', barcodeSource)
    .order('sort_order')

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '대량출고 공용 양식을 불러오지 못했습니다.'),
    )
  }

  return ((data as TemplateFieldRow[]) ?? []).map((row) => ({
    id: row.field_key,
    label: row.label,
    order: row.sort_order,
  }))
}

export async function replaceBulkOutboundTemplateFields(
  brandId: string,
  partnerId: string,
  barcodeSource: BulkOutboundBarcodeSource,
  fields: BulkOutboundTemplateField[],
): Promise<void> {
  const normalized = fields
    .map((field, order) => ({
      id: field.id.trim(),
      label: field.label.trim(),
      order,
    }))
    .filter((field) => field.id && field.label)

  const { error } = await getSupabase().rpc(
    'replace_bulk_outbound_template_fields',
    {
      p_brand_id: brandId,
      p_usage_target_id: partnerId,
      p_barcode_source: barcodeSource,
      p_fields: normalized,
    },
  )

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '대량출고 공용 양식을 저장하지 못했습니다.'),
    )
  }
}

export async function initializeBulkOutboundTemplateFields(
  brandId: string,
  partnerId: string,
  barcodeSource: BulkOutboundBarcodeSource,
  fields: BulkOutboundTemplateField[],
): Promise<boolean> {
  const normalized = fields
    .map((field, order) => ({
      id: field.id.trim(),
      label: field.label.trim(),
      order,
    }))
    .filter((field) => field.id && field.label)

  const { data, error } = await getSupabase().rpc(
    'initialize_bulk_outbound_template_fields',
    {
      p_brand_id: brandId,
      p_usage_target_id: partnerId,
      p_barcode_source: barcodeSource,
      p_fields: normalized,
    },
  )

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '기존 대량출고 양식을 이전하지 못했습니다.'),
    )
  }

  return data === true
}

export async function listBulkOutboundJobs(
  brandId: string,
  partnerNameById: Map<string, string>,
): Promise<BulkOutboundJob[]> {
  const { data, error } = await getSupabase()
    .from('bulk_outbound_jobs')
    .select(
      'id, brand_id, usage_target_id, title, status, barcode_source, started_on, due_on, assignee, note, planned_qty, updated_at, bulk_outbound_job_lines(barcode, order_qty, product_name, source_row_no), bulk_outbound_job_files(id, file_name, file_size, kept_on)',
    )
    .eq('brand_id', brandId)
    .order('updated_at', { ascending: false })

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '대량출고 작업을 불러오지 못했습니다.'),
    )
  }

  return ((data as JobRow[]) ?? []).map((row) => toJob(row, partnerNameById))
}

export async function saveBulkOutboundJob(
  brandId: string,
  input: BulkOutboundJobInput,
): Promise<string> {
  const { data, error } = await getSupabase().rpc('save_bulk_outbound_job', {
    p_brand_id: brandId,
    p_id: input.id ?? null,
    p_usage_target_id: input.partnerId,
    p_title: input.title.trim(),
    p_status: input.status,
    p_barcode_source: input.barcodeSource,
    p_started_on: input.startedOn,
    p_due_on: input.dueOn,
    p_assignee: input.assignee,
    p_note: input.note,
    p_planned_qty: input.plannedQty,
    p_lines: input.lines.map((line) => ({
      barcode: line.barcode,
      orderQty: line.orderQty,
      productName: line.productName,
      sourceRowNo: line.sourceRowNo,
    })),
    p_files: input.files.map((file) => ({
      id: file.id,
      name: file.name,
      fileSize: file.fileSize,
      keptOn: file.keptOn,
    })),
  })

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '대량출고 작업을 저장하지 못했습니다.'),
    )
  }

  return data as string
}

export type BulkOutboundBackupEntry = {
  styleId: string
  quantity: number
}

export async function replaceBulkOutboundBackup(input: {
  brandId: string
  jobId: string
  partnerId: string
  shippedOn: string
  entries: BulkOutboundBackupEntry[]
}): Promise<number> {
  const { data, error } = await getSupabase().rpc(
    'replace_bulk_outbound_backup',
    {
      p_brand_id: input.brandId,
      p_job_id: input.jobId,
      p_usage_target_id: input.partnerId,
      p_shipped_on: input.shippedOn,
      p_entries: input.entries.map((entry) => ({
        styleId: entry.styleId,
        quantity: entry.quantity,
      })),
    },
  )

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '임시 반영을 저장하지 못했습니다.'),
    )
  }

  return typeof data === 'number' ? data : 0
}

export function excelRowsFromJobLines(
  lines: BulkOutboundJobLine[],
  fieldIds: {
    barcode?: string
    productName?: string
    orderQty?: string
  },
): Array<{ id: string; values: Record<string, string> }> {
  return lines.map((line, index) => {
    const values: Record<string, string> = {}
    if (fieldIds.barcode) values[fieldIds.barcode] = line.barcode
    if (fieldIds.productName) values[fieldIds.productName] = line.productName
    if (fieldIds.orderQty && line.orderQty > 0) {
      values[fieldIds.orderQty] = String(line.orderQty)
    }
    return {
      id: `line-${line.sourceRowNo || index + 1}-${line.barcode}`,
      values,
    }
  })
}

export function jobLinesFromExcelRows(
  rows: Array<{ values: Record<string, string> }>,
  fieldIds: {
    barcode?: string
    productName?: string
    orderQty?: string
  },
): BulkOutboundJobLine[] {
  return rows.map((row, index) => {
    const barcode = fieldIds.barcode
      ? (row.values[fieldIds.barcode] ?? '').trim()
      : ''
    const productName = fieldIds.productName
      ? (row.values[fieldIds.productName] ?? '').trim()
      : ''
    const qtyRaw = fieldIds.orderQty
      ? (row.values[fieldIds.orderQty] ?? '').trim()
      : ''
    const orderQty = Number.parseInt(qtyRaw.replace(/[^\d-]/g, ''), 10)
    return {
      barcode,
      productName,
      orderQty: Number.isFinite(orderQty) && orderQty > 0 ? orderQty : 0,
      sourceRowNo: index + 1,
    }
  })
}
