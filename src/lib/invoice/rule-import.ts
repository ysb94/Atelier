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

export type UnresolvedInvoiceCodeExportRow = {
  ownProductCode: string
  productNames: string[]
  rowCount: number
}

/**
 * 변환 안 된 자체품번코드를 일괄 등록 양식과 같은 3열로 내려받는다.
 * 품목명이 여러 개면 행을 나눠 넣고, 4·5열(참고 품목명·건수)은 작업용이다.
 * 업로드 시에는 앞 3열만 읽으며, 같은 코드의 이어쓰기 행은 하나로 합친다.
 */
export async function downloadUnresolvedInvoiceCodes(options: {
  brandName: string
  codes: UnresolvedInvoiceCodeExportRow[]
}) {
  const XLSX = await import('xlsx')
  const headers = ['자체품번코드', '공식 상품명', '메모', '참고_품목명', '건수']
  const body: string[][] = []

  for (const code of options.codes) {
    const names = code.productNames.length > 0 ? code.productNames : ['']
    names.forEach((productName, index) => {
      body.push([
        code.ownProductCode,
        '',
        '',
        productName,
        index === 0 ? String(code.rowCount) : '',
      ])
    })
  }

  const guideRows = [
    ['항목명', '필수', '설명'],
    ['자체품번코드', 'Y', '이미 채워져 있음. 바꾸지 말 것'],
    [
      '공식 상품명',
      'N',
      '같은 코드가 여러 행이어도 한 곳만 채우면 됨. 서로 다른 이름을 넣으면 오류. 비우면 예외',
    ],
    ['메모', 'N', '등록·예외 처리 이유 등 참고용'],
    [
      '참고_품목명 / 건수',
      '-',
      '품목명이 여러 개면 행이 나뉨. 업로드 시 무시되며 같은 코드는 하나로 합침',
    ],
  ]

  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  uploadSheet['!cols'] = [
    { wch: 22 },
    { wch: 30 },
    { wch: 28 },
    { wch: 40 },
    { wch: 8 },
  ]
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  guideSheet['!cols'] = [{ wch: 18 }, { wch: 6 }, { wch: 56 }]

  XLSX.utils.book_append_sheet(workbook, uploadSheet, '자체품번등록')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')

  const fileName = `${safeFilePart(options.brandName)}_변환안된코드_${todayStamp()}.xlsx`
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
 * 같은 코드가 여러 행이면(참고 품목명 분할 등) 하나로 합치고,
 * 서로 다른 공식명이 있으면 해당 코드는 전부 오류로 표시한다.
 */
export function prepareInvoiceRuleRows(
  rows: string[][],
): PreparedInvoiceRuleRow[] {
  if (rows.length === 0) return []

  type RawRow = {
    lineNo: number
    code: string
    officialName: string
    note: string
  }

  const rawRows: RawRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const lineNo = i + 1
    if (row.every((value) => !value.trim())) continue

    const rawCode = (row[0] ?? '').trim()
    const rawName = (row[1] ?? '').trim()
    const rawNote = (row[2] ?? '').trim()

    if (!rawCode) {
      if (!rawName && !rawNote) continue
      rawRows.push({
        lineNo,
        code: '',
        officialName: rawName,
        note: rawNote,
      })
      continue
    }

    rawRows.push({
      lineNo,
      code: rawCode,
      officialName: rawName,
      note: rawNote,
    })
  }

  const prepared: PreparedInvoiceRuleRow[] = []
  const groups = new Map<string, RawRow[]>()

  for (const raw of rawRows) {
    if (!raw.code) {
      prepared.push({
        lineNo: raw.lineNo,
        code: '',
        officialName: raw.officialName,
        note: raw.note,
        action: raw.officialName ? 'rename' : 'exception',
        statusLabel: 'error',
        message: '자체품번코드가 비어 있습니다.',
      })
      continue
    }

    const key = normalizeCode(raw.code)
    const list = groups.get(key) ?? []
    list.push(raw)
    groups.set(key, list)
  }

  for (const group of groups.values()) {
    const distinctNames = [
      ...new Set(
        group.map((row) => row.officialName).filter((name) => name.length > 0),
      ),
    ]
    const first = group[0]!
    const mergedNote =
      group.map((row) => row.note).find((note) => note.length > 0) ?? ''

    if (distinctNames.length > 1) {
      const nameList = distinctNames.join(' / ')
      for (const raw of group) {
        if (!raw.officialName) continue
        prepared.push({
          lineNo: raw.lineNo,
          code: raw.code,
          officialName: raw.officialName,
          note: raw.note,
          action: 'rename',
          statusLabel: 'error',
          message: `같은 코드에 서로 다른 공식 상품명이 있습니다. (${nameList})`,
        })
      }
      continue
    }

    const officialName = distinctNames[0] ?? ''
    const action: InvoiceNameRuleAction = officialName ? 'rename' : 'exception'

    prepared.push({
      lineNo: first.lineNo,
      code: first.code,
      officialName,
      note: mergedNote,
      action,
      statusLabel: 'ok',
      message:
        action === 'rename'
          ? `공식명 "${officialName}"으로 등록합니다.`
          : '예외(원본 품목명 유지)로 등록합니다.',
    })
  }

  prepared.sort((left, right) => left.lineNo - right.lineNo)
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
