import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const NUMBER_RE = /^M\d{4,}$/i
const DATE_RE = /^\d{6}$/
const MAX_IMAGE_CHARS = 8_000_000

function normalizeNumber(value: unknown) {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return ''
  if (raw.startsWith('M')) return `M${raw.slice(1).replace(/\D/g, '')}`
  return `M${raw.replace(/\D/g, '')}`
}

function normalizeLabelDate(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length === 6 ? digits : ''
}

function normalizeQuantity(value: unknown) {
  if (value == null || value === '') return null
  const num = Number(String(value).replace(/[^\d]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num)
}

function parseJsonFromModel(text: string) {
  const trimmed = String(text || '').trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  return JSON.parse(candidate)
}

function validateExtractedPayload(payload: Record<string, unknown>) {
  const number = normalizeNumber(payload?.number)
  const productName = String(payload?.product_name ?? payload?.productName ?? '').trim()
  const labelDate = normalizeLabelDate(payload?.date ?? payload?.labelDate)
  const quantityPerBox = normalizeQuantity(
    payload?.quantity_per_box ?? payload?.quantityPerBox,
  )
  const confidenceRaw = String(payload?.confidence || 'medium').toLowerCase()
  const confidence = ['high', 'medium', 'low'].includes(confidenceRaw)
    ? confidenceRaw
    : 'medium'
  const fieldErrors: Record<string, string> = {}
  if (!number || !NUMBER_RE.test(number)) fieldErrors.number = 'invalid'
  if (!productName) fieldErrors.productName = 'invalid'
  if (!labelDate || !DATE_RE.test(labelDate)) fieldErrors.labelDate = 'invalid'
  if (quantityPerBox == null) fieldErrors.quantityPerBox = 'invalid'
  return {
    number,
    product_name: productName,
    date: labelDate,
    quantity_per_box: quantityPerBox,
    confidence,
    fieldErrors,
    needsReview: confidence !== 'high' || Object.keys(fieldErrors).length > 0,
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { error: '로그인이 필요합니다.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const admin = createClient(supabaseUrl, serviceKey)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    return json(401, { error: '로그인이 필요합니다.' })
  }

  let payload: { imageBase64?: string; mimeType?: string; brandId?: string }
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: 'JSON 본문이 필요합니다.' })
  }

  const brandId = String(payload.brandId || '').trim()
  const imageBase64 = String(payload.imageBase64 || '').replace(/^data:[^;]+;base64,/, '')
  const mimeType = String(payload.mimeType || 'image/jpeg').trim()
  if (!brandId) return json(400, { error: '브랜드를 지정하세요.' })
  if (!imageBase64) return json(400, { error: 'imageBase64가 필요합니다.' })
  if (imageBase64.length > MAX_IMAGE_CHARS) {
    return json(400, { error: '이미지 용량은 10MB 이하여야 합니다.' })
  }

  const { data: allowed, error: allowedError } = await supabase.rpc(
    'claim_masma_finder_session',
    { p_brand_id: brandId },
  )
  if (allowedError) {
    return json(403, { error: 'Finder 세션을 확인할 수 없습니다.' })
  }
  if (allowed?.status !== 'active') {
    return json(403, { error: 'Masma Finder 접근 권한이 없습니다.' })
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    return json(500, { error: 'GEMINI_API_KEY가 설정되지 않았습니다.' })
  }

  const prompt = `You are extracting structured data from a logistics box label photo.
Return JSON only with these keys:
- number: M followed by digits (example: M0536)
- product_name: full Korean product name including brackets if present
- date: YYMMDD digits only (example: 260630)
- quantity_per_box: integer count per box (example: 56)
- confidence: high, medium, or low

If a field is unclear, still provide your best guess and lower confidence.`

  let parsed: Record<string, unknown>
  try {
    const result = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inlineData: { mimeType, data: imageBase64 } },
              ],
            },
          ],
        }),
      },
    )
    if (!result.ok) {
      const text = await result.text()
      console.error('[extract-label-from-image] Gemini 실패', text)
      return json(502, { error: '라벨 추출에 실패했습니다.' })
    }
    const body = await result.json()
    const text = body?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || ''
    parsed = parseJsonFromModel(text)
  } catch (error) {
    console.error('[extract-label-from-image] 파싱 실패', error)
    return json(502, { error: '라벨 추출에 실패했습니다.' })
  }

  const { error: usageError } = await admin.from('masma_finder_ocr_usage').insert({
    brand_id: brandId,
    finder_user_id: allowed?.id || null,
    source: 'extract-label-from-image',
    byte_size: Math.ceil((imageBase64.length * 3) / 4),
  })
  if (usageError) {
    console.warn('[extract-label-from-image] 사용량 기록 실패', usageError)
  }

  return json(200, validateExtractedPayload(parsed))
})
