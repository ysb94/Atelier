/**
 * 내품명 AI 검수 사례·저장 피드백 검증.
 * 실행: npm run verify:item-name-ai-review
 */
import {
  buildItemNameAiReviewRows,
  decideItemNameAiSaves,
  itemNameAiSaveFeedback,
  type ItemNameAiContext,
} from '@/lib/invoice/item-name-ai-review'
import type { InvoiceItemNameRule, StyleRef } from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function style(id: string, no: string, name: string): StyleRef {
  return { styleId: id, styleNo: no, name }
}

const main = style('main', 'M0001', '가방')
const charm = style('charm', 'M2001', '키링')

const context: ItemNameAiContext = {
  contextId: 'ctx-1',
  groupKey: '키링',
  itemName: '키링',
  productLookupKey: '가방 블랙',
  mainStyle: main,
  productComponents: [],
  sourceProductName: '가방',
  productConnectionExcluded: false,
  rowCount: 1,
}

const rows = buildItemNameAiReviewRows({
  groups: [
    {
      key: '키링',
      itemName: '키링',
      rowCount: 1,
      contexts: [context],
    },
  ],
  decisions: [
    {
      contextId: 'ctx-1',
      action: 'components',
      components: [
        {
          styleId: charm.styleId,
          styleNo: charm.styleNo,
          name: charm.name,
          quantity: 1,
        },
      ],
      confidence: 0.93,
      reason: '확정 사례',
    },
  ],
  styles: [main, charm],
  itemNameRules: [] as InvoiceItemNameRule[],
  minConfidence: 0.72,
  recommendationMeta: {
    source: 'local',
    cacheId: 'cache-1',
    provider: 'openai',
    modelId: 'gpt',
  },
})
const row = rows[0]!
assert(row.source === 'local', '로컬 초안 출처를 남긴다')
assert(row.suggestedAction === 'components', '최초 제안을 보존한다')
assert(row.suggestedComponents[0]?.style.styleId === charm.styleId, '제안 구성품')

const edited = {
  ...row,
  action: 'delete' as const,
  components: [],
}
const feedback = itemNameAiSaveFeedback(edited)
assert(feedback.outcome === 'corrected', '구성품을 비우면 corrected')
assert(feedback.suggestedAction === 'components', '제안 action은 유지')

const plan = decideItemNameAiSaves([row], [row.key])
assert(plan.lookups[0]?.feedback.outcome === 'confirmed', '그대로 저장하면 confirmed')
assert(plan.lookups[0]?.feedback.source === 'local', '저장 피드백에 출처를 넣는다')

console.log('item-name-ai-review verify: ok')
