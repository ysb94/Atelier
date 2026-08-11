import type { ParsedSheet } from '@/lib/import/parse'

export type SabangnetFieldKey =
  | 'productName'
  | 'itemName'
  | 'quantity'
  | 'recipientName'
  | 'recipientPhone'
  | 'recipientOtherPhone'
  | 'shippingType'
  | 'recipientAddress'
  | 'shippingMessage'
  | 'customerOrderNo'
  | 'mallName'
  | 'orderedAt'
  | 'ownProductCode'

type SabangnetColumn = {
  key: SabangnetFieldKey
  label: string
  aliases: string[]
}

export const SABANGNET_COLUMNS: SabangnetColumn[] = [
  { key: 'productName', label: '품목명', aliases: ['품목명'] },
  { key: 'itemName', label: '내품명', aliases: ['내품명'] },
  { key: 'quantity', label: '내품수량', aliases: ['내품수량'] },
  { key: 'recipientName', label: '받는분성명', aliases: ['받는분성명'] },
  {
    key: 'recipientPhone',
    label: '받는분전화번호',
    aliases: ['받는분전화번호'],
  },
  {
    key: 'recipientOtherPhone',
    label: '받는분기타연락처',
    aliases: ['받는분기타연락처'],
  },
  { key: 'shippingType', label: '운임구분', aliases: ['운임구분'] },
  {
    key: 'recipientAddress',
    label: '받는분주소',
    aliases: ['받는분주소'],
  },
  {
    key: 'shippingMessage',
    label: '배송메세지',
    aliases: ['배송메세지', '배송메시지'],
  },
  {
    key: 'customerOrderNo',
    label: '고객주문번호',
    aliases: ['고객주문번호'],
  },
  { key: 'mallName', label: '쇼핑몰명', aliases: ['쇼핑몰명'] },
  {
    key: 'orderedAt',
    label: '주문일시(YYYY-MM-DD HH:MM)',
    aliases: ['주문일시(YYYY-MM-DD HH:MM)', '주문일시'],
  },
  {
    key: 'ownProductCode',
    label: '자체품번코드',
    aliases: ['자체상품코드', '자체품번코드'],
  },
]

export type SabangnetOrderRow = {
  rowNumber: number
  productName: string
  itemName: string
  quantity: string
  recipientName: string
  recipientPhone: string
  recipientOtherPhone: string
  shippingType: string
  recipientAddress: string
  shippingMessage: string
  customerOrderNo: string
  mallName: string
  orderedAt: string
  ownProductCode: string
}

export type SabangnetInspection = {
  sheetName: string
  headerRowNumber: number
  columnCount: number
  rowCount: number
  orderCount: number
  repeatedOrderRowCount: number
  missingHeaders: string[]
  missingProductCodeCount: number
  missingRecipientCount: number
  missingPhoneCount: number
  missingAddressCount: number
  invalidQuantityCount: number
  blockingRowCount: number
  rows: SabangnetOrderRow[]
}

type HeaderCandidate = {
  sheet: ParsedSheet
  headerRowIndex: number
  indexByKey: Partial<Record<SabangnetFieldKey, number>>
  score: number
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('ko-KR')
}

const aliasesByKey = new Map<SabangnetFieldKey, Set<string>>(
  SABANGNET_COLUMNS.map((column) => [
    column.key,
    new Set(column.aliases.map(normalizeHeader)),
  ]),
)

function inspectHeaderRow(
  sheet: ParsedSheet,
  headerRowIndex: number,
): HeaderCandidate {
  const row = sheet.rows[headerRowIndex] ?? []
  const indexByKey: Partial<Record<SabangnetFieldKey, number>> = {}

  row.forEach((rawHeader, columnIndex) => {
    const header = normalizeHeader(rawHeader)
    if (!header) return

    for (const column of SABANGNET_COLUMNS) {
      if (indexByKey[column.key] !== undefined) continue
      if (aliasesByKey.get(column.key)?.has(header)) {
        indexByKey[column.key] = columnIndex
        break
      }
    }
  })

  return {
    sheet,
    headerRowIndex,
    indexByKey,
    score: Object.keys(indexByKey).length,
  }
}

