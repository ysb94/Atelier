/**
 * 출고 데이터 입력용 사방넷 점검. 실행: npm run verify:invoice-data-entry
 */
import {
  assessSabangnetDataEntry,
  INVOICE_DATA_ENTRY_MAX_FILE_BYTES,
  validateSabangnetUploadFile,
} from '@/lib/invoice/sabangnet-data-entry'
import {
  inspectSabangnetSheets,
  SABANGNET_COLUMNS,
  type SabangnetOrderRow,
} from '@/lib/invoice/sabangnet'
import type { ParsedSheet } from '@/lib/import/parse'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function row(
  rowNumber: number,
  patch: Partial<SabangnetOrderRow> = {},
): SabangnetOrderRow {
  return {
    rowNumber,
    productName: '울 코트',
    itemName: '블랙 / M',
    quantity: '1',
    recipientName: `수령인${rowNumber}`,
    recipientPhone: `0100000${String(rowNumber).padStart(4, '0')}`,
    recipientOtherPhone: '',
    shippingType: '선불',
    recipientAddress: `서울 가상주소 ${rowNumber}`,
    shippingMessage: '문 앞에 놓아주세요',
    customerOrderNo: `ORD-${String(rowNumber).padStart(5, '0')}`,
    mallName: '테스트몰',
    orderedAt: '2026-08-28 10:00',
    ownProductCode: 'COAT01',
    ...patch,
  }
}

function sheetsFromRows(rows: SabangnetOrderRow[]): ParsedSheet[] {
  const header = SABANGNET_COLUMNS.map((column) => column.label)
  return [
    {
      name: '주문',
      rows: [
        header,
        ...rows.map((source) => [
          source.productName,
          source.itemName,
          source.quantity,
          source.recipientName,
          source.recipientPhone,
          source.recipientOtherPhone,
          source.shippingType,
          source.recipientAddress,
          source.shippingMessage,
          source.customerOrderNo,
          source.mallName,
          source.orderedAt,
          source.ownProductCode,
        ]),
      ],
    },
  ]
}

assert(
  validateSabangnetUploadFile({ name: '주문.csv', size: 100 }) ===
    '사방넷에서 내려받은 엑셀 파일(.xlsx, .xls)을 선택해주세요.',
  '확장자 오류',
)
assert(
  validateSabangnetUploadFile({
    name: '주문.xlsx',
    size: INVOICE_DATA_ENTRY_MAX_FILE_BYTES + 1,
  }) === '파일이 50MB를 넘습니다. 주문 기간을 나눠서 내려받아 주세요.',
  '용량 오류',
)
assert(
  validateSabangnetUploadFile({ name: '주문.xlsx', size: 1024 }) === null,
  '정상 엑셀',
)

const emptyShipping = row(1, {
  recipientName: '',
  recipientPhone: '',
  recipientOtherPhone: '',
  recipientAddress: '',
  shippingMessage: '',
})
const emptyShippingInspection = inspectSabangnetSheets(
  sheetsFromRows([emptyShipping]),
)
const emptyShippingAssessment = assessSabangnetDataEntry(
  emptyShippingInspection.rows,
)
assert(emptyShippingInspection.missingHeaders.length === 0, '헤더 유지')
assert(emptyShippingInspection.blockingRowCount === 1, '송장작업은 개인정보 누락을 막음')
assert(emptyShippingInspection.missingRecipientCount === 1, '수령인 집계')
assert(emptyShippingInspection.missingPhoneCount === 1, '연락처 집계')
assert(emptyShippingInspection.missingAddressCount === 1, '주소 집계')
assert(emptyShippingAssessment.blockingRowCount === 0, '출고 입력은 개인정보 누락을 통과')
assert(emptyShippingAssessment.emptyShippingCount === 1, '개인정보 빈 행 안내')
assert(emptyShippingAssessment.mallCount === 1, '업체 수')

const missingHeaderInspection = inspectSabangnetSheets([
  {
    name: '주문',
    rows: [
      ['품목명', '내품수량', '쇼핑몰명'],
      ['울 코트', '1', '테스트몰'],
    ],
  },
])
assert(missingHeaderInspection.missingHeaders.length > 0, '필수 헤더 누락')

const invalidQuantity = assessSabangnetDataEntry([row(2, { quantity: '0' })])
assert(invalidQuantity.invalidQuantityCount === 1, '수량 0')
assert(invalidQuantity.blockingRowCount === 1, '수량 오류 차단')

const missingMall = assessSabangnetDataEntry([row(3, { mallName: '' })])
assert(missingMall.missingMallCount === 1, '쇼핑몰명 없음')
assert(missingMall.blockingRowCount === 1, '쇼핑몰명 차단')

const missingOrderedAt = assessSabangnetDataEntry([row(4, { orderedAt: '' })])
assert(missingOrderedAt.missingOrderedAtCount === 1, '주문일시 없음')
assert(missingOrderedAt.blockingRowCount === 1, '주문일시 차단')

const missingProduct = assessSabangnetDataEntry([row(5, { productName: '' })])
assert(missingProduct.missingProductNameCount === 1, '품목명 없음')
assert(missingProduct.blockingRowCount === 1, '품목명 차단')

const ready = assessSabangnetDataEntry([row(6), row(7, { mallName: '다른몰' })])
assert(ready.blockingRowCount === 0, '정상 행 통과')
assert(ready.mallCount === 2, '고유 업체 2곳')
assert(ready.emptyShippingCount === 0, '개인정보 있음')

console.log('invoice-data-entry verify: ok')
