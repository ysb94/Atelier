import { load } from 'npm:cheerio@1.0.0'
import { compactPriceText } from './md-price-text.ts'

export function priceDocument(html: string, context = {path:'/product-work/md',lastInput:'가격 최신화'}) {
  const $ = load(html)
  const title = $('title').text().trim()
  const productMetadata: unknown[] = []
  $('script[type="application/ld+json"]').each((_,e) => {
    try {
      const visit = (v: unknown, depth = 0) => {
        if (depth > 8 || !v || typeof v !== 'object' || productMetadata.length >= 3) return
        if (Array.isArray(v)) { v.forEach(item => visit(item,depth+1)); return }
        const row = v as Record<string,unknown>
        if ([row['@type']].flat().includes('Product')) productMetadata.push({name:row.name,sku:row.sku,offers:row.offers})
        if (row['@graph']) visit(row['@graph'],depth+1)
        if (row.mainEntity) visit(row.mainEntity,depth+1)
      }
      visit(JSON.parse($(e).text()))
    } catch (error) { console.warn('[md-price] 참고 상품 데이터 해석 실패',{name:error instanceof Error ? error.name : 'unknown',...context}) }
  })
  // Strip non-content and explicitly hidden nodes. Do not execute scripts or crawl more links.
  $('script,style,svg,iframe,noscript,nav,footer,body > header,[hidden],[aria-hidden="true"],.displaynone,input,textarea').remove()
  $('[style]').each((_,e) => { if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(e).attr('style') ?? '')) $(e).remove() })
  $('[class],[id]').each((_,e) => {
    if (/(?:^|[\s_-])(recommend(?:ation|ed)?|reviews?|related-products|recently-viewed)(?:$|[\s_-])/i.test(`${$(e).attr('class') ?? ''} ${$(e).attr('id') ?? ''}`)) $(e).remove()
  })
  $('br').replaceWith('\n')
  $('p,div,li,section,h1,h2,h3,dt,dd,tr,button,select,option').each((_,e) => { $(e).append('\n') })
  const main = $('main').length === 1 ? $('main') : $('body')
  const visibleText = compactPriceText(main.text())
  return {title,visibleText,metadata:JSON.stringify(productMetadata).slice(0,3000),blocked:/captcha|access denied|비정상적인 접근|접근이 제한/i.test(title)}
}
