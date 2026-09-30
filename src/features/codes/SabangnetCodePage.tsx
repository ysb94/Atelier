import { Fragment, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleCheck,
  FileSpreadsheet,
  FolderTree,
  Link2,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Unlink,
  Upload,
  X,
} from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  SabangnetProductStoreError,
  createSabangnetProduct,
  deleteSabangnetProduct,
  getSabangnetFields,
  getSabangnetProducts,
  listAllStyleRefs,
  setStyleCategories,
  updateSabangnetProduct,
} from '@/lib/api'
import {
  summarizeSabangnetCategories,
  type SabangnetCategorySummary,
} from '@/lib/codes/sabangnet-category-import'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  UNCATEGORIZED_FILTER,
  categoryListLabel,
  categoryPathLabel,
  createStyleCategoryFilter,
  listCategoryFilterOptions,
  styleCategoryIds,
  type CategoryTree,
} from '@/lib/products/product-categories'
import {
  invalidateStyleCategories,
  useStyleCategoryIndex,
} from '@/lib/products/use-style-category-index'
import type {
  SabangnetField,
  SabangnetProduct,
  SabangnetProductInput,
  StyleRef,
} from '@/lib/types'
import { cn, emptyList, formatNumber } from '@/lib/utils'
import { PendingSabangnetPanel } from './PendingSabangnetPanel'
import { SabangnetBulkUploadPanel } from './SabangnetBulkUploadPanel'
import { SabangnetCategoryImportPanel } from './SabangnetCategoryImportPanel'
import { SabangnetFieldManager } from './SabangnetFieldManager'
import {
  SabangnetProductDialog,
  type SabangnetCategoryDraft,
} from './SabangnetProductDialog'

type ListTab = 'all' | 'linked' | 'unlinked'
type DialogState = {
  mode: 'create' | 'edit'
  source: SabangnetProduct | null
  categorySummary: SabangnetCategorySummary | null
}
type SaveRequest = {
  input: SabangnetProductInput
  categories: SabangnetCategoryDraft
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
const DEFAULT_PAGE_SIZE = 50

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function fieldCell(field: SabangnetField, product: SabangnetProduct) {
  if (field.systemKey === 'code') return product.code
  if (field.systemKey === 'name') return product.name
  if (field.systemKey === 'styles') {
    if (product.styles.length === 0) return null
    return product.styles.map((style) => style.styleNo).join(', ')
  }
  const raw = product.values[field.id]?.trim() ?? ''
  if (!raw) return ''
  if (field.type === 'number') {
    const numeric = Number(raw.replace(/,/g, ''))
    return Number.isFinite(numeric) ? formatNumber(numeric) : raw
  }
  return raw
}

function CategoryCell({
  summary,
  tree,
}: {
  summary: SabangnetCategorySummary
  tree: CategoryTree
}) {
  if (summary.kind === 'noStyles') {
    return <span className="text-muted-foreground">—</span>
  }
  if (summary.kind === 'none') return <Badge variant="muted">미분류</Badge>
  const labels = summary.categoryIds.map(
    (id) => categoryPathLabel(tree, id) || '삭제된 카테고리',
  )
  if (summary.kind === 'mixed') {
    return (
      <span className="flex min-w-0 items-center gap-1.5" title={labels.join('\n')}>
        <Badge variant="warning">혼합</Badge>
        <span className="truncate text-xs text-muted-foreground">
          M번호마다 다름
        </span>
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={labels.join('\n')}>
      <span className="truncate">{labels[0]}</span>
      {labels.length > 1 ? (
        <Badge variant="outline" className="shrink-0">
          +{labels.length - 1}
        </Badge>
      ) : null}
    </span>
  )
}

function sameIdSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id) => right.includes(id))
}

function buildPageItems(
  current: number,
  total: number,
): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const items: Array<number | 'ellipsis'> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  if (start > 2) items.push('ellipsis')
  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
    items.push(pageNumber)
  }
  if (end < total - 1) items.push('ellipsis')
  items.push(total)
  return items
}

