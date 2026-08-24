import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatStyleRef } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { searchInvoiceProductNameMapsByLookupKey } from '@/lib/api'
import { formatNumber } from '@/lib/utils'

/** 앞쪽 [태그]는 행사 표기라 검색어에서 뺀다. */
function lookupTextFromCopied(value: string) {
  return value.replace(/^\s*(?:\[[^\]]+\]\s*)+/g, '').trim()
}

/**
 * 본품 확인 목록 위에 떠 있는 검색 창. 표 너비는 가로를 다 쓴다.
 * 품목명을 복사하면 그 글자를 조회 키 원장에서 찾고, 연결된 공식명·M번호를 보여준다.
 * 원장에는 쓰지 않는다.
 */
export function InvoiceProductLookupDock({ brandId }: { brandId: string }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [source, setSource] = useState<'typed' | 'copied' | 'pasted'>('typed')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    function onCopy() {
      const selected = window.getSelection()?.toString().trim() ?? ''
      if (selected.length < 2 || selected.length > 240) return
      const next = lookupTextFromCopied(selected) || selected
      setQuery(next)
      setSource('copied')
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [])

  const resultsQuery = useQuery({
    queryKey: ['invoice-product-lookup', brandId, debounced],
    queryFn: () =>
      searchInvoiceProductNameMapsByLookupKey(brandId, debounced, 20),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  })
  const results = resultsQuery.data ?? []
  const error =
    resultsQuery.error instanceof Error ? resultsQuery.error.message : null

  async function pasteFromClipboard() {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text) return
      const next = lookupTextFromCopied(text) || text
      setQuery(next.slice(0, 240))
      setSource('pasted')
    } catch {
      setSource('typed')
    }
  }

  return (
    <aside className="fixed right-4 top-24 z-40 w-80 max-w-[calc(100vw-2rem)]">
      <div className="max-h-[calc(100vh-7rem)] overflow-auto rounded-lg border border-border bg-card p-3 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">비슷한 상품 찾기</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              복사한 글자를 품목명 원장 조회 키에서 찾고, 연결된 공식명·M번호를
              보여줍니다.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? '열기' : '접기'}
          </Button>
        </div>

        {collapsed ? null : (
          <div className="mt-3 space-y-2">
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSource('typed')
              }}
              placeholder="조회 키"
              className="w-full"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void pasteFromClipboard()}>
                붙여넣기
              </Button>
              {query ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setQuery('')
                    setSource('typed')
                  }}
                >
                  지우기
                </Button>
              ) : null}
            </div>

            {source === 'copied' && query ? (
              <p className="text-[11px] text-muted-foreground">
                방금 복사한 글자로 검색합니다.
              </p>
            ) : null}

            {debounced.length < 2 ? (
              <p className="text-[11px] text-muted-foreground">
                두 글자 이상 넣으면 결과를 보여줍니다.
              </p>
            ) : resultsQuery.isFetching ? (
              <p className="text-[11px] text-muted-foreground">검색 중...</p>
            ) : error ? (
              <p className="text-[11px] text-danger">{error}</p>
            ) : results.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                비슷한 상품을 찾지 못했습니다.
              </p>
            ) : (
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">
                  {formatNumber(results.length)}개
                </p>
                <ul className="max-h-80 space-y-0.5 overflow-auto">
                  {results.map((hit) => (
                    <li key={hit.mapId}>
                      <p
                        className="rounded px-1 py-1 text-xs"
                        title={`${formatStyleRef(hit.style)} · ${hit.lookupKey}`}
                      >
                        <span className="font-medium">{hit.style.styleNo}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {hit.style.name}
                        </span>
                      </p>
                      {hit.lookupKey ? (
                        <p
                          className="truncate px-1 text-[11px] text-muted-foreground"
                          title={hit.lookupKey}
                        >
                          조회 키 · {hit.lookupKey}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
