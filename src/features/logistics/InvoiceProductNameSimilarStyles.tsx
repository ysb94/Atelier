import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchInvoiceProductCandidates } from '@/lib/api'
import { similarProductSearchText } from '@/lib/invoice/product-name-patterns'
import type { AiProductCandidate, StyleRef } from '@/lib/types'

async function searchSimilarStyles(
  brandId: string,
  source: string,
): Promise<AiProductCandidate[]> {
  const prefix = similarProductSearchText(source)
  if (prefix.length < 2) return []
  const first = await searchInvoiceProductCandidates(brandId, [prefix], 10)
  if (first.length > 0 || prefix === source.trim()) return first
  const fallback = source.trim()
  if (fallback.length < 2) return first
  return searchInvoiceProductCandidates(brandId, [fallback], 10)
}

export function InvoiceProductNameSimilarStyles({
  brandId,
  lookupKey,
  productName,
  disabled,
  onPick,
}: {
  brandId: string
  lookupKey: string
  productName: string
  disabled?: boolean
  onPick: (style: StyleRef) => void
}) {
  const [requested, setRequested] = useState(false)
  const source = (lookupKey || productName).trim()
  const resultsQuery = useQuery({
    queryKey: ['product-name-similar', brandId, source],
    queryFn: () => searchSimilarStyles(brandId, source),
    enabled: requested && source.length >= 2,
    staleTime: 30_000,
  })
  const results = (resultsQuery.data ?? []).slice(0, 3)
  const error =
    resultsQuery.error instanceof Error ? resultsQuery.error.message : null

  return (
    <div className="mt-1 space-y-0.5">
      <button
        type="button"
        className="text-[10px] text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled || source.length < 2}
        onClick={() => setRequested(true)}
      >
        비슷한 상품
      </button>
      {requested && resultsQuery.isFetching ? (
        <p className="text-[10px] text-muted-foreground">검색 중...</p>
      ) : null}
      {requested && error ? (
        <p className="text-[10px] text-danger">{error}</p>
      ) : null}
      {requested && !resultsQuery.isFetching && !error && results.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          비슷한 상품을 찾지 못했습니다.
        </p>
      ) : null}
      {results.map((item) => (
        <button
          key={item.styleId}
          type="button"
          className="block truncate text-left text-[10px] text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          onClick={() =>
            onPick({
              styleId: item.styleId,
              styleNo: item.styleNo,
              name: item.name,
            })
          }
        >
          {item.styleNo} · {item.name}
        </button>
      ))}
    </div>
  )
}
