import { useMemo } from 'react'
import { ChevronRight, FolderOpen, Layers3 } from 'lucide-react'
import { ProductThumb } from '@/components/products/ProductThumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  UNCATEGORIZED_FILTER,
  categoryPathLabel,
  countStylesByCategory,
  styleCategoryIds,
  type StyleCategoryIndex,
} from '@/lib/products/product-categories'
import { resolveProductImageSources } from '@/lib/products/product-image'
import { STYLE_STATUS_LABEL, type Brand, type ProductCategory, type Style } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

type CategoryGroup = {
  brandId: string
  brandName: string
  index: StyleCategoryIndex
  counts: Map<string, number>
}

type Props = {
  styles: Style[]
  allStyles: Style[]
  indexes: Map<string, StyleCategoryIndex>
  brands: Map<string, Brand>
  selectedCategory: string
  loading: boolean
  categoryLoading: boolean
  page: number
  totalPages: number
  totalCount: number
  onSelectCategory: (categoryId: string) => void
  onOpenStyle: (style: Style) => void
  onPage: (page: number) => void
}

function CategoryTreeItems({
  group,
  categories,
  selectedCategory,
  expandedIds,
  onSelect,
  depth = 0,
}: {
  group: CategoryGroup
  categories: ProductCategory[]
  selectedCategory: string
  expandedIds: Set<string>
  onSelect: (id: string) => void
  depth?: number
}) {
  return categories.map((category) => {
    const children = group.index.tree.childrenByParent.get(category.id) ?? []
    return (
      <div key={category.id}>
        <button
          type="button"
          aria-current={selectedCategory === category.id ? 'page' : undefined}
          onClick={() => onSelect(category.id)}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-lg py-2.5 pr-3 text-left text-sm transition-colors hover:bg-muted',
            selectedCategory === category.id && 'bg-primary/10 font-semibold text-primary hover:bg-primary/10',
            !category.isActive && 'text-muted-foreground',
          )}
          style={{ paddingLeft: 12 + depth * 16 }}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {children.length > 0 ? <ChevronRight className={cn('size-3 shrink-0 transition-transform', expandedIds.has(category.id) && 'rotate-90')} /> : null}
            <span className="truncate">{category.name}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatNumber(group.counts.get(category.id) ?? 0)}
          </span>
        </button>
        {children.length > 0 && expandedIds.has(category.id) ? (
          <CategoryTreeItems
            group={group}
            categories={children}
            selectedCategory={selectedCategory}
            expandedIds={expandedIds}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ) : null}
      </div>
    )
  })
}

