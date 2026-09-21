/**
 * 송장 백업 주문 키 검증.
 * 실행: npm run verify:invoice-order-key
 */
import {
  buildInvoiceOrderKeyPayload,
  collectInvoiceOrderKeyGroups,
  expandBackedUpExclusionWithProductNameExceptions,
  filterRowsByExcludedNumbers,
  hashInvoiceOrderKeyPayload,
  hashInvoiceOrderKeyPayloads,
  INVOICE_ORDER_KEY_PREFIX,
  matchBackedUpInvoiceOrderKeys,
  type InvoiceOrderKeyExclusionRule,
} from '@/lib/invoice/invoice-order-key'
import { transformInvoiceProductNames } from '@/lib/invoice/product-name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoiceProductNameExclusion } from '@/lib/types'

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

  const packed = {
    recipientName: '김합포',
    recipientPhone: '010-2222-3333',
    recipientAddress: '서울 합포장로 1',
    mallName: '무신사',
    orderedAt: '2026-08-10 09:00',
  }
  const mainA = row({
    rowNumber: 21,
    customerOrderNo: 'MAIN-A',
    productName: '셔링 아이보리',
    ...packed,
  })
  const mainB = row({
    rowNumber: 22,
    customerOrderNo: 'MAIN-B',
    productName: '니트 블랙',
    ...packed,
  })
  const exceptionA = row({
    rowNumber: 23,
    customerOrderNo: 'EX-A',
    productName: '선택안함',
    itemName: 'Keyring',
    ...packed,
  })
  const exceptionB = row({
    rowNumber: 24,
    customerOrderNo: 'EX-B',
    productName: '선택안함',
    itemName: 'Tassel',
    ...packed,
  })
  const regularSameBundle = row({
    rowNumber: 25,
    customerOrderNo: 'NEW-1',
    productName: '새 본품',
    ...packed,
  })
  const exceptionOtherAddress = row({
    rowNumber: 26,
    customerOrderNo: 'EX-ADDR',
    productName: '선택안함',
    itemName: 'Keyring',
    ...packed,
    recipientAddress: '부산 다른주소 9',
  })
  const exceptionOtherTime = row({
    rowNumber: 27,
    customerOrderNo: 'EX-TIME',
    productName: '선택안함',
    itemName: 'Keyring',
    ...packed,
    orderedAt: '2026-08-10 18:00',
  })
  const inactiveException = row({
    rowNumber: 28,
    customerOrderNo: 'EX-OFF',
    productName: '일시정지예외',
    itemName: '스티커',
    ...packed,
  })
  const keylessException = row({
    rowNumber: 29,
    customerOrderNo: '',
    productName: '선택안함',
    itemName: 'Keyring',
    ...packed,
  })
  const mixedOrderException = row({
    rowNumber: 30,
    customerOrderNo: 'MIX-1',
    productName: '선택안함',
    itemName: 'Keyring',
    ...packed,
  })
  const mixedOrderProduct = row({
    rowNumber: 31,
    customerOrderNo: 'MIX-1',
    productName: '새 본품',
    ...packed,
  })
  const keylessWithoutMain = row({
    rowNumber: 32,
    customerOrderNo: '',
    productName: '선택안함',
    itemName: 'Keyring',
    recipientName: '박단독',
    recipientPhone: '010-4444-5555',
    recipientAddress: '대전 단독로 2',
    mallName: '무신사',
    orderedAt: '2026-08-10 09:00',
  })

  const activeExclusion = (
    productName: string,
    itemName: string,
    isActive = true,
  ): InvoiceOrderKeyExclusionRule => ({
    mallName: '무신사',
    productName,
    itemName,
    isActive,
  })
  const exclusions = [
    activeExclusion('선택안함', 'Keyring'),
    activeExclusion('선택안함', 'Tassel'),
    activeExclusion('일시정지예외', '스티커', false),
  ]

  const historicalRows = [mainA, mainB, exceptionA, exceptionB]
  const historicalGroups = collectInvoiceOrderKeyGroups(historicalRows)
  const historicalHashes = await hashInvoiceOrderKeyPayloads(
    historicalGroups.map((group) => group.payload),
  )
  const mainHashes = await hashInvoiceOrderKeyPayloads(
    [buildInvoiceOrderKeyPayload(mainA), buildInvoiceOrderKeyPayload(mainB)].filter(
      (payload): payload is string => Boolean(payload),
    ),
  )
  const historicalMatch = matchBackedUpInvoiceOrderKeys(
    historicalGroups,
    historicalHashes,
    mainHashes,
  )
  assert(historicalMatch.rowNumbers.join(',') === '21,22', '본품만 주문키로 맞춘다.')
  const historicalExpanded = expandBackedUpExclusionWithProductNameExceptions({
    rows: historicalRows,
    match: historicalMatch,
    exclusions,
  })
  assert(
    historicalExpanded.rowNumbers.join(',') === '21,22,23,24',
    '같은 합포장·주문시각의 활성 예외는 함께 제외한다.',
  )
  const historicalWork = filterRowsByExcludedNumbers(
    historicalRows,
    new Set(historicalExpanded.rowNumbers),
  )
  assert(historicalWork.length === 0, '현재 사례처럼 작업 대상은 0행이어야 한다.')
  assert(historicalExpanded.orderCount === 4, '확장된 예외 주문 건수도 더한다.')
  const emptyCatalog = { byName: new Map(), byCompactName: new Map() }
  const leftoverBefore = filterRowsByExcludedNumbers(
    historicalRows,
    new Set(historicalMatch.rowNumbers),
  )
  const guardedBefore = transformInvoiceProductNames(
    leftoverBefore,
    [],
    emptyCatalog,
    [],
    exclusions as InvoiceProductNameExclusion[],
  )
  assert(
    leftoverBefore.length === 2 && guardedBefore.exclusionGuardedRowCount === 2,
    '확장 전에는 남은 예외가 예외 보류가 된다.',
  )
  const guardedAfter = transformInvoiceProductNames(
    historicalWork,
    [],
    emptyCatalog,
    [],
    exclusions as InvoiceProductNameExclusion[],
  )
  assert(
    guardedAfter.exclusionGuardedRowCount === 0,
    '확장 뒤에는 예외 보류가 없어야 한다.',
  )

  const keepCases = expandBackedUpExclusionWithProductNameExceptions({
    rows: [
      mainA,
      exceptionA,
      regularSameBundle,
      exceptionOtherAddress,
      exceptionOtherTime,
      inactiveException,
    ],
    match: {
      orderCount: 1,
      rowCount: 1,
      rowNumbers: [mainA.rowNumber],
      hashes: mainHashes.slice(0, 1),
    },
    exclusions,
  })
  assert(
    keepCases.rowNumbers.join(',') === '21,23',
    '같은 묶음의 활성 예외만 확장한다.',
  )
  assert(
    !keepCases.rowNumbers.includes(regularSameBundle.rowNumber),
    '일반 상품은 같은 합포장이어도 남긴다.',
  )
  assert(
    !keepCases.rowNumbers.includes(exceptionOtherAddress.rowNumber),
    '주소가 다른 예외는 남긴다.',
  )
  assert(
    !keepCases.rowNumbers.includes(exceptionOtherTime.rowNumber),
    '주문시각이 다른 예외는 남긴다.',
  )
  assert(
    !keepCases.rowNumbers.includes(inactiveException.rowNumber),
    '비활성 예외는 남긴다.',
  )

  const mixedExpanded = expandBackedUpExclusionWithProductNameExceptions({
    rows: [mainA, mixedOrderException, mixedOrderProduct],
    match: {
      orderCount: 1,
      rowCount: 1,
      rowNumbers: [mainA.rowNumber],
      hashes: mainHashes.slice(0, 1),
    },
    exclusions,
  })
  assert(
    mixedExpanded.rowNumbers.join(',') === '21',
    '본품이 섞인 미일치 주문키 묶음은 통째로 남긴다.',
  )

  const keylessExpanded = expandBackedUpExclusionWithProductNameExceptions({
    rows: [mainA, keylessException],
    match: {
      orderCount: 1,
      rowCount: 1,
      rowNumbers: [mainA.rowNumber],
      hashes: mainHashes.slice(0, 1),
    },
    exclusions,
  })
  assert(
    keylessExpanded.rowNumbers.join(',') === '21,29',
    '주문키 없는 예외는 같은 묶음의 엄격 일치 본품이 있을 때만 제외한다.',
  )

  const keylessAlone = expandBackedUpExclusionWithProductNameExceptions({
    rows: [exceptionA, keylessWithoutMain],
    match: {
      orderCount: 1,
      rowCount: 1,
      rowNumbers: [exceptionA.rowNumber],
      hashes: [],
    },
    exclusions,
  })
  assert(
    keylessAlone.rowNumbers.join(',') === '23',
    '본품 없이 예외끼리만 맞으면 키 없는 행은 확장하지 않는다.',
  )

  console.log('invoice-order-key.verify ok')
}

await main()
