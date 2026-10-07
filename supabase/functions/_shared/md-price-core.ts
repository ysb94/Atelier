export type PriceRule = { kind: 'jsonld' | 'css' | 'shop'; adapter?: 'musinsa-v1' | 'zigzag-v1' | 'hago-v1' | 'hottracks-v1'; priceSelector?: string; nameSelector?: string; availabilitySelector?: string; priceAttribute?: string; basis?: string }
export type PriceResult = { status: 'ok' | 'sold_out' | 'ended' | 'blocked' | 'unknown' | 'failed'; price: number | null; basis: string; message: string; evidence: string; page_name: string }
export function unknown(message: string, status: PriceResult['status'] = 'unknown'): PriceResult {
  return { status, price: null, basis: '', message, evidence: '', page_name: '' }
}
export function money(value: unknown): number | null {
  const text = String(value ?? '').trim().replace(/[,₩\s]/g, '').replace(/원$/, '')
  if (!/^\d+(?:\.0+)?$/.test(text)) return null
  const n = Number(text)
  return Number.isSafeInteger(n) && n > 0 && n <= 100_000_000 ? n : null
}
export function sameProduct(expected: string, actual: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(w => !!w && !['masmarulez','마스마룰즈'].includes(w))
  const a = new Set(words(expected)), b = new Set(words(actual))
  if (!a.size || !b.size) return false
  const common = [...a].filter(w => b.has(w)).length
  // Both sides having different tokens can mean a different colour/size, even with a similar name.
  return common === Math.min(a.size,b.size) && common / Math.max(a.size, b.size) >= 0.75
}
export function jsonLdPrice(documents: unknown[], expected: string): PriceResult {
  const products: Record<string, unknown>[] = []
  const visit = (value: unknown, depth = 0) => {
    if (depth > 12 || value == null || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(v => visit(v, depth + 1)); return }
    const row = value as Record<string, unknown>
    const types = Array.isArray(row['@type']) ? row['@type'] : [row['@type']]
    if (types.includes('Product')) products.push(row)
    if (row['@graph']) visit(row['@graph'], depth + 1)
    if (row.mainEntity) visit(row.mainEntity, depth + 1)
  }
  documents.forEach(v => visit(v))
  const matching = products.filter(p => sameProduct(expected, String(p.name ?? '')))
  if (matching.length !== 1) return unknown('상품 식별 또는 단일 상품 데이터 확인 필요')
  const p = matching[0], name = String(p.name), raw = Array.isArray(p.offers) ? p.offers : [p.offers]
  const offers = raw.filter(v => v && typeof v === 'object') as Record<string, unknown>[]
  if (!offers.length || offers.some(o => o['@type'] === 'AggregateOffer')) return unknown('옵션별 가격 또는 판매 상태 확인 필요')
  const available = offers.filter(o => /(?:^|\/)InStock$/.test(String(o.availability)))
  if (!available.length) {
    const statuses = offers.map(o => String(o.availability))
    if (statuses.every(s => /(?:OutOfStock|SoldOut)$/.test(s))) return { ...unknown('품절 상품 · 최저가 비교 제외', 'sold_out'), page_name: name }
    if (statuses.every(s => /Discontinued$/.test(s))) return { ...unknown('판매 종료 상품 · 최저가 비교 제외', 'ended'), page_name: name }
    return unknown('판매 중이라는 근거를 확인하지 못했습니다.')
  }
  if (available.some(o => o.priceCurrency !== 'KRW')) return unknown('원화 가격 확인 필요')
  const prices = available.map(o => money(o.price))
  if (prices.some(n => n == null) || new Set(prices).size !== 1) return unknown('옵션별 가격 차이 또는 가격 형식 확인 필요')
  return { status: 'ok', price: prices[0], basis: '공개 상품 데이터 판매가 · 쿠폰/옵션 미검증', message: '페이지 가격 · 동일 옵션 여부 확인 필요', evidence: `Product / Offer / InStock / KRW ${prices[0]}`, page_name: name }
}
// Known retail hosts only: user-supplied DB URLs and redirects never reach arbitrary networks.
const HOSTS = ['musinsa.com','29cm.co.kr','kyobobook.co.kr','babosarang.co.kr','seoulstore.com','naver.com','masmarulez.com','masmarulez001.cafe24.com','gift.kakao.com','artbox.co.kr','a-bly.com','ohou.se','zigzag.kr','10x10.co.kr','gmarket.co.kr','gvg.co.kr','hago.kr','wconcept.co.kr','yes24.com','ssg.com','eqlstore.com','11st.co.kr','wemakeprice.com','kream.co.kr','lotteimall.com','hyundaihmall.com','tmon.co.kr']
export function safeShopUrl(raw: string): URL {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))
    || !HOSTS.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) throw new Error('아직 수집을 허용하지 않은 쇼핑몰 도메인입니다.')
  return url
}
export function shopDomain(url: URL): string {
  return HOSTS.find(h => url.hostname === h || url.hostname.endsWith(`.${h}`)) ?? ''
}
