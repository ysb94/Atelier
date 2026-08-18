import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'

/** 비교 키를 만들기 전에 HTML 엔티티만 풀어 원문 표기를 맞춘다. */
export function decodeInvoiceHtmlEntities(value: string): string {
  let current = value
  for (let i = 0; i < 3; i += 1) {
    const next = current
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&nbsp;/gi, ' ')
    if (next === current) break
    current = next
  }
  return current
}

/**
 * 품목명 비교용 압축 키.
 * HTML 엔티티를 푼 뒤 엄격 정규화하고 공백·특수기호를 제거한다.
 * 한글·영문·숫자만 남기며 원문·표시용 값은 바꾸지 않는다.
 */
export function compactProductNameKey(value: string): string {
  return normalizeInvoiceText(decodeInvoiceHtmlEntities(value)).replace(
    /[^0-9a-z가-힣]/gi,
    '',
  )
}
