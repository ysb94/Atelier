import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

export type BulkOutboundBarcodeSource = 'own' | 'partner'

export type BulkOutboundJobStatus =
  | 'draft'
  | 'converting'
  | 'backup'
  | 'docs'
  | 'done'

export type BulkOutboundPartnerWorkStatus = 'idle' | 'working' | 'done'

const DEV_LOGIN_EMAIL = 'dev@atelier.local'
const DEV_LOGIN_PROFILE_ID = 'd0000000-0000-4000-8000-000000000001'

export function canSetBulkOutboundPartnerWorkStatus(input: {
  profileId?: string | null
  email?: string | null
}) {
  const email = (input.email ?? '').trim().toLowerCase()
  const envEmail = String(
    import.meta.env.VITE_DEV_LOGIN_EMAIL ?? '',
  )
    .trim()
    .toLowerCase()
  if (email && (email === DEV_LOGIN_EMAIL || (envEmail && email === envEmail))) {
    return true
  }
  return input.profileId === DEV_LOGIN_PROFILE_ID
}

export type BulkOutboundPartnerConfig = {
  partnerId: string
  partnerName: string
  barcodeSource: BulkOutboundBarcodeSource
  workStatus: BulkOutboundPartnerWorkStatus
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
  extraValues: Record<string, string>
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
  work_status: string | null
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
    extra_values?: Record<string, unknown> | null
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

function isWorkStatus(
  value: string,
): value is BulkOutboundPartnerWorkStatus {
  return value === 'idle' || value === 'working' || value === 'done'
}

function toWorkStatus(
  value: string | null | undefined,
): BulkOutboundPartnerWorkStatus {
  return isWorkStatus(value ?? '') ? (value as BulkOutboundPartnerWorkStatus) : 'idle'
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

const BULK_LINE_PII_KEY =
  /(받는분|수령인|성명|전화번호|연락처|핸드폰|휴대폰|주소|배송메시지)/

function toExtraValues(
  value: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const extras: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    const trimmedKey = key.trim()
    if (!trimmedKey || BULK_LINE_PII_KEY.test(trimmedKey)) continue
    if (typeof item !== 'string') continue
    extras[trimmedKey] = item
  }
  return extras
}

export function isBulkOutboundPiiFieldLabel(label: string) {
  return BULK_LINE_PII_KEY.test(label.trim())
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
      extraValues: toExtraValues(line.extra_values),
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
    .select('usage_target_id, barcode_source, work_status')
    .eq('brand_id', brandId)

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '바코드 출고 업체를 불러오지 못했습니다.'),
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
      workStatus: toWorkStatus(row.work_status),
    }))
}

export async function replaceBulkOutboundPartnerConfigs(
  brandId: string,
  configs: Array<{
    partnerId: string
    barcodeSource: BulkOutboundBarcodeSource
    workStatus?: BulkOutboundPartnerWorkStatus
  }>,
): Promise<void> {
  const nextIds = configs.map((config) => config.partnerId)
  const supabase = getSupabase()
  const { data: userData } = await supabase.auth.getUser()
  const canSetWorkStatus = canSetBulkOutboundPartnerWorkStatus({
    profileId: userData.user?.id,
    email: userData.user?.email,
  })
  const { data: existing, error: existingError } = await supabase
    .from('bulk_outbound_partner_configs')
    .select('usage_target_id, work_status')
    .eq('brand_id', brandId)
  if (existingError) {
    throw new BulkOutboundStoreError(
      errorMessage(existingError, '바코드 출고 업체를 저장하지 못했습니다.'),
    )
  }

  const existingRows =
    (existing as Array<{
      usage_target_id: string
      work_status: string | null
    }>) ?? []
  const existingStatus = new Map(
    existingRows.map((row) => [row.usage_target_id, toWorkStatus(row.work_status)]),
  )
  const keep = new Set(nextIds)
  const removed = existingRows
    .map((row) => row.usage_target_id)
    .filter((id) => !keep.has(id))

  if (configs.length > 0) {
    const { error } = await supabase
      .from('bulk_outbound_partner_configs')
      .upsert(
        configs.map((config) => ({
          brand_id: brandId,
          usage_target_id: config.partnerId,
          barcode_source: config.barcodeSource,
          work_status: canSetWorkStatus
            ? toWorkStatus(config.workStatus)
            : (existingStatus.get(config.partnerId) ?? 'idle'),
        })),
        { onConflict: 'brand_id,usage_target_id' },
      )
    if (error) {
      throw new BulkOutboundStoreError(
        errorMessage(error, '바코드 출고 업체를 저장하지 못했습니다.'),
      )
    }
  }

  if (removed.length > 0) {
    const { error: deleteError } = await getSupabase()
      .from('bulk_outbound_partner_configs')
      .delete()
      .eq('brand_id', brandId)
      .in('usage_target_id', removed)
    if (deleteError) {
      throw new BulkOutboundStoreError(
        errorMessage(deleteError, '바코드 출고 업체를 저장하지 못했습니다.'),
      )
    }
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
      errorMessage(error, '바코드 출고 공용 양식을 불러오지 못했습니다.'),
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
      errorMessage(error, '바코드 출고 공용 양식을 저장하지 못했습니다.'),
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
      errorMessage(error, '기존 바코드 출고 양식을 이전하지 못했습니다.'),
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
      'id, brand_id, usage_target_id, title, status, barcode_source, started_on, due_on, assignee, note, planned_qty, updated_at, bulk_outbound_job_lines(barcode, order_qty, product_name, source_row_no, extra_values), bulk_outbound_job_files(id, file_name, file_size, kept_on)',
    )
    .eq('brand_id', brandId)
    .order('updated_at', { ascending: false })

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '바코드 출고 작업을 불러오지 못했습니다.'),
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
      extraValues: line.extraValues ?? {},
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
      errorMessage(error, '바코드 출고 작업을 저장하지 못했습니다.'),
    )
  }

  return data as string
}

