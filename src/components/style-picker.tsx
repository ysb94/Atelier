import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { parseStyleName } from '@/lib/invoice/style-name-parts'
import { searchStyleRefs } from '@/lib/api'
import type { StyleRef } from '@/lib/types'
import { cn } from '@/lib/utils'

export function formatStyleRef(ref: StyleRef): string {
  return `${ref.styleNo} · ${ref.name}`
}

/** 채워진 선택값: 제품군은 흐리게, 색상(+사이즈)만 진하게 구분해 훑어보기 쉽게 한다. */
function SelectedStyleLabel({ value }: { value: StyleRef }) {
  const parts = parseStyleName(value.name)
  const colorLabel = parts
    ? [parts.colorRaw, parts.size].filter(Boolean).join(' ')
    : null

  return (
    <>
      <span className="shrink-0 font-semibold tabular-nums text-foreground">
        {value.styleNo}
      </span>
      <span className="mx-1 shrink-0 text-muted-foreground/70">·</span>
      {parts && colorLabel ? (
        <span className="min-w-0 truncate">
          {parts.familyRaw ? (
            <span className="text-muted-foreground">{parts.familyRaw} </span>
          ) : null}
          <span className="font-semibold text-foreground">{colorLabel}</span>
        </span>
      ) : (
        <span className="truncate text-muted-foreground">{value.name}</span>
      )}
    </>
  )
}

function SuggestionList({
  loading,
  suggestions,
  emptyLabel,
  onPick,
}: {
  loading: boolean
  suggestions: StyleRef[]
  emptyLabel: string
  onPick: (ref: StyleRef) => void
}) {
  return (
    <div className="absolute left-0 top-full z-30 mt-1 max-h-56 w-80 max-w-full overflow-auto rounded-md border border-border bg-card shadow-sm">
      {loading ? (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">검색 중...</p>
      ) : suggestions.length === 0 ? (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">{emptyLabel}</p>
      ) : (
        suggestions.map((ref) => (
          <button
            key={ref.styleId}
            type="button"
            className="flex w-full items-baseline gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-muted/60"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(ref)}
          >
            <span className="shrink-0 font-medium tabular-nums">{ref.styleNo}</span>
            <span className="min-w-0 break-words text-muted-foreground">
              {ref.name}
            </span>
          </button>
        ))
      )}
    </div>
  )
}

function SuggestionChecklist({
  loading,
  suggestions,
  selectedIds,
  emptyLabel,
  onToggle,
}: {
  loading: boolean
  suggestions: StyleRef[]
  selectedIds: Set<string>
  emptyLabel: string
  onToggle: (ref: StyleRef) => void
}) {
  return (
    <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-80 max-w-full overflow-auto rounded-md border border-border bg-card shadow-sm">
      {loading ? (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">검색 중...</p>
      ) : suggestions.length === 0 ? (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">{emptyLabel}</p>
      ) : (
        suggestions.map((ref) => {
          const checked = selectedIds.has(ref.styleId)
          return (
            <label
              key={ref.styleId}
              className="flex cursor-pointer items-baseline gap-2 px-2 py-1.5 text-left hover:bg-muted/60"
              onMouseDown={(event) => event.preventDefault()}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-3.5 shrink-0 accent-primary"
                checked={checked}
                onChange={() => onToggle(ref)}
              />
              <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
                <span className="shrink-0 font-medium tabular-nums">{ref.styleNo}</span>
                <span className="min-w-0 break-words text-muted-foreground">
                  {ref.name}
                </span>
              </span>
            </label>
          )
        })
      )}
    </div>
  )
}

