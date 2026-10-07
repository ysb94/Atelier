import assert from 'node:assert/strict'
import './verify-md-price-web-search.mjs'
import { readFileSync } from 'node:fs'
import { jsonLdPrice, money, sameProduct, safeShopUrl } from '../supabase/functions/_shared/md-price-core.ts'
import { musinsaPrice, zigzagPrice, hagoPrice, knownShopRule, shopProductId } from '../supabase/functions/_shared/md-price-shops.ts'
import { compactPriceText, validateTextPrice, PRICE_TEXT_LIMIT } from '../supabase/functions/_shared/md-price-text.ts'
import { runPriceQueue } from '../src/lib/products/md-price-queue.ts'
import {browserDocument} from '../supabase/functions/_shared/md-price-browser.ts'
const offer = { '@type':'Offer',price:'27,000',priceCurrency:'KRW',availability:'https://schema.org/InStock' }
const product = { '@type':'Product',name:'Solid string bag Baby pink',offers:offer }
assert.equal(jsonLdPrice([product],product.name).price,27000)
assert.equal(jsonLdPrice([{...product,offers:{...offer,availability:'https://schema.org/OutOfStock'}}],product.name).status,'sold_out')
assert.equal(jsonLdPrice([{...product,offers:{...offer,availability:'https://schema.org/Discontinued'}}],product.name).price,null)
assert.equal(jsonLdPrice([{...product,offers:{...offer,availability:undefined}}],product.name).status,'unknown')
assert.equal(jsonLdPrice([{...product,name:'Different product'}],product.name).price,null)
assert.equal(jsonLdPrice([product,{...product}],product.name).price,null)
assert.equal(jsonLdPrice([{...product,offers:{'@type':'AggregateOffer',lowPrice:1000,highPrice:27000}}],product.name).price,null)
assert.equal(jsonLdPrice([{...product,offers:[offer,{...offer,price:15000}]}],product.name).price,null)
assert.equal(jsonLdPrice([{...product,offers:{...offer,priceCurrency:'USD'}}],product.name).price,null)
assert.equal(money('30,000원 27,000원'),null)
assert.equal(money('0'),null)
assert.equal(sameProduct('Bag black','Bag white'),false)
assert.equal(sameProduct('Solid string bag Brown','Solid string bag Black'),false)
assert.throws(()=>safeShopUrl('http://127.0.0.1/'))
assert.throws(()=>safeShopUrl('https://musinsa.com.evil.example/'))
assert.throws(()=>safeShopUrl('https://user:password@musinsa.com/'))
console.log('PASS: price identity, sold-out/ended exclusion, option ambiguity, currency and network boundaries')

