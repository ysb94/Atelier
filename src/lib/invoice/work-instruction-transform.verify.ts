/**
 * 작업 지시 완전일치·시작어 우선순위 순수 검증.
 * 실행: npm run verify:work-instruction
 */
import {
  applyWorkInstructionLabel,
  planWorkInstructions,
} from '@/lib/invoice/work-instruction-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceWorkInstruction,
  InvoiceWorkInstructionItem,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function row(
  patch: Partial<SabangnetOrderRow> & Pick<SabangnetOrderRow, 'rowNumber'>,
): SabangnetOrderRow {
  return {
    productName: '울 코트',
    itemName: '블랙 / M',
    quantity: '1',
    recipientName: '숨김',
    recipientPhone: '010',
    recipientOtherPhone: '',
    shippingType: '선불',
    recipientAddress: '숨김주소',
    shippingMessage: '',
    customerOrderNo: `O-${patch.rowNumber}`,
    mallName: '무신사',
    orderedAt: '2026-08-28 10:00',
    ownProductCode: 'M001',
    ...patch,
  }
}

function item(
  instructionId: string,
  id: string,
  productName: string,
): InvoiceWorkInstructionItem {
  return {
    id,
    instructionId,
    productName,
    normalizedProductName: normalizeInvoiceText(productName),
  }
}

function instruction(
  patch: Partial<InvoiceWorkInstruction> &
    Pick<InvoiceWorkInstruction, 'id' | 'title' | 'labelText'>,
): InvoiceWorkInstruction {
  return {
    brandId: 'brand-1',
    isActive: true,
    note: '',
    startsAt: null,
    endsAt: null,
    matchMode: 'exact',
    countBasis: 'per_shipment',
    outgoingProducts: [],
    items: [],
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
    ...patch,
  }
}

function matchOf(
  plan: ReturnType<typeof planWorkInstructions>,
  rowNumber: number,
) {
  return plan.matchByRowNumber.get(rowNumber) ?? null
}

const exact = instruction({
  id: 'exact-1',
  title: '완전일치 코트',
  labelText: '[전체 선물포장]',
  matchMode: 'exact',
  items: [item('exact-1', 'e1', '[선물포장] 울 코트')],
})

const spacePrefix = instruction({
  id: 'prefix-space',
  title: '공백 시작어',
  labelText: '[전체 선물포장]',
  matchMode: 'prefix',
  items: [item('prefix-space', 'ps1', '[선물 포장]')],
})

const tightPrefix = instruction({
  id: 'prefix-tight',
  title: '공백없음 시작어',
  labelText: '[전체 선물포장]',
  matchMode: 'prefix',
  items: [item('prefix-tight', 'pt1', '[선물포장]')],
})

const bothPrefix = instruction({
  id: 'prefix-both',
  title: '두 시작어',
  labelText: '[전체 선물포장]',
  matchMode: 'prefix',
  items: [
    item('prefix-both', 'pb1', '[선물 포장]'),
    item('prefix-both', 'pb2', '[선물포장]'),
  ],
})

const longPrefix = instruction({
  id: 'prefix-long',
  title: '긴 시작어',
  labelText: '[긴시작]',
  matchMode: 'prefix',
  items: [item('prefix-long', 'pl1', '[선물포장] 울')],
})

const emptyPrefix = instruction({
  id: 'prefix-empty',
  title: '빈 시작어',
  labelText: '[무시]',
  matchMode: 'prefix',
  items: [item('prefix-empty', 'pe1', '   ')],
})

const exactAlways = instruction({
  id: 'exact-always',
  title: '항상 완전일치',
  labelText: '[항상]',
  matchMode: 'exact',
  items: [item('exact-always', 'ea1', '울 코트')],
})

const exactPeriod = instruction({
  id: 'exact-period',
  title: '기간 완전일치',
  labelText: '[기간]',
  matchMode: 'exact',
  startsAt: '2026-08-28 00:00',
  endsAt: '2026-08-28 23:59',
  items: [item('exact-period', 'ep1', '울 코트')],
})

