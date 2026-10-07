import { money, sameProduct, shopDomain, unknown, type PriceResult, type PriceRule } from './md-price-core.ts'

type Row = Record<string, unknown>
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const pageProps = (document: unknown) => row(row(row(document).props).pageProps)
const queries = (props: Row) => list(row(props.dehydratedState).queries).map(row)
const keyed = (props: Row, key: unknown[]) => queries(props).filter(q => JSON.stringify(q.queryKey) === JSON.stringify(key))
const queryData = (q: Row) => row(row(q.state).data)

export function shopProductId(url: URL): string | null {
  const domain = shopDomain(url)
  if (domain === 'masmarulez001.cafe24.com' || domain === 'masmarulez.com') return url.searchParams.get('product_no') ?? /\/product\/[^/]+\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] ?? null
  if (domain === 'ssg.com') return url.searchParams.get('itemId')
  const pattern = domain === 'musinsa.com' ? /^(?:\/products\/|\/app\/product\/detail\/)(\d+)(?:\/|$)/
    : domain === '29cm.co.kr' || domain === 'naver.com' ? /\/products\/(\d+)(?:\/|$)/
    : domain === 'gift.kakao.com' ? /^\/product\/(\d+)(?:\/|$)/
    : domain === 'zigzag.kr' ? /^\/(?:catalog\/__preview|app\/catalog\/products)\/(\d+)(?:\/|$)/
    : domain === 'hago.kr' ? /^\/goods\/detail\/(\d+)(?:\/|$)/ : null
  return pattern?.exec(url.pathname)?.[1] ?? null
}

export function knownShopRule(url: URL): PriceRule | null {
  const adapters: Record<string, PriceRule['adapter']> = { 'musinsa.com':'musinsa-v1', 'zigzag.kr':'zigzag-v1', 'hago.kr':'hago-v1', 'kyobobook.co.kr':'hottracks-v1' }
  const adapter = adapters[shopDomain(url)]
  return adapter ? { kind:'shop', adapter } : null
}

export function musinsaPrice(document: unknown, url: URL, expected: string): PriceResult {
  const id = shopProductId(url)
  const props = pageProps(document), matches = keyed(props,['Detail',Number(id)])
  if (!id || matches.length !== 1 || props.hasDetail !== true) return unknown('무신사 상품 데이터 구조 또는 상품 번호 확인 필요')
  const response = queryData(matches[0]), product = row(response.data), name = String(product.goodsNm ?? '')
  if (row(response.meta).result !== 'SUCCESS' || String(product.goodsNo) !== id || !sameProduct(expected,name)) return unknown('등록 상품과 무신사 상품 번호·상품명 확인 필요')
  if (product.isOutOfStock === true) return { ...unknown('무신사 상품 데이터: 품절 · 비교 제외','sold_out'), page_name:name }
  // isSale is a promotion flag, not the sale/purchase status. Explicit stock and sale type are required.
  if (product.goodsSaleType !== 'SALE' || product.isOutOfStock !== false) return unknown('무신사 판매 상태 확인 필요')
  if (row(props.shared).loggedIn !== false || props.isGlobalRequest !== false || ['isBuyForMember','isAppGoods','isOfflineGoods','isOnlyGlobalGoods'].some(k => product[k] !== false)) return unknown('회원·앱·해외 전용 조건 확인 필요')
  const optionQueries = keyed(props,['Options',Number(id)])
  const options = optionQueries.length === 1 ? row(queryData(optionQueries[0]).data) : {}
  const items = list(options.optionItems).map(row).filter(o => o.activated === true && o.isDeleted === false)
  if (product.hasOptionPrice !== false || !items.length || items.some(o => String(o.goodsNo) !== id || o.price !== 0)) return unknown('무신사 옵션별 가격 또는 구매 가능 옵션 확인 필요')
  const priceData = row(product.goodsPrice), price = money(priceData.salePrice)
  if (priceData.currency !== 'KRW' || price == null) return unknown('무신사 원화 판매가 확인 필요')
  return { status:'ok',price,basis:'무신사 비로그인 공개 판매가 · 회원/첫구매/쿠폰 혜택 제외',message:'동일 색상·사이즈 및 추가 쿠폰 조건은 미검증입니다.',evidence:`goodsNo=${id}; goodsSaleType=SALE; isOutOfStock=false; goodsPrice.salePrice=${price} KRW`,page_name:name }
}

export function zigzagPrice(document: unknown, url: URL, expected: string): PriceResult {
  const id = shopProductId(url)
  const props = pageProps(document), matches = keyed(props,['getPdpBaseInfo',id])
  if (!id || String(props.product_id) !== id || matches.length !== 1) return unknown('지그재그 상품 데이터 구조 또는 상품 번호 확인 필요')
  const product = row(queryData(matches[0]).product), name = String(product.name ?? '')
  if (String(product.id) !== id) return unknown('등록 URL과 지그재그 상품 번호가 다릅니다.')
  // An exact URL ID can establish that this listing is stopped, even if its title was renamed.
  if (product.is_purchasable === false && product.sales_status === 'SUSPENDED') return { ...unknown('지그재그 판매 중지 · 현재 구매 불가 · 비교 제외','ended'),evidence:`product.id=${id}; sales_status=SUSPENDED; is_purchasable=false`,page_name:name }
  if (!sameProduct(expected,name)) return unknown('등록 상품명과 지그재그 상품명 확인 필요')
  // Only the suspended state has been validated against real pages. Do not guess other enum meanings
  // or treat display_final_price (which can be a first-order coupon price) as unconditional.
  return unknown('지그재그 구매 가능 상태·쿠폰 적용 조건 추가 확인 필요')
}

export type HagoSnapshot = { id:string; name:string; priceText:string; purchaseText:string; disabled:boolean }
export function hagoPrice(snapshot: HagoSnapshot, url: URL, expected:string): PriceResult {
  const id = shopProductId(url)
  if (!id || snapshot.id !== id || !sameProduct(expected,snapshot.name)) return unknown('하고 상품 번호·상품명 확인 필요')
  if (snapshot.disabled && /구매\s*불가/.test(snapshot.purchaseText)) return { ...unknown('하고 구매 불가 · 미진열 또는 판매 중지 · 비교 제외','ended'),page_name:snapshot.name,evidence:`goods=${id}; disabled purchase button: ${snapshot.purchaseText}` }
  if (/품절/.test(snapshot.purchaseText)) return { ...unknown('하고 품절 · 비교 제외','sold_out'),page_name:snapshot.name }
  // A visible price/analytics stock count is not sufficient: the primary purchase button must agree.
  if (snapshot.disabled || !/구매|장바구니/.test(snapshot.purchaseText)) return unknown('하고 구매 가능 상태 확인 필요')
  const price = /원/.test(snapshot.priceText) ? money(snapshot.priceText) : null
  if (price == null) return unknown('하고 원화 판매가 확인 필요')
  return {status:'ok',price,basis:'하고 공개 페이지 판매가 · 추가 쿠폰/옵션 미검증',message:'동일 옵션 여부 확인 필요',evidence:`goods=${id}; ${snapshot.priceText}; ${snapshot.purchaseText}`,page_name:snapshot.name}
}
