import { parseSabangnetNumber } from '@/lib/codes/sabangnet-fields'
import { parseStyleNoList } from '@/lib/codes/style-no-list'
import { normalizeStyleNo } from '@/lib/import/transform'
import type {
  SabangnetField,
  SabangnetProduct,
  SabangnetProductInput,
  StyleRef,
} from '@/lib/types'

export const SABANGNET_TEMPLATE_HEADERS = [
  '사방넷 코드',
  '사방넷 상품명',
  'M번호 리스트',
] as const

const CODE_ALIASES = [
  '사방넷 코드',
  '품번코드',
  '품번코드 [수정불가]',
  '품번코드 / [수정불가]',
  '품번코드/[수정불가]',
]

const NAME_ALIASES = ['사방넷 상품명', '상품명']
const STYLE_ALIASES = ['M번호 리스트', 'M번호']
const HEADER_SCAN_ROWS = 10
const GUIDE_CELL = /수정불가|불가합니다|필수|예시|안내|설명|입력 가능/

function todayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function safeFilePart(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'brand'
}

function normalizeHeader(value: string): string {
  return value
    .replace(/[\s/]+/g, ' ')
    .trim()
    .toLowerCase()
}

function aliasSet(aliases: readonly string[]) {
  return aliases.map(normalizeHeader)
}

function findAliasIndex(headers: string[], aliases: readonly string[]) {
  const normalized = headers.map(normalizeHeader)
  const aliasesNormalized = aliasSet(aliases)
  for (const alias of aliasesNormalized) {
    const exact = normalized.findIndex((header) => header === alias)
    if (exact >= 0) return exact
  }
  for (const alias of aliasesNormalized) {
    const starts = normalized.findIndex(
      (header) => header.startsWith(alias) && header !== alias,
    )
    if (starts >= 0) return starts
  }
  return -1
}

function looksLikeGuideCell(value: string) {
  const text = value.trim()
  if (!text) return false
  return (
    text.startsWith('[') ||
    text.startsWith('▶') ||
    text.length > 40 ||
    GUIDE_CELL.test(text)
  )
}

export type SabangnetCustomColumn = {
  fieldId: string
  index: number
  label: string
  type: SabangnetField['type']
}

export type SabangnetHeaderMap = {
  headerIndex: number
  dataStartIndex: number
  codeIdx: number
  nameIdx: number | null
  stylesIdx: number | null
  custom: SabangnetCustomColumn[]
}

function findExactIndex(headers: string[], label: string) {
  const target = normalizeHeader(label)
  if (!target) return -1
  return headers.findIndex((header) => normalizeHeader(header) === target)
}

function systemColumnIndex(
  headers: string[],
  fields: SabangnetField[] | undefined,
  systemKey: SabangnetField['systemKey'],
  aliases: readonly string[],
) {
  const field = fields?.find((item) => item.systemKey === systemKey)
  if (field) {
    const labeled = findExactIndex(headers, field.label)
    if (labeled >= 0) return labeled
  }
  return findAliasIndex(headers, aliases)
}

function customColumns(
  headers: string[],
  fields: SabangnetField[] | undefined,
  used: Set<number>,
): SabangnetCustomColumn[] {
  if (!fields) return []
  const columns: SabangnetCustomColumn[] = []
  for (const field of fields) {
    if (field.systemKey) continue
    const index = findExactIndex(headers, field.label)
    if (index < 0 || used.has(index)) continue
    used.add(index)
    columns.push({
      fieldId: field.id,
      index,
      label: field.label,
      type: field.type,
    })
  }
  return columns
}

/**
 * 3열 양식과 사방넷 공식 대량수정 파일의 헤더를 찾는다.
 * 제목·안내 행은 건너뛰고, 나머지 열은 호출측에서 무시한다.
 * 사방넷 코드는 필수이고, 상품명 또는 M번호 리스트 중 하나는 있어야 한다.
 */
