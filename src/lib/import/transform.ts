import type { Season, Style } from '@/lib/types'
import { FIELD_MAP, type FieldOwner, type ImportField } from './fields'

/** 컬럼 인덱스 -> 시스템 필드 키 (매핑 안 함은 null) */
export type ColumnMapping = (string | null)[]

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
  ignoredFields: string[]
  targetStyleId?: string
}

export type PrepareOptions = {
  rows: string[][]
  mapping: ColumnMapping
  hasHeader: boolean
  sourceOwner: FieldOwner
  allowCrossDepartment: boolean
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

function isEditableBy(
  field: ImportField,
  sourceOwner: FieldOwner,
  allowCrossDepartment: boolean,
): boolean {
  if (field.key === 'styleNo') return true
  if (field.owner === 'common') return true
  if (field.owner === sourceOwner) return true
  return allowCrossDepartment
}

export function prepareRows({
  rows,
  mapping,
  hasHeader,
  sourceOwner,
  allowCrossDepartment,
  existingStyles,
  seasons,
}: PrepareOptions): PreparedRow[] {
  const dataRows = hasHeader ? rows.slice(1) : rows
  const offset = hasHeader ? 2 : 1

  const existingByKey = new Map(
    existingStyles.map((style) => [normalizeStyleNo(style.styleNo), style]),
  )
  const seasonByCode = new Map(
    seasons.map((season) => [season.code.toUpperCase(), season]),
  )
  const seenKeys = new Map<string, number>()

  return dataRows.map((cells, index) => {
    const lineNo = index + offset
    const errors: string[] = []
    const warnings: string[] = []
    const raw: Record<string, string> = {}
    const applied: Record<string, unknown> = {}
    const ignoredFields: string[] = []

    mapping.forEach((fieldKey, columnIndex) => {
      if (!fieldKey) return
      const value = (cells[columnIndex] ?? '').trim()
      if (value) raw[fieldKey] = value
    })

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
        ignoredFields,
      }
    }

    const duplicateLine = seenKeys.get(matchKey)
    if (duplicateLine) {
      errors.push(`파일 안에서 품번이 중복됩니다 (${duplicateLine}행과 동일)`)
    } else {
      seenKeys.set(matchKey, lineNo)
    }

    const existing = existingByKey.get(matchKey)
    let seasonRejected = false

    for (const [fieldKey, value] of Object.entries(raw)) {
      if (fieldKey === 'styleNo') continue
      const field = FIELD_MAP.get(fieldKey)
      if (!field) continue

      if (!isEditableBy(field, sourceOwner, allowCrossDepartment)) {
        ignoredFields.push(field.label)
        continue
      }

      switch (field.type) {
        case 'number': {
          const parsed = coerceNumber(value)
          if (parsed === null) {
            errors.push(`${field.label}: 숫자로 읽을 수 없습니다 ("${value}")`)
          } else {
            applied[fieldKey] = parsed
          }
          break
        }
        case 'gender': {
          const parsed = coerceGender(value)
          if (parsed === null) {
            warnings.push(`${field.label}: "${value}"를 알 수 없어 건너뜁니다`)
          } else {
            applied[fieldKey] = parsed
          }
          break
        }
        case 'list': {
          applied[fieldKey] = coerceList(value)
          break
        }
        case 'season': {
          const season = seasonByCode.get(value.toUpperCase())
          if (!season) {
            errors.push(`시즌 코드 "${value}"가 이 브랜드에 없습니다`)
            seasonRejected = true
          } else {
            applied.seasonId = season.id
          }
          break
        }
        default: {
          applied[fieldKey] = value
        }
      }
    }

    if (!existing) {
      const missing: string[] = []
      if (!applied.name) missing.push('상품명')
      if (!applied.seasonId && !seasonRejected) missing.push('시즌')

      const blockedByOwner = missing.filter((label) =>
        ignoredFields.includes(label),
      )
      const stillMissing = missing.filter(
        (label) => !ignoredFields.includes(label),
      )

      if (blockedByOwner.length > 0) {
        errors.push(
          `신규 등록에 필요한 ${blockedByOwner.join(', ')}이(가) 다른 부서 소유입니다. 기획 시트로 먼저 등록하거나 덮어쓰기 옵션을 켜세요`,
        )
      }
      if (stillMissing.length > 0) {
        errors.push(`신규 상품은 ${stillMissing.join(', ')}이(가) 필요합니다`)
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
      ignoredFields,
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
