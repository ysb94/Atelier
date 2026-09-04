/**
 * 송장 백업 주문 키 검증.
 * 실행: npm run verify:invoice-order-key
 */
import {
  buildInvoiceOrderKeyPayload,
  collectInvoiceOrderKeyGroups,
  filterRowsByExcludedNumbers,
  hashInvoiceOrderKeyPayload,
  hashInvoiceOrderKeyPayloads,
  INVOICE_ORDER_KEY_PREFIX,
  matchBackedUpInvoiceOrderKeys,
} from '@/lib/invoice/invoice-order-key'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function row(
  patch: Partial<SabangnetOrderRow> & Pick<SabangnetOrderRow, 'rowNumber'>,
): SabangnetOrderRow {
  return {
    productName: '코트',
    itemName: '',
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
    ownProductCode: 'M0001',
    ...patch,
  }
}

async function main() {
  const spaced = row({
    rowNumber: 1,
    customerOrderNo: '  AB-100  ',
    mallName: '  무  신사  ',
    orderedAt: '2026-8-28 10:00',
  })
  const compact = row({
    rowNumber: 2,
    customerOrderNo: 'AB-100',
    mallName: '무 신사',
    orderedAt: '2026-08-28 10:00',
  })
  const nfkc = row({
    rowNumber: 3,
    customerOrderNo: 'ＡＢ-１００',
    mallName: '무신사',
    orderedAt: '2026-08-28 10:00',
  })
  const sameSkuTwin = row({
    rowNumber: 4,
    customerOrderNo: 'AB-100',
    mallName: '무신사',
    orderedAt: '2026-08-28 10:00',
    productName: '코트 블랙',
  })

  const payload = buildInvoiceOrderKeyPayload(spaced)
  assert(payload, '세 값이 있으면 키 원문이 나와야 합니다.')
  assert(payload.startsWith(`${INVOICE_ORDER_KEY_PREFIX}|`), '버전 접두가 있어야 합니다.')
  assert(
    buildInvoiceOrderKeyPayload(compact) === payload,
    '공백·날짜 표기가 달라도 같은 키여야 합니다.',
  )
  assert(
    buildInvoiceOrderKeyPayload(nfkc) ===
      buildInvoiceOrderKeyPayload(
        row({
          rowNumber: 13,
          customerOrderNo: 'AB-100',
          mallName: '무신사',
          orderedAt: '2026-08-28 10:00',
        }),
      ),
    '전각 주문번호는 NFKC 뒤 같은 키여야 합니다.',
  )

  assert(
    buildInvoiceOrderKeyPayload(
      row({ rowNumber: 5, customerOrderNo: '' }),
    ) === null,
    '주문번호가 없으면 키를 만들지 않습니다.',
  )
  assert(
    buildInvoiceOrderKeyPayload(row({ rowNumber: 6, mallName: '   ' })) ===
      null,
    '쇼핑몰명이 없으면 키를 만들지 않습니다.',
  )
  assert(
    buildInvoiceOrderKeyPayload(
      row({ rowNumber: 7, orderedAt: '잘못된날짜' }),
    ) === null,
    '주문일시가 없으면 키를 만들지 않습니다.',
  )

  const otherMall = row({
    rowNumber: 8,
    customerOrderNo: 'AB-100',
    mallName: '29CM',
    orderedAt: '2026-08-28 10:00',
  })
  const otherTime = row({
    rowNumber: 9,
    customerOrderNo: 'AB-100',
    mallName: '무신사',
    orderedAt: '2026-08-28 11:00',
  })
  assert(
    buildInvoiceOrderKeyPayload(otherMall) !== payload,
    '쇼핑몰이 다르면 다른 키여야 합니다.',
  )
  assert(
    buildInvoiceOrderKeyPayload(otherTime) !== payload,
    '주문일시가 다르면 다른 키여야 합니다.',
  )

  const groups = collectInvoiceOrderKeyGroups([
    spaced,
    sameSkuTwin,
    otherMall,
    row({ rowNumber: 10, customerOrderNo: '' }),
  ])
  assert(groups.length === 2, '유효한 주문 키는 2개여야 합니다.')
  const musinsa = groups.find((group) => group.payload === payload)
  assert(musinsa, '무신사 주문이 묶여야 합니다.')
  assert(
    musinsa.rowNumbers.join(',') === '1,4',
    '같은 주문의 여러 SKU 행은 한 키로 묶어야 합니다.',
  )

  const hashes = await hashInvoiceOrderKeyPayloads(groups.map((group) => group.payload))
  assert(hashes.length === 2, '해시 수가 주문 키 수와 같아야 합니다.')
  assert(
    (await hashInvoiceOrderKeyPayload(payload)) === hashes[0] ||
      (await hashInvoiceOrderKeyPayload(payload)) === hashes[1],
    '같은 원문은 같은 해시여야 합니다.',
  )
  assert(hashes[0] !== hashes[1], '다른 주문은 다른 해시여야 합니다.')

  const match = matchBackedUpInvoiceOrderKeys(groups, hashes, [
    await hashInvoiceOrderKeyPayload(payload),
  ])
  assert(match.orderCount === 1, '일치 주문은 1건이어야 합니다.')
  assert(match.rowCount === 2, '일치 행은 2행이어야 합니다.')
  assert(
    match.rowNumbers.join(',') === '1,4',
    '제외 행 번호가 같은 주문 전체를 가리켜야 합니다.',
  )
  const remaining = filterRowsByExcludedNumbers(
    [spaced, sameSkuTwin, otherMall],
    new Set(match.rowNumbers),
  )
  assert(remaining.length === 1, '다른 쇼핑몰 주문은 남아야 합니다.')
  assert(remaining[0]?.rowNumber === 8, '남은 행은 29CM 주문이어야 합니다.')

  console.log('invoice-order-key.verify ok')
}

await main()