export function findSabangnetHeader(
  rows: string[][],
  fields?: SabangnetField[],
): SabangnetHeaderMap | null {
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length)
  for (let i = 0; i < limit; i += 1) {
    const headers = rows[i] ?? []
    const codeIdx = systemColumnIndex(headers, fields, 'code', CODE_ALIASES)
    if (codeIdx < 0) continue

    const nameFound = systemColumnIndex(headers, fields, 'name', NAME_ALIASES)
    const stylesFound = systemColumnIndex(
      headers,
      fields,
      'styles',
      STYLE_ALIASES,
    )
    const custom = customColumns(
      headers,
      fields,
      new Set(
        [codeIdx, nameFound, stylesFound].filter((index) => index >= 0),
      ),
    )
    if (nameFound < 0 && stylesFound < 0 && custom.length === 0) continue

    let dataStartIndex = i + 1
    const next = rows[dataStartIndex] ?? []
    if (
      next.length > 0 &&
      looksLikeGuideCell(next[codeIdx] ?? '')
    ) {
      dataStartIndex += 1
    }

    return {
      headerIndex: i,
      dataStartIndex,
      codeIdx,
      nameIdx: nameFound >= 0 ? nameFound : null,
      stylesIdx: stylesFound >= 0 ? stylesFound : null,
      custom,
    }
  }
  return null
}

export function describeSabangnetHeader(header: SabangnetHeaderMap | null) {
  if (!header) {
    return '사방넷 코드 헤더를 찾지 못했습니다. 첫 행에 「사방넷 코드」와 「사방넷 상품명」 또는 「M번호 리스트」가 있어야 합니다.'
  }
  const parts = ['사방넷 코드']
  if (header.nameIdx != null) parts.push('사방넷 상품명')
  if (header.stylesIdx != null) parts.push('M번호 리스트')
  for (const column of header.custom) parts.push(column.label)
  const kept: string[] = []
  if (header.nameIdx == null) kept.push('상품명은 기존 값을 유지')
  if (header.stylesIdx == null) kept.push('M번호는 기존 값을 유지')
  return kept.length > 0
    ? `이 파일 헤더: ${parts.join(', ')}. ${kept.join(', ')}합니다.`
    : `이 파일 헤더: ${parts.join(', ')}.`
}

export function timeSabangnetWork<T>(name: string, fn: () => T): T {
  const start =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const result = fn()
  const elapsed = Math.round(
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
      start,
  )
  const path =
    typeof location !== 'undefined' ? location.pathname : ''
  if (elapsed >= 1000) {
    console.warn('[sabangnet]', name, `${elapsed}ms`, { path })
  } else if (elapsed >= 200) {
    console.info('[sabangnet]', name, `${elapsed}ms`, { path })
  }
  return result
}

