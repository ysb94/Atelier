/** Share only overlapping identical reads; never retain a completed result. */
export function createCoalescedReadFetch(base: string, fetcher: typeof fetch): typeof fetch {
  const origin = new URL(base).origin
  type Result = { bytes: ArrayBuffer; status: number; statusText: string; headers: Headers; url: string; redirected: boolean; type: ResponseType }
  const pending = new Map<string, Promise<Result>>()
  return async (input, init) => {
    // Explicit cancellation belongs to its caller, not a shared transport.
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input))
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    if (url.origin !== origin) return fetcher(input, init)
    const read = (method === 'HEAD' && url.pathname === '/rest/v1/styles') ||
      (method === 'GET' && url.pathname === '/rest/v1/warehouse_stock_positions') ||
      (method === 'POST' && url.pathname === '/rest/v1/rpc/list_my_home_work_notifications' &&
        (init?.body == null || init.body === '{}')) ||
      (method === 'POST' && url.pathname === '/rest/v1/rpc/count_brand_styles' && typeof init?.body === 'string')
    if (!read) {
      // A save/read-mark must not join an older read still in flight.
      if (method !== 'GET' && method !== 'HEAD') pending.clear()
      return fetcher(input, init)
    }
    if (request || init?.signal) return fetcher(input, init)
    // Includes the actual authorization token and all response-affecting headers.
    // This key is memory-only and is never logged or persisted.
    const requestHeaders = new Headers(init?.headers)
    // Local workflow trace IDs are observational, not an authorization boundary.
    // Keep the first caller's real trace on the wire; omit only its variable ID
    // from the sharing key so the diagnostic wrapper cannot defeat coalescing.
    if (/^atelier diagnostic\/flow-[a-z0-9-]+\//.test(requestHeaders.get('x-client-info') ?? '')) {
      requestHeaders.set('x-client-info', 'atelier diagnostic/shared-read')
    }
    const headers = [...requestHeaders.entries()].sort(([a], [b]) => a.localeCompare(b))
    const key = JSON.stringify([method, url.href, headers, init?.body ?? '', init?.credentials])
    let task = pending.get(key)
    if (!task) {
      task = (async () => {
        const response = await fetcher(input, init)
        return { bytes: await response.arrayBuffer(), status: response.status,
          statusText: response.statusText, headers: response.headers,
          url: response.url, redirected: response.redirected, type: response.type }
      })()
      pending.set(key, task)
    }
    try {
      const result = await task
      const response = new Response(method === 'HEAD' || [204, 205, 304].includes(result.status) ? null : result.bytes.slice(0), result)
      Object.defineProperties(response, { url: { value: result.url }, redirected: { value: result.redirected }, type: { value: result.type } })
      return response
    } finally {
      if (pending.get(key) === task) pending.delete(key)
    }
  }
}
