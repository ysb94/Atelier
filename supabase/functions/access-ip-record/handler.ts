type Actor = { id: string; sessionId: string; companyId: string | null; name: string }
export type AccessEvent = {
  user_id: string; company_id: string | null; person_name: string
  event_kind: 'login' | 'clock_in_request'; event_key: string
  ip_address: string | null; ip_source: 'cf-connecting-ip' | 'unavailable'
}
type Dependencies = {
  authenticate: (token: string) => Promise<Actor | null>
  save: (event: AccessEvent) => Promise<void>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function recordingOrigin(origin: string) {
  return origin === 'https://test.atelier-6yy.pages.dev'
    || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
}

export function gatewayIp(headers: Headers): string | null {
  // Supabase의 Cloudflare 경유 원본 주소만 사용. 본문 IP·임의 X-Forwarded-For는 받지 않는다.
  const ip = headers.get('cf-connecting-ip')?.trim() ?? ''
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.split('.').every(part => Number(part) <= 255 && String(Number(part)) === part) ? ip : null
  }
  if (!ip.includes(':') || /[\s/%\[\]]/.test(ip)) return null
  try { return new URL(`http://[${ip}]/`).hostname.slice(1, -1) }
  catch { return null /* 유효하지 않은 외부 헤더는 주소 미확인으로 기록한다. */ }
}

export function createAccessIpHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin') ?? ''
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Origin': recordingOrigin(origin) ? origin : 'null',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
    if (!recordingOrigin(origin)) return json({ ok: false }, 403)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') return json({ ok: false }, 405)
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token) return json({ ok: false }, 401)
    try {
      const text = await req.text()
      if (text.length > 512) return json({ ok: false }, 413)
      let body: { kind?: string; requestId?: string }
      try { body = JSON.parse(text) }
      catch { return json({ ok: false }, 400) }
      if (!body || !['login', 'clock_in_request'].includes(body.kind ?? '')) return json({ ok: false }, 400)
      if (body.kind === 'clock_in_request' && !UUID.test(body.requestId ?? '')) return json({ ok: false }, 400)
      const actor = await deps.authenticate(token)
      if (!actor || !UUID.test(actor.sessionId)) return json({ ok: false }, 401)
      const ip = gatewayIp(req.headers)
      await deps.save({
        user_id: actor.id, company_id: actor.companyId, person_name: actor.name.slice(0, 150),
        event_kind: body.kind as AccessEvent['event_kind'],
        event_key: body.kind === 'login' ? actor.sessionId : body.requestId!,
        ip_address: ip, ip_source: ip ? 'cf-connecting-ip' : 'unavailable',
      })
      // 일반 직원에게 IP 목록이나 다른 직원 정보는 반환하지 않는다.
      return json({ ok: true })
    } catch (error) {
      console.warn('[access-ip] 기록 저장 실패', { message: error instanceof Error ? error.message : 'unknown' })
      return json({ ok: false }, 500)
    }
  }
}
