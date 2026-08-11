import {
  codeFieldValue,
  parsePositiveCm,
  resolveBarcodeFieldColumns,
} from '@/lib/codes/barcode-fields'
import type {
  BarcodeField,
  BarcodeFieldSystemKey,
  ProductCode,
  ProductCodeInput,
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
 * 기존 자사 바코드 정보를 수정할 xlsx를 내려받는다.
 * 88코드는 매칭 키이고 바코드 상품명·M번호는 확인용이라 이 경로에서 바꾸지 않는다.
 */
export async function downloadBarcodeInfoWorkbook(options: {
  brandName: string
  codes: ProductCode[]
  fields: BarcodeField[]
}) {
  const XLSX = await import('xlsx')
  const fields = [...options.fields]
    .filter((field) => field.systemKey !== 'components')
    .sort((a, b) => a.order - b.order)
  const headers = fields.map((field) => field.label)
  const body = [...options.codes]
    .sort((a, b) => a.code.localeCompare(b.code, 'en'))
    .map((code) => fields.map((field) => codeFieldValue(code, field)))
  const guideRows = fields.map((field) => [
    field.label,
    field.systemKey === 'code'
      ? '필수. 등록된 13자리 88코드와 정확히 같은 값으로 행을 찾음'
      : field.systemKey === 'name'
        ? '확인용. 이 파일로는 수정하지 않음'
        : field.systemKey === 'weightG'
          ? '1 이상의 정수(g). 빈 칸이면 기존 값을 유지'
          : field.systemKey === 'widthCm' ||
              field.systemKey === 'depthCm' ||
              field.systemKey === 'heightCm'
            ? '0보다 큰 수, 소수 첫째 자리까지(cm). 빈 칸이면 기존 값을 유지'
            : field.type === 'number'
              ? '숫자. 빈 칸이면 기존 값을 유지'
              : '값이 있으면 교체. 빈 칸이면 기존 값을 유지',
  ])
  guideRows.unshift(['항목', '설명'])

  const workbook = XLSX.utils.book_new()
  const dataSheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  dataSheet['!cols'] = fields.map((field) => ({
    wch:
      field.systemKey === 'code'
        ? 18
        : field.systemKey === 'name'
          ? 42
          : field.type === 'number'
            ? 14
            : 28,
  }))
  guideSheet['!cols'] = [{ wch: 18 }, { wch: 58 }]
  XLSX.utils.book_append_sheet(workbook, dataSheet, '바코드정보수정')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')

  const fileName = `${safeFilePart(options.brandName)}_바코드정보수정_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export type PreparedBarcodeInfoRow = {
  lineNo: number
  codeId: string
  code: string
  name: string
  weightG: number | null
  widthCm: number | null
  depthCm: number | null
  heightCm: number | null
  note: string
  values: Record<string, string>
  statusLabel: 'ok' | 'skip' | 'error'
  message: string
  input: ProductCodeInput | null
}

function cell(row: string[], index: number) {
  return index >= 0 ? (row[index] ?? '').trim() : ''
}

function parsePositiveIntegerG(
  raw: string,
  label: string,
): { value?: number; error?: string } {
  if (!raw) return {}
  const cleaned = raw.replace(/,/g, '').replace(/\s+/g, '').replace(/g$/i, '')
  if (!/^\d+$/.test(cleaned)) {
    return { error: `${label}는 1 이상의 정수로 입력하세요. (${raw})` }
  }
  const value = Number(cleaned)
  if (!Number.isSafeInteger(value) || value < 1) {
    return { error: `${label}는 1 이상의 정수로 입력하세요. (${raw})` }
  }
  return { value }
}

function parseNumberValue(raw: string, label: string): { error?: string } {
  if (!raw) return {}
  const normalized = raw.replace(/,/g, '').trim()
  if (!Number.isFinite(Number(normalized))) {
    return { error: `${label}은(는) 숫자로 입력하세요. (${raw})` }
  }
  return {}
}

function updatedSystemValue(
  systemKey: BarcodeFieldSystemKey,
  raw: string,
  existing: ProductCode,
  label: string,
): { value: number | string | null; error?: string; changed: boolean } {
  switch (systemKey) {
    case 'weightG': {
      const parsed = parsePositiveIntegerG(raw, label)
      return {
        value: parsed.value ?? existing.weightG,
        error: parsed.error,
        changed: parsed.value !== undefined && parsed.value !== existing.weightG,
      }
    }
    case 'widthCm':
    case 'depthCm':
    case 'heightCm': {
      const parsed = parsePositiveCm(raw, label)
      const current =
        systemKey === 'widthCm'
          ? existing.widthCm
          : systemKey === 'depthCm'
            ? existing.depthCm
            : existing.heightCm
      return {
        value: parsed.value ?? current,
        error: parsed.error,
        changed: parsed.value !== undefined && parsed.value !== current,
      }
    }
    case 'note':
      return {
        value: raw || existing.note,
        changed: Boolean(raw && raw !== existing.note),
      }
    default:
      return { value: '', changed: false }
  }
}

/**
 * 88코드로 기존 행을 찾아 바코드 정보 수정 행을 준비한다.
 * 관리 중인 헤더만 반영하며, 빈 칸은 기존 값을 유지한다.
 */
export function prepareBarcodeInfoRows(options: {
  rows: string[][]
  codes: ProductCode[]
  fields: BarcodeField[]
}): PreparedBarcodeInfoRow[] {
  const { rows, codes, fields } = options
  if (rows.length === 0) return []

  const { byFieldId, bySystemKey } = resolveBarcodeFieldColumns(
    rows[0],
    fields,
  )
  const resolvedCodeIdx = bySystemKey.get('code') ?? 0

  const codeByValue = new Map(codes.map((code) => [code.code.trim(), code]))
  const seenCodes = new Set<string>()
  const prepared: PreparedBarcodeInfoRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    if (row.every((value) => !value.trim())) continue

    const lineNo = i + 1
    const rawCode = cell(row, resolvedCodeIdx)
    const base = {
      lineNo,
      codeId: '',
      code: rawCode,
      name: '',
      weightG: null,
      widthCm: null,
      depthCm: null,
      heightCm: null,
      note: '',
      values: {},
      input: null,
    }

    if (!rawCode) {
      prepared.push({
        ...base,
        statusLabel: 'error',
        message: '88코드가 비어 있습니다.',
      })
      continue
    }
    if (seenCodes.has(rawCode)) {
      prepared.push({
        ...base,
        statusLabel: 'error',
        message: '파일 안에서 중복된 바코드입니다.',
      })
      continue
    }
    seenCodes.add(rawCode)

    const existing = codeByValue.get(rawCode)
    if (!existing) {
      prepared.push({
        ...base,
        statusLabel: 'error',
        message: '등록된 자사 바코드가 아닙니다.',
      })
      continue
    }

    let weightG = existing.weightG
    let widthCm = existing.widthCm
    let depthCm = existing.depthCm
    let heightCm = existing.heightCm
    let note = existing.note
    const values = { ...existing.values }
    const changes: string[] = []
    const errors: string[] = []

    for (const field of fields) {
      const index = field.systemKey
        ? bySystemKey.get(field.systemKey)
        : byFieldId.get(field.id)
      if (index === undefined) continue
      const raw = cell(row, index)
      if (!raw) continue

      if (!field.systemKey) {
        if (field.type === 'number') {
          const numeric = parseNumberValue(raw, field.label)
          if (numeric.error) {
            errors.push(numeric.error)
            continue
          }
        }
        if (raw !== existing.values[field.id]) {
          values[field.id] = raw
          changes.push(field.label)
        }
        continue
      }

      if (
        field.systemKey === 'code' ||
        field.systemKey === 'name' ||
        field.systemKey === 'components'
      ) {
        continue
      }
      const result = updatedSystemValue(
        field.systemKey,
        raw,
        existing,
        field.label,
      )
      if (result.error) {
        errors.push(result.error)
        continue
      }
      if (result.changed) changes.push(field.label)
      if (field.systemKey === 'weightG') {
        weightG = result.value as number | null
      } else if (field.systemKey === 'widthCm') {
        widthCm = result.value as number | null
      } else if (field.systemKey === 'depthCm') {
        depthCm = result.value as number | null
      } else if (field.systemKey === 'heightCm') {
        heightCm = result.value as number | null
      } else if (field.systemKey === 'note') {
        note = result.value as string
      }
    }

    if (errors.length > 0) {
      prepared.push({
        ...base,
        codeId: existing.id,
        name: existing.name,
        weightG,
        widthCm,
        depthCm,
        heightCm,
        note,
        values,
        statusLabel: 'error',
        message: errors.join(' '),
      })
      continue
    }

    if (changes.length === 0) {
      prepared.push({
        ...base,
        codeId: existing.id,
        name: existing.name,
        weightG,
        widthCm,
        depthCm,
        heightCm,
        note,
        values,
        statusLabel: 'skip',
        message: '변경된 값이 없어 건너뜁니다.',
      })
      continue
    }

    prepared.push({
      ...base,
      codeId: existing.id,
      name: existing.name,
      weightG,
      widthCm,
      depthCm,
      heightCm,
      note,
      values,
      statusLabel: 'ok',
      message: `${changes.join(', ')} 수정`,
      input: {
        kind: existing.kind,
        code: existing.code,
        name: existing.name,
        weightG,
        widthCm,
        depthCm,
        heightCm,
        note,
        values,
        components: existing.components,
      },
    })
  }

  return prepared
}
