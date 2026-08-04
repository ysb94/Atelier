import type { ProductCodeComponent } from '@/lib/types'

/** 구성이 같은 코드를 찾기 위한 비교용 문자열. 순서는 무시한다. */
export function componentSignature(components: ProductCodeComponent[]): string {
  return components
    .filter((component) => component.styleId && component.qty > 0)
    .map((component) => `${component.styleId}x${component.qty}`)
    .sort()
    .join('|')
}
