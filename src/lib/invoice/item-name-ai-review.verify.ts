/**
 * 내품명 AI 검수 사례·저장 피드백 검증.
 * 실행: npm run verify:item-name-ai-review
 */
import {
  ITEM_NAME_AI_DELETE_LABEL,
  ITEM_NAME_AI_QUICK_SLOT_LIMIT,
  applyItemNameAiQuickSlotStyle,
  applyItemNameAiQuickSlotText,
  applyItemNameAiRowAction,
  appendItemNameAiComponent,
  buildItemNameAiReviewRows,
  commitReadyItemNameAiDrafts,
  countItemNameAiPendingResolve,
  decideItemNameAiEnterAction,
  decideItemNameAiSaves,
  dedupeItemNameAiContexts,
  emptyItemNameAiQuickSlot,
  formatItemNameAiStyleLabel,
  isItemNameAiAddExtraKey,
  itemNameAiDecisionKey,
  itemNameAiMatchesQueueFilter,
  itemNameAiQuickSlotInputValue,
  itemNameAiReviewKind,
  itemNameAiSaveFeedback,
  nextItemNameAiQuickFocus,
  nextItemNameAiReviewPage,
  nextItemNameAiRowMark,
  paginateItemNameAiReviewKeys,
  removeItemNameAiQuickSlot,
  reopenItemNameAiCommittedRow,
  revertItemNameAiAppendState,
  selectItemNameSafeCandidateIds,
  shouldIgnoreItemNameAiQuickKey,
  type ItemNameAiContext,
} from '@/lib/invoice/item-name-ai-review'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceItemNameRule, StyleRef } from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function style(id: string, no: string, name: string): StyleRef {
  return { styleId: id, styleNo: no, name }
}

assert(
  normalizeInvoiceText('마스마룰즈\u00A0\uFF3BSET\uFF3D 로고\u2014패치') ===
    '마스마룰즈 [set]로고-패치',
  '전각·NBSP·대시를 앱 검색 키로 맞춘다',
)
assert(
  normalizeInvoiceText('로고\u200B패치 볼캡') === '로고패치 볼캡',
  '제로폭 문자를 검색 키에서 뺀다',
)
assert(
  normalizeInvoiceText('크림\u2013레몬 / 네이비') === '크림-레몬 / 네이비',
  '대시 변형을 하이픈으로 맞춘다',
)
assert(
  normalizeInvoiceText('  Color:  Cream   lemon  ') === 'color: cream lemon',
  '공백 축약과 소문자화를 맞춘다',
)
assert(normalizeInvoiceText('') === '', '빈 문자열은 빈 키')

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

const rankedIds = Array.from({ length: 20 }, (_, index) => `s${index}`)
const safe = selectItemNameSafeCandidateIds(rankedIds, rankedIds, ['s0'])
assert(safe.usedSafeLimit, '상위 안전 후보를 쓴다')
assert(safe.ids[0] === 's0', '필수 후보를 앞에 둔다')
assert(safe.ids.length === 16, '안전 후보 상한')

const fallback = selectItemNameSafeCandidateIds(
  rankedIds,
  ['s0'],
  rankedIds,
)
assert(!fallback.usedSafeLimit, '필수 후보를 못 지키면 전체 범위로 되돌린다')
assert(fallback.ids.length === 20, '전체 후보를 유지한다')

const sameLookup = { ...context, contextId: 'ctx-same' }
const otherLookup = {
  ...context,
  contextId: 'ctx-other',
  productLookupKey: '가방 화이트',
}
assert(
  itemNameAiDecisionKey(context) === itemNameAiDecisionKey(sameLookup),
  '같은 조회 키는 같은 결정 키',
)
assert(
  itemNameAiDecisionKey(context) !== itemNameAiDecisionKey(otherLookup),
  '조회 키가 다르면 따로 판정한다',
)
const independent = dedupeItemNameAiContexts([context, otherLookup])
assert(
  independent.requests.length === 2 && independent.mirrors.size === 0,
  '다른 조회 키는 각각 AI에 묻는다',
)
const merged = dedupeItemNameAiContexts([context, sameLookup])
assert(
  merged.requests.length === 1 &&
    (merged.mirrors.get(context.contextId)?.includes(sameLookup.contextId) ??
      false),
  '같은 문맥만 결정을 복사한다',
)

assert(
  paginateItemNameAiReviewKeys(['a', 'b', 'c'], 2, 2).keys.join(',') === 'c',
  '내품명 검수표 2페이지',
)
assert(
  paginateItemNameAiReviewKeys(['a', 'b', 'c'], 4, 2).page === 2,
  '내품명 검수표 페이지를 마지막까지 당긴다',
)
assert(
  paginateItemNameAiReviewKeys(
    Array.from({ length: 80 }, (_, index) => String(index)),
    1,
    20,
  ).keys.length === 20,
  '내품명 검수표는 페이지 크기만큼만 자른다',
)

