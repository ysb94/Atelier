import { describeEan13Problem } from '@/lib/codes/ean'
import { normalizeHeader } from '@/lib/import/fields'
import { normalizeStyleNo } from '@/lib/import/transform'
import type {
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
 */
export async function downloadBarcodeTemplate(options: { brandName: string }) {
  const XLSX = await import('xlsx')
  const headers = ['88코드', '바코드 상품명', 'M번호']
  const guideRows = [
    ['항목명', '필수', '예시', '설명'],
    [
      '88코드',
      'Y',
      '8801234000017',
      '회사에서 이미 발급한 13자리 EAN-13. 앱에서 자동 발급하지 않음',
    ],
    [
      '바코드 상품명',
      'Y',
      '셔링 아이보리',
      '바코드 라벨·목록에 보일 이름. 구성 상품명과 달라도 됨',
    ],
    [
      'M번호',
      'Y',
      'M0001, M0002',
      '쉼표 또는 줄바꿈으로 1개 이상. 1:1·1:N 모두 가능. 각 수량 1',
    ],
  ]

  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([
    headers,
    ['8801234000017', '셔링 아이보리', 'M0001'],
    ['8801234000024', '래빗에코백 세트', 'M0005, M0006'],
  ])
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  uploadSheet['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 28 }]
  guideSheet['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 22 }, { wch: 48 }]

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
  statusLabel: 'ok' | 'error'
  message: string
}

/** 쉼표·슬래시·줄바꿈·세미콜론으로 나눈 뒤 빈 칸을 버린다. */
export function parseStyleNoList(raw: string): string[] {
  return raw
    .split(/[\n\r,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function findColumn(
  header: string[],
  aliases: string[],
): number {
  return header.findIndex((h) => aliases.includes(h))
}

/**
 * 양식 헤더를 인식해 자사 바코드 일괄 등록 행을 준비한다.
 * 기존 코드는 덮어쓰지 않고 오류로 표시한다.
 */
export function prepareBarcodeRows(options: {
  rows: string[][]
  styles: Style[]
  /** 브랜드의 자사·거래처 코드 전체. UNIQUE(brand_id, code) 충돌을 막는다. */
  existingCodes: ProductCode[]
}): PreparedBarcodeRow[] {
  const { rows, styles, existingCodes } = options
  if (rows.length === 0) return []

  const header = rows[0].map((cell) => normalizeHeader(cell))
  const codeIdx = findColumn(header, [
    '88코드',
    '바코드',
    '코드',
    'ean',
    'barcode',
    'code',
    'ean13',
  ])
  const nameIdx = findColumn(header, [
    '바코드상품명',
    '바코드명',
    '코드명',
    '상품명',
    'name',
    'label',
  ])
  const stylesIdx = findColumn(header, [
    'm번호',
    'm번호목록',
    '품번',
    '품번목록',
    '구성',
    '구성품',
    'styleno',
    'stylenos',
    'styles',
  ])

  // 헤더 인식 실패 시 열 순서로 본다: 88코드 | 바코드 상품명 | M번호
  const resolvedCodeIdx = codeIdx >= 0 ? codeIdx : 0
  const resolvedNameIdx = nameIdx >= 0 ? nameIdx : 1
  const resolvedStylesIdx = stylesIdx >= 0 ? stylesIdx : 2

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
    const rawCode = (row[resolvedCodeIdx] ?? '').trim()
    const rawName = (row[resolvedNameIdx] ?? '').trim()
    const rawStyles = (row[resolvedStylesIdx] ?? '').trim()
    const lineNo = i + 1

    // 세 열 모두 비면 빈 줄로 보고 건너뛴다.
    if (!rawCode && !rawName && !rawStyles) continue

    if (!rawCode) {
      prepared.push({
        lineNo,
        code: '',
        name: rawName,
        styleNos: [],
        components: [],
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
        statusLabel: 'error',
        message: '바코드 상품명이 비어 있습니다.',
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
        statusLabel: 'error',
        message: 'M번호가 비어 있습니다.',
      })
      continue
    }

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

    if (duplicates.length > 0) {
      prepared.push({
        lineNo,
        code: rawCode,
        name: rawName,
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
        code: rawCode,
        name: rawName,
        styleNos,
        components: [],
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
    weightG: null,
    widthMm: null,
    depthMm: null,
    heightMm: null,
    note: '',
    components: row.components,
  }
}
