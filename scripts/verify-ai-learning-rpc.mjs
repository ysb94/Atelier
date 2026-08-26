// ai_learning_v2 마이그레이션 적용 후 실행하는 읽기 전용 RPC 통합 검증.
// 운영 데이터를 바꾸지 않는다. 적용 전에는 실패가 정상이다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(import.meta.dirname, '..')

const env = Object.fromEntries(
  readFileSync(path.join(root, '.env.local'), 'utf8')
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

if (!env.VITE_DEV_LOGIN_EMAIL || !env.VITE_DEV_LOGIN_PASSWORD) {
  console.error('VITE_DEV_LOGIN_EMAIL/PASSWORD가 없어 RPC 검증을 못 합니다.')
  process.exit(1)
}
{
  const { error } = await supabase.auth.signInWithPassword({
    email: env.VITE_DEV_LOGIN_EMAIL,
    password: env.VITE_DEV_LOGIN_PASSWORD,
  })
  if (error) {
    console.error(`dev login failed: ${error.message}`)
    process.exit(1)
  }
}

const { data: brands, error: brandError } = await supabase
  .from('brands')
  .select('id, name')
  .limit(1)
if (brandError || !brands?.length) {
  console.error(`브랜드 조회 실패: ${brandError?.message ?? '브랜드 없음'}`)
  process.exit(1)
}
const brandId = brands[0].id

const results = []
async function check(name, run) {
  try {
    await run()
    results.push({ name, ok: true })
  } catch (cause) {
    results.push({ name, ok: false, error: String(cause?.message ?? cause) })
  }
}

await check('ai_feature_routes에 learning_mode·monthly_budget_usd 존재', async () => {
  const { data, error } = await supabase
    .from('ai_feature_routes')
    .select('feature_key, learning_mode, monthly_budget_usd')
    .eq('brand_id', brandId)
  if (error) throw new Error(error.message)
  const keys = new Set((data ?? []).map((row) => row.feature_key))
  if (!keys.has('invoice_item_name_recommendation')) {
    throw new Error('invoice_item_name_recommendation 라우트가 없습니다.')
  }
})

await check('ai_recommendation_feedback 신규 컬럼', async () => {
  const { error } = await supabase
    .from('ai_recommendation_feedback')
    .select('id, map_id, suggested_style_id, outcome, invalidated_at')
    .eq('brand_id', brandId)
    .limit(1)
  if (error) throw new Error(error.message)
})

await check('ai_item_name_recommendation_feedback 조회', async () => {
  const { error } = await supabase
    .from('ai_item_name_recommendation_feedback')
    .select('id, outcome, source')
    .eq('brand_id', brandId)
    .limit(1)
  if (error) throw new Error(error.message)
})

await check('ai_model_pricing 조회', async () => {
  const { data, error } = await supabase
    .from('ai_model_pricing')
    .select('provider, model_id_prefix, input_usd_per_1m, output_usd_per_1m')
    .limit(5)
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('가격표 시드가 비어 있습니다.')
})

await check('estimate_ai_usage_cost RPC', async () => {
  const { data, error } = await supabase.rpc('estimate_ai_usage_cost', {
    p_provider: 'openai',
    p_model_id: 'gpt-4.1-mini',
    p_input_tokens: 1000,
    p_output_tokens: 1000,
  })
  if (error) throw new Error(error.message)
  if (!Array.isArray(data) || !data.length) {
    throw new Error('가격 추정 결과가 없습니다.')
  }
})

await check('search_invoice_product_candidates RPC(피드백 반영판)', async () => {
  const { error } = await supabase.rpc('search_invoice_product_candidates', {
    p_brand_id: brandId,
    p_texts: ['검증용 테스트 문자열'],
    p_limit: 5,
  })
  if (error) throw new Error(error.message)
})

await check('search_invoice_item_name_cases RPC', async () => {
  const { error } = await supabase.rpc('search_invoice_item_name_cases', {
    p_brand_id: brandId,
    p_contexts: [
      { contextId: 'verify', itemName: '검증용', productLookupKey: '' },
    ],
    p_limit: 3,
  })
  if (error) throw new Error(error.message)
})

const failed = results.filter((row) => !row.ok)
for (const row of results) {
  console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.ok ? '' : ` — ${row.error}`}`)
}
if (failed.length) {
  console.error(`\n${failed.length}개 검증 실패. 마이그레이션 적용 여부를 확인하세요.`)
  process.exit(1)
}
console.log('\nRPC 통합 검증 통과')