export function SabangnetCodePage() {
  useRenderWatch('SabangnetCodePage')
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<ListTab>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const { index: categoryIndex, loading: categoryLoading } =
    useStyleCategoryIndex(brand.id)

  const productsQuery = useQuery({
    queryKey: ['sabangnetProducts', brand.id],
    queryFn: () => getSabangnetProducts(brand.id),
  })
  const stylesQuery = useQuery({
    queryKey: ['styleRefs', brand.id, 'sabangnet'],
    queryFn: () => listAllStyleRefs(brand.id),
  })
  const fieldsQuery = useQuery({
    queryKey: ['sabangnetFields', brand.id],
    queryFn: () => getSabangnetFields(brand.id),
  })

  const products = productsQuery.data ?? emptyList<SabangnetProduct>()
  const styles = stylesQuery.data ?? emptyList<StyleRef>()
  const fields = fieldsQuery.data ?? emptyList<SabangnetField>()
  const listColumnCount = 1 + fields.length + 3
  const categoryOptions = useMemo(
    () => (categoryIndex ? listCategoryFilterOptions(categoryIndex.tree) : []),
    [categoryIndex],
  )
  const categoryMatcher = useMemo(() => {
    if (!categoryIndex || categoryFilter === 'all') return null
    if (categoryFilter === UNCATEGORIZED_FILTER) {
      return (product: SabangnetProduct) =>
        product.styles.some(
          (style) => styleCategoryIds(categoryIndex, style.styleId).length === 0,
        )
    }
    const matchesStyle = createStyleCategoryFilter(categoryIndex, categoryFilter)
    if (!matchesStyle) return null
    return (product: SabangnetProduct) =>
      product.styles.some((style) => matchesStyle(style.styleId))
  }, [categoryIndex, categoryFilter])

  const linkedCount = useMemo(
    () => products.filter((product) => product.styles.length > 0).length,
    [products],
  )
  const unlinkedProducts = useMemo(
    () => products.filter((product) => product.styles.length === 0),
    [products],
  )

  const scoped = useMemo(() => {
    if (tab === 'linked') {
      return products.filter((product) => product.styles.length > 0)
    }
    if (tab === 'unlinked') return unlinkedProducts
    return products
  }, [products, tab, unlinkedProducts])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const inCategory = categoryMatcher
      ? scoped.filter(categoryMatcher)
      : scoped
    if (!keyword) return inCategory
    return inCategory.filter((product) => {
      if (product.code.toLowerCase().includes(keyword)) return true
      if (product.name.toLowerCase().includes(keyword)) return true
      if (
        Object.values(product.values).some((value) =>
          value.toLowerCase().includes(keyword),
        )
      ) {
        return true
      }
      return product.styles.some(
        (style) =>
          style.styleNo.toLowerCase().includes(keyword) ||
          style.name.toLowerCase().includes(keyword) ||
          (categoryIndex !== null &&
            categoryListLabel(
              categoryIndex.tree,
              styleCategoryIds(categoryIndex, style.styleId),
            )
              .toLowerCase()
              .includes(keyword)),
      )
    })
  }, [scoped, search, categoryMatcher, categoryIndex])

  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize) || 1)
  const safePage = Math.min(page, totalPages)
  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, safePage, pageSize])
  const rangeStart = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeEnd = Math.min(safePage * pageSize, totalCount)
  const pageItems = useMemo(
    () => buildPageItems(safePage, totalPages),
    [safePage, totalPages],
  )

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  useEffect(() => {
    setPage(1)
    setExpandedId(null)
  }, [search, pageSize, tab, categoryFilter])

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['sabangnetProducts', brand.id],
    })
  }

  const saveMutation = useMutation({
    mutationFn: async ({ input, categories }: SaveRequest) => {
      const source = dialog?.mode === 'edit' ? dialog.source : null
      const saved = source
        ? await updateSabangnetProduct(source.id, input)
        : await createSabangnetProduct(brand.id, input)
      const styleIds = saved.styles.map((style) => style.styleId)
      const stylesChanged = !sameIdSet(
        source?.styles.map((style) => style.styleId) ?? [],
        styleIds,
      )
      const shouldApply =
        styleIds.length > 0 &&
        (categories.dirty ||
          (stylesChanged && !categories.mixed && categories.ids.length > 0))
      if (!shouldApply) return { categoryError: null }
      try {
        await setStyleCategories(brand.id, styleIds, categories.ids)
        return { categoryError: null }
      } catch (error) {
        console.warn('[sabangnet] 카테고리 저장 실패', {
          code: saved.code,
          error,
        })
        return {
          categoryError:
            error instanceof Error
              ? error.message
              : '카테고리를 저장하지 못했습니다.',
        }
      }
    },
    onSuccess: async ({ categoryError }) => {
      setDialog(null)
      setSaveError(null)
      setNotice(
        categoryError
          ? `사방넷 코드는 저장했지만 카테고리는 저장하지 못했습니다. ${categoryError}`
          : null,
      )
      await Promise.all([
        invalidate(),
        invalidateStyleCategories(queryClient, brand.id),
      ])
    },
    onError: (error) => {
      setSaveError(
        error instanceof SabangnetProductStoreError
          ? error.message
          : '사방넷 코드를 저장하지 못했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSabangnetProduct(id),
    onSuccess: () => invalidate(),
  })

  function openCreate() {
    setSaveError(null)
    setDialog({ mode: 'create', source: null, categorySummary: null })
  }

  function openEdit(product: SabangnetProduct) {
    setSaveError(null)
    setDialog({
      mode: 'edit',
      source: product,
      categorySummary: categoryIndex
        ? summarizeSabangnetCategories(product, categoryIndex.byStyle)
        : null,
    })
  }

  return (
    <div>
      <PageHeader
        title="사방넷 코드 관리"
        description={`${brand.name}의 사방넷 코드와 SKU 단위 M번호 연결을 관리합니다.`}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={fieldsQuery.isLoading}
              onClick={() => setFieldsOpen((current) => !current)}
            >
              <Settings2 className="size-3.5" />
              {fieldsOpen ? '항목 관리 닫기' : '항목 관리'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCategoryOpen((current) => !current)}
            >
              <FolderTree className="size-4" />
              {categoryOpen ? '카테고리 가져오기 닫기' : '카테고리 가져오기'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkOpen((current) => !current)}
            >
              <Upload className="size-4" />
              {bulkOpen ? '일괄 등록 닫기' : '엑셀 일괄 등록·수정'}
            </Button>
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4" />
              코드 등록
            </Button>
          </>
        }
      />

      {fieldsOpen ? (
        <SabangnetFieldManager
          brandId={brand.id}
          fields={fields}
          onClose={() => setFieldsOpen(false)}
        />
      ) : null}

      {bulkOpen ? (
        <div className="mb-4">
          <SabangnetBulkUploadPanel
            brandName={brand.name}
            brandId={brand.id}
            styles={styles}
            fields={fieldsQuery.data}
            fieldsOpen={fieldsOpen}
            existingProducts={products}
            onApplied={invalidate}
            onManageFields={() => setFieldsOpen((current) => !current)}
            onClose={() => setBulkOpen(false)}
          />
        </div>
      ) : null}

      {categoryOpen ? (
        <div className="mb-4">
          <SabangnetCategoryImportPanel
            brandId={brand.id}
            brandName={brand.name}
            products={products}
            index={categoryIndex}
            indexLoading={categoryLoading}
            onApplied={() => invalidateStyleCategories(queryClient, brand.id)}
            onClose={() => setCategoryOpen(false)}
          />
        </div>
      ) : null}

      {notice ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <span>{notice}</span>
          <button
            type="button"
            className="shrink-0"
            aria-label="알림 닫기"
            onClick={() => setNotice(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="전체 코드"
          description="등록된 사방넷 코드"
          value={productsQuery.isLoading ? '—' : formatNumber(products.length)}
          icon={FileSpreadsheet}
        />
        <SummaryCard
          label="연결 완료"
          description="M번호 연결 완료"
          value={productsQuery.isLoading ? '—' : formatNumber(linkedCount)}
          icon={CircleCheck}
        />
        <SummaryCard
          label="미연결"
          description="M번호 지정 필요"
          value={
            productsQuery.isLoading
              ? '—'
              : formatNumber(unlinkedProducts.length)
          }
          icon={Unlink}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            ['all', '전체', products.length],
            ['linked', '연결 완료', linkedCount],
            ['unlinked', 'M번호 미연결', unlinkedProducts.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              tab === id
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab(id)}
          >
            {label} ({formatNumber(count)})
          </button>
        ))}
      </div>

      {tab === 'unlinked' ? (
        <PendingSabangnetPanel
          brandName={brand.name}
          products={products}
          styles={styles}
          fields={fieldsQuery.data}
          onChanged={invalidate}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="sm:max-w-sm"
              placeholder="등록 항목, M번호, 카테고리 검색..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              className="sm:w-52"
              value={categoryFilter}
              aria-label="카테고리 필터"
              disabled={!categoryIndex}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">
                {categoryLoading ? '카테고리 불러오는 중...' : '전체 카테고리'}
              </option>
              <option value={UNCATEGORIZED_FILTER}>미분류 M번호 있음</option>
              {categoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              className="sm:w-auto"
              value={String(pageSize)}
              aria-label="페이지당 행 수"
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}건씩
                </option>
              ))}
            </Select>
            <span className="text-sm text-muted-foreground sm:ml-auto">
              {totalCount === 0
                ? '0건'
                : `전체 ${formatNumber(totalCount)}건 중 ${formatNumber(rangeStart)}–${formatNumber(rangeEnd)}건`}
            </span>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 px-4 py-3" />
                    {fields.map((field) => (
                      <th key={field.id} className="px-4 py-3 font-medium">
                        {field.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 font-medium">카테고리</th>
                    <th className="px-4 py-3 font-medium">수정일</th>
                    <th className="w-20 px-4 py-3 font-medium">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {productsQuery.isLoading ? (
                    <tr>
                      <td
                        colSpan={listColumnCount}
                        className="px-4 py-10 text-center text-muted-foreground"
                      >
                        불러오는 중...
                      </td>
                    </tr>
                  ) : productsQuery.isError ? (
                    <tr>
                      <td colSpan={listColumnCount} className="px-4 py-12 text-center">
                        <div className="mx-auto max-w-md space-y-3">
                          <p className="text-sm font-medium text-danger">
                            사방넷 코드 목록을 불러오지 못했습니다
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {productsQuery.error instanceof Error
                              ? productsQuery.error.message
                              : '잠시 후 다시 시도해 주세요.'}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void productsQuery.refetch()}
                          >
                            다시 시도
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : totalCount === 0 ? (
                    <tr>
                      <td colSpan={listColumnCount} className="px-4 py-16 text-center">
                        <div className="mx-auto flex max-w-md flex-col items-center">
                          <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Link2 className="size-5" />
                          </div>
                          <p className="text-sm font-medium">
                            {products.length === 0
                              ? '등록된 사방넷 코드가 없습니다'
                              : '조건에 맞는 코드가 없습니다'}
                          </p>
                          <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                            {products.length === 0
                              ? '엑셀 일괄 등록이나 단건 등록으로 사방넷 코드를 추가하세요.'
                              : '검색어를 바꾸거나 다른 탭을 확인해 보세요.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paged.map((product) => {
                      const isExpanded = expandedId === product.id
                      return (
                        <Fragment key={product.id}>
                          <tr
                            onClick={() =>
                              setExpandedId(isExpanded ? null : product.id)
                            }
                            className={cn(
                              'cursor-pointer border-b border-border transition-colors',
                              isExpanded ? 'bg-accent/50' : 'hover:bg-muted/40',
                            )}
                          >
                            <td className="px-4 py-3">
                              <ChevronDown
                                className={cn(
                                  'size-4 text-muted-foreground transition-transform',
                                  isExpanded && 'rotate-180',
                                )}
                              />
                            </td>
                            {fields.map((field) => {
                              const value = fieldCell(field, product)
                              return (
                                <td
                                  key={field.id}
                                  className={cn(
                                    'max-w-64 px-4 py-3',
                                    field.systemKey === 'code' &&
                                      'font-medium tabular-nums',
                                    field.type === 'number' && 'tabular-nums',
                                  )}
                                >
                                  {field.systemKey === 'styles' && !value ? (
                                    <Badge variant="warning">미연결</Badge>
                                  ) : (
                                    <span className="line-clamp-2" title={value || undefined}>
                                      {value || '—'}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                            <td className="max-w-72 px-4 py-3">
                              {categoryIndex ? (
                                <CategoryCell
                                  summary={summarizeSabangnetCategories(
                                    product,
                                    categoryIndex.byStyle,
                                  )}
                                  tree={categoryIndex.tree}
                                />
                              ) : (
                                <span className="text-muted-foreground">…</span>
                              )}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-muted-foreground">
                              {formatUpdatedAt(product.updatedAt)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`${product.code} 수정`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openEdit(product)
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-danger hover:bg-danger/10"
                                  aria-label={`${product.code} 삭제`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    if (
                                      window.confirm(
                                        `"${product.name}" (${product.code}) 코드를 삭제할까요?`,
                                      )
                                    ) {
                                      deleteMutation.mutate(product.id)
                                    }
                                  }}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="border-b border-border bg-muted/20">
                              <td />
                              <td colSpan={listColumnCount - 1} className="px-4 py-4">
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  연결 M번호
                                </div>
                                {product.styles.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">
                                    M번호가 아직 없습니다. 미연결 탭에서 채우거나
                                    수정으로 연결하세요.
                                  </p>
                                ) : (
                                  <ul className="space-y-1">
                                    {product.styles.map((style) => {
                                      const categoryLabel = categoryIndex
                                        ? categoryListLabel(
                                            categoryIndex.tree,
                                            styleCategoryIds(
                                              categoryIndex,
                                              style.styleId,
                                            ),
                                          )
                                        : ''
                                      return (
                                        <li
                                          key={style.styleId}
                                          className="flex flex-wrap items-center gap-x-3 gap-y-0.5"
                                        >
                                          <span className="font-medium tabular-nums">
                                            {style.styleNo}
                                          </span>
                                          <span className="text-muted-foreground">
                                            {style.name}
                                          </span>
                                          {categoryIndex ? (
                                            categoryLabel ? (
                                              <span className="text-xs text-muted-foreground">
                                                · {categoryLabel}
                                              </span>
                                            ) : (
                                              <Badge variant="muted">미분류</Badge>
                                            )
                                          ) : null}
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            {totalCount > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {formatNumber(rangeStart)}–{formatNumber(rangeEnd)} /{' '}
                  {formatNumber(totalCount)}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={safePage <= 1}
                    onClick={() => setPage(1)}
                    aria-label="첫 페이지"
                  >
                    <ChevronsLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={safePage <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    aria-label="이전 페이지"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  {pageItems.map((item, index) =>
                    item === 'ellipsis' ? (
                      <span
                        key={`ellipsis-${index}`}
                        className="px-1 text-xs text-muted-foreground"
                      >
                        …
                      </span>
                    ) : (
                      <Button
                        key={item}
                        type="button"
                        variant={item === safePage ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setPage(item)}
                      >
                        {item}
                      </Button>
                    ),
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={safePage >= totalPages}
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    aria-label="다음 페이지"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(totalPages)}
                    aria-label="마지막 페이지"
                  >
                    <ChevronsRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </>
      )}

      <SabangnetProductDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'create'}
        source={dialog?.source}
        existingProducts={products}
        styles={styles}
        fields={fields}
        categoryTree={categoryIndex?.tree ?? null}
        categorySummary={dialog?.categorySummary ?? null}
        isSubmitting={saveMutation.isPending}
        errorMessage={saveError}
        onClose={() => {
          setDialog(null)
          setSaveError(null)
        }}
        onSubmit={(input, categories) =>
          saveMutation.mutate({ input, categories })
        }
      />
    </div>
  )
}

function SummaryCard({
  label,
  description,
  value,
  icon: Icon,
}: {
  label: string
  description: string
  value: string
  icon: typeof FileSpreadsheet
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-xl font-semibold">{value}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
