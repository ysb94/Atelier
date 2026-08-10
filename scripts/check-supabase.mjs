import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=')
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
    }),
)

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

const { data, error } = await supabase.auth.getSession()
if (error) {
  console.error('FAIL', error.message)
  process.exit(1)
}
console.log('OK url =', env.VITE_SUPABASE_URL)
console.log('OK session =', data.session === null ? 'null (비로그인, 정상)' : 'exists')
