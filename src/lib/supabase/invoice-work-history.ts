import type { InvoiceWorkRun, InvoiceWorkSiteSummary } from '@/lib/types'
import type { InvoiceSiteSummaryDraft } from '@/lib/invoice/mall-resolution'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

const RUN_COLUMNS =
  'id, brand_id, file_fingerprint, source_file_name, completed_by, worker_label, completed_at, source_row_count, source_order_count, exported_row_count, review_row_count, created_at, updated_at'

const SUMMARY_COLUMNS =
  'id, brand_id, run_id, usage_target_id, source_mall_names, order_count, source_row_count, source_quantity, cj_order_row_count, cj_order_quantity, cj_gift_row_count, cj_gift_quantity, created_at, updated_at'

const HISTORY_LIMIT = 80

type RunRow = {
  id: string
  brand_id: string
  file_fingerprint: string
  source_file_name: string
  completed_by: string | null
  worker_label: string
  completed_at: string
  source_row_count: number
  source_order_count: number
  exported_row_count: number
  review_row_count: number
  created_at: string
  updated_at: string
}

type SummaryRow = {
  id: string
  brand_id: string
  run_id: string
  usage_target_id: string
  source_mall_names: string
  order_count: number
  source_row_count: number
  source_quantity: number
  cj_order_row_count: number
  cj_order_quantity: number
  cj_gift_row_count: number
  cj_gift_quantity: number
  created_at: string
  updated_at: string
}

export class InvoiceWorkHistoryStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceWorkHistoryStoreError'
  }
}

function toSummary(
  row: SummaryRow,
  targetName: string,
): InvoiceWorkSiteSummary {
  return {
    id: row.id,
    brandId: row.brand_id,
    runId: row.run_id,
    usageTargetId: row.usage_target_id,
    targetName,
    sourceMallNames: row.source_mall_names,
    orderCount: row.order_count,
    sourceRowCount: row.source_row_count,
    sourceQuantity: row.source_quantity,
    cjOrderRowCount: row.cj_order_row_count,
    cjOrderQuantity: row.cj_order_quantity,
    cjGiftRowCount: row.cj_gift_row_count,
    cjGiftQuantity: row.cj_gift_quantity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRun(
  row: RunRow,
  sites: InvoiceWorkSiteSummary[],
): InvoiceWorkRun {
  return {
    id: row.id,
    brandId: row.brand_id,
    fileFingerprint: row.file_fingerprint,
    sourceFileName: row.source_file_name,
    completedBy: row.completed_by,
    workerLabel: row.worker_label,
    completedAt: row.completed_at,
    sourceRowCount: row.source_row_count,
    sourceOrderCount: row.source_order_count,
    exportedRowCount: row.exported_row_count,
    reviewRowCount: row.review_row_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sites: sites.sort(
      (a, b) =>
        a.targetName.localeCompare(b.targetName, 'ko') ||
        a.sourceMallNames.localeCompare(b.sourceMallNames, 'ko'),
    ),
  }
}

export async function listInvoiceWorkRuns(
  brandId: string,
): Promise<InvoiceWorkRun[]> {
  const { data, error } = await getSupabase()
    .from('invoice_work_runs')
    .select(RUN_COLUMNS)
    .eq('brand_id', brandId)
    .order('completed_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  if (error) {
    throw new InvoiceWorkHistoryStoreError(
      errorMessage(error, '출고 작업 이력을 불러오지 못했습니다.'),
    )
  }

  const runs = (data as RunRow[]) ?? []
  if (runs.length === 0) return []

  const runIds = runs.map((row) => row.id)
  const { data: summaryData, error: summaryError } = await getSupabase()
    .from('invoice_work_site_summaries')
    .select(SUMMARY_COLUMNS)
    .eq('brand_id', brandId)
    .in('run_id', runIds)

  if (summaryError) {
    throw new InvoiceWorkHistoryStoreError(
      errorMessage(summaryError, '사이트 집계를 불러오지 못했습니다.'),
    )
  }

  const summaries = (summaryData as SummaryRow[]) ?? []
  const targetIds = [...new Set(summaries.map((row) => row.usage_target_id))]
  const names = new Map<string, string>()

  if (targetIds.length > 0) {
    const { data: targetData, error: targetError } = await getSupabase()
      .from('code_usage_targets')
      .select('id, name')
      .eq('brand_id', brandId)
      .in('id', targetIds)

    if (targetError) {
      throw new InvoiceWorkHistoryStoreError(
        errorMessage(targetError, '출고업체 이름을 불러오지 못했습니다.'),
      )
    }

    ;((targetData as { id: string; name: string }[]) ?? []).forEach((row) => {
      names.set(row.id, row.name)
    })
  }

  const byRun = new Map<string, InvoiceWorkSiteSummary[]>()
  summaries.forEach((row) => {
    const list = byRun.get(row.run_id) ?? []
    list.push(
      toSummary(
        row,
        names.get(row.usage_target_id) || row.source_mall_names || '출고업체',
      ),
    )
    byRun.set(row.run_id, list)
  })

  return runs.map((row) => toRun(row, byRun.get(row.id) ?? []))
}

export type RecordInvoiceWorkCompletionInput = {
  brandId: string
  fileFingerprint: string
  sourceFileName: string
  workerLabel: string
  sourceRowCount: number
  sourceOrderCount: number
  exportedRowCount: number
  reviewRowCount: number
  sites: readonly InvoiceSiteSummaryDraft[]
}

export async function recordInvoiceWorkCompletion(
  input: RecordInvoiceWorkCompletionInput,
): Promise<string> {
  const fingerprint = input.fileFingerprint.trim()
  if (!fingerprint) {
    throw new InvoiceWorkHistoryStoreError('파일 지문이 필요합니다.')
  }

  const { data, error } = await getSupabase().rpc(
    'record_invoice_work_completion',
    {
      p_brand_id: input.brandId,
      p_file_fingerprint: fingerprint,
      p_source_file_name: input.sourceFileName ?? '',
      p_worker_label: input.workerLabel ?? '',
      p_source_row_count: input.sourceRowCount,
      p_source_order_count: input.sourceOrderCount,
      p_exported_row_count: input.exportedRowCount,
      p_review_row_count: input.reviewRowCount,
      p_sites: input.sites.map((site) => ({
        usage_target_id: site.usageTargetId,
        source_mall_names: site.sourceMallNames,
        order_count: site.orderCount,
        source_row_count: site.sourceRowCount,
        source_quantity: site.sourceQuantity,
        cj_order_row_count: site.cjOrderRowCount,
        cj_order_quantity: site.cjOrderQuantity,
        cj_gift_row_count: site.cjGiftRowCount,
        cj_gift_quantity: site.cjGiftQuantity,
      })),
    },
  )

  if (error) {
    throw new InvoiceWorkHistoryStoreError(
      errorMessage(error, '출고 작업 이력을 저장하지 못했습니다.'),
    )
  }

  const runId = data as string | null
  if (!runId) {
    throw new InvoiceWorkHistoryStoreError(
      '출고 작업 이력을 저장하지 못했습니다.',
    )
  }
  return runId
}
