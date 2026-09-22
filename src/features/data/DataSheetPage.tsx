import { useCallback, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import {
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { Download, Settings2, Upload } from 'lucide-react'
import { CompanyBrandFilter } from '@/components/layout/CompanyBrandFilter'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { PageHeader } from '@/components/layout/PageHeader'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  getBrandFields,
  getProductCodes,
  getSabangnetStyleCodes,
  getSeasonsByBrand,
  getStylesFilteredForBrands,
  getStylesPageForBrands,
  type StyleFilter,
} from '@/lib/api'
import {
  applySabangnetCodesToStyles,
  isSabangnetCodeField,
  sabangnetCodeByStyleId,
} from '@/lib/codes/sabangnet-style-codes'
import {
  columnsForSheet,
  downloadStylesExport,
  sheetOwnerLabel,
  type DataSheetOwner,
} from '@/lib/export/styles-export'
import {
  fieldValueKey,
  getStyleFieldDisplay,
} from '@/lib/products/style-fields'
import {
  STYLE_STATUS_LABEL,
  formatSeasonLabel,
  type BrandField,
  type ProductCode,
  type Season,
  type Style,
  type StyleStatus,
} from '@/lib/types'
import { combineListQueries, flattenListQueries } from '@/lib/query/list-queries'
import {
  dataSheetDetailPath,
  dataUploadHref,
  settingsPath,
} from '@/lib/workspace/company-paths'
import { companyQueryKey } from '@/lib/workspace/query-keys'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn, emptyList, formatNumber } from '@/lib/utils'
import { SheetTable, type SheetRow } from './SheetTable'
import {
  compareSheetRows,
  isSheetCellBlank,
  timeDataSheet,
  type SheetSort,
} from './sheet-sort'

const DATA_OWNERS: DataSheetOwner[] = [
  'planning',
  'design',
  'md',
  'logistics',
  'all',
]

const PAGE_SIZES = [50, 100, 200] as const

const BRAND_COLUMN: BrandField = {
  id: '_brand',
  brandId: '',
  label: '브랜드',
  systemKey: 'brand',
  type: 'text',
  owner: 'common',
  required: false,
  order: -3,
  level: 'style',
  options: [],
}

const STYLE_NO_COLUMN: BrandField = {
  id: '_styleNo',
  brandId: '',
  label: 'M번호',
  systemKey: 'styleNo',
  type: 'text',
  owner: 'common',
  required: false,
  order: -2,
  level: 'style',
  options: [],
}

const NAME_COLUMN: BrandField = {
  id: '_name',
  brandId: '',
  label: '상품명',
  systemKey: 'name',
  type: 'text',
  owner: 'common',
  required: false,
  order: -1.8,
  level: 'style',
  options: [],
}

/** 시트 표시 전용. 항목 관리·엑셀 내보내기 대상이 아니다. */
const OWN_BARCODE_COLUMN: BrandField = {
  id: '_ownBarcode',
  brandId: '',
  label: '88바코드',
  systemKey: 'ownBarcode',
  type: 'text',
  owner: 'common',
  required: false,
  order: -1.5,
  level: 'style',
  options: [],
}

function withOwnBarcodeColumn(columns: BrandField[]): BrandField[] {
  if (columns.some((column) => column.systemKey === 'ownBarcode')) {
    return columns
  }
  const nameIndex = columns.findIndex((column) => column.systemKey === 'name')
  const insertAt = nameIndex >= 0 ? nameIndex + 1 : Math.min(2, columns.length)
  return [
    ...columns.slice(0, insertAt),
    OWN_BARCODE_COLUMN,
    ...columns.slice(insertAt),
  ]
}

function withBrandColumn(columns: BrandField[]): BrandField[] {
  if (columns.some((column) => column.systemKey === 'brand')) return columns
  return [BRAND_COLUMN, ...columns]
}

