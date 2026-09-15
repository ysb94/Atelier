// Read-only provider model checks. Does not generate paid images or print credentials.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('#')).map((line) => { const at = line.indexOf('='); return [line.slice(0, at).trim(), line.slice(at + 1).trim()] }))
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const { error: signInError } = await client.auth.signInWithPassword({ email: env.VITE_DEV_LOGIN_EMAIL, password: env.VITE_DEV_LOGIN_PASSWORD })
if (signInError) throw new Error('개발 계정 로그인 실패: ' + signInError.message)
const { data, error } = await client.functions.invoke('styled-image', { body: { action: 'models' } })
if (error) {
  if (error.context instanceof Response) console.error(await error.context.text())
  throw new Error('이미지 모델 조회 실패: ' + error.message)
}
console.log(JSON.stringify(data, null, 2))
if (!data?.ok || !data.models?.length) throw new Error('모델 응답이 없습니다.')
const anonymous = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
const denied = await anonymous.functions.invoke('styled-image', { body: { action: 'models' } })
if (!denied.error) throw new Error('비로그인 요청이 차단되지 않았습니다.')
console.log('Unauthenticated access rejected.')
await client.auth.signOut({ scope: 'local' })
