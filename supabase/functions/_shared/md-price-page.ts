import { safeShopUrl, shopDomain } from './md-price-core.ts'
export async function page(raw: string) {
  let url = safeShopUrl(raw)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000)
  try {
    for (let redirects = 0; redirects < 5; redirects++) {
      const response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'AtelierPriceCheck/1.0', Accept: 'text/html' } })
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel()
        if (!location) throw new Error('이동 주소가 없습니다.')
        const next = safeShopUrl(new URL(location, url).href)
        // A redirect to a different shop cannot silently establish product identity.
        if (shopDomain(next) !== shopDomain(url)) throw new Error('도메인 이동 · 상품 URL 점검 필요')
        url = next; continue
      }
      if (!response.ok) { await response.body?.cancel(); return { html: '', status: response.status, domain: url.hostname, url } }
      if (!/text\/html/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw new Error('HTML 상품 페이지가 아닙니다.') }
      const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let size = 0
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('페이지 용량 제한 초과') }; chunks.push(value) } } finally { reader.releaseLock() }
      const bytes = new Uint8Array(size); let offset = 0; chunks.forEach(c => { bytes.set(c, offset); offset += c.length })
      const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1] ?? /charset\s*=\s*["']?([\w-]+)/i.exec(new TextDecoder().decode(bytes.slice(0,4096)))?.[1] ?? 'utf-8'
      return { html: new TextDecoder(charset).decode(bytes), status: response.status, domain: url.hostname, url }
    }
    throw new Error('페이지 이동 횟수 초과')
  } finally { clearTimeout(timer) }
}
