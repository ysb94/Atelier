import type { BrandField, Season } from '@/lib/types'
import { listActiveSelectOptions } from '@/lib/products/brand-field-select'

export const SELECT_LIST_SHEET = '선택목록'
export const GENDER_SELECT_VALUES = ['여성', '남성', '공용']
/** 드롭다운 열 헤더. 본문보다 조금 진한 하늘색. */
export const SELECT_COLUMN_HEADER_FILL = 'FFD6E6F7'
/** 드롭다운 열 입력칸. 흰색과 구분되는 연한 하늘색. */
export const SELECT_COLUMN_FILL = 'FFEAF3FA'

export function isProductDropdownField(field: BrandField) {
  return (
    field.type === 'select' ||
    field.type === 'gender' ||
    field.type === 'season' ||
    field.systemKey === 'gender' ||
    field.systemKey === 'seasonCode' ||
    field.systemKey === 'seasonId'
  )
}

export type ProductSelectList = {
  key: string
  header: string
  values: string[]
}

export function collectProductSelectLists(
  fields: BrandField[],
  seasons: Season[] = [],
): ProductSelectList[] {
  const lists: ProductSelectList[] = []
  for (const field of fields) {
    if (field.type === 'gender' || field.systemKey === 'gender') {
      lists.push({
        key: field.id || 'gender',
        header: field.label,
        values: [...GENDER_SELECT_VALUES],
      })
      continue
    }
    if (
      field.type === 'season' ||
      field.systemKey === 'seasonCode' ||
      field.systemKey === 'seasonId'
    ) {
      const values = seasons.map((season) => season.code).filter(Boolean)
      if (values.length > 0) {
        lists.push({
          key: field.id || 'season',
          header: field.label,
          values,
        })
      }
      continue
    }
    if (field.type === 'select') {
      const values = listActiveSelectOptions(field).map((option) => option.label)
      if (values.length > 0) {
        lists.push({
          key: field.id,
          header: field.label,
          values,
        })
      }
    }
  }
  return lists
}

export function namedSelectRange(key: string) {
  const safe = key.replace(/[^A-Za-z0-9]/g, '') || 'Col'
  return `Sel_${safe}`
}

export function allowedValuesForField(
  field: BrandField,
  seasons: Season[] = [],
): string {
  return collectProductSelectLists([field], seasons)[0]?.values.join(', ') ?? ''
}

export type ProductWorkbookInput = {
  dataSheetName: string
  headers: string[]
  rows?: string[][]
  columnWidths?: number[]
  fields: BrandField[]
  seasons?: Season[]
  guideSheetName?: string
  guideRows?: string[][]
  guideColumnWidths?: number[]
  validationRows?: number
}

type WorkbookNames = {
  definedNames: {
    add: (location: string, name: string) => void
    model?: unknown
  }
}

type WorksheetValidations = {
  dataValidations: {
    add: (
      range: string,
      rules: {
        type: 'list'
        allowBlank?: boolean
        formulae: string[]
        showErrorMessage?: boolean
        errorStyle?: 'error' | 'warning' | 'information'
        errorTitle?: string
        error?: string
      },
    ) => void
    model?: Record<string, unknown>
  }
}

export function workbookDefinedNames(workbook: object) {
  return (workbook as WorkbookNames).definedNames
}

export function worksheetValidations(sheet: object) {
  return (sheet as WorksheetValidations).dataValidations
}

function fieldForHeader(fields: BrandField[], header: string) {
  return fields.find((field) => field.label === header)
}

function applySolidFill(cell: { fill?: unknown }, argb: string) {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb },
  }
}

function applyDropdownColumnFills(
  sheet: {
    getCell: (row: number, col: number) => { fill?: unknown; font?: unknown }
  },
  headers: string[],
  fields: BrandField[],
  lastRow: number,
) {
  for (const [index, header] of headers.entries()) {
    const field = fieldForHeader(fields, header)
    if (!field || !isProductDropdownField(field)) continue
    const col = index + 1
    for (let row = 1; row <= lastRow; row++) {
      const cell = sheet.getCell(row, col)
      applySolidFill(
        cell,
        row === 1 ? SELECT_COLUMN_HEADER_FILL : SELECT_COLUMN_FILL,
      )
      if (row === 1) {
        cell.font = { bold: true }
      }
    }
  }
}

export async function createProductWorkbook(input: ProductWorkbookInput) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const dataSheet = workbook.addWorksheet(input.dataSheetName)
  dataSheet.addRow(input.headers)
  for (const row of input.rows ?? []) {
    dataSheet.addRow(row)
  }
  dataSheet.columns = input.headers.map((header, index) => ({
    width: input.columnWidths?.[index] ?? Math.max(header.length, 16),
  }))

  const lastRow = Math.max(
    input.validationRows ?? 2000,
    (input.rows?.length ?? 0) + 201,
    2,
  )
  applyDropdownColumnFills(dataSheet, input.headers, input.fields, lastRow)

  const lists = collectProductSelectLists(input.fields, input.seasons)
  if (lists.length > 0) {
    const listSheet = workbook.addWorksheet(SELECT_LIST_SHEET)
    listSheet.state = 'hidden'
    lists.forEach((list, columnIndex) => {
      listSheet.getCell(1, columnIndex + 1).value = list.header
      list.values.forEach((value, rowIndex) => {
        listSheet.getCell(rowIndex + 2, columnIndex + 1).value = value
      })
      const colLetter = listSheet.getColumn(columnIndex + 1).letter
      const endRow = Math.max(list.values.length + 1, 2)
      workbookDefinedNames(workbook).add(
        `'${SELECT_LIST_SHEET}'!$${colLetter}$2:$${colLetter}$${endRow}`,
        namedSelectRange(list.key),
      )
    })

    for (const [index, header] of input.headers.entries()) {
      const list = lists.find((item) => item.header === header)
      if (!list) continue
      const colLetter = dataSheet.getColumn(index + 1).letter
      worksheetValidations(dataSheet).add(`${colLetter}2:${colLetter}${lastRow}`, {
        type: 'list',
        allowBlank: true,
        formulae: [namedSelectRange(list.key)],
        showErrorMessage: true,
        errorStyle: 'error',
        errorTitle: '허용되지 않는 값',
        error: `${header}은(는) 목록에서 고르세요.`,
      })
    }
  }

  if (input.guideRows && input.guideRows.length > 0) {
    const guide = workbook.addWorksheet(input.guideSheetName ?? '작성안내')
    for (const row of input.guideRows) guide.addRow(row)
    if (input.guideColumnWidths) {
      guide.columns = input.guideColumnWidths.map((width) => ({ width }))
    }
  }

  return workbook
}

export async function workbookToBuffer(workbook: {
  xlsx: { writeBuffer: () => Promise<ArrayBuffer | Uint8Array> }
}) {
  return workbook.xlsx.writeBuffer()
}

export async function downloadExcelWorkbook(
  workbook: {
    xlsx: { writeBuffer: () => Promise<ArrayBuffer | Uint8Array> }
  },
  fileName: string,
) {
  const buffer = await workbookToBuffer(workbook)
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