export async function downloadSabangnetTemplate(options: {
  brandName: string
  fields?: SabangnetField[]
}) {
  const XLSX = await import('xlsx')
  const columns = templateColumns(options.fields)
  const guideRows = [
    ['항목명', '필수', '예시', '설명'],
    ...columns.map((column) => [
      column.label,
      column.systemKey === 'code' || column.systemKey === 'name' ? 'Y' : 'N',
      templateExample(column, 0),
      templateGuide(column),
    ]),
  ]

  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([
    columns.map((column) => column.label),
    columns.map((column) => templateExample(column, 0)),
    columns.map((column) => templateExample(column, 1)),
    columns.map((column) => templateExample(column, 2)),
  ])
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  uploadSheet['!cols'] = columns.map((column) => ({
    wch: column.systemKey === 'name' || column.systemKey === 'styles' ? 28 : 18,
  }))
  guideSheet['!cols'] = [{ wch: 16 }, { wch: 6 }, { wch: 18 }, { wch: 64 }]

  XLSX.utils.book_append_sheet(workbook, uploadSheet, '사방넷등록')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')

  const fileName = `${safeFilePart(options.brandName)}_사방넷코드등록_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export type PreparedSabangnetStatus =
  | 'ok'
  | 'pending'
  | 'update'
  | 'unchanged'
  | 'error'

export type PreparedSabangnetRow = {
  lineNo: number
  productId?: string
  code: string
  name: string
  styleNos: string[]
  styleIds: string[]
  values?: Record<string, string>
  statusLabel: PreparedSabangnetStatus
  message: string
}

type TemplateColumn = {
  label: string
  systemKey: SabangnetField['systemKey']
  type: SabangnetField['type']
}

function templateColumns(fields?: SabangnetField[]): TemplateColumn[] {
  if (!fields || fields.length === 0) {
    return SABANGNET_TEMPLATE_HEADERS.map((label, index) => ({
      label,
      systemKey: (['code', 'name', 'styles'] as const)[index]!,
      type: 'text' as const,
    }))
  }
  return [...fields]
    .sort((left, right) => left.order - right.order)
    .map((field) => ({
      label: field.label,
      systemKey: field.systemKey,
      type: field.type,
    }))
}

function templateExample(column: TemplateColumn, rowIndex: number) {
  if (column.systemKey === 'code') {
    return ['123456789', '123456790', '123456791'][rowIndex] ?? ''
  }
  if (column.systemKey === 'name') {
    return ['셔링 아이보리', '래빗에코백 세트', 'M번호 미연결 예시'][rowIndex] ?? ''
  }
  if (column.systemKey === 'styles') {
    return ['M0001', 'M0005, M0511', ''][rowIndex] ?? ''
  }
  if (column.type === 'number') return rowIndex === 0 ? '1' : ''
  return ''
}

function templateGuide(column: TemplateColumn) {
  if (column.systemKey === 'code') {
    return '사방넷 품번코드. 브랜드 안에서 고유. 이미 있으면 파일에 있는 열만 바꿈'
  }
  if (column.systemKey === 'name') {
    return '사방넷 상품명. 공식 상품명과 달라도 됨. 열이 없으면 기존 값을 유지'
  }
  if (column.systemKey === 'styles') {
    return '색상·사이즈 SKU. 쉼표 또는 줄바꿈. 칸을 비우면 미연결. 열이 없으면 기존 연결 유지. 선행 0 유지'
  }
  if (column.type === 'number') {
    return '추가 숫자 항목. 칸을 비우면 기존 값을 유지'
  }
  return '추가 텍스트 항목. 칸을 비우면 기존 값을 유지'
}

function resolveStyleNos(options: {
  styleTokens: string[]
  styleByNo: Map<string, StyleRef>
}): {
  styleNos: string[]
  styleIds: string[]
  missing: string[]
  duplicates: string[]
} {
  const { styleTokens, styleByNo } = options
  const seenInRow = new Set<string>()
  const styleNos: string[] = []
  const styleIds: string[] = []
  const missing: string[] = []
  const duplicates: string[] = []

  for (const token of styleTokens) {
    const key = normalizeStyleNo(token)
    if (!key) continue
    if (seenInRow.has(key)) {
      duplicates.push(token)
      continue
    }
    seenInRow.add(key)
    const style = styleByNo.get(key)
    if (!style) {
      missing.push(token)
      continue
    }
    styleNos.push(style.styleNo)
    styleIds.push(style.styleId)
  }

  return { styleNos, styleIds, missing, duplicates }
}

function styleMap(styles: StyleRef[]) {
  return new Map(
    styles.map((style) => [normalizeStyleNo(style.styleNo), style] as const),
  )
}

function sameStyleIds(existing: StyleRef[], nextIds: string[]) {
  if (existing.length !== nextIds.length) return false
  return existing.every((style, index) => style.styleId === nextIds[index])
}

function sameValues(
  existing: Record<string, string>,
  next: Record<string, string>,
) {
  const keys = new Set([...Object.keys(existing), ...Object.keys(next)])
  for (const key of keys) {
    if ((existing[key] ?? '') !== (next[key] ?? '')) return false
  }
  return true
}

function readCustomValues(options: {
  row: string[]
  columns: SabangnetCustomColumn[]
  existing?: Record<string, string>
}): { values?: Record<string, string>; error?: string } {
  if (options.columns.length === 0) return {}
  const values = { ...(options.existing ?? {}) }
  for (const column of options.columns) {
    const raw = (options.row[column.index] ?? '').trim()
    if (!raw) continue
    if (column.type === 'number') {
      const parsed = parseSabangnetNumber(raw, column.label)
      if (parsed.error) return { error: parsed.error }
      if (parsed.value) values[column.fieldId] = parsed.value
      continue
    }
    values[column.fieldId] = raw
  }
  return { values }
}

function existingRowResult(options: {
  existing: SabangnetProduct
  name: string
  styleNos: string[]
  styleIds: string[]
  values?: Record<string, string>
}): Pick<PreparedSabangnetRow, 'statusLabel' | 'message'> {
  const nameChanged = options.existing.name.trim() !== options.name
  const stylesChanged = !sameStyleIds(options.existing.styles, options.styleIds)
  const valuesChanged =
    options.values != null &&
    !sameValues(options.existing.values ?? {}, options.values)
  if (!nameChanged && !stylesChanged && !valuesChanged) {
    return {
      statusLabel: 'unchanged',
      message: '이미 같은 내용입니다.',
    }
  }

  const extra = valuesChanged ? ' 추가 항목도 수정합니다.' : ''
  if (!stylesChanged && valuesChanged && !nameChanged) {
    return { statusLabel: 'update', message: '추가 항목을 수정합니다.' }
  }
  if (nameChanged && stylesChanged) {
    return {
      statusLabel: 'update',
      message:
        (options.styleIds.length === 0
          ? '상품명을 수정하고 M번호를 비워 미연결로 바꿉니다.'
          : '상품명과 M번호를 수정합니다.') + extra,
    }
  }
  if (nameChanged) {
    return {
      statusLabel: 'update',
      message: valuesChanged
        ? '상품명과 추가 항목을 수정합니다.'
        : '상품명을 수정합니다.',
    }
  }
  return {
    statusLabel: 'update',
    message:
      (options.styleIds.length === 0
        ? 'M번호를 비워 미연결로 바꿉니다.'
        : options.styleIds.length === 1
          ? `${options.styleNos[0]} 1종으로 수정합니다.`
          : `M번호 ${options.styleIds.length}종으로 수정합니다.`) + extra,
  }
}

const MISSING_HEADER_MESSAGE =
  '첫 행에 「사방넷 코드」와 「사방넷 상품명」 또는 「M번호 리스트」 헤더가 있어야 합니다.'

/**
 * 헤더가 있는 열만 반영한다. 사방넷 코드가 키다.
 * 상품명 열이 없으면 기존 상품명을 유지하고, M번호 열이 없으면 기존 연결을 유지한다.
 * M번호 열은 있는데 칸이 비면 미연결이다.
 */
export function prepareSabangnetRows(options: {
  rows: string[][]
  styles: StyleRef[]
  existingProducts: SabangnetProduct[]
  fields?: SabangnetField[]
}): PreparedSabangnetRow[] {
  const { rows, styles, existingProducts, fields } = options
  if (rows.length === 0) return []

  const header = findSabangnetHeader(rows, fields)
  if (!header) {
    return [
      {
        lineNo: 1,
        code: '',
        name: '',
        styleNos: [],
        styleIds: [],
        statusLabel: 'error',
        message: MISSING_HEADER_MESSAGE,
      },
    ]
  }

  const styleByNo = styleMap(styles)
  const existingByCode = new Map(
    existingProducts.map((product) => [product.code.trim(), product]),
  )
  const seenCodes = new Set<string>()
  const prepared: PreparedSabangnetRow[] = []

  for (let i = header.dataStartIndex; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const rawCode = (row[header.codeIdx] ?? '').trim()
    const rawName =
      header.nameIdx == null ? null : (row[header.nameIdx] ?? '').trim()
    const rawStyles =
      header.stylesIdx == null ? null : (row[header.stylesIdx] ?? '').trim()
    const lineNo = i + 1

    if (row.every((value) => !String(value ?? '').trim())) continue

    if (!rawCode) {
      prepared.push({
        lineNo,
        code: '',
        name: rawName ?? '',
        styleNos: [],
        styleIds: [],
        statusLabel: 'error',
        message: '사방넷 코드가 비어 있습니다.',
      })
      continue
    }

    if (seenCodes.has(rawCode)) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName ?? '',
        styleNos: [],
        styleIds: [],
        statusLabel: 'error',
        message: '파일 안에서 중복된 사방넷 코드입니다.',
      })
      continue
    }
    seenCodes.add(rawCode)

    const existing = existingByCode.get(rawCode)
    const name = rawName || existing?.name.trim() || ''
    if (!name) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: '',
        styleNos: [],
        styleIds: [],
        statusLabel: 'error',
        message:
          header.nameIdx == null
            ? '상품명 열이 없고 등록된 사방넷 코드도 아니라 신규 등록할 수 없습니다.'
            : '사방넷 상품명이 비어 있습니다.',
      })
      continue
    }

    let styleNos: string[]
    let styleIds: string[]
    if (rawStyles == null) {
      styleNos = existing?.styles.map((style) => style.styleNo) ?? []
      styleIds = existing?.styles.map((style) => style.styleId) ?? []
    } else {
      const styleTokens = parseStyleNoList(rawStyles)
      if (styleTokens.length === 0) {
        styleNos = []
        styleIds = []
      } else {
        const resolved = resolveStyleNos({
          styleTokens,
          styleByNo,
        })
        if (resolved.duplicates.length > 0) {
          prepared.push({
            lineNo,
            code: rawCode,
            name,
            styleNos: resolved.styleNos,
            styleIds: [],
            statusLabel: 'error',
            message: `같은 행에서 M번호가 반복됩니다. (${resolved.duplicates.join(', ')})`,
          })
          continue
        }
        if (resolved.missing.length > 0) {
          prepared.push({
            lineNo,
            code: rawCode,
            name,
            styleNos: resolved.styleNos,
            styleIds: [],
            statusLabel: 'error',
            message: `등록된 상품에 없는 M번호입니다. (${resolved.missing.join(', ')})`,
          })
          continue
        }
        styleNos = resolved.styleNos
        styleIds = resolved.styleIds
      }
    }

    const custom = readCustomValues({
      row,
      columns: header.custom,
      existing: existing?.values,
    })
    if (custom.error) {
      prepared.push({
        lineNo,
        code: rawCode,
        name,
        styleNos,
        styleIds: [],
        statusLabel: 'error',
        message: custom.error,
      })
      continue
    }

    if (existing) {
      const result = existingRowResult({
        existing,
        name,
        styleNos,
        styleIds,
        values: custom.values,
      })
      prepared.push({
        lineNo,
        productId: existing.id,
        code: rawCode,
        name,
        styleNos,
        styleIds,
        values: custom.values,
        ...result,
      })
      continue
    }

    prepared.push({
      lineNo,
      code: rawCode,
      name,
      styleNos,
      styleIds,
      values: custom.values,
      statusLabel: styleIds.length === 0 ? 'pending' : 'ok',
      message:
        styleIds.length === 0
          ? 'M번호 미연결로 사방넷 코드만 등록합니다.'
          : styleIds.length === 1
            ? `${styleNos[0]} 1종으로 등록합니다.`
            : `${styleNos.join(', ')} ${styleIds.length}종으로 등록합니다.`,
    })
  }

  return prepared
}

export function isSabangnetApplyRow(row: PreparedSabangnetRow) {
  return (
    row.statusLabel === 'ok' ||
    row.statusLabel === 'pending' ||
    row.statusLabel === 'update'
  )
}

export function toSabangnetProductInput(
  row: PreparedSabangnetRow,
): SabangnetProductInput {
  return {
    code: row.code,
    name: row.name,
    styleIds: row.styleIds,
    ...(row.values ? { values: row.values } : {}),
  }
}

export async function downloadPendingSabangnetFill(options: {
  brandName: string
  products: SabangnetProduct[]
  fields?: SabangnetField[]
}) {
  const XLSX = await import('xlsx')
  const columns = templateColumns(options.fields)
  const headers = columns.some((column) => column.systemKey === 'styles')
    ? columns.map((column) => column.label)
    : [...columns.map((column) => column.label), 'M번호 리스트']
  const body = options.products
    .filter((product) => product.styles.length === 0)
    .map((product) =>
      headers.map((header) => {
        const column = columns.find((item) => item.label === header)
        if (column?.systemKey === 'code') return product.code
        if (column?.systemKey === 'name') return product.name
        return ''
      }),
    )

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  sheet['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(workbook, sheet, 'M번호채우기')

  const fileName = `${safeFilePart(options.brandName)}_사방넷M번호채우기_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export type PreparedSabangnetFillRow = {
  lineNo: number
  productId: string
  code: string
  name: string
  styleNos: string[]
  styleIds: string[]
  statusLabel: 'ok' | 'skip' | 'error'
  message: string
}

export function prepareSabangnetFillRows(options: {
  rows: string[][]
  styles: StyleRef[]
  products: SabangnetProduct[]
  fields?: SabangnetField[]
}): PreparedSabangnetFillRow[] {
  const { rows, styles, products, fields } = options
  if (rows.length === 0) return []

  const header = findSabangnetHeader(rows, fields)
  if (!header || header.stylesIdx == null) {
    return [
      {
        lineNo: 1,
        productId: '',
        code: '',
        name: '',
        styleNos: [],
        styleIds: [],
        statusLabel: 'error',
        message:
          header == null
            ? MISSING_HEADER_MESSAGE
            : 'M번호 리스트 헤더가 있어야 채울 수 있습니다.',
      },
    ]
  }

  const styleByNo = styleMap(styles)
  const productByCode = new Map(
    products.map((product) => [product.code.trim(), product]),
  )
  const seenCodes = new Set<string>()
  const prepared: PreparedSabangnetFillRow[] = []

  for (let i = header.dataStartIndex; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const rawCode = (row[header.codeIdx] ?? '').trim()
    const rawName =
      header.nameIdx == null ? '' : (row[header.nameIdx] ?? '').trim()
    const rawStyles = (row[header.stylesIdx] ?? '').trim()
    const lineNo = i + 1

    if (row.every((value) => !String(value ?? '').trim())) continue

    if (!rawCode) {
      prepared.push({
        lineNo,
        productId: '',
        code: '',
        name: rawName,
        styleNos: [],
        styleIds: [],
        statusLabel: 'error',
        message: '사방넷 코드가 비어 있습니다.',
      })
      continue
    }

    if (seenCodes.has(rawCode)) {
      prepared.push({
        lineNo,
        productId: '',
        code: rawCode,
        name: rawName,
        styleNos: [],
        styleIds: [],
        statusLabel: 'error',
        message: '파일 안에서 중복된 사방넷 코드입니다.',
      })
      continue
    }
    seenCodes.add(rawCode)

    const existing = productByCode.get(rawCode)
    if (!existing) {
      prepared.push({
        lineNo,
        productId: '',
        code: rawCode,
        name: rawName,
        styleNos: [],
        styleIds: [],
        statusLabel: 'error',
        message: '등록된 사방넷 코드가 아닙니다.',
      })
      continue
    }

    if (existing.styles.length > 0) {
      prepared.push({
        lineNo,
        productId: existing.id,
        code: rawCode,
        name: existing.name,
        styleNos: existing.styles.map((style) => style.styleNo),
        styleIds: [],
        statusLabel: 'error',
        message: '이미 M번호가 있는 사방넷 코드입니다. 덮어쓰지 않습니다.',
      })
      continue
    }

    const styleTokens = parseStyleNoList(rawStyles)
    if (styleTokens.length === 0) {
      prepared.push({
        lineNo,
        productId: existing.id,
        code: rawCode,
        name: existing.name,
        styleNos: [],
        styleIds: [],
        statusLabel: 'skip',
        message: 'M번호가 비어 있어 건너뜁니다.',
      })
      continue
    }

    const { styleNos, styleIds, missing, duplicates } = resolveStyleNos({
      styleTokens,
      styleByNo,
    })

    if (duplicates.length > 0) {
      prepared.push({
        lineNo,
        productId: existing.id,
        code: rawCode,
        name: existing.name,
        styleNos,
        styleIds: [],
        statusLabel: 'error',
        message: `같은 행에서 M번호가 반복됩니다. (${duplicates.join(', ')})`,
      })
      continue
    }

    if (missing.length > 0) {
      prepared.push({
        lineNo,
        productId: existing.id,
        code: rawCode,
        name: existing.name,
        styleNos,
        styleIds: [],
        statusLabel: 'error',
        message: `등록된 상품에 없는 M번호입니다. (${missing.join(', ')})`,
      })
      continue
    }

    prepared.push({
      lineNo,
      productId: existing.id,
      code: rawCode,
      name: existing.name,
      styleNos,
      styleIds,
      statusLabel: 'ok',
      message:
        styleIds.length === 1
          ? `${styleNos[0]} 1종으로 채웁니다.`
          : `${styleNos.join(', ')} ${styleIds.length}종으로 채웁니다.`,
    })
  }

  return prepared
}

export function toSabangnetFillInput(
  product: SabangnetProduct,
  styleIds: string[],
): SabangnetProductInput {
  return {
    code: product.code,
    name: product.name,
    styleIds,
    values: product.values ?? {},
  }
}

export function resolveStyleNosToIds(options: {
  raw: string
  styles: StyleRef[]
}): { styleIds: string[]; styleNos: string[]; error: string | null } {
  const styleTokens = parseStyleNoList(options.raw)
  if (styleTokens.length === 0) {
    return { styleIds: [], styleNos: [], error: 'M번호를 입력하세요.' }
  }

  const { styleIds, styleNos, missing, duplicates } = resolveStyleNos({
    styleTokens,
    styleByNo: styleMap(options.styles),
  })

  if (duplicates.length > 0) {
    return {
      styleIds: [],
      styleNos: [],
      error: `같은 행에서 M번호가 반복됩니다. (${duplicates.join(', ')})`,
    }
  }
  if (missing.length > 0) {
    return {
      styleIds: [],
      styleNos: [],
      error: `등록된 상품에 없는 M번호입니다. (${missing.join(', ')})`,
    }
  }
  return { styleIds, styleNos, error: null }
}
