type SearchEvidence = {
  candidatePrice:number|null
  evidenceType:'product_page'|'search_snippet'|'none'
  quote:string
  conditions:string
  sources:{url:string;title:string}[]
}
export function priceSearchEvidence(check?:{rule_state:string|null;evidence:string}):SearchEvidence|null {
  if (check?.rule_state !== 'web-search-v1' || !check.evidence) return null
  try {
    const value = JSON.parse(check.evidence)
    if (value?.kind !== 'web-search-v1' || value.version !== 1) return null
    return {
      candidatePrice:Number.isInteger(value.candidatePrice) && value.candidatePrice > 0 && value.candidatePrice <= 100_000_000 ? value.candidatePrice : null,
      evidenceType:['product_page','search_snippet'].includes(value.evidenceType) ? value.evidenceType : 'none',
      quote:typeof value.quote === 'string' ? value.quote : '',
      conditions:typeof value.conditions === 'string' ? value.conditions : '',
      sources:Array.isArray(value.sources) ? value.sources.filter((s:unknown):s is {url:string;title:string} => {
        if (!s || typeof s !== 'object' || !('url' in s) || typeof s.url !== 'string') return false
        try {const url = new URL(s.url);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password} catch {return false} // Reject malformed citation links.
      }).slice(0,4).map((s:{url:string;title?:unknown})=>({url:s.url,title:typeof s.title === 'string' ? s.title : '상품 출처'})) : [],
    }
  } catch (error) {
    console.warn('[md-price] 검색 근거 해석 실패',{name:error instanceof Error ? error.name : 'unknown'})
    return null
  }
}
