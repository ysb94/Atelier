import assert from 'node:assert/strict'
import {sameSearchProduct,validateWebSearch,webSearchRequest,webSearchUsage} from '../supabase/functions/_shared/md-price-web-search.ts'
import {priceSearchEvidence} from '../src/lib/products/md-price-search-evidence.ts'
const url='https://smartstore.naver.com/masmarulez/products/13243466853'
const analysis={price:58000,currency:'KRW',sourceUrl:url,evidenceType:'search_snippet',pageName:'표기가 다른 상품명',priceQuote:'판매가 58,000원',conditions:'',availability:'unknown',message:''}
const payload=(patch={},sources=[{url,title:'상품 상세'}])=>({status:'completed',usage:{input_tokens:321,output_tokens:123},output:[
 {type:'web_search_call',status:'completed',action:{type:'search',sources}},
 {type:'message',content:[{type:'output_text',text:JSON.stringify({...analysis,...patch}),annotations:[]}]},
]})
const read=(p)=>priceSearchEvidence({rule_state:'web-search-v1',evidence:validateWebSearch(p,url).evidence})
assert.equal(sameSearchProduct(url,url+'?utm_source=naver'),true)
assert.equal(sameSearchProduct(url,url.replace('smartstore.','m.smartstore.')),true)
for(const other of [url.replace('masmarulez','anotherstore'),url.replace('13243466853','13243466854'),url.replace('smartstore.naver.com','evil.naver.com'),'https://www.musinsa.com/products/13243466853','javascript:alert(1)']) assert.equal(sameSearchProduct(url,other),false,other)
assert.equal(sameSearchProduct('https://www.ssg.com/item/itemView.ssg?itemId=123','https://m.ssg.com/item/itemView.ssg?itemId=123'),true)
assert.equal(sameSearchProduct('https://www.ssg.com/item/itemView.ssg?itemId=123','https://www.ssg.com/item/itemView.ssg?itemId=999'),false)
assert.equal(sameSearchProduct('http://store.musinsa.com/app/product/detail/123/0','https://www.musinsa.com/products/123'),true)
assert.equal(sameSearchProduct('http://store.musinsa.com/app/product/detail/123/0','https://global.musinsa.com/tw/products/123'),false)
assert.equal(read(payload()).candidatePrice,58000)
assert.equal(read(payload()).sources[0].url,url)
assert.equal(read(payload({evidenceType:'product_page'})).candidatePrice,58000)
for(const patch of [{price:57000},{currency:'USD'},{availability:'sold_out'},{availability:'ended'},{evidenceType:'none'},{priceQuote:'정상 가격은 알 수 없음'},{conditions:'신규 가입 첫구매 할인'},{priceQuote:'카드 결제 58,000원'},{sourceUrl:url.replace('masmarulez','anotherstore')}]) assert.equal(read(payload(patch)).candidatePrice,null,JSON.stringify(patch))
// Matching JSON URLs cannot invent a tool source. A completed attempted open alone
// also cannot establish the source of the model's quote.
assert.equal(read(payload({},[])).candidatePrice,null)
const openOnly=payload({},[]);openOnly.output[0].action={type:'open_page',url}
assert.equal(read(openOnly).candidatePrice,null)
const cited=payload({},[]);cited.output[1].content[0].annotations=[{type:'url_citation',url,title:'가격 출처'}]
assert.equal(read(cited).candidatePrice,58000)
const noTool=payload();noTool.output.shift()
assert.equal(validateWebSearch(noTool,url).price,null)
assert.equal(validateWebSearch({...payload(),status:'incomplete'},url).price,null)
// Every search outcome stays out of confirmed-price comparisons and last_success.
for(const p of [payload(),payload({evidenceType:'product_page'}),payload({},[])]){
 const result=validateWebSearch(p,url);assert.equal(result.price,null);assert.equal(result.status,'unknown')
}
const request=webSearchRequest('gpt-5.6-luna',url,'이름은 검색 힌트')
assert.equal(request.max_tool_calls,3);assert.equal(request.store,false);assert.equal(request.tool_choice,'required')
assert.deepEqual(request.tools[0].filters.allowed_domains,['smartstore.naver.com'])
assert.deepEqual(webSearchUsage(payload()),{inputTokens:321,outputTokens:123,webSearchCalls:1,webToolCalls:1})
const stored=JSON.parse(validateWebSearch(payload(),url).evidence)
stored.sources.push({url:'javascript:alert(1)',title:'unsafe'})
assert.equal(priceSearchEvidence({rule_state:'web-search-v1',evidence:JSON.stringify(stored)}).sources.length,1)
assert.equal(priceSearchEvidence({rule_state:'browser-text-v1',evidence:JSON.stringify(stored)}),null)
console.log('PASS: web search product/store identity, real source metadata, price references, no false confirmation, bounded requests and safe UI citations')
