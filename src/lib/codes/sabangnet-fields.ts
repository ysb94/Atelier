import type { SabangnetField, SabangnetFieldSystemKey } from '@/lib/types'

export const SABANGNET_SYSTEM_FIELDS: ReadonlyArray<{
  systemKey: SabangnetFieldSystemKey
  label: string
  type: SabangnetField['type']
  locked: boolean
}> = [
  {
    systemKey: 'code',
    label: '사방넷 코드',
    type: 'text',
    locked: true,
  },
  {
    systemKey: 'name',
    label: '사방넷 상품명',
    type: 'text',
    locked: true,
  },
  {
    systemKey: 'styles',
    label: 'M번호 리스트',
    type: 'text',
    locked: false,
  },
]

export function isLockedSabangnetField(field: SabangnetField) {
  return field.systemKey === 'code' || field.systemKey === 'name'
}

export function sabangnetFieldLabel(
  fields: SabangnetField[],
  systemKey: SabangnetFieldSystemKey,
  fallback: string,
) {
  return fields.find((field) => field.systemKey === systemKey)?.label ?? fallback
}

/** 추가 숫자 항목. 천단위 콤마는 허용하고, 그 외 문자는 오류다. */
export function parseSabangnetNumber(
  raw: string,
  label: string,
): { value?: string; error?: string } {
  const cleaned = raw.replace(/,/g, '').replace(/\s+/g, '')
  if (!cleaned) return {}
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return { error: `${label}은(는) 숫자만 입력하세요. (${raw})` }
  }
  return { value: cleaned }
}