/** 데이터 시트 상품 1개 선택. 연결은 styleId, 표시는 M번호·이름. */
export function StylePicker({
  brandId,
  value,
  onChange,
  placeholder = 'M번호 또는 상품명 검색',
  className,
  inputClassName,
  disabled = false,
}: {
  brandId: string
  value: StyleRef | null
  onChange: (next: StyleRef | null) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [query])

  const suggestionsQuery = useQuery({
    queryKey: ['style-picker-refs', brandId, debounced],
    queryFn: () => searchStyleRefs(brandId, debounced, 8),
    enabled: open && debounced.length > 0 && !disabled,
    staleTime: 30_000,
  })

  const suggestions = suggestionsQuery.data ?? []

  if (value) {
    return (
      <div className={cn('flex min-w-0 items-center gap-1', className)}>
        <span
          className={cn(
            'inline-flex min-w-0 flex-1 items-center rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-xs',
            inputClassName,
          )}
          title={formatStyleRef(value)}
        >
          <SelectedStyleLabel value={value} />
        </span>
        {!disabled ? (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onChange(null)}
            aria-label="선택 해제"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <Input
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            const first = suggestions[0]
            if (first) {
              onChange(first)
              setQuery('')
              setDebounced('')
            }
          }
        }}
        className={cn('h-8', inputClassName)}
        placeholder={placeholder}
      />
      {open && debounced ? (
        <SuggestionList
          loading={suggestionsQuery.isFetching}
          suggestions={suggestions}
          emptyLabel="데이터 시트에 먼저 등록하세요"
          onPick={(ref) => {
            onChange(ref)
            setQuery('')
            setDebounced('')
            setOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

/** 데이터 시트 상품 여러 개 선택. 검색 결과에서 여러 개를 체크할 수 있다. */
export function StyleMultiPicker({
  brandId,
  selected,
  onChange,
  placeholder = 'M번호 또는 상품명 검색',
  className,
}: {
  brandId: string
  selected: StyleRef[]
  onChange: (next: StyleRef[]) => void
  placeholder?: string
  className?: string
}) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [query])

  const selectedIds = useMemo(
    () => new Set(selected.map((ref) => ref.styleId)),
    [selected],
  )

  const suggestionsQuery = useQuery({
    queryKey: ['style-multi-picker-refs', brandId, debounced],
    queryFn: () => searchStyleRefs(brandId, debounced, 24),
    enabled: open && debounced.length > 0,
    staleTime: 30_000,
  })

  const suggestions = suggestionsQuery.data ?? []

  function toggleRef(ref: StyleRef) {
    if (selectedIds.has(ref.styleId)) {
      onChange(selected.filter((item) => item.styleId !== ref.styleId))
      return
    }
    onChange([...selected, ref])
  }

  function removeRef(styleId: string) {
    onChange(selected.filter((ref) => ref.styleId !== styleId))
  }

  return (
    <div className={cn('min-w-56 space-y-1.5', className)}>
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selected.map((ref) => {
            const parts = parseStyleName(ref.name)
            const colorLabel = parts
              ? [parts.colorRaw, parts.size].filter(Boolean).join(' ')
              : null
            return (
              <span
                key={ref.styleId}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[11px]"
                title={formatStyleRef(ref)}
              >
                <span className="shrink-0 font-semibold tabular-nums">{ref.styleNo}</span>
                {parts && colorLabel ? (
                  <span className="min-w-0 truncate">
                    {parts.familyRaw ? (
                      <span className="text-muted-foreground">{parts.familyRaw} </span>
                    ) : null}
                    <span className="font-semibold text-foreground">{colorLabel}</span>
                  </span>
                ) : (
                  <span className="truncate text-muted-foreground">{ref.name}</span>
                )}
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => removeRef(ref.styleId)}
                  aria-label={`${ref.styleNo} 제거`}
                >
                  <X className="size-3" />
                </button>
              </span>
            )
          })}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">아직 고른 제품 없음</p>
      )}
      <div className="relative">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const first = suggestions[0]
              if (first) toggleRef(first)
            }
          }}
          className="h-8"
          placeholder={placeholder}
        />
        {open && debounced ? (
          <SuggestionChecklist
            loading={suggestionsQuery.isFetching}
            suggestions={suggestions}
            selectedIds={selectedIds}
            emptyLabel="데이터 시트에 먼저 등록하세요"
            onToggle={toggleRef}
          />
        ) : null}
      </div>
    </div>
  )
}
