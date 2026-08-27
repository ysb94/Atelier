import type { InvoiceProductListEntry } from '@/lib/invoice/product-list-summary'

export const INVOICE_PRODUCT_LIST_BACKUP_HEADERS = [
  'M번호',
  '공식 상품명',
  '수량',
] as const

export function buildInvoiceProductListBackupRows(
  entries: InvoiceProductListEntry[],
) {
  return entries.map((entry) => [
    entry.styleNo,
    entry.styleName,
    entry.quantity,
  ])
}

function backupTimestamp(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}${month}${day}_${hours}${minutes}`
}

export async function downloadInvoiceProductListBackup(
  entries: InvoiceProductListEntry[],
) {
  const XLSX = await import('xlsx')
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...INVOICE_PRODUCT_LIST_BACKUP_HEADERS],
    ...buildInvoiceProductListBackupRows(entries),
  ])
  worksheet['!cols'] = [{ wch: 14 }, { wch: 48 }, { wch: 12 }]
  worksheet['!autofilter'] = { ref: 'A1:C1' }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '선택상품리스트')
  XLSX.writeFile(
    workbook,
    `선택상품리스트_백업_${backupTimestamp(new Date())}.xlsx`,
  )
}
