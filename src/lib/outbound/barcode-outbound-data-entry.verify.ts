import type { CodeUsageTarget } from '@/lib/types'
import {
  applyBarcodeDataEntrySiteLookup,
  barcodeDataEntryAllReady,
  barcodeDataEntryBackupEntries,
  barcodeDataEntryCompanyKey,
  barcodeDataEntrySourceRef,
  barcodeDataEntryUnresolvedSites,
  filterTargetsByVisibleIds,
  isIsoDate,
  parseBarcodeDataEntryText,
  todayIsoDate,
  unitIdsForCompanyKeys,
  visibleCompanyKeysFromUnitIds,
} from './barcode-outbound-data-entry'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function unit(input: {
  id: string
  groupId?: string | null
  name: string
  siteName?: string
  active?: boolean
}): CodeUsageTarget {
  return {
    id: input.id,
    brandId: 'brand',
    name: input.name,
    normalizedName: input.name.replace(/\s+/g, ''),
    active: input.active ?? true,
    isOneTime: false,
    channelType: 'offline',
    shippingMethod: 'unset',
    folderId: null,
    groupId: input.groupId ?? 'kyobo',
    groupName: '교보문고',
    siteName: input.siteName ?? '',
    normalizedSiteName: (input.siteName ?? '').replace(/\s+/g, ''),
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    address: '',
    note: '',
    order: 0,
    createdAt: '',
    updatedAt: '',
  }
}

const sample = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c' },
] as CodeUsageTarget[]

assert(isIsoDate('2026-09-03'), 'ISO 날짜를 받아야 한다')
assert(!isIsoDate('2026/09/03'), '슬래시 날짜는 거절한다')
assert(
  todayIsoDate(new Date('2026-09-03T15:00:00+09:00')) === '2026-09-03',
  '서울 날짜를 쓴다',
)
assert(
  barcodeDataEntrySourceRef('kyobo') === 'barcode-data-entry:kyobo',
  '출처 키를 만든다',
)
assert(
  filterTargetsByVisibleIds(sample, null).map((row) => row.id).join() ===
    'a,b,c',
  '설정 전에는 전체를 보여 준다',
)
assert(
  filterTargetsByVisibleIds(sample, ['b']).map((row) => row.id).join() === 'b',
  '체크한 곳만 남긴다',
)
assert(
  filterTargetsByVisibleIds(sample, []).length === 0,
  '빈 설정은 아무것도 보여 주지 않는다',
)

const gangnam = unit({
  id: 'u-gangnam',
  name: '교보문고 강남점 오프라인',
  siteName: '강남점',
})
const busan = unit({
  id: 'u-busan',
  name: '교보문고 부산점 오프라인',
  siteName: '부산점',
})
const gwanghwamun = unit({
  id: 'u-gwang',
  name: '교보문고 광화문점 오프라인',
  siteName: '광화문점',
})
const otherCompany = unit({
  id: 'u-young',
  groupId: 'youngpoong',
  name: '영풍문고 부산대점 오프라인',
  siteName: '부산대점',
})
const companyUnits = [gangnam, busan, gwanghwamun]
const aliases = new Map<string, string[]>([
  ['u-gwang', ['광주터미널점']],
])

const pasted = parseBarcodeDataEntryText(`미니스 데이지 블랙	1	광주터미널점
베파 옥수수 네이비	1	광주터미널점
스파 누빔	1	부산대점
베파 라벤더	2	신림타임스트림점
데일리백팩 블랙	1	강남점`)
assert(!pasted.error, pasted.error ?? '3열 붙여넣기를 읽어야 한다')
assert(pasted.rows.length === 5, '5행을 읽어야 한다')
assert(pasted.rows[0]?.siteName === '광주터미널점', '지점명을 세 번째 칸에서 읽는다')
assert(pasted.rows[3]?.qty === 2, '수량을 읽는다')

const headed = parseBarcodeDataEntryText(
  '상품명\t수량\t지점명\n가방\t3\t강남점',
)
assert(headed.rows[0]?.productName === '가방', '헤더가 있어도 읽는다')
assert(headed.rows[0]?.siteName === '강남점', '헤더 지점명을 읽는다')

const twoCol = parseBarcodeDataEntryText('가방\t3')
assert(twoCol.rows[0]?.siteName === '', '2열은 지점명을 비운다')

const resolved = applyBarcodeDataEntrySiteLookup(
  pasted.rows,
  companyUnits,
  aliases,
)
assert(
  resolved[0]?.siteStatus === 'matched' &&
    resolved[0]?.usageTargetId === 'u-gwang',
  '별칭 지점명을 연결한다',
)
assert(
  resolved[4]?.siteStatus === 'matched' &&
    resolved[4]?.usageTargetId === 'u-gangnam',
  '같은 지점명을 연결한다',
)
assert(resolved[2]?.siteStatus === 'unmatched', '회사 밖 지점은 막는다')
assert(
  applyBarcodeDataEntrySiteLookup(resolved, [otherCompany], new Map())[2]
    ?.siteStatus === 'matched',
  '다른 업체에서는 그 지점명이 연결된다',
)

const unresolved = barcodeDataEntryUnresolvedSites(resolved)
assert(
  unresolved.map((site) => site.displayName).join(',') ===
    '부산대점,신림타임스트림점',
  '미연결 지점만 모은다',
)

const linked = resolved.map((row) =>
  row.siteStatus === 'matched'
    ? { ...row, styleNo: 'M1', styleId: 'style-1' }
    : row,
)
assert(!barcodeDataEntryAllReady(linked), '미연결 지점이 있으면 백업하지 않는다')

const ready = applyBarcodeDataEntrySiteLookup(
  [
    {
      ...linked[0]!,
      styleNo: 'M1',
      styleId: 'style-1',
    },
    {
      ...linked[1]!,
      styleNo: 'M1',
      styleId: 'style-1',
    },
    {
      ...linked[4]!,
      styleNo: 'M2',
      styleId: 'style-2',
    },
  ],
  companyUnits,
  aliases,
)
const entries = barcodeDataEntryBackupEntries(ready)
assert(entries.length === 2, '지점·M번호별로 합친다')
assert(
  entries.some(
    (entry) =>
      entry.usageTargetId === 'u-gwang' &&
      entry.styleId === 'style-1' &&
      entry.quantity === 2,
  ),
  '같은 지점·같은 M번호 수량을 더한다',
)
assert(
  entries.some(
    (entry) =>
      entry.usageTargetId === 'u-gangnam' &&
      entry.styleId === 'style-2' &&
      entry.quantity === 1,
  ),
  '다른 지점은 따로 둔다',
)

const storedIds = ['u-gangnam']
const companyKeys = visibleCompanyKeysFromUnitIds(companyUnits, storedIds)
assert(companyKeys?.has('kyobo') === true, '예전 지점 설정을 업체로 펼친다')
assert(
  unitIdsForCompanyKeys(companyUnits, companyKeys ?? new Set()).length === 3,
  '업체 체크는 지점 전체를 저장한다',
)
assert(
  barcodeDataEntryCompanyKey(gangnam) === 'kyobo',
  '업체 키는 그룹 id다',
)

console.log('barcode-outbound-data-entry.verify ok')
