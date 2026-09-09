import { createClient } from 'npm:@supabase/supabase-js@2'
import {
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
    validateOnly?: boolean
    sourceFileName?: string
    brandSlug?: string
    rows?: unknown
  }
  try {
    payload = JSON.parse(rawBody) as typeof payload
  } catch {
    return json({ ok: false, error: 'JSON 본문이 올바르지 않습니다.' }, 400)
  }

  const brandSlug = String(payload.brandSlug ?? WAREHOUSE_SHEET_SYNC_BRAND_SLUG)
    .trim()
    .toLowerCase()
  if (brandSlug !== WAREHOUSE_SHEET_SYNC_BRAND_SLUG) {
    return json({ ok: false, error: 'Masmarulez 창고만 동기화할 수 있습니다.' }, 403)
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

  const styles = (
    await listAll<{ id: string; style_no: string; name: string }>((from, to) =>
      supabase
        .from('styles')
        .select('id, style_no, name')
        .eq('brand_id', brand.id)
        .range(from, to),
    )
  ).map(
    (row): StyleRef => ({
      styleId: row.id,
      styleNo: row.style_no,
      name: row.name,
    }),
  )

  const prepared = prepareWarehouseSheetSyncRows(
    validated.rows,
    styles,
    pickingCodes,
  )
  const summary = summarizeWarehouseSheetSync(prepared)
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
    'replace_warehouse_inventory_snapshot',
    {
      p_brand_id: brand.id,
      p_source_file_name: sourceFileName,
      p_rows: toWarehouseSnapshotRpcRows(prepared),
    },
  )
  if (error || !set) {
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