// Reduced public-page fixtures captured 2026-10-06. These contain only price/identity/availability
// fields; no executable scripts, user sessions, or merchant contact records are retained.
const musinsa = JSON.parse(readFileSync(new URL('./fixtures/md-price/musinsa.json',import.meta.url),'utf8'))
const musinsaUrl = new URL('https://www.musinsa.com/products/2850453')
const expected = 'Solid string bag _ Purple blue'
assert.equal(musinsaPrice(musinsa,musinsaUrl,expected).price,33000)
assert.equal(shopProductId(new URL('http://store.musinsa.com/app/product/detail/2850453/0')),shopProductId(musinsaUrl))
assert.equal(knownShopRule(musinsaUrl).adapter,'musinsa-v1')
assert.equal(knownShopRule(new URL('https://musinsa.com.evil.example/products/2850453')),null)
const changeMusinsa = edit => { const d=structuredClone(musinsa); edit(d.props.pageProps,d.props.pageProps.dehydratedState.queries[0].state.data.data); return d }
assert.equal(musinsaPrice(musinsa,new URL('https://www.musinsa.com/products/999'),expected).price,null)
assert.equal(musinsaPrice(musinsa,musinsaUrl,'Solid string bag Orange').price,null)
assert.equal(musinsaPrice(changeMusinsa((_,p)=>p.isOutOfStock=true),musinsaUrl,expected).status,'sold_out')
assert.equal(musinsaPrice(changeMusinsa((_,p)=>delete p.isOutOfStock),musinsaUrl,expected).price,null)
assert.equal(musinsaPrice(changeMusinsa((_,p)=>p.goodsSaleType='UNKNOWN'),musinsaUrl,expected).price,null)
assert.equal(musinsaPrice(changeMusinsa((p)=>p.shared.loggedIn=true),musinsaUrl,expected).price,null)
assert.equal(musinsaPrice(changeMusinsa((_,p)=>p.isBuyForMember=true),musinsaUrl,expected).price,null)
assert.equal(musinsaPrice(changeMusinsa((_,p)=>p.goodsPrice.currency='USD'),musinsaUrl,expected).price,null)
assert.equal(musinsaPrice(changeMusinsa((_,p)=>p.hasOptionPrice=true),musinsaUrl,expected).price,null)
assert.equal(musinsaPrice(changeMusinsa(p=>p.dehydratedState.queries[1].state.data.data.optionItems[0].price=1000),musinsaUrl,expected).price,null)
assert.equal(musinsaPrice(changeMusinsa((_,p)=>{p.goodsPrice.finalPrice=500;p.goodsPrice.couponPrice=500}),musinsaUrl,expected).price,33000)
assert.equal(musinsaPrice(changeMusinsa(p=>p.dehydratedState.queries.push(p.dehydratedState.queries[0])),musinsaUrl,expected).price,null)
const zigzag = JSON.parse(readFileSync(new URL('./fixtures/md-price/zigzag.json',import.meta.url),'utf8'))
const zigzagUrl = new URL('https://store.zigzag.kr/catalog/__preview/122381768')
assert.equal(zigzagPrice(zigzag,zigzagUrl,expected).status,'ended')
assert.equal(zigzagPrice(zigzag,zigzagUrl,expected).price,null) // 28,500 coupon price still exists on stopped listing.
assert.equal(zigzagPrice(zigzag,new URL('https://store.zigzag.kr/catalog/__preview/999'),expected).status,'unknown')
const z=structuredClone(zigzag);z.props.pageProps.dehydratedState.queries[0].state.data.product.is_purchasable=true
assert.equal(zigzagPrice(z,zigzagUrl,expected).price,null)
const hagoUrl=new URL('https://www.hago.kr/goods/detail/440280')
const hago={id:'440280',name:'Handle string bag_Solid Purple blue',priceText:'29,900원',purchaseText:'구매 불가',disabled:true}
assert.equal(hagoPrice(hago,hagoUrl,expected).status,'ended')
assert.equal(hagoPrice(hago,hagoUrl,expected).price,null)
assert.equal(hagoPrice({...hago,purchaseText:'구매하기',disabled:false},hagoUrl,expected).price,29900)
assert.equal(hagoPrice({...hago,purchaseText:'구매하기'},hagoUrl,expected).price,null)
assert.equal(hagoPrice({...hago,id:'999'},hagoUrl,expected).price,null)
console.log('PASS: public page JSON, exact shop product IDs, conditional/option price guards, stopped listings with retained prices')

const visible = 'Rabbit eco bag Deep brown\n판매가 35,500원\n상품 쿠폰 적용가 24,850원 (누구나 30% 상품 쿠폰)\n구매하기\n첫 구매 앱 전용 20,000원\n품절'
const analysis = {status:'ok',price:24850,currency:'KRW',pageName:'Rabbit eco bag Deep brown',basis:'public_coupon',conditions:'누구나 30% 상품 쿠폰',message:'',priceEvidence:'상품 쿠폰 적용가 24,850원 (누구나 30% 상품 쿠폰)',nameEvidence:'Rabbit eco bag Deep brown',availabilityEvidence:'구매하기'}
assert.equal(validateTextPrice(analysis,visible).price,24850)
assert.equal(validateTextPrice({...analysis,conditions:'누구나 사용할 수 있는 30% 상품 쿠폰 적용'},visible).status,'unknown')
assert.equal(validateTextPrice({...analysis,price:20000},visible).price,null)
assert.equal(validateTextPrice({...analysis,priceEvidence:'상품 쿠폰 적용가 20,000원',price:20000},visible).price,null)
assert.equal(validateTextPrice({...analysis,priceEvidence:'첫 구매 앱 전용 20,000원',price:20000},visible).price,null)
assert.equal(validateTextPrice({...analysis,currency:'USD'},visible).price,null)
assert.equal(validateTextPrice({...analysis,availabilityEvidence:'품절'},visible).price,null)
assert.equal(validateTextPrice({...analysis,availabilityEvidence:'타임특가 D-4'},visible+'\n타임특가 D-4').price,null)
assert.equal(validateTextPrice({...analysis,status:'sold_out',availabilityEvidence:'품절'},visible).status,'sold_out')
assert.equal(validateTextPrice({...analysis,status:'sold_out',availabilityEvidence:'구매하기'},visible).status,'unknown')
assert.equal(validateTextPrice({...analysis,pageName:'Invented product',nameEvidence:'Invented product'},visible).price,null)
assert.equal(validateTextPrice({...analysis,pageName:'',nameEvidence:''},visible).price,null)
assert.equal(validateTextPrice({...analysis,pageName:'  ',nameEvidence:analysis.nameEvidence},visible).price,null)
assert.equal(validateTextPrice(analysis,'metadata only: 24850').price,null)
assert.ok(compactPriceText('구매 20,000원\n'.repeat(10000)).length <= PRICE_TEXT_LIMIT)
assert.ok(compactPriceText(visible).includes('누구나 30% 상품 쿠폰'))
assert.equal(safeShopUrl('https://masmarulez001.cafe24.com/product/detail.html?product_no=1').hostname,'masmarulez001.cafe24.com')
assert.equal(safeShopUrl('https://gift.kakao.com/product/1').hostname,'gift.kakao.com')
assert.throws(()=>safeShopUrl('https://other.cafe24.com/product/1'))
assert.throws(()=>safeShopUrl('https://gift.kakao.com.evil.example/product/1'))