const prefixAlways = instruction({
  id: 'prefix-always',
  title: '항상 시작어',
  labelText: '[항상시작]',
  matchMode: 'prefix',
  items: [item('prefix-always', 'pa1', '[선물포장]')],
})

const prefixPeriod = instruction({
  id: 'prefix-period',
  title: '기간 시작어',
  labelText: '[기간시작]',
  matchMode: 'prefix',
  startsAt: '2026-08-28 00:00',
  endsAt: '2026-08-28 23:59',
  items: [item('prefix-period', 'pp1', '[선물포장]')],
})

const exactConflictA = instruction({
  id: 'exact-a',
  title: '완전일치 A',
  labelText: '[A]',
  matchMode: 'exact',
  items: [item('exact-a', 'eca1', '울 코트')],
})

const exactConflictB = instruction({
  id: 'exact-b',
  title: '완전일치 B',
  labelText: '[B]',
  matchMode: 'exact',
  items: [item('exact-b', 'ecb1', '울 코트')],
})

const prefixConflictA = instruction({
  id: 'prefix-a',
  title: '시작어 A',
  labelText: '[PA]',
  matchMode: 'prefix',
  items: [item('prefix-a', 'pca1', '[선물포장]')],
})

const prefixConflictB = instruction({
  id: 'prefix-b',
  title: '시작어 B',
  labelText: '[PB]',
  matchMode: 'prefix',
  items: [item('prefix-b', 'pcb1', '[선물포장]')],
})

{
  const plan = planWorkInstructions(
    [row({ rowNumber: 1, productName: '[선물포장] 울 코트' })],
    [exact],
  )
  const match = matchOf(plan, 1)
  assert(match?.instructionId === 'exact-1', '완전일치는 같은 원본 품목명에만 붙는다')
  assert(
    applyWorkInstructionLabel(match.labelText, '공식상품명') ===
      '[전체 선물포장] 공식상품명',
    '표시 문구는 최종 품목명 앞에 붙는다',
  )
}

{
  const plan = planWorkInstructions(
    [
      row({ rowNumber: 1, productName: '[선물 포장] 울 코트' }),
      row({ rowNumber: 2, productName: '[선물 포장]랜덤 머플러' }),
      row({ rowNumber: 3, productName: '[선물포장] 울 코트' }),
      row({ rowNumber: 4, productName: '울 코트 [선물 포장]' }),
    ],
    [spacePrefix],
  )
  assert(matchOf(plan, 1)?.instructionId === 'prefix-space', '[선물 포장] 울 코트는 맞는다')
  assert(matchOf(plan, 2)?.instructionId === 'prefix-space', '[선물 포장]랜덤 머플러는 맞는다')
  assert(matchOf(plan, 3) === null, '공백이 다른 [선물포장]은 안 맞는다')
  assert(matchOf(plan, 4) === null, '앞에 다른 글자가 있으면 안 맞는다')
}

{
  const plan = planWorkInstructions(
    [
      row({ rowNumber: 1, productName: '[선물포장] 울 코트' }),
      row({ rowNumber: 2, productName: '[선물포장]랜덤 머플러' }),
      row({ rowNumber: 3, productName: '[선물 포장] 울 코트' }),
      row({ rowNumber: 4, productName: '[선물포장완료] 울 코트' }),
    ],
    [tightPrefix],
  )
  assert(matchOf(plan, 1)?.instructionId === 'prefix-tight', '[선물포장] 울 코트는 맞는다')
  assert(matchOf(plan, 2)?.instructionId === 'prefix-tight', '[선물포장]랜덤 머플러는 맞는다')
  assert(matchOf(plan, 3) === null, '공백 있는 [선물 포장]은 안 맞는다')
  assert(
    matchOf(plan, 4) === null,
    '[선물포장]은 [선물포장완료]로 시작하는 품목명에 안 맞는다',
  )
}

