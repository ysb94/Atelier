/**
 * PostgREST 1000행 상한을 넘는 목록을 첫 페이지+총건수 확인 후
 * 제한된 동시성으로 이어 읽는다. 한 페이지면 추가 요청을 하지 않는다.
 */

export const DEFAULT_PAGE_SIZE = 1000
export const DEFAULT_PAGE_CONCURRENCY = 4

export type PagedSelectPage<T> = {
  rows: T[]
  count: number | null
}

export async function fetchAllPages<T>(options: {
  fetchPage: (
    from: number,
    to: number,
    withCount: boolean,
  ) => Promise<PagedSelectPage<T>>
  pageSize?: number
  concurrency?: number
}): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_PAGE_CONCURRENCY)
  const first = await options.fetchPage(0, pageSize - 1, true)
  const all = [...first.rows]
  if (first.rows.length < pageSize) return all

  const total =
    typeof first.count === 'number' && first.count > 0
      ? first.count
      : null
  if (total !== null && all.length >= total) return all

  const remainingStarts: number[] = []
  if (total !== null) {
    for (let from = pageSize; from < total; from += pageSize) {
      remainingStarts.push(from)
    }
  } else {
    remainingStarts.push(pageSize)
  }

  if (remainingStarts.length === 0) return all

  if (total !== null) {
    let cursor = 0
    async function worker() {
      while (cursor < remainingStarts.length) {
        const index = cursor
        cursor += 1
        const from = remainingStarts[index]!
        const page = await options.fetchPage(from, from + pageSize - 1, false)
        all.push(...page.rows)
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, remainingStarts.length) },
        () => worker(),
      ),
    )
    return all
  }

  for (let from = pageSize; ; from += pageSize) {
    const page = await options.fetchPage(from, from + pageSize - 1, false)
    all.push(...page.rows)
    if (page.rows.length < pageSize) break
  }
  return all
}