const active = new Set(), finished = []; let maxActive = 0
await runPriceQueue([{id:1,shop:'a'},{id:2,shop:'a'},{id:3,shop:'b'},{id:4,shop:'c'},{id:5,shop:'d'}],v=>v.shop,async v=>{
  assert.ok(!active.has(v.shop)); active.add(v.shop);maxActive=Math.max(maxActive,active.size)
  await new Promise(resolve=>setTimeout(resolve,5)); active.delete(v.shop);finished.push(v.id)
},()=>false)
assert.equal(maxActive,3)
assert.deepEqual(finished.sort(),[1,2,3,4,5])
let stop=false;const cancelled=[]
await runPriceQueue([1,2,3],()=> 'same',async item=>{cancelled.push(item);stop=true},()=>stop)
assert.deepEqual(cancelled,[1])
console.log('PASS: text evidence, coupon vs personal benefits, metadata-only rejection, exact allowed hosts, bounded parallel queue and cancellation')

const capture={url:'https://www.29cm.co.kr/products/123',visibleText:visible,title:'상품',status:200,blocked:false,crawlMs:1500,controls:[{text:'구매하기',disabled:false}]}
assert.equal(browserDocument(capture,capture.url).document.visibleText,compactPriceText(visible))
assert.throws(()=>browserDocument({...capture,url:'http://127.0.0.1'},capture.url))
assert.throws(()=>browserDocument({...capture,url:'https://www.musinsa.com/products/123'},capture.url))
assert.throws(()=>browserDocument({...capture,visibleText:'x'.repeat(22001)},capture.url))
assert.throws(()=>browserDocument({...capture,crawlMs:-1},capture.url))
assert.equal(browserDocument({...capture,url:'https://masmarulez.com/'},'http://masmarulez001.cafe24.com/product/detail.html?product_no=75').url.pathname,'/')
assert.equal(shopProductId(new URL('https://masmarulez.com/')),null) // A storefront redirect must remain unverified.
for(const [url,id] of [
  ['https://www.29cm.co.kr/products/3550649','3550649'],
  ['https://smartstore.naver.com/masmarulez/products/13243466853','13243466853'],
  ['https://masmarulez001.cafe24.com/product/detail.html?product_no=3409','3409'],
  ['https://www.ssg.com/item/itemView.ssg?itemId=1000803648008','1000803648008'],
  ['https://gift.kakao.com/product/13151844','13151844'],
])assert.equal(shopProductId(new URL(url)),id)
const sale={...analysis,basis:'sale',price:35500,priceEvidence:'판매가 35,500원',conditions:'일반 회원 구매 필요; 첫 구매 쿠폰 제외'}
assert.equal(validateTextPrice(sale,visible).price,35500)
assert.equal(validateTextPrice({...sale,conditions:'첫 구매 쿠폰 적용'},visible).price,null)
// Registered names no longer participate in price validation: the URL selects the main product.
for (const displayedName of ['[10/30 예약배송]_Rabbit eco bag Deep brown','래빗 에코백 딥브라운','미니 글로시 벨티드 플랩 백팩 (4컬러)']) {
  const displayedText=visible.replace(analysis.pageName,displayedName)
  const namedSale={...sale,pageName:displayedName,nameEvidence:displayedName}
  assert.equal(validateTextPrice(namedSale,displayedText).price,35500)
  assert.equal(validateTextPrice(namedSale,displayedText).page_name,displayedName)
  assert.equal(validateTextPrice({...namedSale,status:'sold_out',availabilityEvidence:'품절'},displayedText).status,'sold_out')
}
console.log('PASS: browser text limits, same-shop boundary, product redirect identities, URL-selected display names and benefit exclusions')
