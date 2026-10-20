import type { CodeUsageStatus, ProductCode } from '@/lib/types'
import { CODE_USAGE_STATUS_LABEL } from '@/lib/types'
import {
  usageCodeHeaderIndex,
  type UsageCodeColumn,
} from '@/lib/codes/usage-code-columns'

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
  columns?: UsageCodeColumn[]
}) {
  const XLSX = await import('xlsx')
  const codeLabel =
    options.columns?.find((column) => column.sourceKey === 'code')?.label ??
    '88코드'
  const statusLabel =
    options.columns?.find((column) => column.sourceKey === 'status')?.label ??
    '상태'
  const headers = [codeLabel, statusLabel]
  const guideRows = [
    ['항목명', '필수', '예시', '설명'],
    [
      codeLabel,
      'Y',
      '8801234000015',
      '자사 바코드 마스터에 이미 등록된 13자리 바코드',
    ],
    [
      statusLabel,
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
  columns?: UsageCodeColumn[]
}): PreparedUsageRow[] {
  const { rows, ownCodes, existingByCodeId } = options
  if (rows.length === 0) return []

  const codeIdx = usageCodeHeaderIndex(rows[0], options.columns ?? [], 'code')
  const statusIdx = usageCodeHeaderIndex(
    rows[0],
    options.columns ?? [],
    'status',
  )

  // 업체 설정이 없던 호출만 기존 열 위치를 유지한다. 설정이 있으면 잘못된 헤더를 추측하지 않는다.
  const resolvedCodeIdx = codeIdx >= 0 ? codeIdx : options.columns ? -1 : 0
  const resolvedStatusIdx =
    statusIdx >= 0 ? statusIdx : options.columns ? -1 : 1

  const codeMap = new Map(
    ownCodes.filter((c) => c.kind === 'own').map((c) => [c.code, c] as const),
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
        message:
          '자사 바코드 마스터에 없는 코드입니다. 먼저 바코드를 등록하세요.',
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