{
  const plan = planWorkInstructions(
    [
      row({ rowNumber: 1, productName: '[선물포장] 울 코트' }),
      row({ rowNumber: 2, productName: '[선물 포장] 울 코트' }),
    ],
    [bothPrefix],
  )
  assert(matchOf(plan, 1)?.itemId === 'pb2', '한 지시에 두 시작어를 넣으면 각각 맞춘다')
  assert(matchOf(plan, 2)?.itemId === 'pb1', '공백 있는 시작어도 따로 맞춘다')
}

{
  const plan = planWorkInstructions(
    [row({ rowNumber: 1, productName: '[선물포장] 울 코트' })],
    [tightPrefix, longPrefix],
  )
  assert(
    matchOf(plan, 1)?.instructionId === 'prefix-long',
    '시작어끼리는 더 긴 시작어가 이긴다',
  )
}

{
  const plan = planWorkInstructions(
    [row({ rowNumber: 1, productName: '[선물포장] 울 코트' })],
    [exact, tightPrefix],
  )
  assert(
    matchOf(plan, 1)?.instructionId === 'exact-1',
    '완전일치가 시작어보다 앞선다',
  )
}

{
  const inPeriod = planWorkInstructions(
    [row({ rowNumber: 1, productName: '울 코트', orderedAt: '2026-08-28 10:00' })],
    [exactAlways, exactPeriod],
  )
  assert(
    matchOf(inPeriod, 1)?.instructionId === 'exact-period',
    '기간 있는 완전일치가 항상 지시보다 앞선다',
  )

  const outPeriod = planWorkInstructions(
    [row({ rowNumber: 1, productName: '울 코트', orderedAt: '2026-08-20 10:00' })],
    [exactAlways, exactPeriod],
  )
  assert(
    matchOf(outPeriod, 1)?.instructionId === 'exact-always',
    '기간을 벗어나면 항상 완전일치가 남는다',
  )
}

{
  const inPeriod = planWorkInstructions(
    [row({ rowNumber: 1, productName: '[선물포장] 울 코트', orderedAt: '2026-08-28 10:00' })],
    [prefixAlways, prefixPeriod],
  )
  assert(
    matchOf(inPeriod, 1)?.instructionId === 'prefix-period',
    '기간 있는 시작어가 항상 시작어보다 앞선다',
  )
}

{
  const plan = planWorkInstructions(
    [row({ rowNumber: 1, productName: '울 코트' })],
    [exactConflictA, exactConflictB],
  )
  assert(matchOf(plan, 1) === null, '같은 순위 완전일치는 충돌로 붙이지 않는다')
  assert(plan.conflicts.length === 1, '완전일치 충돌을 집계한다')
}

{
  const plan = planWorkInstructions(
    [row({ rowNumber: 1, productName: '[선물포장] 울 코트' })],
    [prefixConflictA, prefixConflictB],
  )
  assert(matchOf(plan, 1) === null, '같은 길이 시작어는 충돌로 붙이지 않는다')
  assert(plan.conflicts.length === 1, '시작어 충돌을 집계한다')
}

{
  const plan = planWorkInstructions(
    [row({ rowNumber: 1, productName: '아무 상품' })],
    [emptyPrefix],
  )
  assert(matchOf(plan, 1) === null, '빈 시작어는 무시한다')
  assert(
    plan.unusedProductNames.length === 0,
    '빈 시작어는 미사용 대상으로 세지 않는다',
  )
}

{
  const plan = planWorkInstructions(
    [row({ rowNumber: 1, productName: '[선물포장완료] 울 코트' })],
    [tightPrefix],
  )
  assert(
    plan.unusedProductNames.some((item) => item.productName === '[선물포장]'),
    '시작어가 안 맞으면 미사용 대상으로 남긴다',
  )
}

console.log('verify:work-instruction ok')
