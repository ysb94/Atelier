/**
 * 송장 품목명 자리·포장 표시 검증.
 * 실행: npm run verify:shipment-product-label
 */
import {
  applyInvoiceShipmentProductLabels,
  type InvoiceOutputRow,
} from '@/lib/invoice/invoice-output'
import {
  buildInvoiceShipmentLocationByStyleNo,
  buildInvoiceShipmentPackingCodeByStyleNo,
  formatInvoiceShipmentProductName,
  lookupInvoiceShipmentLabels,
} from '@/lib/invoice/shipment-product-label'
import type {
  BrandField,
  InvoicePackingSizeMap,
  Style,
  WarehouseStockPosition,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  formatInvoiceShipmentProductName({
    productName: '미니 이지 플랩백팩 블랙',
    locationLabel: '$-7-8//',
    packingCode: 'P2',
    linkedStyle: true,
  }) === '[$-7-8//] [P2] // 미니 이지 플랩백팩 블랙 //',
  '자리·포장·상품명 형식',
)

assert(
  formatInvoiceShipmentProductName({
    productName: '사은품(1) : 비비 마카롱 비치볼 레드',
    locationLabel: '2-1-1',
    packingCode: 'P1',
    linkedStyle: true,
  }) === '사은품(1) : [2-1-1] [P1] // 비비 마카롱 비치볼 레드 //',
  '사은품 접두는 유지하고 본문만 감싼다',
)

assert(
  formatInvoiceShipmentProductName({
    productName: '원문 유지',
    locationLabel: 'A1',
    packingCode: 'P2',
    linkedStyle: false,
  }) === '원문 유지',
  'M번호 미연결은 원문 유지',
)

assert(
  formatInvoiceShipmentProductName({
    productName: '내품 스트랩',
    locationLabel: '',
    packingCode: 'P3',
    linkedStyle: true,
  }) === '[P3] // 내품 스트랩 //',
  '자리 없으면 포장만',
)

const positions = [
  {
    styleNo: 'M1000',
    locationCode: '$-7-8',
    isFinalLocation: true,
    isForcedPriority: false,
    receivedOn: '2026-01-01',
    sourceRowNumber: 1,
    remainingBoxes: 1,
    openedUnits: 0,
    unitsPerBox: 10,
    zone: 'picking',
  },
  {
    styleNo: 'M1000',
    locationCode: '4-1-1',
    isFinalLocation: false,
    isForcedPriority: false,
    receivedOn: '2026-01-02',
    sourceRowNumber: 2,
    remainingBoxes: 2,
    openedUnits: 0,
    unitsPerBox: 10,
    zone: 'box_storage',
  },
] as WarehouseStockPosition[]

const boxLocations = buildInvoiceShipmentLocationByStyleNo(positions)
assert(boxLocations.get('M1000') === '4-1-1', '기본은 박스창고 1순위 자리')

const pickingLocations = buildInvoiceShipmentLocationByStyleNo(
  positions,
  'picking',
)
assert(
  pickingLocations.get('M1000') === '$-7-8//',
  '출고창고 선택 시 출고 1순위 자리',
)

const field = {
  id: 'field-pack',
  label: '택배 포장 규격(단품)',
  systemKey: null,
} as BrandField

const styles = [
  {
    styleNo: 'M1000',
    values: { 'field-pack': '30*40' },
    customFields: {},
  },
  {
    styleNo: 'M2000',
    values: { 'field-pack': '20*30' },
    customFields: {},
  },
] as unknown as Style[]

const maps = [
  {
    normalizedSourceValue: '30*40',
    sourceValue: '30*40',
    displayValue: 'P2',
  },
] as InvoicePackingSizeMap[]

const packing = buildInvoiceShipmentPackingCodeByStyleNo({
  styles,
  field,
  maps,
})
assert(packing.get('M1000') === 'P2', '포장 규격 매핑')
assert(!packing.has('M2000'), '미매핑 포장은 비움')

const lookups = {
  locationByStyleNo: boxLocations,
  packingCodeByStyleNo: packing,
}
const lookedUp = lookupInvoiceShipmentLabels('M1000', lookups)
assert(
  lookedUp.locationLabel === '4-1-1' && lookedUp.packingCode === 'P2',
  '스타일 조회',
)

const labeled = applyInvoiceShipmentProductLabels(
  [
    {
      kind: 'order',
      finalProductName: '미니 이지 플랩백팩 블랙',
      productName: '미니 이지 플랩백팩 블랙',
      linkedStyleNo: 'M1000',
    },
    {
      kind: 'gift',
      finalProductName: '사은품(1) : 비비 마카롱 비치볼 레드',
      productName: '사은품(1) : 비비 마카롱 비치볼 레드',
      linkedStyleNo: 'M1000',
    },
    {
      kind: 'order',
      finalProductName: '미연결 원문',
      productName: '미연결 원문',
      linkedStyleNo: null,
    },
  ] as InvoiceOutputRow[],
  lookups,
)

assert(
  labeled[0]?.finalProductName ===
    '[4-1-1] [P2] // 미니 이지 플랩백팩 블랙 //',
  '본품 라벨',
)
assert(
  labeled[1]?.finalProductName ===
    '사은품(1) : [4-1-1] [P2] // 비비 마카롱 비치볼 레드 //',
  '사은품 라벨',
)
assert(labeled[2]?.finalProductName === '미연결 원문', '미연결 유지')

console.log('shipment-product-label verify: ok')
