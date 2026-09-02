import { useEffect, useState } from 'react'

export const INVOICE_TABLE_PAGE_SIZE = 100

export function useInvoiceTablePage<T>(
  items: readonly T[],
  resetKey: string,
  pageSize = INVOICE_TABLE_PAGE_SIZE,
) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))

  useEffect(() => {
    setPage(1)
  }, [resetKey])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const safePage = Math.min(page, pageCount)
  const startIndex = (safePage - 1) * pageSize
  return {
    page: safePage,
    setPage,
    pageCount,
    pageSize,
    startIndex,
    pageItems: items.slice(startIndex, startIndex + pageSize),
  }
}
