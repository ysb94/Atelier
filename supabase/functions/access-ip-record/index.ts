import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
import { createAccessIpHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('apikey', serviceKey)
    headers.set('Authorization', `Bearer ${serviceKey}`)
    return fetch(input, { ...init, headers })
  } },
})

Deno.serve(createAccessIpHandler({
  async authenticate(token) {
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser(token)
    if (error || !data.user) return null
    // getUser로 검증이 끝난 JWT의 세션 ID만 중복 방지에 사용한다. 사용자 메타데이터는 권한에 쓰지 않는다.
    const claims = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')))
    const { data: profile, error: profileError } = await userClient.from('profiles')
      .select('company_id,display_name').eq('id', data.user.id).maybeSingle()
    if (profileError) throw new Error(`기록용 이름 조회 실패 (${profileError.code})`)
    return { id: data.user.id, sessionId: claims.session_id ?? '', companyId: profile?.company_id ?? null,
      name: profile?.display_name?.trim() || data.user.email || '이름 미등록' }
  },
  async save(event) {
    const { error } = await admin.from('access_ip_events')
      .upsert(event, { onConflict: 'user_id,event_kind,event_key', ignoreDuplicates: true })
    if (error) throw new Error(`기록 저장 실패 (${error.code})`)
  },
}))
