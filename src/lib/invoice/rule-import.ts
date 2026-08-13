import { normalizeStyleNo } from '@/lib/import/transform'
import type { InvoiceCodeRuleInput } from '@/lib/supabase/invoice-name-rules'
import type { InvoiceNameRuleAction, StyleRef } from '@/lib/types'

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
 * M번호·공식 상품명을 비우면 예외(원본 품목명 유지)로 등록된다.
 */
export async function downloadInvoiceCodeRuleTemplate(brandName: string) {
  const XLSX = await import('xlsx')
  const headers = ['자체품번코드', 'M번호', '공식 상품명(참고)', '메모']
  const guideRows = [
    ['항목명', '필수', '설명'],
    ['자체품번코드', 'Y', '사방넷 자체품번코드와 정확히 같은 값을 입력'],
    [
      'M번호',
      'N*',
      '데이터 시트 품번. 채우면 이 상품으로 연결. 비우고 상품명만 있으면 이름으로 찾음',
    ],
    [
      '공식 상품명(참고)',
      'N*',
      'M번호가 없을 때만 사용. 데이터 시트 상품명과 완전 일치해야 함. 둘 다 비우면 예외',
    ],
    ['메모', 'N', '등록·예외 처리 이유 등 참고용'],
  ]

  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([
    headers,
    ['RABBITECOHELF', 'M0003', '래빗에코백 허니루프', ''],
    ['KAKAOSPCOLLECTION', '', '', '원본 품목명 유지'],
  ])
  uploadSheet['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 30 }, { wch: 28 }]
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  guideSheet['!cols'] = [{ wch: 18 }, { wch: 6 }, { wch: 64 }]

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
 * 변환 안 된 자체품번코드를 일괄 등록 양식과 같은 열로 내려받는다.
 * 품목명이 여러 개면 행을 나눠 넣고, 참고 열은 작업용이다.
 */
export async function downloadUnresolvedInvoiceCodes(options: {
  brandName: string
  codes: UnresolvedInvoiceCodeExportRow[]
}) {
  const XLSX = await import('xlsx')
  const headers = [
    '자체품번코드',
    'M번호',
    '공식 상품명(참고)',
    '메모',
    '참고_품목명',
    '건수',
  ]
  const body: string[][] = []

  for (const code of options.codes) {
    const names = code.productNames.length > 0 ? code.productNames : ['']
    names.forEach((productName, index) => {
      body.push([
        code.ownProductCode,
        '',
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
      'M번호',
      'N*',
      '데이터 시트 품번. 같은 코드가 여러 행이어도 한 곳만 채우면 됨. 서로 다른 M번호면 오류',
    ],
    [
      '공식 상품명(참고)',
      'N*',
      'M번호가 없을 때만 사용. 데이터 시트 상품명과 완전 일치. 둘 다 비우면 예외',
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
    { wch: 12 },
    { wch: 30 },
    { wch: 28 },
    { wch: 40 },
    { wch: 8 },
  ]
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  guideSheet['!cols'] = [{ wch: 18 }, { wch: 6 }, { wch: 64 }]

  XLSX.utils.book_append_sheet(workbook, uploadSheet, '자체품번등록')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')

  const fileName = `${safeFilePart(options.brandName)}_변환안된코드_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export type PreparedInvoiceRuleRow = {
  lineNo: number
  code: string
  styleNo: string
  officialName: string
  targetStyle: StyleRef | null
  note: string
  action: InvoiceNameRuleAction
  statusLabel: 'ok' | 'error'
  message: string
}

export type InvoiceRuleStyleLookup = {
  byStyleNo: Map<string, StyleRef>
  byName: Map<string, StyleRef[]>
}

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

function resolveStyle(
  styleNo: string,
  officialName: string,
  lookup: InvoiceRuleStyleLookup,
): { style: StyleRef | null; error: string | null } {
  if (styleNo) {
    const key = normalizeStyleNo(styleNo)
    const byNorm = lookup.byStyleNo.get(key)
    if (byNorm) return { style: byNorm, error: null }
    const byLower = lookup.byStyleNo.get(styleNo.trim().toLocaleLowerCase('ko-KR'))
    if (byLower) return { style: byLower, error: null }
    return { style: null, error: `M번호를 찾을 수 없습니다: ${styleNo}` }
  }

  if (!officialName) return { style: null, error: null }

  const nameKey = officialName.trim().toLocaleLowerCase('ko-KR')
  const matches = lookup.byName.get(nameKey) ?? []
  if (matches.length === 1) return { style: matches[0]!, error: null }
  if (matches.length === 0) {
    return {
      style: null,
      error: `상품명을 찾을 수 없습니다: ${officialName}`,
    }
  }
  return {
    style: null,
    error: '상품명이 여러 상품과 겹칩니다. M번호를 넣으세요',
  }
}

/**
 * 자체품번코드·M번호·공식 상품명·메모 양식을 읽어 등록 행을 준비한다.
 * M번호/상품명이 비면 예외로, 채워지면 공식명 변경으로 등록한다.
 */
export function prepareInvoiceRuleRows(
  rows: string[][],
  lookup: InvoiceRuleStyleLookup,
): PreparedInvoiceRuleRow[] {
  if (rows.length === 0) return []

  type RawRow = {
    lineNo: number
    code: string
    styleNo: string
    officialName: string
    note: string
  }

  const rawRows: RawRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const lineNo = i + 1
    if (row.every((value) => !value.trim())) continue

    const rawCode = (row[0] ?? '').trim()
    const rawStyleNo = (row[1] ?? '').trim()
    const rawName = (row[2] ?? '').trim()
    const rawNote = (row[3] ?? '').trim()

    if (!rawCode) {
      if (!rawStyleNo && !rawName && !rawNote) continue
      rawRows.push({
        lineNo,
        code: '',
        styleNo: rawStyleNo,
        officialName: rawName,
        note: rawNote,
      })
      continue
    }

    rawRows.push({
      lineNo,
      code: rawCode,
      styleNo: rawStyleNo,
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
        styleNo: raw.styleNo,
        officialName: raw.officialName,
        targetStyle: null,
        note: raw.note,
        action: raw.styleNo || raw.officialName ? 'rename' : 'exception',
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
    const filled = group.filter((row) => row.styleNo || row.officialName)
    const first = group[0]!
    const mergedNote =
      group.map((row) => row.note).find((note) => note.length > 0) ?? ''

    if (filled.length === 0) {
      prepared.push({
        lineNo: first.lineNo,
        code: first.code,
        styleNo: '',
        officialName: '',
        targetStyle: null,
        note: mergedNote,
        action: 'exception',
        statusLabel: 'ok',
        message: '예외(원본 품목명 유지)로 등록합니다.',
      })
      continue
    }

    const resolved = filled.map((row) => ({
      raw: row,
      ...resolveStyle(row.styleNo, row.officialName, lookup),
    }))

    const resolveErrors = resolved.filter((item) => item.error)
    if (resolveErrors.length > 0) {
      for (const item of resolveErrors) {
        prepared.push({
          lineNo: item.raw.lineNo,
          code: item.raw.code,
          styleNo: item.raw.styleNo,
          officialName: item.raw.officialName,
          targetStyle: null,
          note: item.raw.note,
          action: 'rename',
          statusLabel: 'error',
          message: item.error!,
        })
      }
      continue
    }

    const styleIds = [
      ...new Set(
        resolved
          .map((item) => item.style?.styleId)
          .filter((id): id is string => Boolean(id)),
      ),
    ]

    if (styleIds.length > 1) {
      const label = resolved
        .map((item) => item.style?.styleNo ?? item.raw.styleNo)
        .filter(Boolean)
        .join(' / ')
      for (const item of resolved) {
        prepared.push({
          lineNo: item.raw.lineNo,
          code: item.raw.code,
          styleNo: item.raw.styleNo,
          officialName: item.raw.officialName,
          targetStyle: item.style,
          note: item.raw.note,
          action: 'rename',
          statusLabel: 'error',
          message: `같은 코드에 서로 다른 상품이 있습니다. (${label})`,
        })
      }
      continue
    }

    const style = resolved.find((item) => item.style)?.style ?? null
    if (!style) {
      prepared.push({
        lineNo: first.lineNo,
        code: first.code,
        styleNo: first.styleNo,
        officialName: first.officialName,
        targetStyle: null,
        note: mergedNote,
        action: 'rename',
        statusLabel: 'error',
        message: '연결할 상품을 찾지 못했습니다.',
      })
      continue
    }

    prepared.push({
      lineNo: first.lineNo,
      code: first.code,
      styleNo: style.styleNo,
      officialName: style.name,
      targetStyle: style,
      note: mergedNote,
      action: 'rename',
      statusLabel: 'ok',
      message: `공식명 "${style.styleNo} · ${style.name}"으로 등록합니다.`,
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
    targetStyle: row.targetStyle ?? undefined,
    note: row.note,
  }
}
