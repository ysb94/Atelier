import type { BrandField, FieldOwner, Style, StyleStatus } from '@/lib/types'

/** Style 타입 속성으로 직접 저장되는 시스템 키 */
export const STYLE_TYPED_KEYS = new Set([
  'styleNo',
  'name',
  'seasonCode',
  'seasonId',
  'category',
  'gender',
  'colors',
  'plannedQty',
  'targetCost',
  'retailPrice',
  'planner',
  'designer',
  'description',
  'weightG',
  'status',
])

export function fieldValueKey(field: BrandField): string {
  return field.systemKey ?? field.id
}

export function isFieldFilled(style: Style, field: BrandField): boolean {
  const text = getStyleFieldDisplay(style, field).trim()
  return text.length > 0 && text !== '—'
}

export function getStyleFieldDisplay(
  style: Style,
  field: BrandField,
  options?: { seasonCode?: string },
): string {
  const key = field.systemKey
  if (!key) {
    return style.values?.[field.id] ?? style.customFields?.[field.label] ?? ''
  }

  switch (key) {
    case 'styleNo':
      return style.styleNo
    case 'name':
      return style.name
    case 'seasonCode':
    case 'seasonId':
      return options?.seasonCode ?? ''
    case 'category':
      return style.category
    case 'gender':
      return style.gender === 'W'
        ? '여성'
        : style.gender === 'M'
          ? '남성'
          : style.gender === 'U'
            ? '유니섹스'
            : ''
    case 'colors':
      return style.colors.join(', ')
    case 'plannedQty':
      return style.plannedQty != null ? String(style.plannedQty) : ''
    case 'targetCost':
      return style.targetCost != null ? String(style.targetCost) : ''
    case 'retailPrice':
      return style.retailPrice != null ? String(style.retailPrice) : ''
    case 'planner':
      return style.planner ?? ''
    case 'designer':
      return style.designer ?? ''
    case 'description':
      return style.description ?? ''
    case 'weightG':
      return style.weightG != null && style.weightG > 0
        ? String(style.weightG)
        : ''
    case 'status':
      return style.status
    default:
      return style.values?.[key] ?? ''
  }
}

/** 편집 입력용 원시 문자열 (성별은 W/M/U, 컬러는 콤마 구분) */
export function getStyleFieldRaw(
  style: Style,
  field: BrandField,
  options?: { seasonCode?: string },
): string {
  const key = field.systemKey
  if (!key) {
    return style.values?.[field.id] ?? style.customFields?.[field.label] ?? ''
  }
  if (key === 'gender') return style.gender
  if (key === 'colors') return style.colors.join(', ')
  if (key === 'seasonCode' || key === 'seasonId') {
    return options?.seasonCode ?? style.seasonId
  }
  return getStyleFieldDisplay(style, field, options)
}

export function ownerCompleteness(
  style: Style,
  fields: BrandField[],
  owner: FieldOwner,
): { filled: number; total: number; ratio: number } {
  const owned = fields.filter(
    (f) =>
      f.owner === owner &&
      f.systemKey !== 'styleNo' &&
      f.level !== 'sku',
  )
  if (owned.length === 0) return { filled: 0, total: 0, ratio: 1 }
  const filled = owned.filter((f) => isFieldFilled(style, f)).length
  return {
    filled,
    total: owned.length,
    ratio: filled / owned.length,
  }
}

export function parseColors(raw: string): string[] {
  return raw
    .split(/[,/|]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function parseGender(raw: string): 'W' | 'M' | 'U' | null {
  const value = raw.trim().toLowerCase()
  if (!value) return null
  if (['w', '여성', '여', 'woman', 'female', 'f'].includes(value)) return 'W'
  if (['m', '남성', '남', 'man', 'male'].includes(value)) return 'M'
  if (['u', '유니섹스', '공용', 'unisex'].includes(value)) return 'U'
  return null
}

export function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,원\s]/g, '').trim()
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

export function isStyleStatus(value: string): value is StyleStatus {
  return [
    'draft',
    'design',
    'sampling',
    'confirmed',
    'ordered',
    'received',
  ].includes(value)
}