export function ProductCategoryBrowse({
  styles,
  allStyles,
  indexes,
  brands,
  selectedCategory,
  loading,
  categoryLoading,
  page,
  totalPages,
  totalCount,
  onSelectCategory,
  onOpenStyle,
  onPage,
}: Props) {
  useRenderWatch('ProductCategoryBrowse')
  const groups = useMemo<CategoryGroup[]>(
    () =>
      Array.from(indexes, ([brandId, index]) => ({
        brandId,
        brandName: brands.get(brandId)?.name ?? '카테고리',
        index,
        counts: countStylesByCategory(index),
      })).filter((group) => group.index.tree.ordered.length > 0),
    [brands, indexes],
  )
  const selectedGroup = groups.find((group) =>
    group.index.tree.byId.has(selectedCategory),
  )
  const selected = selectedGroup?.index.tree.byId.get(selectedCategory)
  const expandedIds = new Set<string>()
  if (selected && selectedGroup) {
    let current: ProductCategory | undefined = selected
    while (current && !expandedIds.has(current.id)) {
      expandedIds.add(current.id)
      current = current.parentId
        ? selectedGroup.index.tree.byId.get(current.parentId)
        : undefined
    }
  }
  const children = selected
    ? selectedGroup?.index.tree.childrenByParent.get(selected.id) ?? []
    : groups.flatMap((group) => group.index.tree.childrenByParent.get(null) ?? [])
  const uncategorizedCount = useMemo(
    () =>
      allStyles.filter((style) => {
        const index = indexes.get(style.brandId)
        return !index || styleCategoryIds(index, style.id).length === 0
      }).length,
    [allStyles, indexes],
  )
  const heading =
    selectedCategory === UNCATEGORIZED_FILTER
      ? '미분류 상품'
      : selected && selectedGroup
        ? selected.name
        : '전체 카테고리'
  const categoryPath =
    selected && selectedGroup
      ? categoryPathLabel(selectedGroup.index.tree, selected.id).split(' > ')
      : []

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <Card className="hidden h-fit overflow-hidden lg:sticky lg:top-4 lg:block">
        <div className="border-b border-border px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CATEGORY</p>
          <h2 className="mt-1 text-base font-semibold">카테고리 탐색</h2>
          <p className="mt-1 text-xs text-muted-foreground">숫자는 연결된 M번호 수입니다.</p>
        </div>
        <nav aria-label="상품 카테고리" className="max-h-[65vh] space-y-1 overflow-y-auto p-2">
          <button
            type="button"
            aria-current={selectedCategory === 'all' ? 'page' : undefined}
            onClick={() => onSelectCategory('all')}
            className={cn(
              'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted',
              selectedCategory === 'all' && 'bg-primary/10 font-semibold text-primary hover:bg-primary/10',
            )}
          >
            <span>전체 상품</span>
            <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(allStyles.length)}</span>
          </button>
          {groups.map((group) => (
            <div key={group.brandId} className="pt-2">
              {groups.length > 1 ? (
                <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground">{group.brandName}</p>
              ) : null}
              <CategoryTreeItems
                group={group}
                categories={group.index.tree.childrenByParent.get(null) ?? []}
                selectedCategory={selectedCategory}
                expandedIds={expandedIds}
                onSelect={onSelectCategory}
              />
            </div>
          ))}
          <button
            type="button"
            aria-current={selectedCategory === UNCATEGORIZED_FILTER ? 'page' : undefined}
            onClick={() => onSelectCategory(UNCATEGORIZED_FILTER)}
            className={cn(
              'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted',
              selectedCategory === UNCATEGORIZED_FILTER && 'bg-primary/10 font-semibold text-primary hover:bg-primary/10',
            )}
          >
            <span>미분류</span>
            <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(uncategorizedCount)}</span>
          </button>
        </nav>
      </Card>

      <div className="min-w-0 space-y-5">
        <Card className="overflow-hidden bg-gradient-to-br from-card via-card to-muted/50 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers3 className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <button type="button" onClick={() => onSelectCategory('all')} className="hover:text-foreground">전체 상품</button>
                {categoryPath.map((part, index) => (
                  <span key={`${part}-${index}`} className="flex items-center gap-1">
                    <ChevronRight className="size-3" />{part}
                  </span>
                ))}
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{heading}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {categoryLoading ? '카테고리를 불러오는 중입니다.' : `${formatNumber(totalCount)}개 M번호 · 카드를 누르면 상품 상세가 열립니다.`}
              </p>
            </div>
          </div>
        </Card>

        {children.length > 0 && selectedCategory !== UNCATEGORIZED_FILTER ? (
          <section aria-label="하위 카테고리">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{selected ? '하위 카테고리' : '카테고리 둘러보기'}</h3>
              <span className="text-xs text-muted-foreground">{children.length}개 분류</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {children.map((category) => {
                const group = groups.find((item) => item.brandId === category.brandId)
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => onSelectCategory(category.id)}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/30"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-primary">
                      <FolderOpen className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{category.name}</span>
                      <span className="text-xs text-muted-foreground">{formatNumber(group?.counts.get(category.id) ?? 0)}개 M번호</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}

        <section aria-label="상품 카드">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">상품 보기</h3>
            <span className="text-xs text-muted-foreground">현재 조건 {formatNumber(totalCount)}개 M번호</span>
          </div>
          {loading ? (
            <Card className="px-4 py-16 text-center text-sm text-muted-foreground">상품을 불러오는 중...</Card>
          ) : styles.length === 0 ? (
            <Card className="px-4 py-16 text-center text-sm text-muted-foreground">
              {groups.length === 0 && !categoryLoading
                ? '아직 등록된 카테고리가 없습니다. 상품 목록에서 먼저 상품을 확인할 수 있습니다.'
                : '이 조건에 해당하는 상품이 없습니다.'}
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {styles.map((style) => (
                <button
                  key={`${style.brandId}:${style.id}`}
                  type="button"
                  onClick={() => onOpenStyle(style)}
                  className="group min-w-0 overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex h-48 items-center justify-center bg-muted/50">
                    <ProductThumb
                      sources={resolveProductImageSources(style)}
                      alt={style.name || style.styleNo}
                      size={176}
                      className="rounded-lg bg-card object-contain"
                    />
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium tabular-nums text-muted-foreground">{style.styleNo}</span>
                      <Badge variant="outline" className="shrink-0">{STYLE_STATUS_LABEL[style.status]}</Badge>
                    </div>
                    <p className="line-clamp-2 min-h-10 text-sm font-semibold leading-5">{style.name || '상품명 미입력'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {brands.get(style.brandId)?.name ?? ''}
                      {style.colors.length > 0 ? ` · ${style.colors.join(', ')}` : ''}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {totalCount > 0 ? (
            <div className="mt-5 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{formatNumber(page)} / {formatNumber(totalPages)} 페이지</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>이전</Button>
                <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>다음</Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
