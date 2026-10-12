import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'
import { verifyBarcodeHistoryRead } from '@/lib/supabase/barcode-history-read.verify'
import {
  applyBarcodeDataEntrySiteLookup,
  assignBarcodeDataEntryEmptySite,
  barcodeDataEntryAllReady,
  barcodeDataEntryBackupEntries,
  barcodeDataEntryCompanyKey,
  barcodeDataEntryRowsFromHistory,
  barcodeDataEntryRunSourceRef,
  barcodeDataEntrySourceRefSuffix,
  groupBarcodeDataEntryHistory,
  groupBarcodeDataEntryCompaniesByCategory,
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
  groupName?: string
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
    groupId: input.groupId === undefined ? 'kyobo' : input.groupId,
    groupName: input.groupName ?? '교보문고',
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
  barcodeDataEntryRunSourceRef('run-1') === 'barcode-data-entry:run-1',
  '등록 ID로 출처 키를 만든다',
)
assert(
  barcodeDataEntrySourceRefSuffix('barcode-data-entry:run-1') === 'run-1',
  '출처에서 등록 ID를 되돌린다',
)

const historyLedger = [
  {
    id: '1',
    sourceRef: 'barcode-data-entry:run-1',
    styleId: 's1',
    styleNo: 'M1',
    styleName: '가방',
    usageTargetId: 'u1',
    partnerName: '강남점',
    shippedOn: '2026-09-04',
    quantity: 2,
    note: '1차',
    createdAt: '2026-09-04T01:00:00.000Z',
  },
  {
    id: '2',
    sourceRef: 'barcode-data-entry:run-1',
    styleId: 's1',
    styleNo: 'M1',
    styleName: '가방',
    usageTargetId: 'u2',
    partnerName: '광화문점',
    shippedOn: '2026-09-04',
    quantity: 1,
    note: '1차',
    createdAt: '2026-09-04T01:00:00.000Z',
  },
  {
    id: '3',
    sourceRef: 'barcode-data-entry:run-2',
    styleId: 's1',
    styleNo: 'M1',
    styleName: '가방',
    usageTargetId: 'u1',
    partnerName: '강남점',
    shippedOn: '2026-09-04',
    quantity: 5,
    note: '2차',
    createdAt: '2026-09-04T03:00:00.000Z',
  },
  {
    id: '4',
    sourceRef: 'barcode-data-entry:kyobo',
    styleId: 's2',
    styleNo: 'M2',
    styleName: '지갑',
    usageTargetId: 'u3',
    partnerName: '부산대점',
    shippedOn: '2026-09-03',
    quantity: 4,
    note: '',
    createdAt: '2026-09-03T05:00:00.000Z',
  },
]
const historyRuns = [
  {
    id: 'run-1',
    companyKey: 'kyobo',
    shippedOn: '2026-09-04',
    note: '1차',
    workerLabel: '김지선',
    registeredAt: '2026-09-04T01:00:00.000Z',
  },
  {
    id: 'run-2',
    companyKey: 'kyobo',
    shippedOn: '2026-09-04',
    note: '2차',
    workerLabel: '윤설빈',
    registeredAt: '2026-09-04T03:00:00.000Z',
  },
]

