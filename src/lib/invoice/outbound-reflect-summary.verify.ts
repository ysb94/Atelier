/**
 * 송장 출고반영 집계·차단 검증.
 * 실행: npm run verify:outbound-reflect
 */
import {
  compactOutboundPartnerKey,
  normalizeOutboundPartnerName,
} from '@/lib/codes/outbound-partner'
import type { InvoiceItemNameTransformRow } from '@/lib/invoice/item-name-transform'
import {
  resolveInvoiceMalls,
  type InvoiceMallResolution,
} from '@/lib/invoice/mall-resolution'
import {
  buildOutboundReflectLedger,
  formatOutboundReflectBlockReasons,
  summarizeOutboundReflectProducts,
} from '@/lib/invoice/outbound-reflect-summary'
import type { InvoiceProductNameTransformRow } from '@/lib/invoice/product-name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  CodeUsageTarget,
  InvoiceOptionMapComponent,
  StyleRef,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const coat: StyleRef = {
  styleId: '11111111-1111-4111-8111-111111111111',
  styleNo: 'M0001',
  name: '코트',
}
const strap: StyleRef = {
  styleId: '22222222-2222-4222-8222-222222222222',
  styleNo: 'M0002',
  name: '스트랩',
}

function row(
  patch: Partial<SabangnetOrderRow> & Pick<SabangnetOrderRow, 'rowNumber'>,
): SabangnetOrderRow {
  return {
    productName: '코트',
    itemName: '스트랩',
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

function extra(style: StyleRef, quantity = 1): InvoiceOptionMapComponent {
  return {
    id: `extra-${style.styleId}`,
    mapId: '',
    style,
    role: 'included',
    quantity,
    sortOrder: 0,
  }
}

function productRow(
  patch: Partial<InvoiceProductNameTransformRow> & {
    source: SabangnetOrderRow
  },
): InvoiceProductNameTransformRow {
  return {
    status: 'mapped',
    mapId: 'map-1',
    style: coat,
    transformedProductName: coat.name,
    appliedRule: 'lookup',
    appliedLookupKey: '코트',
    itemNameConsumed: false,
    effectiveItemName: patch.source.itemName,
    candidates: [],
    candidateStyles: [],
    tags: [],
    itemTags: [],
    ...patch,
  }
}

function itemRow(
  patch: Partial<InvoiceItemNameTransformRow> & {
    source: SabangnetOrderRow
  },
): InvoiceItemNameTransformRow {
  return {
    status: 'mapped',
    mapId: null,
    ruleId: 'rule-1',
    productStyle: coat,
    extras: [extra(strap)],
    productExtras: [],
    itemExtras: [extra(strap)],
    expandableExtras: [],
    transformedItemName: strap.name,
    displayChanged: true,
    resolvedBy: 'rule',
    evidence: [],
    ...patch,
  }
}

function productTransformation(rows: InvoiceProductNameTransformRow[]) {
  return {
    rows,
    mappedRowCount: rows.filter((item) => item.status === 'mapped').length,
    candidateRowCount: 0,
    missingStyleRowCount: 0,
    conflictRowCount: 0,
    unresolvedRowCount: rows.filter((item) => item.status === 'unresolved')
      .length,
    excludedRowCount: 0,
    exclusionGuardedRowCount: 0,
    giftPendingRowCount: 0,
    giftMappedRowCount: 0,
    unresolvedCombos: [],
  }
}

function itemTransformation(rows: InvoiceItemNameTransformRow[]) {
  return {
    rows,
    mappedRowCount: rows.filter((item) => item.status === 'mapped').length,
    passthroughRowCount: 0,
    consumedRowCount: 0,
    deletedRowCount: 0,
    unresolvedRowCount: rows.filter((item) => item.status === 'unresolved')
      .length,
    conflictRowCount: 0,
    autoComponentsRowCount: 0,
    autoDeletedRowCount: 0,
    unresolvedCombos: [],
  }
}

function target(
  patch: Partial<CodeUsageTarget> & Pick<CodeUsageTarget, 'id' | 'name'>,
): CodeUsageTarget {
  const name = patch.name
  return {
    brandId: 'brand-1',
    normalizedName: compactOutboundPartnerKey(
      normalizeOutboundPartnerName(name),
    ),
    active: true,
    isOneTime: false,
    channelType: 'online',
    shippingMethod: 'parcel',
    folderId: 'folder-sabang',
    note: '',
    order: 0,
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
    ...patch,
    groupId: patch.groupId ?? null,
    groupName: patch.groupName ?? '',
    siteName: patch.siteName ?? '',
    normalizedSiteName: patch.normalizedSiteName ?? '',
    contactName: patch.contactName ?? '',
    contactPhone: patch.contactPhone ?? '',
    contactEmail: patch.contactEmail ?? '',
    address: patch.address ?? '',
  }
}

const musinsa = target({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: '무신사',
})
const zigzag = target({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: '지그재그',
})

function malls(
  rows: SabangnetOrderRow[],
  partners = [musinsa, zigzag],
): InvoiceMallResolution {
  return resolveInvoiceMalls(rows, partners, [])
}

const first = row({ rowNumber: 1, quantity: '2' })
const second = row({
  rowNumber: 2,
  orderedAt: '2026-08-29 09:00',
  mallName: '지그재그',
})
const sameDay = row({ rowNumber: 3, quantity: '1' })

const readyProduct = productTransformation([
  productRow({ source: first }),
  productRow({ source: second }),
  productRow({ source: sameDay }),
])
const readyItem = itemTransformation([
  itemRow({ source: first }),
  itemRow({ source: second }),
  itemRow({ source: sameDay }),
])

const preview = summarizeOutboundReflectProducts({
  productTransformation: readyProduct,
  itemTransformation: readyItem,
})
assert(preview.styleCount === 2, '미리보기는 본품·내품 2종')
assert(preview.totalQuantity === 8, '2+2 + 1+1 + 1+1 = 8')
assert(preview.firstOrderedOn === '2026-08-28', '첫 주문일')
assert(preview.lastOrderedOn === '2026-08-29', '마지막 주문일')

const ledger = buildOutboundReflectLedger({
  productTransformation: readyProduct,
  itemTransformation: readyItem,
  mallResolution: malls([first, second, sameDay]),
})
assert(ledger.ok, '준비된 변환은 저장 가능')
if (!ledger.ok) throw new Error('unreachable')
assert(ledger.entries.length === 4, '날짜·업체·SKU 4행')
assert(ledger.styleCount === 2, '저장 항목도 2종')
assert(ledger.totalQuantity === 8, '저장 수량 합')

const musinsaCoat = ledger.entries.find(
  (entry) =>
    entry.shippedOn === '2026-08-28' &&
    entry.usageTargetId === musinsa.id &&
    entry.styleId === coat.styleId,
)
assert(musinsaCoat?.quantity === 3, '같은 날·같은 업체 본품은 합산')
const musinsaStrap = ledger.entries.find(
  (entry) =>
    entry.shippedOn === '2026-08-28' &&
    entry.styleId === strap.styleId,
)
assert(musinsaStrap?.quantity === 3, '같은 날 내품도 합산')
const zigzagCoat = ledger.entries.find(
  (entry) =>
    entry.shippedOn === '2026-08-29' &&
    entry.usageTargetId === zigzag.id &&
    entry.styleId === coat.styleId,
)
assert(zigzagCoat?.quantity === 1, '다른 날·다른 업체는 분리')

const again = buildOutboundReflectLedger({
  productTransformation: readyProduct,
  itemTransformation: readyItem,
  mallResolution: malls([first, second, sameDay]),
})
assert(
  again.ok &&
    JSON.stringify(again.entries) === JSON.stringify(ledger.entries),
  '같은 파일 입력은 같은 저장 항목',
)

const unresolvedSource = row({ rowNumber: 10 })
const unresolved = buildOutboundReflectLedger({
  productTransformation: productTransformation([
    productRow({ source: unresolvedSource, status: 'unresolved', style: null }),
  ]),
  itemTransformation: itemTransformation([
    itemRow({
      source: unresolvedSource,
      status: 'passthrough',
      extras: [],
      itemExtras: [],
    }),
  ]),
  mallResolution: malls([unresolvedSource]),
})
assert(!unresolved.ok, '품목명 미해결은 차단')
if (unresolved.ok) throw new Error('unreachable')
assert(
  unresolved.reasons.some((reason) => reason.code === 'unresolved_product'),
  '품목명 미해결 사유',
)

const itemUnresolvedSource = row({ rowNumber: 11 })
const itemUnresolved = buildOutboundReflectLedger({
  productTransformation: productTransformation([
    productRow({ source: itemUnresolvedSource }),
  ]),
  itemTransformation: itemTransformation([
    itemRow({ source: itemUnresolvedSource, status: 'unresolved' }),
  ]),
  mallResolution: malls([itemUnresolvedSource]),
})
assert(!itemUnresolved.ok, '내품명 미해결은 차단')
if (itemUnresolved.ok) throw new Error('unreachable')
assert(
  itemUnresolved.reasons.some((reason) => reason.code === 'unresolved_item'),
  '내품명 미해결 사유',
)

const missingDateSource = row({ rowNumber: 12, orderedAt: '날짜없음' })
const missingDate = buildOutboundReflectLedger({
  productTransformation: productTransformation([
    productRow({ source: missingDateSource }),
  ]),
  itemTransformation: itemTransformation([itemRow({ source: missingDateSource })]),
  mallResolution: malls([missingDateSource]),
})
assert(!missingDate.ok, '주문일시 없음은 차단')
if (missingDate.ok) throw new Error('unreachable')
assert(
  missingDate.reasons.some((reason) => reason.code === 'missing_ordered_on'),
  '주문일시 없음 사유',
)

const unknownMallSource = row({ rowNumber: 13, mallName: '미등록몰' })
const unknownMall = buildOutboundReflectLedger({
  productTransformation: productTransformation([
    productRow({ source: unknownMallSource }),
  ]),
  itemTransformation: itemTransformation([itemRow({ source: unknownMallSource })]),
  mallResolution: malls([unknownMallSource]),
})
assert(!unknownMall.ok, '출고업체 미연결은 차단')
if (unknownMall.ok) throw new Error('unreachable')
assert(
  unknownMall.reasons.some((reason) => reason.code === 'unresolved_mall'),
  '출고업체 미연결 사유',
)

const missingStyleSource = row({ rowNumber: 14 })
const missingStyle = buildOutboundReflectLedger({
  productTransformation: productTransformation([
    productRow({
      source: missingStyleSource,
      style: { styleId: '', styleNo: 'M0001', name: '코트' },
    }),
  ]),
  itemTransformation: itemTransformation([
    itemRow({
      source: missingStyleSource,
      extras: [],
      itemExtras: [],
    }),
  ]),
  mallResolution: malls([missingStyleSource]),
})
assert(!missingStyle.ok, 'styleId 없는 본품은 차단')
if (missingStyle.ok) throw new Error('unreachable')
assert(
  missingStyle.reasons.some(
    (reason) =>
      reason.code === 'unresolved_product' || reason.code === 'missing_style',
  ),
  '상품 연결 없음 사유',
)

const empty = buildOutboundReflectLedger({
  productTransformation: productTransformation([]),
  itemTransformation: itemTransformation([]),
  mallResolution: resolveInvoiceMalls([], [], []),
})
assert(!empty.ok, '빈 변환은 차단')
if (empty.ok) throw new Error('unreachable')
assert(empty.reasons.some((reason) => reason.code === 'empty'), '빈 목록 사유')
assert(
  formatOutboundReflectBlockReasons(empty.reasons).includes('변환된 상품'),
  '차단 문구',
)

console.log('outbound-reflect-summary.verify ok')