export async function updateBulkOutboundJobMeta(
  brandId: string,
  jobId: string,
  assignee: string,
  input: {
    title: string
    dueOn: string
    note: string
    partnerId?: string
    barcodeSource?: BulkOutboundBarcodeSource
  },
): Promise<void> {
  const { data, error } = await getSupabase()
    .from('bulk_outbound_jobs')
    .select('id, assignee, status, planned_qty')
    .eq('brand_id', brandId)
    .eq('id', jobId)
    .maybeSingle()

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '바코드 출고 작업을 확인하지 못했습니다.'),
    )
  }
  if (!data) {
    throw new BulkOutboundStoreError('바코드 출고 작업을 찾지 못했습니다.')
  }
  if ((data.assignee ?? '') !== assignee) {
    throw new BulkOutboundStoreError('본인이 만든 건만 수정할 수 있습니다.')
  }

  const title = input.title.trim()
  if (!title) {
    throw new BulkOutboundStoreError('작업 이름을 입력하세요.')
  }

  const patch: Record<string, string> = {
    title,
    due_on: input.dueOn,
    note: input.note,
  }
  if (input.partnerId && input.barcodeSource) {
    if (data.status !== 'draft' || (data.planned_qty ?? 0) > 0) {
      throw new BulkOutboundStoreError(
        '엑셀을 올린 뒤에는 업체를 바꿀 수 없습니다.',
      )
    }
    patch.usage_target_id = input.partnerId
    patch.barcode_source = input.barcodeSource
  }

  const { error: updateError } = await getSupabase()
    .from('bulk_outbound_jobs')
    .update(patch)
    .eq('brand_id', brandId)
    .eq('id', jobId)

  if (updateError) {
    throw new BulkOutboundStoreError(
      errorMessage(updateError, '바코드 출고 작업을 수정하지 못했습니다.'),
    )
  }
}

export async function getBulkOutboundBackupSummary(
  brandId: string,
  jobId: string,
): Promise<{ kinds: number; qty: number }> {
  const { data, error } = await getSupabase()
    .from('outbound_shipments')
    .select('quantity')
    .eq('brand_id', brandId)
    .eq('source', 'bulk')
    .eq('source_ref', jobId)

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '출고 데이터를 확인하지 못했습니다.'),
    )
  }

  const rows = data ?? []
  return {
    kinds: rows.length,
    qty: rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0),
  }
}

export async function deleteBulkOutboundJob(
  brandId: string,
  jobId: string,
  assignee: string,
): Promise<number> {
  const { data, error } = await getSupabase().rpc('delete_bulk_outbound_job', {
    p_brand_id: brandId,
    p_job_id: jobId,
    p_assignee: assignee,
  })

  if (error) {
    throw new BulkOutboundStoreError(
      errorMessage(error, '바코드 출고 작업을 삭제하지 못했습니다.'),
    )
  }

  return typeof data === 'number' ? data : 0
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
  fields: Array<{ id: string; label: string }> = [],
): Array<{ id: string; values: Record<string, string> }> {
  return lines.map((line, index) => {
    const values: Record<string, string> = {}
    if (fieldIds.barcode) values[fieldIds.barcode] = line.barcode
    if (fieldIds.productName) values[fieldIds.productName] = line.productName
    if (fieldIds.orderQty && line.orderQty > 0) {
      values[fieldIds.orderQty] = String(line.orderQty)
    }
    const extras = line.extraValues ?? {}
    for (const field of fields) {
      if (
        field.id === fieldIds.barcode ||
        field.id === fieldIds.productName ||
        field.id === fieldIds.orderQty
      ) {
        continue
      }
      const extra = extras[field.id] ?? extras[field.label]
      if (extra) values[field.id] = extra
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
  fields: Array<{ id: string; label: string }> = [],
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
    const extraValues: Record<string, string> = {}
    for (const field of fields) {
      if (
        field.id === fieldIds.barcode ||
        field.id === fieldIds.productName ||
        field.id === fieldIds.orderQty ||
        isBulkOutboundPiiFieldLabel(field.label)
      ) {
        continue
      }
      const value = (row.values[field.id] ?? '').trim()
      if (!value) continue
      extraValues[field.id] = value
      extraValues[field.label] = value
    }
    return {
      barcode,
      productName,
      orderQty: Number.isFinite(orderQty) && orderQty > 0 ? orderQty : 0,
      sourceRowNo: index + 1,
      extraValues,
    }
  })
}
