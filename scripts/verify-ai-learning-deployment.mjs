// 운영 배포 후 ai-gateway → item-name route → usage log 연동을 확인한다.
// 규칙·피드백·원장은 쓰지 않고 테스트용 캐시와 사용량 로그만 1건 남긴다.
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

const { error: signInError } = await supabase.auth.signInWithPassword({
  email: env.VITE_DEV_LOGIN_EMAIL,
  password: env.VITE_DEV_LOGIN_PASSWORD,
})
if (signInError) throw signInError

const { data: brands, error: brandError } = await supabase
  .from('brands')
  .select('id')
  .limit(1)
if (brandError) throw brandError
if (!brands?.[0]?.id) throw new Error('검증할 브랜드가 없습니다.')

const brandId = brands[0].id
const startedAt = new Date().toISOString()
const contextId = `deployment-smoke-${Date.now()}`

const { data: gateway, error: gatewayError } = await supabase.functions.invoke(
  'ai-gateway',
  {
    body: {
      action: 'recommend_accessory_rules',
      mode: 'item_name',
      brandId,
      featureKey: 'invoice_item_name_recommendation',
      unknownPiece: '',
      contexts: [
        {
          contextId,
          itemName: '배포 검증용 선택값',
          productLookupKey: '배포 검증',
          mainProduct: 'M-VERIFY',
          candidateStyleIds: [],
          priorExamples: [
            {
              itemName: '검증용 선택값',
              productLookupKey: '검증',
              action: 'delete',
              components: [],
            },
          ],
        },
      ],
      candidates: [],
    },
  },
)
if (gatewayError) throw gatewayError
if (!gateway?.ok) {
  throw new Error(gateway?.error ?? 'ai-gateway 응답이 실패했습니다.')
}

const decision = gateway.recommendation?.contexts?.find(
  (row) => row.contextId === contextId,
)
if (!decision || !['delete', 'hold'].includes(decision.action)) {
  throw new Error('후보 없는 내품명 문맥의 안전한 결정(delete/hold)을 받지 못했습니다.')
}

const { data: logs, error: logError } = await supabase
  .from('ai_usage_logs')
  .select(
    'feature_key, action, provider, model_id, status, input_tokens, output_tokens, estimated_cost_usd, pricing_version',
  )
  .eq('brand_id', brandId)
  .eq('feature_key', 'invoice_item_name_recommendation')
  .eq('action', 'recommend_item_name_rules')
  .gte('created_at', startedAt)
  .order('created_at', { ascending: false })
  .limit(1)
if (logError) throw logError

const log = logs?.[0]
if (!log || log.status !== 'ok') {
  throw new Error('내품명 추천 사용량 로그가 기록되지 않았습니다.')
}
if (log.estimated_cost_usd == null || !log.pricing_version) {
  throw new Error('토큰 비용 또는 가격 버전이 기록되지 않았습니다.')
}

console.log(
  JSON.stringify(
    {
      ok: true,
      gateway: {
        provider: gateway.provider,
        modelId: gateway.modelId,
        source: gateway.source,
        decision: decision.action,
      },
      usage: log,
    },
    null,
    2,
  ),
)
