import type { BrandField, Season, Style } from '@/lib/types'
import { FIELD_MAP, normalizeHeader } from './fields'

export type RowStatus = 'new' | 'update' | 'error'

export type PreparedRow = {
  lineNo: number
  styleNo: string
  matchKey: string
  status: RowStatus
  errors: string[]
  warnings: string[]
  raw: Record<string, string>
  applied: Record<string, unknown>
  /** 사용자 정의·미등록 컬럼: 헤더 이름 -> 값 */
  customFields: Record<string, string>
  /** 항목 정의에 없는 헤더 (경고 표시용) */
  unknownHeaders: string[]
  targetStyleId?: string
}

export type PrepareOptions = {
  rows: string[][]
  fields: BrandField[]
  existingStyles: Style[]
  seasons: Season[]
}

/**
 * 시트마다 품번 표기가 미세하게 달라서(공백, 대소문자, 구분자) 매칭 전에 한 형태로 맞춘다.
 */
export function normalizeStyleNo(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[_/\\]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function coerceNumber(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned || cleaned === '-') return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function coerceGender(value: string): Style['gender'] | null {
  const v = value.trim().toUpperCase()
  if (!v) return null
  if (/^(W|F|여|여성|WOMEN|WOMAN|LADIES)$/.test(v)) return 'W'
  if (/^(M|남|남성|MEN|MAN)$/.test(v)) return 'M'
  if (/^(U|공용|남녀공용|유니섹스|UNISEX)$/.test(v)) return 'U'
  return null
}

function coerceList(value: string): string[] {
  return value
    .split(/[,/|·]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** 헤더 텍스트를 브랜드 항목 정의와 매칭 (라벨 + 시스템 aliases) */
export function matchBrandField(
  header: string,
  fields: BrandField[],
): BrandField | null {
  const normalized = normalizeHeader(header)
  if (!normalized) return null

  for (const field of fields) {
    if (normalizeHeader(field.label) === normalized) return field
  }

  for (const field of fields) {
    if (!field.systemKey) continue
    const system = FIELD_MAP.get(field.systemKey)
    if (!system) continue
    if (
      system.aliases.some((alias) => normalizeHeader(alias) === normalized)
    ) {
      return field
    }
  }

  return null
}

function applyTypedValue(
  field: BrandField,
  value: string,
  seasonByCode: Map<string, Season>,
  applied: Record<string, unknown>,
  customFields: Record<string, string>,
  errors: string[],
  warnings: string[],
): { seasonRejected?: boolean } {
  // 사용자 추가 항목
  if (!field.systemKey) {
    customFields[field.label] = value
    return {}
  }

  const key = field.systemKey
  switch (field.type) {
    case 'number': {
      const parsed = coerceNumber(value)
      if (parsed === null) {
        errors.push(`${field.label}: 숫자로 읽을 수 없습니다 ("${value}")`)
      } else {
        applied[key] = parsed
      }
      return {}
    }
    case 'gender': {
      const parsed = coerceGender(value)
      if (parsed === null) {
        warnings.push(`${field.label}: "${value}"를 알 수 없어 건너뜁니다`)
      } else {
        applied[key] = parsed
      }
      return {}
    }
    case 'list': {
      applied[key] = coerceList(value)
      return {}
    }
    case 'season': {
      const season = seasonByCode.get(value.toUpperCase())
      if (!season) {
        errors.push(`시즌 코드 "${value}"가 이 브랜드에 없습니다`)
        return { seasonRejected: true }
      }
      applied.seasonId = season.id
      return {}
    }
    default: {
      if (key === 'styleNo') {
        // raw에서 따로 처리
        return {}
      }
      applied[key] = value
      return {}
    }
  }
}

/**
 * 첫 줄은 항상 헤더.
 * 브랜드 항목 정의의 헤더 이름으로 자동 인식하고, 없는 컬럼은 customFields + warning.
 */
export function prepareRows({
  rows,
  fields,
  existingStyles,
  seasons,
}: PrepareOptions): PreparedRow[] {
  if (rows.length === 0) return []

  const headerRow = rows[0] ?? []
  const dataRows = rows.slice(1)
  const sortedFields = [...fields].sort((a, b) => a.order - b.order)

  const columnFields: (BrandField | null)[] = headerRow.map((header) =>
    matchBrandField(header.trim(), sortedFields),
  )

  const existingByKey = new Map(
    existingStyles.map((style) => [normalizeStyleNo(style.styleNo), style]),
  )
  const seasonByCode = new Map(
    seasons.map((season) => [season.code.toUpperCase(), season]),
  )
  const seenKeys = new Map<string, number>()

  return dataRows.map((cells, index) => {
    const lineNo = index + 2
    const errors: string[] = []
    const warnings: string[] = []
    const raw: Record<string, string> = {}
    const applied: Record<string, unknown> = {}
    const customFields: Record<string, string> = {}
    const unknownHeaders: string[] = []
    let seasonRejected = false

    headerRow.forEach((header, columnIndex) => {
      const value = (cells[columnIndex] ?? '').trim()
      const headerLabel = header.trim() || `컬럼 ${columnIndex + 1}`
      const field = columnFields[columnIndex]

      if (!field) {
        if (value) {
          customFields[headerLabel] = value
          if (!unknownHeaders.includes(headerLabel)) {
            unknownHeaders.push(headerLabel)
          }
        }
        return
      }

      if (!value) return

      if (field.systemKey === 'styleNo') {
        raw.styleNo = value
        return
      }

      if (field.systemKey) {
        raw[field.systemKey] = value
      } else {
        raw[field.label] = value
      }

      const result = applyTypedValue(
        field,
        value,
        seasonByCode,
        applied,
        customFields,
        errors,
        warnings,
      )
      if (result.seasonRejected) seasonRejected = true
    })

    if (unknownHeaders.length > 0) {
      warnings.push(
        `등록되지 않은 항목: ${unknownHeaders.join(', ')} (원본 헤더로 저장됨)`,
      )
    }

    const styleNo = raw.styleNo ?? ''
    const matchKey = normalizeStyleNo(styleNo)

    if (!matchKey) {
      return {
        lineNo,
        styleNo,
        matchKey,
        status: 'error' as const,
        errors: ['품번이 비어 있습니다'],
        warnings,
        raw,
        applied,
        customFields,
        unknownHeaders,
      }
    }

    const duplicateLine = seenKeys.get(matchKey)
    if (duplicateLine) {
      errors.push(`파일 안에서 품번이 중복됩니다 (${duplicateLine}행과 동일)`)
    } else {
      seenKeys.set(matchKey, lineNo)
    }

    const existing = existingByKey.get(matchKey)

    if (!existing) {
      const missing: string[] = []
      for (const field of sortedFields) {
        if (!field.required) continue
        if (field.systemKey === 'styleNo') continue
        if (field.systemKey === 'seasonCode') {
          if (!applied.seasonId && !seasonRejected) missing.push(field.label)
          continue
        }
        if (field.systemKey) {
          if (applied[field.systemKey] === undefined && !raw[field.systemKey]) {
            missing.push(field.label)
          }
          continue
        }
        if (!customFields[field.label]) missing.push(field.label)
      }
      // 기본: 시스템 필수에서 이름/시즌 보완
      if (!applied.name && !missing.includes('상품명')) {
        const nameField = sortedFields.find((f) => f.systemKey === 'name')
        if (nameField?.required !== false && !applied.name) {
          // required check already covered if name is required
        }
      }

      if (missing.length > 0) {
        errors.push(`신규 상품은 ${missing.join(', ')}이(가) 필요합니다`)
      }
    }

    const status: RowStatus =
      errors.length > 0 ? 'error' : existing ? 'update' : 'new'

    return {
      lineNo,
      styleNo,
      matchKey,
      status,
      errors,
      warnings,
      raw,
      applied,
      customFields,
      unknownHeaders,
      targetStyleId: existing?.id,
    }
  })
}

export type ImportSummary = {
  total: number
  created: number
  updated: number
  failed: number
}

export function summarize(rows: PreparedRow[]): ImportSummary {
  return {
    total: rows.length,
    created: rows.filter((r) => r.status === 'new').length,
    updated: rows.filter((r) => r.status === 'update').length,
    failed: rows.filter((r) => r.status === 'error').length,
  }
}

/** 단건 폼 입력값(label/systemKey -> string)을 준비된 행으로 변환 */
export function prepareSingleEntry(options: {
  values: Record<string, string>
  fields: BrandField[]
  existingStyles: Style[]
  seasons: Season[]
}): PreparedRow {
  const ordered = [...options.fields].sort((a, b) => a.order - b.order)
  const headerRow = ordered.map((f) => f.label)
  const dataRow = ordered.map((f) => {
    if (f.systemKey && options.values[f.systemKey] !== undefined) {
      return options.values[f.systemKey] ?? ''
    }
    return options.values[f.label] ?? options.values[f.id] ?? ''
  })
  const rows = prepareRows({
    rows: [headerRow, dataRow],
    fields: options.fields,
    existingStyles: options.existingStyles,
    seasons: options.seasons,
  })
  return (
    rows[0] ?? {
      lineNo: 1,
      styleNo: '',
      matchKey: '',
      status: 'error',
      errors: ['입력값을 확인할 수 없습니다'],
      warnings: [],
      raw: {},
      applied: {},
      customFields: {},
      unknownHeaders: [],
    }
  )
}
