import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image as ImageIcon, RefreshCw, Search, X } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { SingleBrandOrList } from '@/components/layout/SingleBrandOrList'
import {
  useWorkspaceTabActivity,
  WorkspaceTabOverlay,
} from '@/components/layout/workspace-tabs'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CompanyWarehouseList } from '@/features/workspace/company-operation-lists'
import {
  getActiveWarehouseInventorySet,
  listWarehouseFinderInbounds,
  searchWarehouseFinder,
  subscribeWarehouseInventorySetChanges,
} from '@/lib/api'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  LOGISTICS_IMAGE_KEY,
  PRODUCT_IMAGE_KEY,
  ruleImageUrls,
} from '@/lib/products/product-image'
import { cn, emptyList, formatNumber } from '@/lib/utils'
import {
  WAREHOUSE_FINDER_SEARCH_MODE_LABEL,
  WAREHOUSE_FINDER_SEARCH_MODES,
  WAREHOUSE_FINDER_SUGGESTION_DEBOUNCE_MS,
  pushWarehouseFinderHistory,
  readWarehouseFinderHistory,
  removeWarehouseFinderHistory,
  uniqueWarehouseFinderProductNames,
  warehouseFinderHistoryForMode,
  warehouseFinderWarningLabels,
  writeWarehouseFinderHistory,
  type WarehouseFinderCard,
  type WarehouseFinderHistoryItem,
  type WarehouseFinderSearchMode,
} from '@/lib/warehouse/finder'

