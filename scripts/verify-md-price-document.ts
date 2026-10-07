import { priceDocument } from '../supabase/functions/_shared/md-price-document.ts'

function assert(condition:boolean,message:string) {if (!condition) throw new Error(message)}
const doc = priceDocument(`<html><head><script type="application/ld+json">{"@type":"Product","name":"Bag Black","offers":{"price":20000}}</script></head><body><nav>추천 상품 1,000원</nav><main><section><header><h1>Bag Black</h1></header><p>판매가 22,000원</p><button>구매하기</button><div class="wrap soldout displaynone"><button>품절</button></div><button hidden>판매 종료</button><div aria-hidden="true">품절</div><p style="display: none">품절</p><div class="recommended"><h1>Bag White</h1><p>1,000원</p></div></section></main><footer>상담센터 100원</footer></body></html>`)
assert(doc.visibleText.includes('Bag Black'),'Product header was removed')
assert(doc.visibleText.includes('22,000원') && doc.visibleText.includes('구매하기'),'Price/purchase text missing')
assert(!/품절|판매 종료|1,000원|상담센터|20000|Bag White/.test(doc.visibleText),'Hidden, metadata, or unrelated prices leaked into body')
assert(doc.metadata.includes('20000'),'Supplementary metadata should remain separately labelled')
const jsOnly = priceDocument('<html><body><script type="application/ld+json">{"@type":"Product","name":"Bag","offers":{"price":20000}}</script><div id="root"></div></body></html>')
assert(!jsOnly.visibleText,'Metadata-only pages must not become visible prices')
assert(priceDocument('<html><title>Access denied</title><body>blocked</body></html>').blocked,'Access denial not recognized')
console.log('PASS: product headers, hidden sold-out controls, recommendations, JSON-LD separation and JS-only pages')
if (Deno.args.includes('--live')) {
  const response=await fetch('http://masmarulez001.cafe24.com/product/detail.html?product_no=3409',{signal:AbortSignal.timeout(15000)})
  console.log(JSON.stringify({status:response.status,...priceDocument(await response.text())}))
}
