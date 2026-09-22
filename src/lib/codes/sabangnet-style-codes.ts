import type { BrandField, Style } from '@/lib/types'

export type SabangnetStyleCodeLink = {
  styleId: string
  code: string
}

/** 상품 데이터 시트의 「사방넷코드」 항목. 값은 상품 필드가 아니라 사방넷 연결에서 채운다. */
export function isSabangnetCodeField(field: BrandField): boolean {
  return field.label.replace(/\s+/g, '') === '사방넷코드'
}

/** 한 M번호가 여러 사방넷 코드에 있으면 코드 순으로 쉼표로 잇는다. */
export function sabangnetCodeByStyleId(
  links: SabangnetStyleCodeLink[],
): Map<string, string> {
  const grouped = new Map<string, string[]>()
  for (const link of links) {
    const code = link.code.trim()
    if (!link.styleId || !code) continue
    const list = grouped.get(link.styleId) ?? []
    if (!list.includes(code)) list.push(code)
    grouped.set(link.styleId, list)
  }

  const result = new Map<string, string>()
  for (const [styleId, codes] of grouped) {
    codes.sort((left, right) => left.localeCompare(right, 'ko'))
    result.set(styleId, codes.join(', '))
  }
  return result
}

/** 내보내기 열이 화면에 보이는 사방넷 코드와 같게 한다. */
export function applySabangnetCodesToStyles(
  styles: Style[],
  fields: BrandField[],
  codeByStyleId: Map<string, string>,
): Style[] {
  const fieldIds = fields.filter(isSabangnetCodeField).map((field) => field.id)
  if (fieldIds.length === 0) return styles
  return styles.map((style) => {
    const code = codeByStyleId.get(style.id) ?? ''
    const values = { ...style.values }
    let changed = false
    for (const fieldId of fieldIds) {
      if (values[fieldId] !== code) {
        values[fieldId] = code
        changed = true
      }
    }
    if (!changed) return style
    return { ...style, values }
  })
}
