/** 품목명·내품명 AI 검수표 공통 페이지 계산. */

export function clampInvoiceReviewPage(page: number, pageCount: number) {
  const count = Math.max(1, pageCount)
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(1, Math.trunc(page)), count)
}

export function paginateInvoiceReviewKeys(
  keys: string[],
  page: number,
  pageSize: number,
) {
  const size = Math.max(1, Math.trunc(pageSize) || 20)
  const pageCount = Math.max(1, Math.ceil(keys.length / size) || 1)
  const safePage = clampInvoiceReviewPage(page, pageCount)
  const start = (safePage - 1) * size
  return {
    page: safePage,
    pageCount,
    pageSize: size,
    keys: keys.slice(start, start + size),
  }
}
