import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

type ServiceAccount = {
  client_email: string
  private_key: string
  project_id: string
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function buildProductCodeCandidates(value: string) {
  const normalized = String(value || '').trim()
  if (!normalized) return []
  const upper = normalized.toUpperCase()
  const candidates = new Set([normalized, upper])
  if (/^M\d+$/.test(upper)) candidates.add(upper.slice(1))
  else if (/^\d+$/.test(upper)) candidates.add(`M${upper}`)
  return Array.from(candidates)
}

function decodeBase64Url(input: string) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Uint8Array.from(atob(padded + pad), (char) => char.charCodeAt(0))
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function googleAccessToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000)
  const header = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
  )
  const claim = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    ),
  )
  const pem = account.private_key.replace(/\\n/g, '\n')
  const pemBody = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '')
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodeBase64Url(pemBody.replace(/\+/g, '-').replace(/\//g, '_')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claim}`),
  )
  const jwt = `${header}.${claim}.${encodeBase64Url(new Uint8Array(signature))}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!response.ok) {
    throw new Error(`Google token ${response.status}`)
  }
  const body = await response.json()
  return String(body.access_token || '')
}

function readOnhand(fields: Record<string, { integerValue?: string; doubleValue?: number; stringValue?: string }> | undefined) {
  const raw = fields?.onhand
  if (!raw) return { found: false, value: null as number | string | null }
  if (raw.integerValue != null) return { found: true, value: Number(raw.integerValue) }
  if (raw.doubleValue != null) return { found: true, value: raw.doubleValue }
  if (raw.stringValue != null && raw.stringValue.trim()) {
    return { found: true, value: raw.stringValue }
  }
  return { found: false, value: null }
}

async function firestoreGet(
  projectId: string,
  token: string,
  documentId: string,
) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products/${encodeURIComponent(documentId)}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Firestore get ${response.status}`)
  return await response.json()
}

async function firestoreQuery(
  projectId: string,
  token: string,
  field: string,
  value: string,
) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'products' }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: { stringValue: value },
          },
        },
        limit: 1,
      },
    }),
  })
  if (!response.ok) throw new Error(`Firestore query ${response.status}`)
  const rows = await response.json()
  return rows.find((row: { document?: unknown }) => row.document)?.document || null
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json(401, { error: '로그인이 필요합니다.' })

  let payload: {
    brandId?: string
    styleNo?: string
    productRef?: string
    productName?: string
  }
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: 'JSON 본문이 필요합니다.' })
  }

  const brandId = String(payload.brandId || '').trim()
  if (!brandId) return json(400, { error: '브랜드를 지정하세요.' })

  const { data: session, error: sessionError } = await supabase.rpc(
    'claim_masma_finder_session',
    { p_brand_id: brandId },
  )
  if (sessionError || session?.status !== 'active') {
    return json(403, { error: 'Masma Finder 접근 권한이 없습니다.' })
  }

  const rawAccount = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')
  if (!rawAccount) {
    return json(500, { error: 'Firebase 서비스 계정이 설정되지 않았습니다.' })
  }
  const account = JSON.parse(rawAccount) as ServiceAccount
  const token = await googleAccessToken(account)
  const styleNo = String(payload.styleNo || payload.productRef || '').trim()
  const productName = String(payload.productName || '').trim()
  const candidates = buildProductCodeCandidates(styleNo)

  if (styleNo) {
    const direct = await firestoreGet(account.project_id, token, styleNo)
    const directOnhand = readOnhand(direct?.fields)
    if (directOnhand.found) {
      return json(200, { styleNo, onhand: directOnhand.value })
    }
  }

  for (const code of candidates) {
    const doc = await firestoreQuery(account.project_id, token, 'china_code', code)
    const onhand = readOnhand(doc?.fields)
    if (onhand.found) {
      return json(200, { styleNo: code, onhand: onhand.value })
    }
  }

  if (productName) {
    const doc = await firestoreQuery(account.project_id, token, 'name', productName)
    const onhand = readOnhand(doc?.fields)
    if (onhand.found) {
      return json(200, { styleNo: styleNo || null, onhand: onhand.value })
    }
  }

  return json(200, { styleNo: styleNo || null, onhand: null })
})
