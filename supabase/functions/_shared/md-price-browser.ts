import {safeShopUrl, shopDomain} from './md-price-core.ts'
import {compactPriceText} from './md-price-text.ts'

export const BROWSER_COLLECTOR='browser-text-v1'
// User-authenticated collector evidence is untrusted input, never a client-supplied price.
export function browserDocument(value:unknown,originalUrl:string) {
  if(!value||typeof value!=='object')throw new Error('브라우저 수집 본문 형식 오류')
  const v=value as Record<string,unknown>
  if(typeof v.url!=='string'||v.url.length>3000||typeof v.visibleText!=='string'||v.visibleText.length>22_000
    ||typeof v.title!=='string'||v.title.length>1000||!Number.isInteger(v.status)||Number(v.status)<0||Number(v.status)>599
    ||typeof v.blocked!=='boolean'||!Number.isFinite(v.crawlMs)||Number(v.crawlMs)<0||Number(v.crawlMs)>60_000)throw new Error('브라우저 수집 본문 범위 오류')
  const url=safeShopUrl(v.url), original=safeShopUrl(originalUrl)
  const family=(u:URL)=>['masmarulez.com','masmarulez001.cafe24.com'].includes(shopDomain(u))?'masmarulez':shopDomain(u)
  if(family(url)!==family(original))throw new Error('수집 페이지가 등록된 업체와 다릅니다.')
  const visibleText=compactPriceText(v.visibleText)
  const controls=Array.isArray(v.controls)?v.controls.slice(0,30).filter((c):c is {text:string;disabled:boolean}=>!!c&&typeof c==='object'&&typeof c.text==='string'&&c.text.length<100&&typeof c.disabled==='boolean'):[]
  return {url,status:Number(v.status),crawlMs:Number(v.crawlMs),document:{visibleText,metadata:[],blocked:v.blocked},controls}
}
