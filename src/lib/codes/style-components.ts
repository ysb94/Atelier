import { normalizeStyleNo } from '@/lib/import/transform'
import type { ProductCodeComponent, Style } from '@/lib/types'

/** M번호(SKU)별 구성품을 찾고 미등록·중복 입력을 반환한다. 오류 문구는 호출자가 결정한다. */
export function resolveComponents(options: {
  styleTokens: string[]
  styleByNo: Map<string, Style>
}): {
  styleNos: string[]
  components: ProductCodeComponent[]
  missing: string[]
  duplicates: string[]
} {
  const { styleTokens, styleByNo } = options
  const seenInRow = new Set<string>()
  const components: ProductCodeComponent[] = []
  const styleNos: string[] = []
  const missing: string[] = []
  const duplicates: string[] = []

  for (const token of styleTokens) {
    const key = normalizeStyleNo(token)
    if (!key) continue
    if (seenInRow.has(key)) {
      duplicates.push(token)
      continue
    }
    seenInRow.add(key)
    const style = styleByNo.get(key)
    if (!style) {
      missing.push(token)
      continue
    }
    styleNos.push(style.styleNo)
    components.push({
      styleId: style.id,
      styleNo: style.styleNo,
      qty: 1,
    })
  }

  return { styleNos, components, missing, duplicates }
}
