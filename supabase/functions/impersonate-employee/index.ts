import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Operator = { id: string }
type Subject = {
  id: string
  email?: string | null
  display_name?: string | null
  job_position?: string | null
  department_name?: string | null
  company_id?: string | null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}

function adminClient(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // getUser(jwt)·admin.signOut(jwt)의 직원 JWT를 SDK가 그대로 전송하게 한다.
    // 모든 요청의 Authorization을 service role로 덮으면 전환 세션을 폐기할 수 없다.
  })
}

function personName(value: string | null | undefined) {
  return value?.trim() || '이름 없음'
}

/**
 * 개발자와 대표이사만 재직 직원 세션을 연다.
 * generateLink는 링크만 만들고 메일을 보내지 않는다.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST만 지원합니다.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !serviceKey || !anonKey) {
    return json({ ok: false, error: '계정 전환에 필요한 환경변수가 없습니다.' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ ok: false, error: '로그인이 필요합니다.' }, 401)

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = authHeader.slice(7).trim()
  const { data: userData, error: userError } = await userClient.auth.getUser(token)
  if (userError || !userData.user) return json({ ok: false, error: '로그인이 필요합니다.' }, 401)

  const admin = adminClient(url, serviceKey)
  const operator = await loadOperator(admin, userData.user.id)
  if (operator instanceof Response) return operator

  let body: { action?: string; targetId?: string; employeeAccessToken?: string; eventId?: string }
  try {
    body = await req.json()
  } catch (error) {
    console.warn('[impersonation] 요청 본문 파싱 실패', { message: error instanceof Error ? error.message : 'unknown' })
    return json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  if (body.action === 'list') return listEmployees(admin, operator)
  if (body.action === 'start') return startSession(admin, operator, body.targetId, req.headers.get('user-agent'))
  if (body.action === 'stop') return stopSession(admin, operator, body.eventId, body.employeeAccessToken)
  return json({ ok: false, error: '지원하지 않는 요청입니다.' }, 400)
})

async function loadOperator(admin: SupabaseClient, userId: string): Promise<Operator | Response> {
  const { data: allowed, error } = await admin
    .from('impersonation_operators')
    .select('profile_id')
    .eq('profile_id', userId)
    .maybeSingle()
  if (error || !allowed) {
    console.warn('[impersonation] 운영자 확인 실패', { message: error?.message ?? null })
    return json({ ok: false, error: '직원 계정을 전환할 수 없습니다.' }, 403)
  }
  return { id: userId }
}

async function subjects(admin: SupabaseClient, operatorId: string, targetId: string | null) {
  const { data, error } = await admin.rpc('impersonation_subject', {
    p_operator_id: operatorId,
    p_target_id: targetId,
  })
  if (error) {
    console.warn('[impersonation] 직원 조회 실패', { message: error.message })
    return { rows: [] as Subject[], error: true }
  }
  return { rows: (data ?? []) as Subject[], error: false }
}

async function listEmployees(admin: SupabaseClient, operator: Operator) {
  const { rows, error } = await subjects(admin, operator.id, null)
  if (error) return json({ ok: false, error: '직원 목록을 불러오지 못했습니다.' }, 500)
  return json({
    ok: true,
    targets: rows.map((row) => ({
      id: row.id,
      name: personName(row.display_name),
      department: row.department_name?.trim() || null,
      position: row.job_position?.trim() || null,
    })),
  })
}

async function startSession(admin: SupabaseClient, operator: Operator, targetId: string | undefined, userAgentHeader: string | null) {
  if (!targetId || !UUID.test(targetId)) return json({ ok: false, error: '직원을 선택해 주세요.' }, 400)
  const { rows, error } = await subjects(admin, operator.id, targetId)
  const target = rows[0]
  if (error) return json({ ok: false, error: '직원 정보를 확인하지 못했습니다.' }, 500)
  if (!target?.company_id) return json({ ok: false, error: '같은 회사의 재직 직원만 선택할 수 있습니다.' }, 404)
  const profileEmail = target.email?.trim() ?? ''
  if (!profileEmail) return json({ ok: false, error: '이 직원 계정에는 이메일이 없습니다.' }, 404)

  const { data: authLookup, error: authLookupError } = await admin.auth.admin.getUserById(target.id)
  const authEmail = authLookup.user?.email?.trim() ?? ''
  if (authLookupError || !authEmail) {
    console.warn('[impersonation] 로그인 계정 조회 실패', { targetId: target.id, message: authLookupError?.message })
    return json({ ok: false, error: '이 직원의 로그인 계정을 찾지 못했습니다.' }, 404)
  }
  if (authEmail.toLowerCase() !== profileEmail.toLowerCase()) {
    return json({ ok: false, error: '직원 정보와 로그인 이메일이 달라 전환하지 않았습니다.' }, 409)
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: authEmail,
  })
  const properties = link?.properties as { hashed_token?: string; hashedToken?: string } | undefined
  const tokenHash = properties?.hashed_token || properties?.hashedToken || ''
  if (linkError || !tokenHash) {
    console.warn('[impersonation] 세션 링크 생성 실패', { targetId: target.id, message: linkError?.message })
    return json({ ok: false, error: '로그인 세션을 만들지 못했습니다.' }, 500)
  }

  const userAgent = userAgentHeader?.trim().replaceAll('  ', ' ').slice(0, 300) || null
  const { data: event, error: eventError } = await admin
    .from('impersonation_events')
    .insert({
      company_id: target.company_id,
      operator_id: operator.id,
      target_id: target.id,
      user_agent: userAgent,
    })
    .select('id')
    .single()
  if (eventError || !event) {
    console.warn('[impersonation] 전환 기록 실패', { targetId: target.id, message: eventError?.message })
    return json({ ok: false, error: '전환 기록을 남기지 못했습니다.' }, 500)
  }

  return json({
    ok: true,
    tokenHash,
    verificationType: 'magiclink',
    eventId: event.id,
    target: {
      id: target.id,
      name: personName(target.display_name),
      department: target.department_name?.trim() || null,
      position: target.job_position?.trim() || null,
    },
  })
}

async function stopSession(admin: SupabaseClient, operator: Operator, eventId: string | undefined, employeeAccessToken: string | undefined) {
  if (!eventId || !UUID.test(eventId)) return json({ ok: false, error: '전환 기록이 없습니다.' }, 400)
  const { data, error } = await admin
    .from('impersonation_events')
    .select('id, target_id, ended_at')
    .eq('id', eventId)
    .eq('operator_id', operator.id)
    .maybeSingle()
  const event = data as { id: string; target_id: string; ended_at: string | null } | null
  if (error || !event) return json({ ok: false, error: '전환 기록을 찾지 못했습니다.' }, 404)
  if (event.ended_at) return json({ ok: true, revoked: false })

  let revoked = false
  const employeeToken = employeeAccessToken?.trim() ?? ''
  if (employeeToken) {
    const { data: employeeData } = await admin.auth.getUser(employeeToken)
    const employeeId = employeeData.user?.id
    if (employeeId && employeeId === event.target_id && employeeId !== operator.id) {
      const { error: signOutError } = await admin.auth.admin.signOut(employeeToken, 'local')
      if (signOutError) {
        console.warn('[impersonation] 직원 세션 폐기 실패', { eventId, message: signOutError.message })
      } else {
        revoked = true
      }
    }
  }

  const { error: updateError } = await admin
    .from('impersonation_events')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', event.id)
    .is('ended_at', null)
  if (updateError) {
    console.warn('[impersonation] 종료 시각 기록 실패', { eventId, message: updateError.message })
    return json({ ok: false, error: '전환 종료를 기록하지 못했습니다.' }, 500)
  }
  return json({ ok: true, revoked })
}
