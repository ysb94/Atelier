import { describeEan13Problem } from '@/lib/codes/ean'
import { normalizeStyleNo } from '@/lib/import/transform'
import {
  barcodeFieldLabel,
  parsePositiveCm,
  resolveBarcodeFieldColumns,
} from '@/lib/codes/barcode-fields'
import type {
  BarcodeField,
  ProductCode,
  ProductCodeComponent,
  ProductCodeInput,
  Style,
} from '@/lib/types'

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

/**
 * 자사 바코드 마스터를 일괄 등록할 빈 양식 xlsx를 내려받는다.
 * 88코드는 회사에서 이미 발급한 값만 넣고, 앱에서 자동 발급하지 않는다.
 * M번호는 비워 두면 미지정으로 등록된다.
 */
export async function downloadBarcodeTemplate(options: {
  brandName: string
  fields: BarcodeField[]
}) {
  const XLSX = await import('xlsx')
  const fields = [...options.fields].sort((a, b) => a.order - b.order)
  const headers = fields.map((field) => field.label)
  const guideRows = [
    ['항목명', '필수', '예시', '설명'],
    [
      barcodeFieldLabel(fields, 'code'),
      'Y',
      '8801234000017',
      '회사에서 이미 발급한 13자리 EAN-13. 앱에서 자동 발급하지 않음',
    ],
    [
      barcodeFieldLabel(fields, 'name'),
      'Y',
      '셔링 아이보리',
      '바코드 라벨·목록에 보일 이름. 구성 상품명과 달라도 됨',
    ],
    [
      barcodeFieldLabel(fields, 'components'),
      'N',
      'M0001, M0002',
      '쉼표 또는 줄바꿈으로 1개 이상. 비워 두면 88코드만 등록하고 미지정 탭에서 나중에 채움. 각 수량 1',
    ],
  ]

  const workbook = XLSX.utils.book_new()
  const exampleRow = (code: string, name: string, components: string) =>
    fields.map((field) => {
      if (field.systemKey === 'code') return code
      if (field.systemKey === 'name') return name
      if (field.systemKey === 'components') return components
      return ''
    })
  const uploadSheet = XLSX.utils.aoa_to_sheet([
    headers,
    exampleRow('8801234000017', '셔링 아이보리', 'M0001'),
    exampleRow('8801234000024', '래빗에코백 세트', 'M0005, M0006'),
    exampleRow('8801234000031', 'M번호 미지정 예시', ''),
  ])
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  uploadSheet['!cols'] = fields.map((field) => ({
    wch: field.systemKey === 'code' ? 18 : 24,
  }))
  guideSheet['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 22 }, { wch: 56 }]

  XLSX.utils.book_append_sheet(workbook, uploadSheet, '바코드등록')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')

  const fileName = `${safeFilePart(options.brandName)}_자사바코드등록_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export type PreparedBarcodeRow = {
  lineNo: number
  code: string
  name: string
  styleNos: string[]
  components: ProductCodeComponent[]
  values?: Record<string, string>
  weightG?: number | null
  widthCm?: number | null
  depthCm?: number | null
  heightCm?: number | null
  note?: string
  statusLabel: 'ok' | 'pending' | 'error'
  message: string
}

/** 쉼표·슬래시·줄바꿈·세미콜론으로 나눈 뒤 빈 칸을 버린다. */
export function parseStyleNoList(raw: string): string[] {
  return raw
    .split(/[\n\r,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function customValuesFromRow(
  row: string[],
  fields: BarcodeField[],
  byFieldId: Map<string, number>,
) {
  const values: Record<string, string> = {}
  const errors: string[] = []
  for (const field of fields) {
    if (field.systemKey) continue
    const column = byFieldId.get(field.id)
    const value = column === undefined ? '' : (row[column] ?? '').trim()
    if (!value) continue
    if (
      field.type === 'number' &&
      !Number.isFinite(Number(value.replace(/,/g, '')))
    ) {
      errors.push(`${field.label}은(는) 숫자로 입력하세요.`)
      continue
    }
    values[field.id] = value
  }
  return { values, error: errors.join(' ') }
}

function parsePositiveIntegerG(
  raw: string,
  label: string,
): { value: number | null; error?: string } {
  if (!raw) return { value: null }
  const cleaned = raw.replace(/,/g, '').replace(/\s+/g, '').replace(/g$/i, '')
  if (!/^\d+$/.test(cleaned)) {
    return { value: null, error: `${label}은(는) 1 이상의 정수로 입력하세요.` }
  }
  const value = Number(cleaned)
  if (!Number.isSafeInteger(value) || value < 1) {
    return { value: null, error: `${label}은(는) 1 이상의 정수로 입력하세요.` }
  }
  return { value }
}

function systemValuesFromRow(
  row: string[],
  fields: BarcodeField[],
  bySystemKey: Map<BarcodeField['systemKey'] & string, number>,
) {
  const labelFor = (
    systemKey: 'weightG' | 'widthCm' | 'depthCm' | 'heightCm',
  ) => fields.find((field) => field.systemKey === systemKey)?.label ?? systemKey
  const rawWeight = row[bySystemKey.get('weightG') ?? -1]?.trim() ?? ''
  const rawWidth = row[bySystemKey.get('widthCm') ?? -1]?.trim() ?? ''
  const rawDepth = row[bySystemKey.get('depthCm') ?? -1]?.trim() ?? ''
  const rawHeight = row[bySystemKey.get('heightCm') ?? -1]?.trim() ?? ''
  const rawNote = row[bySystemKey.get('note') ?? -1]?.trim() ?? ''
  const weight = parsePositiveIntegerG(rawWeight, labelFor('weightG'))
  const width = parsePositiveCm(rawWidth, labelFor('widthCm'))
  const depth = parsePositiveCm(rawDepth, labelFor('depthCm'))
  const height = parsePositiveCm(rawHeight, labelFor('heightCm'))
  return {
    weightG: weight.value,
    widthCm: width.value ?? null,
    depthCm: depth.value ?? null,
    heightCm: height.value ?? null,
    note: rawNote,
    error: [weight.error, width.error, depth.error, height.error]
      .filter((message): message is string => Boolean(message))
      .join(' '),
  }
}

function resolveComponents(options: {
  styleTokens: string[]
  styleByNo: Map<string, Style>
}): {
  styleNos: string[]
  components: ProductCodeComponent[]
  missing: string[]
  duplicates: string[]
} {
  const { styleTokens, styleByNo } = options
  const seenInRow = new Set<string>()
  const components: ProductCodeComponent[] = []
  const styleNos: string[] = []
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
    components.push({
      styleId: style.id,
      styleNo: style.styleNo,
      qty: 1,
    })
  }

  return { styleNos, components, missing, duplicates }
}

/**
 * 양식 헤더를 인식해 자사 바코드 일괄 등록 행을 준비한다.
 * 기존 코드는 덮어쓰지 않고 오류로 표시한다.
 * M번호가 비면 pending으로 두고 88코드만 등록한다.
 */
export function prepareBarcodeRows(options: {
  rows: string[][]
  styles: Style[]
  fields: BarcodeField[]
  /** 브랜드의 자사·거래처 코드 전체. UNIQUE(brand_id, code) 충돌을 막는다. */
  existingCodes: ProductCode[]
}): PreparedBarcodeRow[] {
  const { rows, styles, fields, existingCodes } = options
  if (rows.length === 0) return []

  const { byFieldId, bySystemKey } = resolveBarcodeFieldColumns(
    rows[0],
    fields,
  )
  const codeIdx = bySystemKey.get('code') ?? 0
  const nameIdx = bySystemKey.get('name') ?? 1
  const stylesIdx = bySystemKey.get('components') ?? 2

  const styleByNo = new Map(
    styles.map((style) => [normalizeStyleNo(style.styleNo), style] as const),
  )
  const existingCodeSet = new Set(
    existingCodes.map((code) => code.code.trim()),
  )
  const seenCodes = new Set<string>()
  const prepared: PreparedBarcodeRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const rawCode = (row[codeIdx] ?? '').trim()
    const rawName = (row[nameIdx] ?? '').trim()
    const rawStyles = (row[stylesIdx] ?? '').trim()
    const { values, error: customValueError } = customValuesFromRow(
      row,
      fields,
      byFieldId,
    )
    const { error: systemError, ...systemValues } = systemValuesFromRow(
      row,
      fields,
      bySystemKey,
    )
    const lineNo = i + 1

    // 모든 열이 비면 빈 줄로 보고 건너뛴다.
    if (row.every((value) => !value.trim())) continue

    if (!rawCode) {
      prepared.push({
        lineNo,
        code: '',
        name: rawName,
        styleNos: [],
        components: [],
        values,
        statusLabel: 'error',
        message: '88코드가 비어 있습니다.',
      })
      continue
    }

    const eanProblem = describeEan13Problem(rawCode)
    if (eanProblem) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName,
        styleNos: [],
        components: [],
        values,
        statusLabel: 'error',
        message: eanProblem,
      })
      continue
    }

    if (seenCodes.has(rawCode)) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName,
        styleNos: [],
        components: [],
        values,
        statusLabel: 'error',
        message: '파일 안에서 중복된 바코드입니다.',
      })
      continue
    }
    seenCodes.add(rawCode)

    if (existingCodeSet.has(rawCode)) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName,
        styleNos: [],
        components: [],
        values,
        statusLabel: 'error',
        message: '이미 등록된 바코드입니다. 덮어쓰지 않습니다.',
      })
      continue
    }

    if (!rawName) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: '',
        styleNos: [],
        components: [],
        values,
        statusLabel: 'error',
        message: '바코드 상품명이 비어 있습니다.',
      })
      continue
    }

    if (customValueError) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName,
        styleNos: [],
        components: [],
        values,
        ...systemValues,
        statusLabel: 'error',
        message: customValueError,
      })
      continue
    }

    if (systemError) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName,
        styleNos: [],
        components: [],
        values,
        ...systemValues,
        statusLabel: 'error',
        message: systemError,
      })
      continue
    }

    const styleTokens = parseStyleNoList(rawStyles)
    if (styleTokens.length === 0) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName,
        styleNos: [],
        components: [],
        values,
        ...systemValues,
        statusLabel: 'pending',
        message: 'M번호 미지정으로 88코드만 등록합니다.',
      })
      continue
    }

    const { styleNos, components, missing, duplicates } = resolveComponents({
      styleTokens,
      styleByNo,
    })

    if (duplicates.length > 0) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName,
        styleNos,
        components: [],
        values,
        statusLabel: 'error',
        message: `같은 행에서 M번호가 반복됩니다. (${duplicates.join(', ')})`,
      })
      continue
    }

    if (missing.length > 0) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName,
        styleNos,
        components: [],
        values,
        statusLabel: 'error',
        message: `등록된 상품에 없는 M번호입니다. (${missing.join(', ')})`,
      })
      continue
    }

    prepared.push({
      lineNo,
      code: rawCode,
      name: rawName,
      styleNos,
      components,
      values,
      ...systemValues,
      statusLabel: 'ok',
      message:
        components.length === 1
          ? `${styleNos[0]} 1종으로 등록합니다.`
          : `${styleNos.join(', ')} ${components.length}종으로 등록합니다.`,
    })
  }

  return prepared
}

/** 미리보기에서 통과한 행을 저장 입력으로 바꾼다. */
export function toProductCodeInput(row: PreparedBarcodeRow): ProductCodeInput {
  return {
    kind: 'own',
    code: row.code,
    name: row.name,
    weightG: row.weightG ?? null,
    widthCm: row.widthCm ?? null,
    depthCm: row.depthCm ?? null,
    heightCm: row.heightCm ?? null,
    note: row.note ?? '',
    values: row.values ?? {},
    components: row.components,
  }
}

/**
 * M번호가 비어 있는 자사 바코드만 모아 채우기용 xlsx를 내려받는다.
 * M번호 열만 비워 두고 88코드·상품명은 미리 채운다.
 */
export async function downloadPendingBarcodeFill(options: {
  brandName: string
  codes: ProductCode[]
  fields: BarcodeField[]
}) {
  const XLSX = await import('xlsx')
  const headers = [
    barcodeFieldLabel(options.fields, 'code'),
    barcodeFieldLabel(options.fields, 'name'),
    barcodeFieldLabel(options.fields, 'components'),
  ]
  const body = options.codes
    .filter((code) => code.components.length === 0)
    .map((code) => [code.code, code.name, ''])

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  sheet['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(workbook, sheet, 'M번호채우기')

  const fileName = `${safeFilePart(options.brandName)}_M번호채우기_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export type PreparedFillRow = {
  lineNo: number
  codeId: string
  code: string
  name: string
  styleNos: string[]
  components: ProductCodeComponent[]
  statusLabel: 'ok' | 'skip' | 'error'
  message: string
}

/**
 * 미지정 바코드에 M번호를 채우는 업로드 행을 준비한다.
 * 이미 M번호가 있는 코드는 덮어쓰지 않는다.
 */
export function prepareBarcodeFillRows(options: {
  rows: string[][]
  styles: Style[]
  codes: ProductCode[]
  fields: BarcodeField[]
}): PreparedFillRow[] {
  const { rows, styles, codes, fields } = options
  if (rows.length === 0) return []

  const { bySystemKey } = resolveBarcodeFieldColumns(rows[0], fields)
  const codeIdx = bySystemKey.get('code') ?? 0
  const nameIdx = bySystemKey.get('name') ?? 1
  const stylesIdx = bySystemKey.get('components') ?? 2

  const styleByNo = new Map(
    styles.map((style) => [normalizeStyleNo(style.styleNo), style] as const),
  )
  const codeByValue = new Map(codes.map((code) => [code.code.trim(), code]))
  const seenCodes = new Set<string>()
  const prepared: PreparedFillRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const rawCode = (row[codeIdx] ?? '').trim()
    const rawName = (row[nameIdx] ?? '').trim()
    const rawStyles = (row[stylesIdx] ?? '').trim()
    const lineNo = i + 1

    if (row.every((value) => !value.trim())) continue

    if (!rawCode) {
      prepared.push({
        lineNo,
        codeId: '',
        code: '',
        name: rawName,
        styleNos: [],
        components: [],
        statusLabel: 'error',
        message: '88코드가 비어 있습니다.',
      })
      continue
    }

    if (seenCodes.has(rawCode)) {
      prepared.push({
        lineNo,
        codeId: '',
        code: rawCode,
        name: rawName,
        styleNos: [],
        components: [],
        statusLabel: 'error',
        message: '파일 안에서 중복된 바코드입니다.',
      })
      continue
    }
    seenCodes.add(rawCode)

    const existing = codeByValue.get(rawCode)
    if (!existing) {
      prepared.push({
        lineNo,
        codeId: '',
        code: rawCode,
        name: rawName,
        styleNos: [],
        components: [],
        statusLabel: 'error',
        message: '등록된 바코드가 아닙니다.',
      })
      continue
    }

    if (existing.components.length > 0) {
      prepared.push({
        lineNo,
        codeId: existing.id,
        code: rawCode,
        name: existing.name,
        styleNos: existing.components.map((c) => c.styleNo),
        components: [],
        statusLabel: 'error',
        message: '이미 M번호가 있는 바코드입니다. 덮어쓰지 않습니다.',
      })
      continue
    }

    const styleTokens = parseStyleNoList(rawStyles)
    if (styleTokens.length === 0) {
      prepared.push({
        lineNo,
        codeId: existing.id,
        code: rawCode,
        name: existing.name,
        styleNos: [],
        components: [],
        statusLabel: 'skip',
        message: 'M번호가 비어 있어 건너뜁니다.',
      })
      continue
    }

    const { styleNos, components, missing, duplicates } = resolveComponents({
      styleTokens,
      styleByNo,
    })

    if (duplicates.length > 0) {
      prepared.push({
        lineNo,
        codeId: existing.id,
        code: rawCode,
        name: existing.name,
        styleNos,
        components: [],
        statusLabel: 'error',
        message: `같은 행에서 M번호가 반복됩니다. (${duplicates.join(', ')})`,
      })
      continue
    }

    if (missing.length > 0) {
      prepared.push({
        lineNo,
        codeId: existing.id,
        code: rawCode,
        name: existing.name,
        styleNos,
        components: [],
        statusLabel: 'error',
        message: `등록된 상품에 없는 M번호입니다. (${missing.join(', ')})`,
      })
      continue
    }

    prepared.push({
      lineNo,
      codeId: existing.id,
      code: rawCode,
      name: existing.name,
      styleNos,
      components,
      statusLabel: 'ok',
      message:
        components.length === 1
          ? `${styleNos[0]} 1종으로 채웁니다.`
          : `${styleNos.join(', ')} ${components.length}종으로 채웁니다.`,
    })
  }

  return prepared
}

/**
 * 기존 바코드의 이름·규격·비고를 유지하고 구성품만 채운 저장 입력을 만든다.
 * 인라인 저장과 채우기 업로드가 같은 빌더를 쓴다.
 */
export function toFillInput(
  code: ProductCode,
  components: ProductCodeComponent[],
): ProductCodeInput {
  return {
    kind: code.kind,
    code: code.code,
    name: code.name,
    weightG: code.weightG,
    widthCm: code.widthCm,
    depthCm: code.depthCm,
    heightCm: code.heightCm,
    note: code.note,
    values: code.values,
    components,
  }
}

/**
 * 쉼표로 나눈 M번호 문자열을 구성품으로 바꾼다.
 * 미등록·중복이면 오류 메시지를 돌려준다.
 */
export function resolveStyleNosToComponents(options: {
  raw: string
  styles: Style[]
}): { components: ProductCodeComponent[]; error: string | null } {
  const styleTokens = parseStyleNoList(options.raw)
  if (styleTokens.length === 0) {
    return { components: [], error: 'M번호를 입력하세요.' }
  }

  const styleByNo = new Map(
    options.styles.map(
      (style) => [normalizeStyleNo(style.styleNo), style] as const,
    ),
  )
  const { components, missing, duplicates } = resolveComponents({
    styleTokens,
    styleByNo,
  })

  if (duplicates.length > 0) {
    return {
      components: [],
      error: `같은 행에서 M번호가 반복됩니다. (${duplicates.join(', ')})`,
    }
  }
  if (missing.length > 0) {
    return {
      components: [],
      error: `등록된 상품에 없는 M번호입니다. (${missing.join(', ')})`,
    }
  }
  return { components, error: null }
}
