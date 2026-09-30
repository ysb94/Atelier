import { createClient } from 'npm:@supabase/supabase-js@2'

const headers = { 'Content-Type': 'application/json' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * 기한이 지난 채팅 파일만 지운다. 요청 본문은 읽지 않는다.
 * 호출한 사람이 누구든 같은 정리만 한다.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ ok: false, error: 'POST만 지원합니다.' }, 405)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    return json({ ok: false, error: '정리에 필요한 환경변수가 없습니다.' }, 500)
  }

  const supabase = createClient(url, serviceKey)
  const { data, error } = await supabase.rpc('cleanup_chat_files')
  if (error) return json({ ok: false, error: error.message }, 500)

  const paths = ((data ?? []) as { object_path: string | null }[])
    .map((row) => row.object_path)
    .filter((path): path is string => Boolean(path))

  let removed = 0
  for (let index = 0; index < paths.length; index += 100) {
    const chunk = paths.slice(index, index + 100)
    const { error: removeError } = await supabase.storage
      .from('company-chat')
      .remove(chunk)
    if (removeError) {
      return json(
        { ok: false, error: removeError.message, paths: paths.length, removed },
        500,
      )
    }
    removed += chunk.length
  }

  return json({ ok: true, paths: paths.length, removed })
})