assert(
  nextItemNameAiReviewPage(1, 3, ['a', 'b'], 'b') === 2,
  '페이지 마지막 행 Enter는 다음 페이지',
)
assert(
  nextItemNameAiReviewPage(1, 3, ['a', 'b'], 'a') === null,
  '중간 행 Enter는 페이지를 바꾸지 않는다',
)
assert(
  nextItemNameAiReviewPage(3, 3, ['a', 'b'], 'b') === null,
  '마지막 페이지에서는 더 이상 넘기지 않는다',
)
assert(
  nextItemNameAiQuickFocus(['a', 'b'], 'a', 0, 'down')?.rowKey === 'b',
  'Enter는 다음 행 같은 칸',
)
assert(
  nextItemNameAiQuickFocus(['a', 'b'], 'a', 0, 'right')?.ensureCount === 2,
  'Tab은 같은 행 다음 구성 칸을 만든다',
)
assert(
  nextItemNameAiQuickFocus(
    ['a', 'b'],
    'a',
    ITEM_NAME_AI_QUICK_SLOT_LIMIT - 1,
    'right',
  )?.rowKey === 'b',
  '마지막 칸 Tab은 다음 행으로',
)
assert(
  shouldIgnoreItemNameAiQuickKey({ isComposing: true, key: 'Enter' }),
  '한글 조합 중 Enter는 무시',
)
assert(
  isItemNameAiAddExtraKey({ key: '+' }) &&
    isItemNameAiAddExtraKey({ key: 'Add' }),
  '이름 칸 + 는 구성품 칸을 추가한다',
)
assert(
  !isItemNameAiAddExtraKey({ key: '+', isComposing: true }) &&
    !isItemNameAiAddExtraKey({ key: '+', ctrlKey: true }),
  '조합 중 + 와 Ctrl+Plus는 구성품 추가가 아니다',
)
const extraSlots = [
  emptyItemNameAiQuickSlot(),
  emptyItemNameAiQuickSlot(),
  emptyItemNameAiQuickSlot(),
]
assert(
  removeItemNameAiQuickSlot(extraSlots, 1).length === 2,
  '추가 구성품 칸은 지울 수 있다',
)
assert(
  removeItemNameAiQuickSlot(extraSlots, 0).length === 3,
  '첫 칸은 휴지통으로 지우지 않는다',
)
assert(
  nextItemNameAiRowMark('confirm', 'needs_ai') === 'pending_ai' &&
    nextItemNameAiRowMark('confirm', 'delete') === 'committed' &&
    nextItemNameAiRowMark('confirm', 'components') === 'committed' &&
    nextItemNameAiRowMark('edit', 'components') === 'unconfirm' &&
    nextItemNameAiRowMark('resolved', 'components') === 'keep',
  'Enter만 분류하고 이름 수정은 대기로 되돌리며 AI 정리는 다시 Enter를 기다린다',
)
const emptySlot = emptyItemNameAiQuickSlot()
assert(
  decideItemNameAiEnterAction([emptySlot]).status === 'delete' &&
    itemNameAiQuickSlotInputValue(emptySlot, { showDeleteLabel: true }) ===
      ITEM_NAME_AI_DELETE_LABEL,
  '빈 행 Enter는 내품명 비움이고 분류된 칸에 그 문구를 보여 준다',
)
const namedSlot = applyItemNameAiQuickSlotText(emptySlot, '키링')
assert(
  decideItemNameAiEnterAction([namedSlot]).status === 'needs_ai',
  '이름만 있으면 입력 대기에 남긴다',
)
const matchedSlot = applyItemNameAiQuickSlotStyle(namedSlot, charm)
assert(
  itemNameAiQuickSlotInputValue(matchedSlot) === charm.name &&
    applyItemNameAiQuickSlotText(matchedSlot, charm.name).status === 'matched' &&
    matchedSlot.style?.styleNo === charm.styleNo,
  '공식 구성품은 M번호와 이름을 나눠 보여 준다',
)
assert(
  applyItemNameAiQuickSlotText(emptySlot, ITEM_NAME_AI_DELETE_LABEL).status ===
    'empty',
  '내품명 비움 표시 글자는 빈 칸으로 본다',
)
const pendingCount = countItemNameAiPendingResolve(
  new Set(['a', 'b']),
  new Map([
    ['a', [namedSlot]],
    ['b', [matchedSlot]],
  ]),
)
assert(pendingCount === 1, '공식명칭이 없는 대기 행만 AI 정리 대상이다')