assert(
  groupBarcodeDataEntryHistory(historyLedger, historyRuns)
    .map((job) => `${job.companyKey}:${job.workerLabel || '-'}:${job.qty}`)
    .join(',') === 'kyobo:윤설빈:5,kyobo:김지선:3,kyobo:-:4',
  '같은 업체·출고일이어도 등록이 다르면 따로 남기고 최신 등록을 위에 둔다',
)
assert(
  groupBarcodeDataEntryHistory(historyLedger, historyRuns)
    .map((job) => job.runId ?? 'legacy')
    .join(',') === 'run-2,run-1,legacy',
  '등록 이력이 없는 예전 반영분은 runId 없이 읽기 전용으로 남긴다',
)
assert(
  groupBarcodeDataEntryHistory(historyLedger, historyRuns).at(-1)
    ?.registeredAt === '2026-09-03T05:00:00.000Z',
  '예전 반영분의 등록시간은 원장 생성 시각으로 채운다',
)
assert(
  barcodeDataEntryBackupEntries(
    barcodeDataEntryRowsFromHistory([
      {
        id: '1',
        styleId: 's1',
        styleNo: 'M1',
        styleName: '가방',
        usageTargetId: 'u1',
        partnerName: '강남점',
        quantity: 2,
      },
      {
        id: '2',
        styleId: 's1',
        styleNo: 'M1',
        styleName: '가방',
        usageTargetId: 'u1',
        partnerName: '강남점',
        quantity: 3,
      },
    ]),
  ).map((entry) => `${entry.usageTargetId}:${entry.styleId}:${entry.quantity}`).join() ===
    'u1:s1:5',
  '이력 행을 백업 수량으로 다시 합친다',
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
  groupName: '영풍문고',
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

const assignedEmpty = assignBarcodeDataEntryEmptySite(twoCol.rows, gangnam)
assert(
  assignedEmpty[0]?.siteName === '강남점' &&
    assignedEmpty[0]?.usageTargetId === 'u-gangnam' &&
    assignedEmpty[0]?.siteStatus === 'matched',
  '빈 지점명 행에 고른 지점을 넣는다',
)
assert(
  assignBarcodeDataEntryEmptySite(pasted.rows, gangnam)[0]?.siteName ===
    '광주터미널점',
  '지점명이 있는 행은 그대로 둔다',
)

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

const fullNameRows = applyBarcodeDataEntrySiteLookup(
  parseBarcodeDataEntryText('가방\t1\t교보문고 강남점\n지갑\t2\t교보문고 · 부산점\n가방\t1\t교보문고 강남점 오프라인').rows,
  companyUnits,
  new Map(),
)
assert(fullNameRows.map((item) => item.usageTargetId).join(',') === 'u-gangnam,u-busan,u-gangnam', '업체와 지점의 전체 이름을 분류 없이 연결하고 기존 합성명도 유지한다')
const tenOnline = unit({ id: 'ten-online', groupId: 'ten', groupName: '텐바이텐', name: '텐바이텐 온라인' })
const tenRows = applyBarcodeDataEntrySiteLookup(
  parseBarcodeDataEntryText('가방\t1\t텐바이텐').rows,
  [tenOnline],
  new Map(),
)
assert(tenRows[0]?.usageTargetId === 'ten-online', '지점 없는 업체도 분류 없는 등록명으로 연결한다')

const duplicateSite = unit({ id: 'other-gangnam', groupId: 'another', groupName: '다른업체', name: '다른업체 강남점 오프라인', siteName: '강남점' })
const ambiguousSites = applyBarcodeDataEntrySiteLookup(
  parseBarcodeDataEntryText('가방\t1\t강남점\n지갑\t1\t교보문고 강남점').rows,
  [duplicateSite, gangnam],
  new Map(),
)
assert(ambiguousSites[0]?.siteStatus === 'unmatched', '조회 범위에 같은 지점명 두 개가 있으면 첫 업체로 임의 연결하지 않는다')
assert(ambiguousSites[1]?.usageTargetId === 'u-gangnam', '전체 업체·지점명은 같은 지점명 충돌에도 정확히 연결한다')

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

function folder(id: string, name: string, parentId: string | null, order: number): CodeUsageTargetFolder {
  return { id, name, parentId, order, brandId: 'brand', normalizedName: name, createdAt: '', updatedAt: '' }
}
const categoryFolders = [
  folder('offline', '오프라인', null, 1),
  folder('sabang', '사방넷', 'online', 0),
  folder('retail', '위탁', 'offline', 0),
  folder('online', '온라인', null, 0),
  folder('overseas', '해외', null, 2),
]
const scopedTenOnline = { ...tenOnline, folderId: 'sabang', channelType: 'online' as const }
const scopedDaehakro = {
  ...unit({ id: 'ten-daehakro', groupId: 'ten', groupName: '텐바이텐', name: '텐바이텐 대학로점 오프라인', siteName: '대학로점' }),
  folderId: 'retail',
}
const scopedWarehouse = {
  ...unit({ id: 'ten-warehouse', groupId: 'ten', groupName: '텐바이텐', name: '텐바이텐 물류센터 오프라인', siteName: '물류센터' }),
  folderId: 'offline',
}
const scopedOverseas = {
  ...unit({ id: 'ten-overseas', groupId: 'ten', groupName: '텐바이텐', name: '텐바이텐 일본', siteName: '일본' }),
  folderId: 'overseas', channelType: 'unset' as const,
}
const missingFolder = {
  ...unit({ id: 'unknown-folder', groupId: null, groupName: '', name: '미분류업체' }),
  folderId: 'missing',
}
const scopedTargets = [scopedTenOnline, scopedDaehakro, scopedWarehouse, scopedOverseas, missingFolder]
const categorySelections = groupBarcodeDataEntryCompaniesByCategory(scopedTargets, categoryFolders)
assert(categorySelections.map((category) => category.name).join(',') === '온라인,오프라인,해외,미분류', '최상위 폴더만 설정 순서대로 보여 주고 사방넷·위탁은 하위 분류로 펼치지 않는다')
const onlineCompany = categorySelections[0]!.companies[0]!
const offlineCompany = categorySelections[1]!.companies[0]!
const overseasCompany = categorySelections[2]!.companies[0]!
assert(onlineCompany.units.map((item) => item.id).join() === 'ten-online', '온라인 업체 선택에는 온라인 대상만 포함한다')
assert(offlineCompany.units.map((item) => item.id).sort().join() === 'ten-daehakro,ten-warehouse', '오프라인 하위 폴더와 루트의 지점은 같은 큰 분류로 묶는다')
assert(overseasCompany.units[0]?.id === 'ten-overseas', '해외는 채널 속성 대신 실제 최상위 폴더로 구분한다')
assert(new Set([onlineCompany.selectionKey, offlineCompany.selectionKey, overseasCompany.selectionKey]).size === 3, '같은 업체 그룹이라도 분류별 선택 키와 임시 입력 키는 다르다')
assert([onlineCompany.key, offlineCompany.key, overseasCompany.key].every((key) => key === 'ten'), 'DB 등록과 기존 이력에 쓰는 그룹 ID는 그대로 유지한다')
assert(categorySelections.reduce((sum, category) => sum + category.companies.reduce((total, company) => total + company.units.length, 0), 0) === scopedTargets.length, '모든 출고 대상은 한 최상위 분류에만 포함된다')
assert(categorySelections[3]!.companies[0]!.units[0]?.id === missingFolder.id, '분류가 없거나 사라진 폴더의 업체도 목록에서 빠지지 않는다')

const offlineOnlyKeys = visibleCompanyKeysFromUnitIds(scopedTargets, [scopedDaehakro.id], categoryFolders)!
assert(offlineOnlyKeys.has(offlineCompany.selectionKey) && !offlineOnlyKeys.has(onlineCompany.selectionKey), '지점 표시 설정은 같은 그룹의 다른 분류로 확대하지 않는다')
assert(unitIdsForCompanyKeys(scopedTargets, offlineOnlyKeys, categoryFolders).sort().join() === 'ten-daehakro,ten-warehouse', '오프라인 업체 체크는 해당 분류의 지점만 저장한다')
assert(filterTargetsByVisibleIds(scopedTargets, [scopedDaehakro.id], categoryFolders).map((item) => item.id).sort().join() === 'ten-daehakro,ten-warehouse', '기존 지점 ID 기반 표시 설정도 현재 분류의 업체 범위로 유지한다')

const categoryPasted = parseBarcodeDataEntryText('가방\t1\t텐바이텐\n지갑\t1\t텐바이텐 대학로점\n가방\t1\t온라인몰').rows
const allCategoryAliases = new Map([[scopedTenOnline.id, ['온라인몰']]])
const offlineResolved = applyBarcodeDataEntrySiteLookup(categoryPasted, offlineCompany.units, allCategoryAliases)
assert(offlineResolved[0]?.siteStatus === 'unmatched', '오프라인에서 지점을 생략한 텐바이텐 입력을 온라인으로 연결하지 않는다')
assert(offlineResolved[1]?.usageTargetId === scopedDaehakro.id, '오프라인 전체 지점명은 기존 지점 ID에 연결한다')
assert(offlineResolved[2]?.siteStatus === 'unmatched', '온라인에 등록된 별칭도 오프라인 작업 후보에 들어오지 않는다')
assert(applyBarcodeDataEntrySiteLookup(categoryPasted, onlineCompany.units, allCategoryAliases)[0]?.usageTargetId === scopedTenOnline.id, '온라인 작업에서는 텐바이텐 업체명 그대로 연결한다')
assert(applyBarcodeDataEntrySiteLookup(twoCol.rows, offlineCompany.units, new Map())[0]?.siteStatus === 'empty', '오프라인 지점이 여러 개면 빈 지점 입력도 특정 대상에 자동 연결하지 않는다')

console.log('barcode-outbound-data-entry.verify ok')
await verifyBarcodeHistoryRead()
