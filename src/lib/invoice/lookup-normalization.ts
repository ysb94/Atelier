import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'

/**
 * 품목명 비교용 압축 키.
 * 엄격 정규화 뒤 공백·특수기호를 제거하고 한글·영문·숫자만 남긴다.
 * 원문·표시용 값은 바꾸지 않는다.
 */
export function compactProductNameKey(value: string): string {
  return normalizeInvoiceText(value).replace(/[^0-9a-z가-힣]/gi, '')
}