const deleted = applyItemNameAiRowAction(row, { action: 'delete' })
assert(deleted.ok, '빈 Enter 초안을 만든다')
const directDelete = commitReadyItemNameAiDrafts({
  rows: [row],
  drafts: new Map([[row.key, deleted.row]]),
  confirmedKeys: new Set([row.key]),
  pendingAiKeys: new Set(),
  committedKeys: new Set(),
})
assert(
  itemNameAiReviewKind(directDelete.rows[0]!) === 'delete' &&
    itemNameAiMatchesQueueFilter(
      directDelete.rows[0]!,
      'delete',
      directDelete.committedKeys,
    ) &&
    !itemNameAiMatchesQueueFilter(
      directDelete.rows[0]!,
      'queue',
      directDelete.committedKeys,
    ),
  '빈 Enter는 바로 내품명 비움 탭으로 보낸다',
)
const singleDraft = applyItemNameAiRowAction(row, {
  action: 'components',
  components: [{ style: charm, quantity: 1 }],
})
assert(singleDraft.ok, '구성품 1개 초안')
const directSingle = commitReadyItemNameAiDrafts({
  rows: [row],
  drafts: new Map([[row.key, singleDraft.row]]),
  confirmedKeys: new Set([row.key]),
  pendingAiKeys: new Set(),
  committedKeys: new Set(),
})
assert(
  itemNameAiReviewKind(directSingle.rows[0]!) === 'single' &&
    itemNameAiMatchesQueueFilter(
      directSingle.rows[0]!,
      'single',
      directSingle.committedKeys,
    ),
  '공식 M번호 1개는 옵션 상품 1개 탭으로 보낸다',
)
const bundleDraft = applyItemNameAiRowAction(row, {
  action: 'components',
  components: [
    { style: charm, quantity: 1 },
    { style: main, quantity: 1 },
  ],
})
assert(bundleDraft.ok, '구성품 2개 초안')
const directBundle = commitReadyItemNameAiDrafts({
  rows: [row],
  drafts: new Map([[row.key, bundleDraft.row]]),
  confirmedKeys: new Set([row.key]),
  pendingAiKeys: new Set(),
  committedKeys: new Set(),
})
assert(
  itemNameAiReviewKind(directBundle.rows[0]!) === 'bundle' &&
    itemNameAiMatchesQueueFilter(
      directBundle.rows[0]!,
      'bundle',
      directBundle.committedKeys,
    ),
  '공식 M번호 2개 이상은 구성 2개 이상 탭으로 보낸다',
)
const pendingStay = commitReadyItemNameAiDrafts({
  rows: [row],
  drafts: new Map(),
  confirmedKeys: new Set([row.key]),
  pendingAiKeys: new Set([row.key]),
  committedKeys: new Set(),
})
assert(
  !pendingStay.committedKeys.has(row.key) &&
    itemNameAiMatchesQueueFilter(row, 'queue', pendingStay.committedKeys),
  '이름만 입력한 행은 입력 대기에 남는다',
)
const reopened = reopenItemNameAiCommittedRow({
  committedKeys: directSingle.committedKeys,
  selectedKeys: new Set(directSingle.selectedKeys),
  confirmedKeys: new Set([row.key]),
  pendingAiKeys: new Set(),
  key: row.key,
})
assert(
  !reopened.committedKeys.has(row.key) &&
    !reopened.selectedKeys.has(row.key) &&
    itemNameAiMatchesQueueFilter(directSingle.rows[0]!, 'queue', reopened.committedKeys),
  '다시 입력은 분류된 행을 입력 대기로 되돌린다',
)

const holdContext: ItemNameAiContext = {
  ...context,
  contextId: 'ctx-hold',
}
const holdRows = buildItemNameAiReviewRows({
  groups: [
    {
      key: '키링',
      itemName: '키링',
      rowCount: 1,
      contexts: [holdContext],
    },
  ],
  decisions: [],
  styles: [main, charm],
  itemNameRules: [] as InvoiceItemNameRule[],
  minConfidence: 0.72,
})
const appended = appendItemNameAiComponent(
  holdRows,
  [holdRows[0]!.key],
  { style: charm, quantity: 1 },
)
const appendedCommit = commitReadyItemNameAiDrafts({
  rows: holdRows,
  drafts: new Map([[holdRows[0]!.key, appended.rows[0]!]]),
  confirmedKeys: new Set([holdRows[0]!.key]),
  pendingAiKeys: new Set(),
  committedKeys: new Set(),
})
assert(
  itemNameAiReviewKind(appendedCommit.rows[0]!) === 'single' &&
    appendedCommit.committedKeys.has(holdRows[0]!.key),
  '일괄 넣기는 바로 로컬 분류한다',
)
const undone = revertItemNameAiAppendState({
  rows: appendedCommit.rows,
  drafts: appendedCommit.drafts,
  committedKeys: appendedCommit.committedKeys,
  selectedKeys: new Set(appendedCommit.selectedKeys),
  confirmedKeys: new Set([holdRows[0]!.key]),
  pendingAiKeys: new Set(),
  lastAppend: {
    addedKeys: appended.addedKeys,
    skippedKeys: appended.skippedKeys,
    previous: appended.previous,
  },
})
assert(
  !undone.committedKeys.has(holdRows[0]!.key) &&
    undone.rows[0]!.action === holdRows[0]!.action &&
    itemNameAiMatchesQueueFilter(undone.rows[0]!, 'queue', undone.committedKeys),
  '일괄 넣기 실행 취소는 분류 전 상태로 되돌린다',
)
assert(
  formatItemNameAiStyleLabel(charm) === `${charm.styleNo} · ${charm.name}`,
  '공식 라벨 형식',
)

console.log('item-name-ai-review verify: ok')
