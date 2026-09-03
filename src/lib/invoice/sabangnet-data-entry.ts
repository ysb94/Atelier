import { parseInvoiceQuantity } from '@/lib/invoice/mall-resolution'
import { orderMomentOf } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'

export const INVOICE_DATA_ENTRY_MAX_FILE_BYTES = 50 * 1024 * 1024

export type SabangnetDataEntryAssessment = {
  mallCount: number
  missingProductNameCount: number
  missingMallCount: number
  missingOrderedAtCount: number
  invalidQuantityCount: number
  emptyShippingCount: number
  blockingRowCount: number
}

/** 클릭·드래그로 받은 사방넷 엑셀의 확장자·용량만 본다. */
export function validateSabangnetUploadFile(file: {
  name: string
  size: number
}): string | null {
  if (!/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
    return '사방넷에서 내려받은 엑셀 파일(.xlsx, .xls)을 선택해주세요.'
  }
  if (file.size > INVOICE_DATA_ENTRY_MAX_FILE_BYTES) {
    return '파일이 50MB를 넘습니다. 주문 기간을 나눠서 내려받아 주세요.'
  }
  return null
}

function hasEmptyShippingPii(row: SabangnetOrderRow): boolean {
  return (
    !row.recipientName.trim() ||
    (!row.recipientPhone.trim() && !row.recipientOtherPhone.trim()) ||
    !row.recipientAddress.trim()
  )
}

/**
 * 출고 데이터 입력용 점검. 받는분 성명·연락처·주소·배송메세지는
 * 비어 있어도 막지 않는다.
 */
export function assessSabangnetDataEntry(
  rows: readonly SabangnetOrderRow[],
): SabangnetDataEntryAssessment {
  const malls = new Set<string>()
  let missingProductNameCount = 0
  let missingMallCount = 0
  let missingOrderedAtCount = 0
  let invalidQuantityCount = 0
  let emptyShippingCount = 0
  let blockingRowCount = 0

  for (const row of rows) {
    const mallName = row.mallName.trim()
    if (mallName) malls.add(mallName)

    const missingProduct = !row.productName.trim()
    const missingMall = !mallName
    const missingOrderedAt = !orderMomentOf(row)
    const invalidQuantity = parseInvoiceQuantity(row.quantity) <= 0

    if (missingProduct) missingProductNameCount += 1
    if (missingMall) missingMallCount += 1
    if (missingOrderedAt) missingOrderedAtCount += 1
    if (invalidQuantity) invalidQuantityCount += 1
    if (hasEmptyShippingPii(row)) emptyShippingCount += 1
    if (missingProduct || missingMall || missingOrderedAt || invalidQuantity) {
      blockingRowCount += 1
    }
  }

  return {
    mallCount: malls.size,
    missingProductNameCount,
    missingMallCount,
    missingOrderedAtCount,
    invalidQuantityCount,
    emptyShippingCount,
    blockingRowCount,
  }
}
