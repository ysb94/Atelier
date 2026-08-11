import type { InvoiceCodeRuleInput } from '@/lib/supabase/invoice-name-rules'
import type { InvoiceNameRuleAction } from '@/lib/types'

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
 * 자체품번코드 기준 일괄 등록용 빈 양식 xlsx를 내려받는다.
 * 공식 상품명을 비우면 예외(원본 품목명 유지)로 등록된다.
 */
export async function downloadInvoiceCodeRuleTemplate(brandName: string) {
  const XLSX = await import('xlsx')
  const headers = ['자체품번코드', '공식 상품명', '메모']
  const guideRows = [
    ['항목명', '필수', '설명'],
    ['자체품번코드', 'Y', '사방넷 자체품번코드와 정확히 같은 값을 입력'],
    [
      '공식 상품명',
      'N',
      '비우면 예외로 등록해 원본 품목명을 유지함. 채우면 이 이름으로 바뀜',
    ],
    ['메모', 'N', '등록·예외 처리 이유 등 참고용'],
  ]

  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([
    headers,
    ['RABBITECOHELF', '래빗에코백 허니루프', ''],
    ['KAKAOSPCOLLECTION', '', '원본 품목명 유지'],
  ])
  uploadSheet['!cols'] = [{ wch: 22 }, { wch: 30 }, { wch: 28 }]
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  guideSheet['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 52 }]

  XLSX.utils.book_append_sheet(workbook, uploadSheet, '자체품번등록')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')

  const fileName = `${safeFilePart(brandName)}_자체품번코드등록_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export type PreparedInvoiceRuleRow = {
  lineNo: number
  code: string
  officialName: string
  note: string
  action: InvoiceNameRuleAction
  statusLabel: 'ok' | 'error'
  message: string
}

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

/**
 * 자체품번코드·공식 상품명·메모 3열 양식을 읽어 등록 행을 준비한다.
 * 공식 상품명이 비면 예외로, 채워지면 공식명 변경으로 등록한다.
 */
export function prepareInvoiceRuleRows(
  rows: string[][],
): PreparedInvoiceRuleRow[] {
  if (rows.length === 0) return []

  const seenCodes = new Set<string>()
  const prepared: PreparedInvoiceRuleRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const lineNo = i + 1
    if (row.every((value) => !value.trim())) continue

    const rawCode = (row[0] ?? '').trim()
    const rawName = (row[1] ?? '').trim()
    const rawNote = (row[2] ?? '').trim()
    const action: InvoiceNameRuleAction = rawName ? 'rename' : 'exception'

    if (!rawCode) {
      prepared.push({
        lineNo,
        code: '',
        officialName: rawName,
        note: rawNote,
        action,
        statusLabel: 'error',
        message: '자체품번코드가 비어 있습니다.',
      })
      continue
    }

    const key = normalizeCode(rawCode)
    if (seenCodes.has(key)) {
      prepared.push({
        lineNo,
        code: rawCode,
        officialName: rawName,
        note: rawNote,
        action,
        statusLabel: 'error',
        message: '파일 안에서 중복된 자체품번코드입니다.',
      })
      continue
    }
    seenCodes.add(key)

    prepared.push({
      lineNo,
      code: rawCode,
      officialName: rawName,
      note: rawNote,
      action,
      statusLabel: 'ok',
      message:
        action === 'rename'
          ? `공식명 "${rawName}"으로 등록합니다.`
          : '예외(원본 품목명 유지)로 등록합니다.',
    })
  }

  return prepared
}

/** 미리보기에서 통과한 행을 저장 입력으로 바꾼다. */
export function toInvoiceCodeRuleInput(
  row: PreparedInvoiceRuleRow,
): InvoiceCodeRuleInput {
  return {
    ownProductCode: row.code,
    action: row.action,
    officialProductName: row.officialName,
    note: row.note,
  }
}