function findBestHeader(sheets: ParsedSheet[]): HeaderCandidate | null {
  let best: HeaderCandidate | null = null

  for (const sheet of sheets) {
    const scanLimit = Math.min(sheet.rows.length, 10)
    for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
      const candidate = inspectHeaderRow(sheet, rowIndex)
      if (!best || candidate.score > best.score) best = candidate
    }
  }

  return best
}

function cell(
  row: string[],
  key: SabangnetFieldKey,
  indexes: Partial<Record<SabangnetFieldKey, number>>,
): string {
  const index = indexes[key]
  return index === undefined ? '' : (row[index] ?? '').trim()
}

function isPositiveQuantity(value: string): boolean {
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed > 0
}

export function inspectSabangnetSheets(
  sheets: ParsedSheet[],
): SabangnetInspection {
  const candidate = findBestHeader(sheets)
  if (!candidate) {
    throw new Error('읽을 수 있는 시트가 없습니다.')
  }

  const { sheet, headerRowIndex, indexByKey } = candidate
  const missingHeaders = SABANGNET_COLUMNS.filter(
    (column) => indexByKey[column.key] === undefined,
  ).map((column) => column.label)

  const dataRows = sheet.rows
    .slice(headerRowIndex + 1)
    .map((row, index) => ({
      row,
      rowNumber: headerRowIndex + index + 2,
    }))
    .filter(({ row }) => row.some((value) => value.trim() !== ''))

  const orderNumbers = new Set<string>()
  let repeatedOrderRowCount = 0
  let missingProductCodeCount = 0
  let missingRecipientCount = 0
  let missingPhoneCount = 0
  let missingAddressCount = 0
  let invalidQuantityCount = 0
  let blockingRowCount = 0

  const rows = dataRows.map(({ row, rowNumber }) => ({
    rowNumber,
    productName: cell(row, 'productName', indexByKey),
    itemName: cell(row, 'itemName', indexByKey),
    quantity: cell(row, 'quantity', indexByKey),
    recipientName: cell(row, 'recipientName', indexByKey),
    recipientPhone: cell(row, 'recipientPhone', indexByKey),
    recipientOtherPhone: cell(row, 'recipientOtherPhone', indexByKey),
    shippingType: cell(row, 'shippingType', indexByKey),
    recipientAddress: cell(row, 'recipientAddress', indexByKey),
    shippingMessage: cell(row, 'shippingMessage', indexByKey),
    customerOrderNo: cell(row, 'customerOrderNo', indexByKey),
    mallName: cell(row, 'mallName', indexByKey),
    orderedAt: cell(row, 'orderedAt', indexByKey),
    ownProductCode: cell(row, 'ownProductCode', indexByKey),
  }))

  for (const { row } of dataRows) {
    const orderNumber = cell(row, 'customerOrderNo', indexByKey)
    if (orderNumber) {
      if (orderNumbers.has(orderNumber)) {
        repeatedOrderRowCount += 1
      }
      orderNumbers.add(orderNumber)
    }

    const missingRecipient = !cell(row, 'recipientName', indexByKey)
    const missingPhone =
      !cell(row, 'recipientPhone', indexByKey) &&
      !cell(row, 'recipientOtherPhone', indexByKey)
    const missingAddress = !cell(row, 'recipientAddress', indexByKey)
    const invalidQuantity = !isPositiveQuantity(
      cell(row, 'quantity', indexByKey),
    )

    if (!cell(row, 'ownProductCode', indexByKey)) missingProductCodeCount += 1
    if (missingRecipient) missingRecipientCount += 1
    if (missingPhone) missingPhoneCount += 1
    if (missingAddress) missingAddressCount += 1
    if (invalidQuantity) invalidQuantityCount += 1
    if (
      missingRecipient ||
      missingPhone ||
      missingAddress ||
      invalidQuantity
    ) {
      blockingRowCount += 1
    }
  }

  return {
    sheetName: sheet.name,
    headerRowNumber: headerRowIndex + 1,
    columnCount: sheet.rows[headerRowIndex]?.length ?? 0,
    rowCount: dataRows.length,
    orderCount: orderNumbers.size,
    repeatedOrderRowCount,
    missingHeaders,
    missingProductCodeCount,
    missingRecipientCount,
    missingPhoneCount,
    missingAddressCount,
    invalidQuantityCount,
    blockingRowCount,
    rows,
  }
}
