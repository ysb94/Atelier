import { randomUUID } from 'node:crypto'
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
const itemName = `__AI_CACHE_FK_VERIFY__${Date.now()}`
const staleCacheId = randomUUID()
let ruleId = null
let feedbackId = null
let verificationError = null

try {
  const { data: savedRuleId, error: saveError } = await supabase.rpc(
    'save_invoice_item_name_rule_with_feedback',
    {
      p_brand_id: brandId,
      p_row: {
        scope: 'global',
        main_style_id: null,
        item_name: itemName,
        product_lookup_key: '',
        action: 'delete',
        is_active: true,
        note: 'AI cache FK verification; remove immediately',
        components: [],
      },
      p_rule_id: null,
      p_feedback: {
        source: 'ai',
        cache_id: staleCacheId,
        provider: 'openai',
        model_id: 'verification-only',
        suggested_action: 'delete',
        suggested_components: [],
        outcome: 'confirmed',
      },
    },
  )
  if (saveError || !savedRuleId) {
    throw saveError ?? new Error('검증용 내품명 규칙이 저장되지 않았습니다.')
  }
  ruleId = String(savedRuleId)

  const { data: feedback, error: feedbackError } = await supabase
    .from('ai_item_name_recommendation_feedback')
    .select('id, cache_id')
    .eq('brand_id', brandId)
    .eq('rule_id', ruleId)
    .single()
  if (feedbackError || !feedback) {
    throw feedbackError ?? new Error('검증용 피드백이 저장되지 않았습니다.')
  }
  feedbackId = feedback.id
  if (feedback.cache_id !== staleCacheId) {
    throw new Error('사라진 캐시 ID가 피드백 추적값으로 보존되지 않았습니다.')
  }
} catch (error) {
  verificationError = error
} finally {
  if (feedbackId) {
    const { error } = await supabase
      .from('ai_item_name_recommendation_feedback')
      .delete()
      .eq('id', feedbackId)
    if (error && !verificationError) verificationError = error
  }
  if (ruleId) {
    const { error } = await supabase
      .from('invoice_item_name_rules')
      .delete()
      .eq('id', ruleId)
    if (error && !verificationError) verificationError = error
  }
}

if (verificationError) throw verificationError

console.log(
  JSON.stringify({
    ok: true,
    staleCacheAccepted: true,
    cleanup: true,
  }),
)