function buildOneToOneBarcodeByStyleId(
  codes: ProductCode[],
): Map<string, string> {
  const grouped = new Map<string, string[]>()
  for (const code of codes) {
    if (code.kind !== 'own' || code.components.length !== 1) continue
    const styleId = code.components[0]?.styleId
    if (!styleId) continue
    const list = grouped.get(styleId) ?? []
    list.push(code.code)
    grouped.set(styleId, list)
  }

  const result = new Map<string, string>()
  for (const [styleId, barcodes] of grouped) {
    result.set(styleId, barcodes.join(', '))
  }
  return result
}

function parseOwner(raw: string | undefined): DataSheetOwner | null {
  if (!raw) return null
  if (DATA_OWNERS.includes(raw as DataSheetOwner)) {
    return raw as DataSheetOwner
  }
  return null
}

function parsePageSize(raw: string | null): number {
  const value = Number(raw)
  if (PAGE_SIZES.includes(value as (typeof PAGE_SIZES)[number])) return value
  return 100
}

function parsePage(raw: string | null): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 1) return 1
  return Math.trunc(value)
}

function styleToRow(
  style: Style,
  columns: BrandField[],
  options?: {
    seasonLabel?: string
    ownBarcode?: string
    sabangnetCode?: string
    brandName?: string
  },
): SheetRow {
  const values: Record<string, string> = {}
  for (const column of columns) {
    if (column.systemKey === 'brand') {
      values[fieldValueKey(column)] = options?.brandName ?? ''
      continue
    }
    if (column.systemKey === 'ownBarcode') {
      values[fieldValueKey(column)] = options?.ownBarcode ?? ''
      continue
    }
    if (isSabangnetCodeField(column)) {
      values[fieldValueKey(column)] = options?.sabangnetCode ?? ''
      continue
    }
    values[fieldValueKey(column)] = getStyleFieldDisplay(style, column, {
      seasonCode: options?.seasonLabel,
    })
  }
  return { id: `${style.brandId}:${style.id}`, styleNo: style.styleNo, values }
}

