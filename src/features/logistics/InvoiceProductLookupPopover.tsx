import { useEffect, useRef, useState } from 'react'
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

function isLookupToggleKey(event: KeyboardEvent) {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.code === 'Slash'
  )
}

/**
 * 검수표 툴바에서 여는 검색 창.
 * 품목명을 복사하면 그 글자를 조회 키 원장에서 찾고, 연결된 공식명·M번호를 보여준다.
 * 원장에는 쓰지 않는다.
 */
export function InvoiceProductLookupPopover({ brandId }: { brandId: string }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [source, setSource] = useState<'typed' | 'copied' | 'pasted'>('typed')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const openRef = useRef(open)
  openRef.current = open

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

  function rememberFocus() {
    const active = document.activeElement
    if (active instanceof HTMLElement && !rootRef.current?.contains(active)) {
      lastFocusRef.current = active
    }
  }

  function restoreFocus() {
    const previous = lastFocusRef.current
    lastFocusRef.current = null
    if (previous && document.contains(previous)) {
      previous.focus()
      return
    }
    inputRef.current?.blur()
  }

  function openPopover() {
    rememberFocus()
    setOpen(true)
  }

  function closePopover() {
    setOpen(false)
    restoreFocus()
  }

  function togglePopover() {
    if (openRef.current) closePopover()
    else openPopover()
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isLookupToggleKey(event)) {
        event.preventDefault()
        togglePopover()
        return
      }
      if (event.key === 'Escape' && openRef.current) {
        event.preventDefault()
        closePopover()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      closePopover()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(timer)
  }, [open])

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
  const badgeCount =
    debounced.length >= 2 && !resultsQuery.isFetching ? results.length : 0

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
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[11px]"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={togglePopover}
      >
        비슷한 상품 찾기
        {!open && badgeCount > 0 ? ` ${formatNumber(badgeCount)}` : ''}
      </Button>
      {open ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border border-border bg-card p-3 shadow-sm"
          role="dialog"
          aria-label="비슷한 상품 찾기"
        >
          <p className="text-[11px] text-muted-foreground">
            복사한 글자를 품목명 원장 조회 키에서 찾고, 연결된 공식명·M번호를
            보여줍니다.
          </p>
          <div className="mt-3 space-y-2">
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSource('typed')
              }}
              placeholder="조회 키"
              className="w-full"
              aria-label="조회 키"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void pasteFromClipboard()}
              >
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
        </div>
      ) : null}
    </div>
  )
}
