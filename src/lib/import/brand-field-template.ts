import type { BrandField, FieldOwner } from '@/lib/types'

/** 양식 다운로드용: 선택 부서 + 품번 항상 포함 */
export function filterFieldsForTemplate(
  fields: BrandField[],
  ownerFilter?: FieldOwner | 'all',
): BrandField[] {
  if (!ownerFilter || ownerFilter === 'all') return fields
  return fields.filter(
    (f) =>
      f.systemKey === 'styleNo' ||
      f.owner === ownerFilter ||
      f.owner === 'common',
  )
}
