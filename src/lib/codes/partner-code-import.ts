import { resolveComponents } from '@/lib/codes/style-components'
import { parseStyleNoList } from '@/lib/codes/style-no-list'
import { normalizeStyleNo } from '@/lib/import/transform'
import type { ProductCodeComponent, Style } from '@/lib/types'

export const PARTNER_COMPONENT_HEADER = '구성'

/** 엑셀 구성 셀 → ProductCodeComponent[]. error가 있으면 components는 비어 있다. */
export function parsePartnerComponentsCell(
  raw: string,
  styles: Style[],
): { components: ProductCodeComponent[]; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { components: [], error: null }

  const styleByNo = new Map(
    styles.map((style) => [normalizeStyleNo(style.styleNo), style] as const),
  )
  const { components, missing, duplicates } = resolveComponents({
    styleTokens: parseStyleNoList(trimmed),
    styleByNo,
  })

  if (duplicates.length > 0) {
    return {
      components: [],
      error: `같은 M번호가 중복됩니다: ${duplicates.join(', ')}`,
    }
  }
  if (missing.length > 0) {
    return {
      components: [],
      error: `등록되지 않은 M번호: ${missing.join(', ')}`,
    }
  }
  if (components.length === 0) {
    return { components: [], error: '구성 M번호를 입력하세요.' }
  }
  return { components, error: null }
}
