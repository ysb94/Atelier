/**
 * 사방넷 쇼핑몰 연결·출고 집계 순수 검증.
 * 실행: npm run verify:invoice-mall
 */
import {
  findDefaultSabangnetFolderId,
  folderPathLabel,
} from '@/lib/codes/outbound-folder'
import {
  countUniqueInvoiceOrders,
  fingerprintInvoiceWorkRows,
  invoiceWorkFingerprintPayload,
  isInvoiceMallReady,
  parseInvoiceQuantity,
  resolveInvoiceMalls,
  summarizeInvoiceWorkSites,
} from '@/lib/invoice/mall-resolution'
import type { InvoiceOutputRow } from '@/lib/invoice/invoice-output'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  CodeUsageTarget,
  CodeUsageTargetAlias,
  CodeUsageTargetFolder,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function row(
  patch: Partial<SabangnetOrderRow> & Pick<SabangnetOrderRow, 'rowNumber'>,
): SabangnetOrderRow {
  return {
    productName: '코트',
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

function target(
  patch: Partial<CodeUsageTarget> & Pick<CodeUsageTarget, 'id' | 'name'>,
): CodeUsageTarget {
  return {
    brandId: 'brand-1',
    normalizedName: patch.normalizedName ?? patch.name.replace(/\s+/g, '').toLowerCase(),
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

function alias(
  patch: Pick<CodeUsageTargetAlias, 'targetId' | 'alias'> &
    Partial<CodeUsageTargetAlias>,
): CodeUsageTargetAlias {
  return {
    id: patch.id ?? `alias-${patch.alias}`,
    brandId: 'brand-1',
    normalizedAlias:
      patch.normalizedAlias ?? patch.alias.replace(/\s+/g, '').toLowerCase(),
    note: '',
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
    ...patch,
  }
}

function folder(
  patch: Partial<CodeUsageTargetFolder> &
    Pick<CodeUsageTargetFolder, 'id' | 'name' | 'parentId'>,
): CodeUsageTargetFolder {
  return {
    brandId: 'brand-1',
    normalizedName: patch.name,
    order: 0,
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
    ...patch,
  }
}

const partners = [
  target({ id: 't-musinsa', name: '무신사', normalizedName: '무신사' }),
  target({ id: 't-29cm', name: '29CM', normalizedName: '29cm' }),
  target({
    id: 't-ssg',
    name: 'SSG',
    normalizedName: 'ssg',
    active: false,
  }),
]

const aliases = [
  alias({ targetId: 't-musinsa', alias: 'MUSINSA', normalizedAlias: 'musinsa' }),
  alias({ targetId: 't-29cm', alias: '29CM 스토어', normalizedAlias: '29cm스토어' }),
]

const rows = [
  row({ rowNumber: 2, mallName: '무신사', customerOrderNo: 'A-1', quantity: '2' }),
  row({ rowNumber: 3, mallName: '무 신사', customerOrderNo: 'A-1', quantity: '1' }),
  row({ rowNumber: 4, mallName: 'MUSINSA', customerOrderNo: 'A-2', quantity: '1' }),
  row({ rowNumber: 5, mallName: '29CM', customerOrderNo: 'B-1', quantity: '3' }),
  row({ rowNumber: 6, mallName: '29CM 스토어', customerOrderNo: 'B-2', quantity: '1' }),
  row({
    rowNumber: 7,
    mallName: '신규몰',
    customerOrderNo: 'C-1',
    quantity: '1',
  }),
  row({ rowNumber: 8, mallName: '', customerOrderNo: 'D-1', quantity: '1' }),
  row({
    rowNumber: 9,
    mallName: 'SSG',
    customerOrderNo: 'E-1',
    quantity: '1',
  }),
]

const resolution = resolveInvoiceMalls(rows, partners, aliases)

assert(resolution.uniqueCount === 7, '고유 쇼핑몰 수가 맞아야 한다')
assert(resolution.matchedCount === 4, '정식명·별칭·띄어쓰기 그룹이 연결돼야 한다')
assert(resolution.unmatchedCount === 1, '미등록 사이트는 차단해야 한다')
assert(resolution.emptyCount === 1, '빈 쇼핑몰명은 차단해야 한다')
assert(resolution.inactiveCount === 1, '비활성 일치는 자동 연결하면 안 된다')
assert(resolution.unresolvedCount === 3, '미해결 수가 맞아야 한다')
assert(!isInvoiceMallReady(resolution), '미해결이 있으면 다음 단계를 열면 안 된다')

const musinsa = resolution.sites.find((site) => site.key === '무신사')
assert(musinsa?.status === 'matched', '무신사 정식명이 맞아야 한다')
assert(musinsa?.usageTargetId === 't-musinsa', '무신사 ID가 맞아야 한다')
assert(musinsa?.rowCount === 2, '띄어쓰기만 다른 무신사는 한 그룹이다')

const musinsaAlias = resolution.sites.find((site) => site.key === 'musinsa')
assert(musinsaAlias?.status === 'matched', 'MUSINSA 별칭이 무신사에 붙어야 한다')
assert(musinsaAlias?.usageTargetId === 't-musinsa', 'MUSINSA 대상이 무신사여야 한다')

const aliasSite = resolution.sites.find((site) => site.key === '29cm스토어')
assert(aliasSite?.status === 'matched', '별칭 29CM 스토어가 29CM에 붙어야 한다')
assert(aliasSite?.usageTargetId === 't-29cm', '별칭 대상이 29CM이어야 한다')

const unmatched = resolution.sites.find((site) => site.key === '신규몰')
assert(unmatched?.status === 'unmatched', '미등록은 unmatched여야 한다')

const empty = resolution.sites.find((site) => site.key === '')
assert(empty?.status === 'empty', '빈 값은 empty여야 한다')

const inactive = resolution.sites.find((site) => site.key === 'ssg')
assert(inactive?.status === 'inactive', '비활성 SSG는 inactive여야 한다')
assert(inactive?.officialName === 'SSG', '비활성 공식명을 알려야 한다')

const officialWins = resolveInvoiceMalls(
  [row({ rowNumber: 2, mallName: '29CM' })],
  [
    target({ id: 't-29cm', name: '29CM', normalizedName: '29cm' }),
    target({ id: 't-other', name: '다른몰', normalizedName: '다른몰' }),
  ],
  [alias({ targetId: 't-other', alias: '29CM', normalizedAlias: '29cm' })],
)
assert(
  officialWins.sites[0]?.usageTargetId === 't-29cm',
  '정식명이 같은 키의 별칭보다 앞서야 한다',
)

const ready = resolveInvoiceMalls(
  rows.filter((item) => ['무신사', '무 신사', 'MUSINSA', '29CM', '29CM 스토어'].includes(item.mallName)),
  partners,
  aliases,
)
assert(isInvoiceMallReady(ready), '모두 연결되면 다음 단계가 열려야 한다')
assert(countUniqueInvoiceOrders(ready.sites.length ? rows.slice(0, 5) : []) >= 4, '주문 건수는 지문 중복을 접어야 한다')

const output: InvoiceOutputRow[] = [
  {
    ...rows[0]!,
    kind: 'order',
    finalProductName: '코트',
    finalItemName: '블랙 / M',
    sourceRowNumber: 2,
    quantity: '2',
  },
  {
    ...rows[1]!,
    kind: 'order',
    finalProductName: '코트',
    finalItemName: '블랙 / M',
    sourceRowNumber: 3,
    quantity: '1',
  },
  {
    ...rows[2]!,
    kind: 'gift',
    finalProductName: '사은품',
    finalItemName: '',
    sourceRowNumber: 4,
    quantity: '1',
  },
  {
    ...rows[3]!,
    kind: 'order',
    finalProductName: '코트',
    finalItemName: '블랙 / M',
    sourceRowNumber: 5,
    quantity: '3',
  },
  {
    ...rows[4]!,
    kind: 'gift',
    finalProductName: '사은품',
    finalItemName: '',
    sourceRowNumber: 6,
    quantity: '2',
  },
]

const summaries = summarizeInvoiceWorkSites({
  sourceRows: rows.slice(0, 5),
  outputRows: output,
  resolution: ready,
})

assert(summaries.length === 2, '공식 사이트 2곳으로 합쳐야 한다')
const musinsaSum = summaries.find((item) => item.usageTargetId === 't-musinsa')
const cmSum = summaries.find((item) => item.usageTargetId === 't-29cm')
assert(musinsaSum?.orderCount === 2, '무신사 주문 건수는 주문번호 기준 2건')
assert(musinsaSum?.sourceRowCount === 3, '무신사 원본 행은 3행')
assert(musinsaSum?.sourceQuantity === 4, '무신사 원본 수량은 2+1+1')
assert(musinsaSum?.cjOrderRowCount === 2, '무신사 CJ 주문 행은 2행')
assert(musinsaSum?.cjOrderQuantity === 3, '무신사 CJ 주문 수량은 2+1')
assert(musinsaSum?.cjGiftRowCount === 1, '무신사 사은품 행은 1행')
assert(musinsaSum?.cjGiftQuantity === 1, '무신사 사은품 수량은 1')
assert(cmSum?.orderCount === 2, '29CM 주문 건수는 2건')
assert(cmSum?.sourceQuantity === 4, '29CM 원본 수량은 3+1')
assert(cmSum?.cjGiftQuantity === 2, '29CM 사은품 수량은 2')
assert(
  musinsaSum?.sourceMallNames.includes('MUSINSA'),
  '원본 표기 MUSINSA가 남아야 한다',
)

const again = summarizeInvoiceWorkSites({
  sourceRows: rows.slice(0, 5),
  outputRows: output,
  resolution: ready,
})
assert(
  JSON.stringify(summaries) === JSON.stringify(again),
  '같은 입력의 집계는 같아야 한다',
)

const payloadA = invoiceWorkFingerprintPayload(rows)
const payloadB = invoiceWorkFingerprintPayload([...rows].reverse())
assert(payloadA === payloadB, '행 순서가 달라도 같은 파일 지문 원문이어야 한다')
assert(
  !payloadA.includes('숨김주소') && !payloadA.includes('숨김'),
  '지문에 수령인·주소가 들어가면 안 된다',
)

const hashA = await fingerprintInvoiceWorkRows(rows)
const hashB = await fingerprintInvoiceWorkRows([...rows].reverse())
assert(hashA === hashB, '같은 파일은 같은 SHA-256이어야 한다')
assert(hashA.length === 64, 'SHA-256 hex 길이')
assert(
  hashA !== (await fingerprintInvoiceWorkRows(rows.slice(0, 3))),
  '다른 내용은 다른 지문이어야 한다',
)

assert(parseInvoiceQuantity('2,000') === 2000, '수량 천단위 쉼표를 읽어야 한다')
assert(parseInvoiceQuantity('x') === 0, '잘못된 수량은 0이다')

const folders = [
  folder({ id: 'f-online', name: '온라인', parentId: null }),
  folder({ id: 'f-sabang', name: '사방넷', parentId: 'f-online' }),
  folder({ id: 'f-offline', name: '유통', parentId: null }),
]
assert(
  folderPathLabel(folders, 'f-sabang') === '온라인 / 사방넷',
  '사방넷 경로 라벨',
)
assert(
  findDefaultSabangnetFolderId(folders) === 'f-sabang',
  '신규 등록 기본 폴더는 온라인 / 사방넷',
)
assert(
  findDefaultSabangnetFolderId([folder({ id: 'f-only', name: '사방넷', parentId: null })]) ===
    'f-only',
  '경로가 없으면 사방넷 이름 폴더를 쓴다',
)

console.log('invoice mall resolution verify: ok')