function formatImportedAt(value: string) {
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function FinderImage({
  styleNo,
  fit = 'cover',
}: {
  styleNo: string
  fit?: 'cover' | 'contain'
}) {
  const sources = useMemo(() => {
    const logistics = ruleImageUrls(styleNo, LOGISTICS_IMAGE_KEY)
    const product = ruleImageUrls(styleNo, PRODUCT_IMAGE_KEY)
    return [...logistics, ...product]
  }, [styleNo])
  const [index, setIndex] = useState(0)
  const src = sources[index]
  if (!src) {
    return (
      <div className="flex size-full items-center justify-center text-muted-foreground">
        <ImageIcon className="size-8" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className={cn(
        'size-full',
        fit === 'contain' ? 'object-contain' : 'object-cover',
      )}
      onError={() => setIndex((current) => current + 1)}
    />
  )
}

function FinderCard({
  item,
  onLocationClick,
  onImageClick,
}: {
  item: WarehouseFinderCard
  onLocationClick: (locationBase: string) => void
  onImageClick: (item: WarehouseFinderCard) => void
}) {
  const warnings = warehouseFinderWarningLabels(item.reviewFlags)
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-none">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-snug">
            {item.styleNo
              ? `[${item.styleNo}] ${item.productName}`
              : item.productName}
          </h2>
          {item.officialStyleName ? (
            <p className="mt-1 text-xs text-muted-foreground">
              공식명 {item.officialStyleName}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onImageClick(item)}
          className="size-10 shrink-0 rounded-md border border-border bg-muted/40"
          aria-label="상품 이미지"
        >
          <FinderImage styleNo={item.styleNo} />
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            창고자리
          </dt>
          <dd>
            <button
              type="button"
              onClick={() => onLocationClick(item.locationBase)}
              className="font-semibold text-primary underline"
            >
              {item.locationDisplay}
            </button>
            {item.inboundCount > 1 ? (
              <span className="ml-1 text-xs text-muted-foreground">
                · {item.inboundCount}종
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            입고일
          </dt>
          <dd className="font-semibold">{item.receivedOnLabel}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            입수
          </dt>
          <dd className="font-semibold">
            {item.unitsPerBox == null ? '미확인' : formatNumber(item.unitsPerBox)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            남은 박스
          </dt>
          <dd className="font-semibold">
            {item.remainingBoxes == null
              ? '미확인'
              : formatNumber(item.remainingBoxes)}
          </dd>
        </div>
      </dl>

      {warnings.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {warnings.map((label) => (
            <Badge key={label} variant="warning">
              {label}
            </Badge>
          ))}
        </div>
      ) : null}
      {item.note ? (
        <p className="mt-3 border-t border-dashed border-border pt-2 text-sm text-muted-foreground">
          {item.note}
        </p>
      ) : null}
    </article>
  )
}

export function WarehouseFinderPage() {
  useRenderWatch('WarehouseFinderPage')
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const tabActive = useWorkspaceTabActivity()
  const [mode, setMode] = useState<WarehouseFinderSearchMode>('product')
  const [draft, setDraft] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [history, setHistory] = useState<WarehouseFinderHistoryItem[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [locationBase, setLocationBase] = useState<string | null>(null)
  const [imageItem, setImageItem] = useState<WarehouseFinderCard | null>(null)

  useEffect(() => {
    setHistory(readWarehouseFinderHistory(brand.id))
  }, [brand.id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSubmitted(draft.trim())
    }, WAREHOUSE_FINDER_SUGGESTION_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft])

  const setQuery = useQuery({
    queryKey: ['warehouse-inventory-set', brand.id],
    queryFn: () => getActiveWarehouseInventorySet(brand.id),
  })

  const searchQuery = useQuery({
    queryKey: ['warehouse-finder', brand.id, mode, submitted],
    queryFn: () => searchWarehouseFinder(brand.id, mode, submitted),
    enabled: Boolean(submitted),
  })

  const inboundQuery = useQuery({
    queryKey: ['warehouse-finder-inbounds', brand.id, locationBase],
    queryFn: () => listWarehouseFinderInbounds(brand.id, locationBase ?? ''),
    enabled: Boolean(locationBase),
  })

  useEffect(() => {
    if (!tabActive) return
    return subscribeWarehouseInventorySetChanges(brand.id, {
      onChange: () => {
        void queryClient.invalidateQueries({
          queryKey: ['warehouse-inventory-set', brand.id],
        })
        void queryClient.invalidateQueries({
          queryKey: ['warehouse-finder', brand.id],
        })
        void queryClient.invalidateQueries({
          queryKey: ['warehouse-finder-inbounds', brand.id],
        })
      },
    })
  }, [brand.id, queryClient, tabActive])

  function runSearch(nextMode: WarehouseFinderSearchMode, nextQuery: string) {
    const trimmed = nextQuery.trim()
    setMode(nextMode)
    setDraft(nextQuery)
    setSubmitted(trimmed)
    if (!trimmed) return
    const nextHistory = pushWarehouseFinderHistory(history, {
      mode: nextMode,
      query: trimmed,
    })
    setHistory(nextHistory)
    writeWarehouseFinderHistory(brand.id, nextHistory)
  }

  const items = searchQuery.data?.items ?? emptyList<WarehouseFinderCard>()
  const inboundItems = inboundQuery.data ?? emptyList<WarehouseFinderCard>()
  const modeHistory = useMemo(
    () => warehouseFinderHistoryForMode(history, mode),
    [history, mode],
  )
  const productSuggestions = useMemo(
    () => uniqueWarehouseFinderProductNames(items),
    [items],
  )
  const showProductSuggestions =
    mode === 'product' &&
    suggestionsOpen &&
    Boolean(draft.trim()) &&
    (searchQuery.isFetching || productSuggestions.length > 0)

  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader
        title="창고 파인더"
        description={`${brand.name} 자리·상품·M번호를 연습 창고 스냅샷에서 찾습니다. 조회만 하고 재고는 바꾸지 않습니다.`}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void setQuery.refetch()
              if (submitted) void searchQuery.refetch()
            }}
          >
            <RefreshCw className="size-3.5" />
            새로고침
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="warning">연습 데이터</Badge>
        <p className="text-xs text-muted-foreground">
          {setQuery.data
            ? `마지막 동기화 ${formatImportedAt(setQuery.data.importedAt)} · ${formatNumber(setQuery.data.rowCount)}행`
            : '활성 창고 스냅샷이 없습니다.'}
        </p>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        {WAREHOUSE_FINDER_SEARCH_MODES.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={mode === item}
            onClick={() => {
              setMode(item)
              setSuggestionsOpen(item === 'product')
              if (draft.trim()) runSearch(item, draft)
            }}
            className={cn(
              'rounded-md border px-2 py-2 text-xs font-semibold',
              mode === item
                ? 'border-primary/40 bg-primary/5 text-foreground'
                : 'border-border bg-muted/20 text-muted-foreground',
            )}
          >
            {WAREHOUSE_FINDER_SEARCH_MODE_LABEL[item]}
          </button>
        ))}
      </div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          runSearch(mode, draft)
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setSuggestionsOpen(true)
            }}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setSuggestionsOpen(false), 120)
            }}
            aria-autocomplete={mode === 'product' ? 'list' : undefined}
            aria-controls={
              showProductSuggestions
                ? 'warehouse-finder-product-suggestions'
                : undefined
            }
            aria-expanded={
              mode === 'product' ? showProductSuggestions : undefined
            }
            placeholder={
              mode === 'warehouse'
                ? '자리번호 또는 211'
                : mode === 'mnumber'
                  ? 'M번호'
                  : '상품명'
            }
            className="h-11"
          />
          {showProductSuggestions ? (
            <div
              id="warehouse-finder-product-suggestions"
              role="listbox"
              aria-label="상품명 연관 검색어"
              className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-sm"
            >
              {searchQuery.isFetching && productSuggestions.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  연관 검색어 찾는 중…
                </p>
              ) : (
                productSuggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={name === draft.trim()}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/60"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSuggestionsOpen(false)
                      runSearch('product', name)
                    }}
                  >
                    {name}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
        <Button type="submit" className="h-11 px-4">
          <Search className="size-4" />
          검색
        </Button>
      </form>

      {modeHistory.length > 0 ? (
        <div className="mb-4 flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
          {modeHistory.map((item) => (
            <div
              key={`${item.mode}:${item.query}`}
              className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/30 text-[11px] text-muted-foreground"
            >
              <button
                type="button"
                onClick={() => runSearch(item.mode, item.query)}
                className="max-w-[12rem] truncate px-2.5 py-1"
              >
                {item.query}
              </button>
              <button
                type="button"
                aria-label={`${item.query} 삭제`}
                onClick={() => {
                  const nextHistory = removeWarehouseFinderHistory(history, item)
                  setHistory(nextHistory)
                  writeWarehouseFinderHistory(brand.id, nextHistory)
                }}
                className="pr-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {searchQuery.isFetching ? (
        <p className="text-sm text-muted-foreground">검색 중…</p>
      ) : null}
      {searchQuery.isError ? (
        <p className="text-sm text-danger">
          {searchQuery.error instanceof Error
            ? searchQuery.error.message
            : '검색에 실패했습니다.'}
        </p>
      ) : null}
      {submitted && !searchQuery.isFetching && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">맞는 자리가 없습니다.</p>
      ) : null}

      <div className="space-y-3">
        {items.map((item) => (
          <FinderCard
            key={item.positionId}
            item={item}
            onLocationClick={setLocationBase}
            onImageClick={setImageItem}
          />
        ))}
      </div>

      {locationBase ? (
        <WorkspaceTabOverlay>
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
            <div className="max-h-[80vh] w-full max-w-xl overflow-auto rounded-xl bg-background p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{locationBase} 입고 이력</p>
                  <p className="text-xs text-muted-foreground">
                    같은 자리의 이전 입고만 보여 줍니다. 재고는 바꾸지 않습니다.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLocationBase(null)}
                >
                  닫기
                </Button>
              </div>
              <div className="space-y-3">
                {inboundItems.map((item) => (
                  <FinderCard
                    key={item.positionId}
                    item={item}
                    onLocationClick={() => undefined}
                    onImageClick={setImageItem}
                  />
                ))}
              </div>
            </div>
          </div>
        </WorkspaceTabOverlay>
      ) : null}

      {imageItem ? (
        <WorkspaceTabOverlay>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-background p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">{imageItem.productName}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setImageItem(null)}
                >
                  닫기
                </Button>
              </div>
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                <FinderImage styleNo={imageItem.styleNo} fit="contain" />
              </div>
            </div>
          </div>
        </WorkspaceTabOverlay>
      ) : null}
    </div>
  )
}

export function CompanyWarehouseFinderPage() {
  return (
    <SingleBrandOrList list={<CompanyWarehouseList />}>
      <WarehouseFinderPage />
    </SingleBrandOrList>
  )
}
