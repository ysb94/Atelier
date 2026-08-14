/**
 * 확정 원장 패턴을 재생해 hybrid_auto 임계값과 호출률을 확인한다.
 * 실행: npm run verify:ai-hybrid-replay
 */
import {
  evaluateHybridDecision,
  summarizeHybridReplay,
  tuneDecisionConfig,
  type ProductCandidate,
} from '@/lib/ai/gateway-core'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function candidate(
  source: ProductCandidate['source'],
  styleId: string,
  score: number,
  extras: Partial<ProductCandidate> = {},
): ProductCandidate {
  return {
    source,
    lookupKey: extras.lookupKey ?? styleId,
    styleId,
    styleNo: extras.styleNo ?? styleId,
    name: extras.name ?? styleId,
    score,
  }
}

const samples = [
  {
    styleId: 'exact-1',
    candidates: [
      candidate('ledger_exact', 'exact-1', 1),
      candidate('style_name', 'near-1', 0.38),
    ],
  },
  {
    styleId: 'hist-1',
    candidates: [candidate('history', 'hist-1', 0.95)],
  },
  {
    styleId: 'strong-1',
    candidates: [
      candidate('lookup_key', 'strong-1', 0.84),
      candidate('style_name', 'strong-2', 0.41),
    ],
  },
  {
    styleId: 'strong-3',
    candidates: [
      candidate('lookup_key', 'strong-3', 0.78),
      candidate('lookup_key', 'strong-4', 0.52),
    ],
  },
  {
    styleId: 'amb-1',
    candidates: [
      candidate('lookup_key', 'amb-1', 0.55),
      candidate('lookup_key', 'amb-2', 0.53),
      candidate('style_name', 'amb-3', 0.44),
    ],
  },
  {
    styleId: 'amb-4',
    candidates: [
      candidate('style_name', 'amb-4', 0.61),
      candidate('style_name', 'amb-5', 0.58),
    ],
  },
  {
    styleId: 'weak-1',
    candidates: [candidate('style_name', 'weak-1', 0.22)],
  },
  {
    styleId: 'none',
    candidates: [],
  },
]

const tuned = tuneDecisionConfig(samples.filter((sample) => sample.styleId !== 'none'))
const summary = summarizeHybridReplay(samples, tuned)

assert(tuned.aiTopN === 6, 'AI 후보는 상위 6개')
assert(summary.localPrecision >= 0.95, '로컬 추천 정밀도는 95% 이상')
assert(summary.aiCalls === 2, '애매한 2건만 AI를 부른다')
assert(summary.manual === 2, '후보 없음·저신뢰 1개는 수동')
assert(
  evaluateHybridDecision(samples[4]!.candidates, tuned).aiCandidates.length <= 6,
  'AI 입력은 상위 6개로 자른다',
)

console.log(
  JSON.stringify(
    {
      decisionConfig: tuned,
      localPrecision: Number(summary.localPrecision.toFixed(3)),
      aiCallRate: Number(summary.aiCallRate.toFixed(3)),
      local: summary.local,
      localCorrect: summary.localCorrect,
      aiCalls: summary.aiCalls,
      manual: summary.manual,
      total: summary.total,
    },
    null,
    2,
  ),
)
console.log('ai-hybrid-replay verify: ok')
