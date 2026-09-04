import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchInvoiceProductCandidates } from '@/lib/api'
import { similarProductSearchText } from '@/lib/invoice/product-name-patterns'
import type { AiProductCandidate, StyleRef } from '@/lib/types'

const RESULT_LIMIT = 8
const DEBOUNCE_MS = 250

/**
 * 입력 중이면 그 글자로, 아직 비었으면 조회 키의 제품군 앞부분으로 찾는다.
 * 색상·사이즈만 다른 SKU를 한 번에 보여주려고 앞부분을 먼저 쓴다.
 */
function suggestSearchText(text: string, lookupKey: string, productName: string) {
  const typed = text.trim()
  if (typed.length >= 2) return typed
  return similarProductSearchText(lookupKey || productName)
}

async function searchStyles(
  brandId: string,
  text: string,
): Promise<AiProductCandidate[]> {
  const first = await searchInvoiceProductCandidates(brandId, [text], 20)
  if (first.length > 0) return first
  const narrowed = similarProductSearchText(text)
  if (narrowed === text || narrowed.length < 2) return first
  return searchInvoiceProductCandidates(brandId, [narrowed], 20)
}

/**
 * 본품 칸을 잡고 있는 동안만 뜨는 상품 검색 목록.
 * 행마다 미리 조회하면 한 페이지에서 요청이 수십 건 나가므로 포커스로 막는다.
 */
export function InvoiceProductNameStyleSuggest({
  brandId,
  text,
  lookupKey,
  productName,
  disabled,
  onPick,
}: {
  brandId: string
  text: string
  lookupKey: string
  productName: string
  disabled?: boolean
  onPick: (style: StyleRef) => void
}) {
  const target = suggestSearchText(text, lookupKey, productName)
  const [debounced, setDebounced] = useState(target)

  useEffect(() => {
    if (debounced === target) return
    const timer = setTimeout(() => setDebounced(target), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [debounced, target])

  const resultsQuery = useQuery({
    queryKey: ['product-name-style-suggest', brandId, debounced],
    queryFn: () => searchStyles(brandId, debounced),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  })
  const results = (resultsQuery.data ?? []).slice(0, RESULT_LIMIT)
  const error =
    resultsQuery.error instanceof Error ? resultsQuery.error.message : null

  if (debounced.length < 2) return null

  return (
    <div className="mt-1 space-y-0.5 rounded-md border border-border bg-muted/30 px-1.5 py-1">
      {resultsQuery.isFetching ? (
        <p className="text-[10px] text-muted-foreground">검색 중...</p>
      ) : null}
      {error ? <p className="text-[10px] text-danger">{error}</p> : null}
      {!resultsQuery.isFetching && !error && results.length === 0 ? (
        <p className="text-[10px] leading-4 text-muted-foreground">
          맞는 상품이 없습니다. M번호가 아직 없는 색상·사이즈면 상품을 등록한 뒤
          품목명 변환을 다시 돌리세요.
        </p>
      ) : null}
      {results.map((item) => (
        <button
          key={item.styleId}
          type="button"
          className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          title={`${item.styleNo} · ${item.name}`}
          onMouseDown={(event) => event.preventDefault()}
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
