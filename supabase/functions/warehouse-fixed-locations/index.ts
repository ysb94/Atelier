import { createClient } from 'npm:@supabase/supabase-js@2'
import { releaseHref } from '../../../src/lib/company/release-access.ts'
import { corsHeaders } from '../_shared/cors.ts'

const BRAND_ID = 'b0000000-0000-4000-8000-000000000001'
const SPREADSHEET_ID = '1kkAtKT5tEjjatibloT36MTxIaXkUfIW32GJn1Nx_R_8'
const RANGE = "'1+1 이름변경'!G2:H"
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const encoder = new TextEncoder()

function json(status: number, payload: unknown) {
  return Response.json(payload, {
    status,
    headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
  })
}

function base64Url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function requestGoogleToken(credentials: string) {
  const account = JSON.parse(credentials) as { client_email: string; private_key: string }
  const pem = account.private_key.replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '')
  const key = await crypto.subtle.importKey(
    'pkcs8', Uint8Array.from(atob(pem), (character) => character.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claim = base64Url(encoder.encode(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })))
  const unsigned = `${header}.${claim}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned))
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) return { token: null, status: response.status }
  const { access_token } = await response.json()
  return { token: typeof access_token === 'string' ? access_token : null, status: response.status }
}

async function readSheet(token: string) {
  const query = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' })
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(RANGE)}?${query}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    console.warn('[warehouse-fixed-locations] Google Sheets read failed', { status: response.status })
    const accessError = [401, 403, 404].includes(response.status)
    return json(502, { code: accessError ? 'google_access' : 'unavailable' })
  }
  const { values = [] } = await response.json() as { values?: string[][] }
  const rows = values.flatMap(([productName = '', location = ''], index) =>
    productName.trim() || location.trim() ? [{ sheetRow: index + 2, productName, location }] : [],
  )
  return json(200, { rows })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { code: 'method_not_allowed' })

  const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1]
  if (!token) return json(401, { code: 'sign_in_required' })
  const input = await request.json().catch(() => null) as { brandId?: string } | null
  if (input?.brandId !== BRAND_ID) return json(403, { code: 'forbidden' })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError && authError.status && authError.status >= 500) {
      console.warn('[warehouse-fixed-locations] Login verification failed', { status: authError.status })
      return json(503, { code: 'unavailable' })
    }
    if (!user) return json(401, { code: 'sign_in_required' })
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('id, status, company_id, department_id, email').eq('id', user.id).maybeSingle()
    if (profileError) {
      console.warn('[warehouse-fixed-locations] Profile read failed', { code: profileError.code })
      return json(503, { code: 'unavailable' })
    }
    if (!profile || !releaseHref({
      id: profile.id,
      status: profile.status,
      companyId: profile.company_id,
      departmentId: profile.department_id,
      email: profile.email,
    }, '/logistics/warehouses')) return json(403, { code: 'forbidden' })

    // Read using the caller's Atelier permissions before using the Google credential.
    const { data: brand, error: brandError } = await supabase
      .from('brands').select('id').eq('id', BRAND_ID).eq('company_id', profile.company_id).maybeSingle()
    if (brandError) {
      console.warn('[warehouse-fixed-locations] Brand permission check failed', { code: brandError.code })
      return json(503, { code: 'unavailable' })
    }
    if (!brand) return json(403, { code: 'forbidden' })

    const credentials = Deno.env.get('WAREHOUSE_FIXED_SHEETS_SERVICE_ACCOUNT')
    if (!credentials) return json(503, { code: 'not_configured' })
    const google = await requestGoogleToken(credentials)
    if (!google.token) {
      console.warn('[warehouse-fixed-locations] Google authorization failed', { status: google.status })
      return json(502, { code: google.status < 500 && google.status !== 429 ? 'google_access' : 'unavailable' })
    }
    return await readSheet(google.token)
  } catch (error) {
    console.warn('[warehouse-fixed-locations] Read failed', {
      timeout: error instanceof DOMException && error.name === 'TimeoutError',
    })
    return json(502, { code: 'unavailable' })
  }
})
