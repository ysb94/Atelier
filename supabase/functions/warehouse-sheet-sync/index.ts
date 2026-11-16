import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  isWarehouseNoStockMarker,
  normalizeStyleNo,
  prepareWarehouseSheetSyncRows,
  summarizeWarehouseSheetSync,
  toWarehouseSnapshotRpcRows,
  validateWarehouseSheetSyncPayload,
  WAREHOUSE_SHEET_SYNC_BRAND_SLUG,
  type StyleRef,
} from '../_shared/warehouse-sheet-sync.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-atelier-timestamp, x-atelier-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_SKEW_MS = 5 * 60 * 1000
const PAGE_SIZE = 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let out = 0
  for (let index = 0; index < left.length; index += 1) {
    out |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return out === 0
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  )
  return bytesToHex(signature)
}

async function listAll<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const all: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'POST만 지원합니다.' }, 405)
  }

  const secret = Deno.env.get('ATELIER_WAREHOUSE_SYNC_SECRET') ?? ''
  if (!secret) {
    return json({ ok: false, error: '동기화 비밀키가 없습니다.' }, 500)
  }

  const rawBody = await req.text()
  const timestamp = req.headers.get('x-atelier-timestamp') ?? ''
  const signature = (req.headers.get('x-atelier-signature') ?? '').toLowerCase()
  const sentAt = Number(timestamp)
  if (!timestamp || !Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_SKEW_MS) {
    return json({ ok: false, error: '요청 시각이 올바르지 않습니다.' }, 401)
  }
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`)
  if (!safeEqual(expected, signature)) {
    return json({ ok: false, error: '서명 검증에 실패했습니다.' }, 401)
  }

  let payload: {
    action?: 'list-models' | 'list-stock-conditions' | 'confirm-stock-conditions'
      | 'list-qr-audit-exports' | 'confirm-qr-audit-export'
      | 'claim-stock-sheet-jobs' | 'finish-stock-sheet-job' | 'fail-stock-sheet-job' | 'cleanup-stock-sheet-job'
    validateOnly?: boolean
    sourceFileName?: string
    brandSlug?: string
    rows?: unknown
    confirmed?: unknown
    snapshotAt?: number
  }
  try {
    payload = JSON.parse(rawBody) as typeof payload
  } catch {
    return json({ ok: false, error: 'JSON 본문이 올바르지 않습니다.' }, 400)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ ok: false, error: 'JSON 본문이 올바르지 않습니다.' }, 400)
  }
  const listModels = payload.action === 'list-models'
  const listConditions = payload.action === 'list-stock-conditions'
  const confirmConditions = payload.action === 'confirm-stock-conditions'
  const listAudits = payload.action === 'list-qr-audit-exports'
  const confirmAudit = payload.action === 'confirm-qr-audit-export'
  const claimJobs = payload.action === 'claim-stock-sheet-jobs'
  const finishJob = payload.action === 'finish-stock-sheet-job'
  const failJob = payload.action === 'fail-stock-sheet-job'
  const cleanupJob = payload.action === 'cleanup-stock-sheet-job'
  const snapshotAt = payload.snapshotAt ?? (
    payload.validateOnly === true || listModels || listConditions || confirmConditions || listAudits || confirmAudit
      || claimJobs || finishJob || failJob || cleanupJob
      ? sentAt : undefined
  )
  if (typeof snapshotAt !== 'number' || !Number.isSafeInteger(snapshotAt)
    || snapshotAt > sentAt || sentAt - snapshotAt > MAX_SKEW_MS) {
    return json({ ok: false, error: '시트 조회 시작 시각이 올바르지 않습니다. 시트를 새로 읽고 동기화해주세요.' }, 400)
  }

  const brandSlug = String(payload.brandSlug ?? WAREHOUSE_SHEET_SYNC_BRAND_SLUG)
    .trim()
    .toLowerCase()
  if (brandSlug !== WAREHOUSE_SHEET_SYNC_BRAND_SLUG) {
    return json({ ok: false, error: 'Masmarulez 창고만 동기화할 수 있습니다.' }, 403)
  }

  const serviceRoleKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
    Deno.env.get('SUPABASE_SECRET_KEY') ??
    ''
  if (!serviceRoleKey) {
    return json({ ok: false, error: '동기화 서버 키가 없습니다.' }, 500)
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('id, slug')
    .eq('id', 'b0000000-0000-4000-8000-000000000001')
    .maybeSingle()
  if (brandError || !brand) {
    return json(
      {
        ok: false,
        error: brandError?.message || 'Masmarulez 브랜드를 찾지 못했습니다.',
      },
      400,
    )
  }
  if (brand.slug !== WAREHOUSE_SHEET_SYNC_BRAND_SLUG) {
    return json({ ok: false, error: 'Masmarulez 창고만 동기화할 수 있습니다.' }, 403)
  }

  if (claimJobs || finishJob || failJob || cleanupJob) {
    if (payload.validateOnly) return json({ ok: false, error: '검증 요청에서는 시트 반영 상태를 변경할 수 없습니다.' }, 400)
    if (claimJobs) {
      const { data, error } = await supabase.rpc('claim_atelier_stock_sheet_jobs', { p_brand_id: brand.id })
      if (error || !data) {
        console.warn('[warehouse-sheet-sync] claim-stock-sheet-jobs', { code: error?.code })
        return json({ ok: false, error: 'STOCK_SHEET_CLAIM_FAILED' }, 500)
      }
      return json({ ok: true, ...data })
    }

    const proof = payload.confirmed as {
      id?: unknown; lease?: unknown; rows?: unknown; absent?: unknown; reason?: unknown; differences?: unknown
    } | null | undefined
    if (typeof proof?.id !== 'string' || !UUID.test(proof.id)) {
      return json({ ok: false, error: 'INVALID_STOCK_SHEET_JOB' }, 400)
    }
    if (cleanupJob) {
      const { data, error } = await supabase.rpc('release_atelier_stock_sheet_removal_markers', {
        p_brand_id: brand.id, p_job_id: proof.id,
      })
      if (error) console.warn('[warehouse-sheet-sync] cleanup-stock-sheet-job', { code: error.code })
      return error || data !== true ? json({ ok: false, error: 'STOCK_SHEET_CLEANUP_REJECTED' }, 409) : json({ ok: true })
    }
    if (typeof proof.lease !== 'string' || !UUID.test(proof.lease)) {
      return json({ ok: false, error: 'INVALID_STOCK_SHEET_JOB' }, 400)
    }
    const job = { p_brand_id: brand.id, p_job_id: proof.id, p_lease: proof.lease }
    if (finishJob) {
      if (!Array.isArray(proof.rows) || proof.rows.length > 8000
        || !Array.isArray(proof.absent) || proof.absent.length > 8000
        || !proof.absent.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) {
        return json({ ok: false, error: 'INVALID_STOCK_SHEET_PROOF' }, 400)
      }
      const { data, error } = await supabase.rpc('finish_atelier_stock_sheet_job', {
        ...job, p_rows: proof.rows, p_absent: proof.absent,
      })
      if (error) console.warn('[warehouse-sheet-sync] finish-stock-sheet-job', { code: error.code })
      return error || data !== true ? json({ ok: false, error: 'STOCK_SHEET_PROOF_REJECTED' }, 409) : json({ ok: true })
    }
    if (typeof proof.reason !== 'string' || !/^[A-Z_]{1,60}$/.test(proof.reason)
      || !Array.isArray(proof.differences) || proof.differences.length > 16) {
      return json({ ok: false, error: 'INVALID_STOCK_SHEET_FAILURE' }, 400)
    }
    const { data, error } = await supabase.rpc('fail_atelier_stock_sheet_job', {
      ...job, p_reason: proof.reason, p_differences: proof.differences,
    })
    if (error) console.warn('[warehouse-sheet-sync] fail-stock-sheet-job', { code: error.code })
    return error || data !== true ? json({ ok: false, error: 'STOCK_SHEET_FAILURE_REJECTED' }, 409) : json({ ok: true })
  }

  if (listConditions) {
    const { data, error } = await supabase.rpc('list_warehouse_stock_condition_exports', { p_brand_id: brand.id })
    return error ? json({ ok: false, error: '상태 반영 대기 목록을 읽지 못했습니다.' }, 500)
      : json({ ok: true, entries: data ?? [] })
  }
  if (listAudits) {
    const { data, error } = await supabase.rpc('list_warehouse_qr_audit_sheet_exports', { p_brand_id: brand.id })
    return error ? json({ ok: false, error: 'QR 실사 반영 대기 목록을 읽지 못했습니다.' }, 500)
      : json({ ok: true, entries: data ?? [] })
  }
  if (confirmAudit) {
    const observed = payload.confirmed as { id?: string; rows?: unknown[] } | null | undefined
    if (typeof observed?.id !== 'string' || !Array.isArray(observed.rows) || observed.rows.length > 2000) {
      return json({ ok: false, error: '실사 반영 확인 값이 올바르지 않습니다.' }, 400)
    }
    const { data, error } = await supabase.rpc('confirm_warehouse_qr_audit_sheet_export', {
      p_brand_id: brand.id, p_id: observed.id, p_rows: observed.rows,
    })
    return error || data !== true ? json({ ok: false, error: '창고입력에서 실사 결과를 확인하지 못했습니다.' }, 409)
      : json({ ok: true })
  }
  if (confirmConditions) {
    if (!Array.isArray(payload.confirmed) || payload.confirmed.length > 40) {
      return json({ ok: false, error: '상태 반영 확인 값이 올바르지 않습니다.' }, 400)
    }
    const { data, error } = await supabase.rpc('confirm_warehouse_stock_condition_exports', {
      p_brand_id: brand.id, p_confirmed: payload.confirmed,
    })
    return error ? json({ ok: false, error: '상태 반영 결과를 저장하지 못했습니다.' }, 500)
      : json({ ok: true, confirmed: data })
  }

  const loadStyles = () => listAll<{ id: string; style_no: string; name: string }>((from, to) =>
    supabase.from('styles').select('id, style_no, name').eq('brand_id', brand.id)
      .order('id').range(from, to),
  )

  if (listModels) {
    const styles = await loadStyles()
    const models = styles.map((row) => ({ number: normalizeStyleNo(row.style_no), productName: row.name.trim() }))
      .filter((row) => /^M[0-9]{4,}$/.test(row.number) && row.productName)
    return json({ ok: true, models })
  }

  const validated = validateWarehouseSheetSyncPayload(payload.rows)
  if (validated.issues.length > 0) {
    return json(
      {
        ok: false,
        error: validated.issues[0]?.message ?? '행 검증에 실패했습니다.',
        issues: validated.issues.slice(0, 20),
      },
      400,
    )
  }

  const { data: activeSet } = await supabase
    .from('warehouse_inventory_sets')
    .select('warehouse_id')
    .eq('brand_id', brand.id)
    .eq('kind', 'sandbox')
    .eq('status', 'active')
    .maybeSingle()

  const pickingCodes = activeSet?.warehouse_id
    ? (
        await listAll<{ code: string }>((from, to) =>
          supabase
            .from('warehouse_registered_slots')
            .select('code')
            .eq('warehouse_id', activeSet.warehouse_id)
            .eq('zone', 'picking')
            .range(from, to),
        )
      ).map((row) => row.code)
    : []

  const styles = (await loadStyles()).map(
    (row): StyleRef => ({
      styleId: row.id,
      styleNo: row.style_no,
      name: row.name,
    }),
  )

  const stockRows = validated.rows.filter((row) => !isWarehouseNoStockMarker(row))
  const prepared = prepareWarehouseSheetSyncRows(
    stockRows,
    styles,
    pickingCodes,
  )
  const summary = {
    ...summarizeWarehouseSheetSync(prepared),
    ignoredNoStockRows: validated.rows.length - stockRows.length,
  }
  const sourceFileName = String(
    payload.sourceFileName ?? '창고입력 시트 동기화',
  ).trim()

  if (payload.validateOnly) {
    return json({
      ok: true,
      validateOnly: true,
      ...summary,
    })
  }

  const { data: set, error } = await supabase.rpc(
    'replace_warehouse_inventory_snapshot_with_box_qr',
    {
      p_brand_id: brand.id,
      p_source_file_name: sourceFileName,
      p_rows: toWarehouseSnapshotRpcRows(prepared),
      p_snapshot_at: new Date(snapshotAt).toISOString(),
    },
  )
  if (error || !set) {
    if (error?.code && /^PWS0[1-7]$/.test(error.code)) {
      return json({ ok: false, code: error.code, error: error.message }, 409)
    }
    console.warn('[warehouse-sheet-sync] 전체 교체 실패', {
      message: error?.message,
      rowCount: prepared.length,
    })
    return json(
      {
        ok: false,
        error: error?.message ?? '창고 스냅샷을 교체하지 못했습니다.',
      },
      500,
    )
  }

  return json({
    ok: true,
    validateOnly: false,
    setId: (set as { id?: string }).id ?? null,
    ...summary,
  })
})