export function DataSheetPage() {
  useRenderWatch('DataSheetPage')
  const {
    selectedBrands,
    brandById,
    selection,
    loading: brandsLoading,
  } = useCompanyBrandScope()
  const navigate = useNavigate()
  const { owner: ownerParam } = useParams()
  const owner = parseOwner(ownerParam)
  const [searchParams, setSearchParams] = useSearchParams()
  const singleBrand = selection.canEdit ? selectedBrands[0] : undefined
  const brandIds = selectedBrands.map((item) => item.id)

  const search = searchParams.get('q') ?? ''
  const seasonId = searchParams.get('season') ?? 'all'
  const statusFilter = searchParams.get('status') ?? 'all'
  const pageSize = parsePageSize(searchParams.get('size'))
  const page = parsePage(searchParams.get('page'))

  const [banner, setBanner] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [searchDraft, setSearchDraft] = useState(search)
  const [isSearchComposing, setIsSearchComposing] = useState(false)

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            if (value == null || value === '' || value === 'all') {
              next.delete(key)
            } else if (key === 'size' && value === '100') {
              next.delete(key)
            } else if (key === 'page' && value === '1') {
              next.delete(key)
            } else {
              next.set(key, value)
            }
          }
          if (!('page' in patch)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  useEffect(() => {
    setSearchDraft((current) => (current === search ? current : search))
  }, [search])

  useEffect(() => {
    if (isSearchComposing || searchDraft === search) return
    const timer = window.setTimeout(() => {
      patchParams({ q: searchDraft || null })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [isSearchComposing, patchParams, search, searchDraft])

  const filter = useMemo<StyleFilter>(
    () => ({
      seasonId: seasonId === 'all' ? undefined : seasonId,
      status:
        statusFilter === 'all' ? undefined : (statusFilter as StyleStatus),
      search: search.trim() || undefined,
    }),
    [seasonId, statusFilter, search],
  )

  // 기본 반환 배열은 매 렌더 새 참조라 아래 useMemo 가 매번 다시 돈다. list-queries.ts 참고.
  const fieldQueries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['brand-fields', item.id] as const,
      queryFn: () => getBrandFields(item.id),
    })),
    combine: combineListQueries<BrandField>,
  })
  const seasonQueries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['seasons', item.id] as const,
      queryFn: () => getSeasonsByBrand(item.id),
    })),
    combine: combineListQueries<Season>,
  })
  const codeQueries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['productCodes', item.id, 'own'] as const,
      queryFn: () => getProductCodes(item.id, 'own'),
    })),
    combine: combineListQueries<ProductCode>,
  })
  const sabangnetQueries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['sabangnetProducts', item.id, 'styleCodes'] as const,
      queryFn: async () => {
        try {
          return await getSabangnetStyleCodes(item.id)
        } catch (error) {
          console.warn('[data-sheet] 사방넷 코드를 불러오지 못했습니다', {
            brandId: item.id,
            error,
          })
          throw error
        }
      },
    })),
    combine: combineListQueries<{ styleId: string; code: string }>,
  })
  const sortParam = searchParams.get('sort')
  const sortDirection = searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
  const blankParam = searchParams.get('blank')
  const needsCatalog = Boolean(sortParam || blankParam)
  const pageQuery = useQuery({
    queryKey: companyQueryKey(
      'styles-page',
      brandIds,
      filter,
      page,
      pageSize,
    ),
    queryFn: () =>
      getStylesPageForBrands(
        brandIds,
        filter,
        (page - 1) * pageSize,
        pageSize,
      ),
    enabled: brandIds.length > 0 && !needsCatalog,
    placeholderData: keepPreviousData,
  })
  const sortedQuery = useQuery({
    queryKey: companyQueryKey('styles-sorted', brandIds, filter),
    queryFn: async () => {
      try {
        return await getStylesFilteredForBrands(brandIds, filter)
      } catch (error) {
        console.warn('[data-sheet] 상품 목록을 불러오지 못했습니다', {
          brandIds,
          error,
        })
        throw error
      }
    },
    enabled: brandIds.length > 0 && needsCatalog,
    placeholderData: keepPreviousData,
  })

  const fieldsByBrand = useMemo(() => {
    const map = new Map<string, BrandField[]>()
    selectedBrands.forEach((item, index) => {
      map.set(item.id, fieldQueries.data[index] ?? [])
    })
    return map
  }, [fieldQueries.data, selectedBrands])
  const fields =
    (singleBrand ? fieldsByBrand.get(singleBrand.id) : undefined) ??
    emptyList<BrandField>()
  const seasons = useMemo(
    () => flattenListQueries(seasonQueries),
    [seasonQueries],
  )
  const hasSeasons = seasons.length > 0
  const codes = useMemo(() => flattenListQueries(codeQueries), [codeQueries])

  const columns = useMemo(() => {
    if (!owner) return []
    if (singleBrand) {
      return withBrandColumn(withOwnBarcodeColumn(columnsForSheet(fields, owner)))
    }
    return withBrandColumn(
      withOwnBarcodeColumn([STYLE_NO_COLUMN, NAME_COLUMN]),
    )
  }, [fields, owner, singleBrand])

  const seasonById = useMemo(
    () => new Map(seasons.map((season) => [season.id, season])),
    [seasons],
  )
  const ownBarcodeByStyleId = useMemo(
    () => buildOneToOneBarcodeByStyleId(codes),
    [codes],
  )
  const sabangnetCodeByStyle = useMemo(
    () => sabangnetCodeByStyleId(flattenListQueries(sabangnetQueries)),
    [sabangnetQueries],
  )

  const sort = useMemo<SheetSort | null>(() => {
    if (!sortParam) return null
    const column = columns.find((item) => fieldValueKey(item) === sortParam)
    if (!column) return null
    return { key: fieldValueKey(column), direction: sortDirection }
  }, [columns, sortDirection, sortParam])
  const blankKey = useMemo(() => {
    if (!blankParam) return null
    const column = columns.find((item) => fieldValueKey(item) === blankParam)
    return column ? fieldValueKey(column) : null
  }, [blankParam, columns])

  const orderedRows = useMemo(() => {
    const source = needsCatalog ? sortedQuery.data : pageQuery.data?.rows
    if (!source) return emptyList<SheetRow>()
    const rowFields = singleBrand
      ? columns
      : withBrandColumn(
          withOwnBarcodeColumn([STYLE_NO_COLUMN, NAME_COLUMN]),
        )
    return timeDataSheet(
      blankKey ? '빈칸 필터' : sort ? '헤더 정렬' : '시트 행',
      () => {
        const mapped = source.map((style) => {
          const season = seasonById.get(style.seasonId)
          return styleToRow(style, rowFields, {
            seasonLabel: season ? formatSeasonLabel(season) : undefined,
            ownBarcode: ownBarcodeByStyleId.get(style.id) ?? '',
            sabangnetCode: sabangnetCodeByStyle.get(style.id) ?? '',
            brandName: brandById.get(style.brandId)?.name,
          })
        })
        const filtered = blankKey
          ? mapped.filter((row) => isSheetCellBlank(row, blankKey))
          : mapped
        if (!sort) return filtered
        return [...filtered].sort((left, right) =>
          compareSheetRows(left, right, sort),
        )
      },
    )
  }, [
    blankKey,
    brandById,
    columns,
    needsCatalog,
    ownBarcodeByStyleId,
    pageQuery.data,
    sabangnetCodeByStyle,
    seasonById,
    singleBrand,
    sort,
    sortedQuery.data,
  ])

  const total = needsCatalog
    ? sortedQuery.data
      ? orderedRows.length
      : 0
    : (pageQuery.data?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rows = useMemo(() => {
    if (!needsCatalog) return orderedRows
    const start = (page - 1) * pageSize
    return orderedRows.slice(start, start + pageSize)
  }, [needsCatalog, orderedRows, page, pageSize])

  // 숨겨진 KeepAlive 탭이 주소를 고치면 보고 있던 탭이 바뀐다. 보이는 탭만 주소를 고친다.
  const tabActive = useWorkspaceTabActivity()
  const handleSort = useCallback(
    (key: string) => {
      const nextDirection =
        sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc'
      patchParams({
        sort: key,
        dir: nextDirection === 'desc' ? 'desc' : null,
      })
    },
    [patchParams, sort],
  )
  useEffect(() => {
    if (
      !tabActive ||
      brandsLoading ||
      fieldQueries.loading ||
      columns.length === 0
    ) {
      return
    }
    const patch: Record<string, string | null> = {}
    if (
      sortParam &&
      !columns.some((column) => fieldValueKey(column) === sortParam)
    ) {
      patch.sort = null
      patch.dir = null
    }
    if (
      blankParam &&
      !columns.some((column) => fieldValueKey(column) === blankParam)
    ) {
      patch.blank = null
    }
    if (Object.keys(patch).length === 0) return
    patchParams(patch)
  }, [
    blankParam,
    brandsLoading,
    columns,
    fieldQueries.loading,
    patchParams,
    sortParam,
    tabActive,
  ])
  useEffect(() => {
    if (!tabActive) return
    if (needsCatalog && !sortedQuery.data) return
    if (page > totalPages) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('page')
          return next
        },
        { replace: true },
      )
    }
  }, [needsCatalog, page, sortedQuery.data, tabActive, totalPages, setSearchParams])

  async function handleExport() {
    if (!owner || brandIds.length === 0) return
    try {
      setExporting(true)
      setBanner(null)
      const styles = await getStylesFilteredForBrands(brandIds, filter)
      const exportFields = singleBrand ? fields : [...columns]
      const links = (
        await Promise.all(brandIds.map((id) => getSabangnetStyleCodes(id)))
      ).flat()
      const codeByStyle = sabangnetCodeByStyleId(links)
      const visibleStyles = blankKey
        ? styles.filter((style) => {
            const season = seasonById.get(style.seasonId)
            const row = styleToRow(style, columns, {
              seasonLabel: season ? formatSeasonLabel(season) : undefined,
              ownBarcode: ownBarcodeByStyleId.get(style.id) ?? '',
              sabangnetCode: codeByStyle.get(style.id) ?? '',
              brandName: brandById.get(style.brandId)?.name,
            })
            return isSheetCellBlank(row, blankKey)
          })
        : styles
      await downloadStylesExport({
        brandName: singleBrand?.name ?? 'E&J',
        owner,
        fields: exportFields,
        styles: applySabangnetCodesToStyles(
          visibleStyles,
          exportFields,
          codeByStyle,
        ),
        seasons,
      })
    } catch (error) {
      setBanner(
        error instanceof Error ? error.message : '내보내기에 실패했습니다.',
      )
    } finally {
      setExporting(false)
    }
  }

  if (!owner) {
    return <Navigate to="/data/all" replace />
  }

  const loading =
    fieldQueries.loading ||
    seasonQueries.loading ||
    codeQueries.loading ||
    sabangnetQueries.loading ||
    (needsCatalog ? sortedQuery.isLoading : pageQuery.isLoading)
  const hasFilter =
    Boolean(filter.search) ||
    Boolean(filter.seasonId) ||
    Boolean(filter.status) ||
    Boolean(blankKey)

  const pageTitle =
    owner === 'all' ? '전체 상품' : `${sheetOwnerLabel(owner)} 시트`
  const querySuffix = searchParams.toString()
  const detailQuery = querySuffix ? `?${querySuffix}` : ''
  const uploadHref = singleBrand ? dataUploadHref(singleBrand.slug) : '/data/upload'
  const fieldsHref = singleBrand
    ? settingsPath('fields', singleBrand.slug)
    : '/settings/fields'
  const seasonsHref = singleBrand
    ? settingsPath('seasons', singleBrand.slug)
    : '/settings/seasons'

  return (
    <div className="-mx-1">
      <PageHeader
        title={pageTitle}
        description={
          owner === 'all'
            ? 'E&J 상품 데이터를 한 표에서 봅니다. 행을 눌러 그 행의 브랜드로 고치거나, 일괄 업로드는 브랜드를 하나 고른 뒤 합니다.'
            : `${sheetOwnerLabel(owner)} 항목만 모아 봅니다. 여러 건은 내보내기 후 일괄 업로드로 되돌립니다.`
        }
        actions={
          <>
            <Link to={fieldsHref}>
              <Button type="button" variant="outline" size="sm">
                <Settings2 className="size-3.5" />
                항목 관리
              </Button>
            </Link>
            <Link to={uploadHref}>
              <Button type="button" variant="outline" size="sm">
                <Upload className="size-3.5" />
                일괄 업로드
              </Button>
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              disabled={total === 0 || exporting}
            >
              <Download className="size-3.5" />
              {exporting ? '내보내는 중...' : '내보내기'}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            열 범위
          </span>
          {DATA_OWNERS.map((item) => (
            <Link
              key={item}
              to={`/data/${item}?${searchParams.toString()}`}
              className={cn(
                'rounded px-2.5 py-1 text-xs tabular-nums transition-colors',
                item === owner
                  ? 'bg-foreground text-background'
                  : 'bg-background text-muted-foreground ring-1 ring-border hover:text-foreground',
              )}
            >
              {item === 'all' ? '전체' : sheetOwnerLabel(item)}
            </Link>
          ))}
        </div>
        <div className="hidden h-4 w-px bg-border sm:block" />
        <div className="flex flex-wrap items-center gap-2">
          <CompanyBrandFilter className="h-8 bg-background text-sm" />
          <Input
            className="h-8 max-w-[14rem] bg-background text-sm"
            placeholder="품번·상품명 검색"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onCompositionStart={() => setIsSearchComposing(true)}
            onCompositionEnd={(event) => {
              setSearchDraft(event.currentTarget.value)
              setIsSearchComposing(false)
            }}
          />
          <Select
            className="h-8 bg-background text-sm"
            value={seasonId}
            onChange={(event) => patchParams({ season: event.target.value })}
          >
            <option value="all">전체 출시 기획</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {selectedBrands.length > 1
                  ? `${brandById.get(season.brandId)?.name ?? ''} · ${formatSeasonLabel(season)}`
                  : formatSeasonLabel(season)}
                {season.status === 'archived' ? ' · 마감' : ''}
              </option>
            ))}
          </Select>
          <Select
            className="h-8 bg-background text-sm"
            value={statusFilter}
            onChange={(event) => patchParams({ status: event.target.value })}
          >
            <option value="all">전체 상태</option>
            {(Object.keys(STYLE_STATUS_LABEL) as StyleStatus[]).map((status) => (
              <option key={status} value={status}>
                {STYLE_STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
          <Select
            className="h-8 bg-background text-sm"
            value={blankKey ?? 'all'}
            onChange={(event) => patchParams({ blank: event.target.value })}
          >
            <option value="all">빈칸 필터 없음</option>
            {columns.map((column) => {
              const key = fieldValueKey(column)
              return (
                <option key={key} value={key}>
                  {column.label} 빈칸
                </option>
              )
            })}
          </Select>
          <Select
            className="h-8 bg-background text-sm"
            value={String(pageSize)}
            onChange={(event) => patchParams({ size: event.target.value })}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}행
              </option>
            ))}
          </Select>
        </div>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {formatNumber(total)}건
          {columns.length > 0 ? ` · ${columns.length}열` : ''}
          {needsCatalog && sortedQuery.isFetching
            ? ' · 불러오는 중'
            : pageQuery.isFetching
              ? ' · 불러오는 중'
              : ''}
        </span>
      </div>

      <p className="mb-3 text-[11px] text-muted-foreground">
        <b className="font-medium">행을 누르면</b> 그 상품의 브랜드로 바로
        고칠 수 있습니다. 여러 건은 <b className="font-medium">내보내기</b>로
        받아 엑셀에서 편집한 뒤 <b className="font-medium">일괄 업로드</b>에
        다시 올리세요.
      </p>

      {banner ? (
        <p className="mb-3 text-sm text-muted-foreground">{banner}</p>
      ) : null}
      {sabangnetQueries.errorIndexes.length > 0 ? (
        <p className="mb-3 text-sm text-danger">
          사방넷 코드를 불러오지 못했습니다.
        </p>
      ) : null}
      {sortedQuery.isError ? (
        <p className="mb-3 text-sm text-danger">
          상품 목록을 불러오지 못했습니다.
        </p>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          불러오는 중...
        </p>
      ) : total === 0 && !hasFilter ? (
        <Card>
          <CardContent className="space-y-4 px-6 py-12 text-center">
            <p className="text-sm font-medium">시트에 표시할 상품이 없습니다</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link to={uploadHref}>
                <Button type="button" size="sm">
                  <Upload className="size-3.5" />
                  일괄 업로드
                </Button>
              </Link>
              {!hasSeasons ? (
                <Link to={seasonsHref}>
                  <Button type="button" size="sm" variant="outline">
                    출시 기획 만들기
                  </Button>
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <SheetTable
          columns={columns}
          rows={rows}
          sort={sort}
          onSort={handleSort}
          showOwnerGroups={Boolean(singleBrand) && owner === 'all'}
          onRowOpen={(row) => {
            const [rowBrandId] = row.id.split(':')
            const rowBrand = rowBrandId ? brandById.get(rowBrandId) : undefined
            if (!rowBrand) return
            navigate(
              `${dataSheetDetailPath(owner, rowBrand.slug, row.styleNo)}${detailQuery}`,
            )
          }}
        />
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => patchParams({ page: String(page - 1) })}
          >
            이전
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => patchParams({ page: String(page + 1) })}
          >
            다음
          </Button>
        </div>
      ) : null}

      <Outlet />
    </div>
  )
}

export function CompanyDataSheetPage() {
  return <DataSheetPage />
}
