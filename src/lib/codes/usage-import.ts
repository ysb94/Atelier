import type { CodeUsageStatus, ProductCode } from '@/lib/types'
import { CODE_USAGE_STATUS_LABEL } from '@/lib/types'
import { normalizeHeader } from '@/lib/import/fields'

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
 * 선택한 사용처에 바코드를 일괄 등록할 빈 양식 xlsx를 내려받는다.
 * 사용처는 화면에서 이미 선택되어 있으므로 파일에는 88코드·상태만 넣는다.
 */
export async function downloadUsageCodeTemplate(options: {
  brandName: string
  usageTargetName: string
}) {
  const XLSX = await import('xlsx')
  const headers = ['88코드', '상태']
  const guideRows = [
    ['항목명', '필수', '예시', '설명'],
    [
      '88코드',
      'Y',
      '8801234000015',
      '자사 바코드 마스터에 이미 등록된 13자리 바코드',
    ],
    [
      '상태',
      'N',
      '사용중',
      '사용중 또는 일시중지. 비우면 사용중으로 처리',
    ],
  ]

  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([headers])
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  uploadSheet['!cols'] = [{ wch: 18 }, { wch: 12 }]
  guideSheet['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 18 }, { wch: 40 }]

  XLSX.utils.book_append_sheet(workbook, uploadSheet, '사용처등록')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')

  const fileName = `${safeFilePart(options.brandName)}_${safeFilePart(options.usageTargetName)}_바코드등록_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export type PreparedUsageRow = {
  lineNo: number
  code: string
  status: CodeUsageStatus
  productCodeId?: string
  productCodeName?: string
  statusLabel: 'ok' | 'warn' | 'error'
  message: string
}

function parseStatus(raw: string): CodeUsageStatus | null {
  const value = raw.trim().toLowerCase()
  if (!value) return 'active'
  if (
    value === 'active' ||
    value === '사용중' ||
    value === '사용' ||
    value === 'y' ||
    value === 'yes'
  ) {
    return 'active'
  }
  if (
    value === 'paused' ||
    value === '일시중지' ||
    value === '중지' ||
    value === 'pause' ||
    value === 'n' ||
    value === 'no'
  ) {
    return 'paused'
  }
  return null
}

/**
 * 양식 헤더(88코드, 상태)를 인식해 사용처 일괄 등록 행을 준비한다.
 */
export function prepareUsageRows(options: {
  rows: string[][]
  ownCodes: ProductCode[]
  /** 이미 해당 사용처에 등록된 productCodeId → 현재 상태 */
  existingByCodeId: Map<string, CodeUsageStatus>
}): PreparedUsageRow[] {
  const { rows, ownCodes, existingByCodeId } = options
  if (rows.length === 0) return []

  const header = rows[0].map((cell) => normalizeHeader(cell))
  const codeIdx = header.findIndex(
    (h) =>
      h === '88코드' ||
      h === '바코드' ||
      h === '코드' ||
      h === 'ean' ||
      h === 'barcode' ||
      h === 'code',
  )
  const statusIdx = header.findIndex(
    (h) => h === '상태' || h === 'status' || h === '사용상태',
  )

  // 헤더 인식 실패 시 첫 열을 바코드, 둘째 열을 상태로 본다.
  const resolvedCodeIdx = codeIdx >= 0 ? codeIdx : 0
  const resolvedStatusIdx = statusIdx >= 0 ? statusIdx : 1

  const codeMap = new Map(
    ownCodes
      .filter((c) => c.kind === 'own')
      .map((c) => [c.code, c] as const),
  )
  const seenCodes = new Set<string>()
  const prepared: PreparedUsageRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]
    const rawCode = (row[resolvedCodeIdx] ?? '').trim()
    const rawStatus = (row[resolvedStatusIdx] ?? '').trim()
    const lineNo = i + 1

    if (!rawCode) {
      prepared.push({
        lineNo,
        code: '',
        status: 'active',
        statusLabel: 'error',
        message: '88코드가 비어 있습니다.',
      })
      continue
    }

    if (seenCodes.has(rawCode)) {
      prepared.push({
        lineNo,
        code: rawCode,
        status: 'active',
        statusLabel: 'error',
        message: '파일 안에서 중복된 바코드입니다.',
      })
      continue
    }
    seenCodes.add(rawCode)

    const status = parseStatus(rawStatus)
    if (!status) {
      prepared.push({
        lineNo,
        code: rawCode,
        status: 'active',
        statusLabel: 'error',
        message: `상태를 확인할 수 없습니다. (${rawStatus}) 사용중 또는 일시중지를 쓰세요.`,
      })
      continue
    }

    const product = codeMap.get(rawCode)
    if (!product) {
      prepared.push({
        lineNo,
        code: rawCode,
        status,
        statusLabel: 'error',
        message: '자사 바코드 마스터에 없는 코드입니다. 먼저 바코드를 등록하세요.',
      })
      continue
    }

    const existing = existingByCodeId.get(product.id)
    if (existing === status) {
      prepared.push({
        lineNo,
        code: rawCode,
        status,
        productCodeId: product.id,
        productCodeName: product.name,
        statusLabel: 'warn',
        message: `이미 ${CODE_USAGE_STATUS_LABEL[status]}으로 등록되어 있습니다.`,
      })
      continue
    }
    if (existing) {
      prepared.push({
        lineNo,
        code: rawCode,
        status,
        productCodeId: product.id,
        productCodeName: product.name,
        statusLabel: 'ok',
        message: `상태를 ${CODE_USAGE_STATUS_LABEL[existing]} → ${CODE_USAGE_STATUS_LABEL[status]}로 변경합니다.`,
      })
      continue
    }

    prepared.push({
      lineNo,
      code: rawCode,
      status,
      productCodeId: product.id,
      productCodeName: product.name,
      statusLabel: 'ok',
      message: `${CODE_USAGE_STATUS_LABEL[status]}으로 등록합니다.`,
    })
  }

  return prepared
}
