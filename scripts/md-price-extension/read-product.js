// Self-contained: Chrome serializes this function into the active tab's isolated world.
// This prototype collects evidence only. It never chooses or writes a price.
export function readSmartstoreProduct() {
  const started = performance.now()
  const url = new URL(location.href)
  if (url.origin !== 'https://smartstore.naver.com' || !/^\/masmarulez\/products\/\d+\/?$/.test(url.pathname)) {
    return {error:'마스마룰즈 스마트스토어 상품 상세페이지에서 눌러 주세요.'}
  }
  const visible = element => element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})
  const excluded = 'script,style,noscript,iframe,svg,nav,header,footer,aside,input,textarea,select,[hidden],[aria-hidden="true"],[class*="review" i],[class*="recommend" i]'
  const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')
  const metadataName = document.querySelector('meta[property="og:title"]')?.content || document.title
  const titles = [metadataName, document.title].map(text=>normalize(text.split(/\s[:|]\s/)[0])).filter(Boolean)
  const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(element=>{
    if (!visible(element) || element.closest(excluded)) return false
    const text = normalize(element.innerText || '')
    return text.length >= 6 && titles.some(title=>title === text || title.startsWith(text) || text.startsWith(title))
  })
  const distinctNames = [...new Set(headings.map(element=>normalize(element.innerText || '')))]
  if (distinctNames.length !== 1) return {error:'본상품 제목 영역을 하나로 확인하지 못했습니다. 이 페이지 구조를 먼저 확인해야 합니다.'}
  const read = element => {
    if (element.matches(excluded) || (getComputedStyle(element).display !== 'contents' && !visible(element))) return ''
    return [...element.childNodes].map(node=>node.nodeType === Node.TEXT_NODE ? node.textContent
      : node.nodeType === Node.ELEMENT_NODE ? '\n'+read(node)+'\n' : '').join('')
  }
  const purchasePattern = /구매|장바구니|품절|판매\s*(중지|종료)/
  const controlsIn = element => [...element.querySelectorAll('button,a,[role="button"]')]
    .filter(control=>visible(control) && !control.closest(excluded))
    .map(control=>({text:(control.innerText || control.getAttribute('aria-label') || '').trim(),disabled:control.disabled === true || control.getAttribute('aria-disabled') === 'true'}))
    .filter(control=>control.text.length < 100 && purchasePattern.test(control.text)).slice(0,30)
  let root = null
  for (const heading of headings) {
    let candidate = heading.parentElement
    for (let depth=0; candidate && candidate !== document.body && depth<8; depth++,candidate=candidate.parentElement) {
      const candidateText = read(candidate)
      if (candidateText.length > 22_000) break
      if (/(?:\d[\d,]*\s*원|₩\s*\d|품절|판매\s*(종료|중지))/.test(candidateText) && controlsIn(candidate).length) {
        root = candidate
        break
      }
    }
    if (root) break
  }
  if (!root) return {error:'제목·가격·구매 상태가 함께 있는 본상품 영역을 찾지 못했습니다. 전체 페이지를 대신 수집하지 않았습니다.'}
  const visibleText = read(root).replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n').trim()
  const navigation = performance.getEntriesByType('navigation')[0]
  return {
    version:1, url:url.origin+url.pathname, title:document.title.slice(0,1000),
    pageName:headings[0].innerText.trim().slice(0,300), visibleText, controls:controlsIn(root),
    httpStatus:Number.isInteger(navigation?.responseStatus) && navigation.responseStatus > 0 ? navigation.responseStatus : null,
    scope:'smartstore-heading-purchase-panel', readMs:Math.round(performance.now()-started),
    collectedAt:new Date().toISOString(), transport:'ordinary-chrome-extension',
  }
}
