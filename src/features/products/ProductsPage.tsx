import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
} from 'lucide-react'
import {
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProductThumb } from '@/components/products/ProductThumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  getBrandFields,
  getSeasonsByBrand,
  getStylesByBrand,
  updateStyleFields,
} from '@/lib/api'
import { OWNER_LABEL } from '@/lib/import/fields'
import {
  isImageField,
  pickImageSources,
  resolveProductImageSources,
} from '@/lib/products/product-image'
import {
  fieldValueKey,
  getStyleFieldDisplay,
  getStyleFieldRaw,
  isFieldFilled,
  ownerCompleteness,
} from '@/lib/products/style-fields'
import {
  SEASON_STATUS_LABEL,
  STYLE_STATUS_LABEL,
  formatSeasonLabel,
  type BrandField,
  type FieldOwner,
  type Season,
  type Style,
  type StyleStatus,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

const columnHelper = createColumnHelper<Style>()

type ColumnPreset = 'all' | 'planning' | 'design' | 'md' | 'logistics'

const OWNER_PRESETS: Exclude<ColumnPreset, 'all'>[] = [
  'planning',
  'design',
  'md',
  'logistics',
]

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
const DEFAULT_PAGE_SIZE = 50

function statusVariant(
  status: StyleStatus,
): 'default' | 'success' | 'warning' | 'muted' | 'outline' {
  switch (status) {
    case 'confirmed':
    case 'received':
      return 'success'
    case 'sampling':
    case 'ordered':
      return 'warning'
    case 'draft':
      return 'muted'
    default:
      return 'outline'
  }
}

function CompletenessDots({
  style,
  fields,
}: {
  style: Style
  fields: BrandField[]
}) {
  return (
    <div
      className="flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {OWNER_PRESETS.map((owner) => {
        const { ratio } = ownerCompleteness(style, fields, owner)
        const pct = Math.round(ratio * 100)
        return (
          <span
            key={owner}
            title={`${OWNER_LABEL[owner]} ${pct}%`}
            className={cn(
              'inline-block h-2 w-2 rounded-sm',
              pct >= 100
                ? 'bg-success'
                : pct >= 50
                  ? 'bg-warning'
                  : pct > 0
                    ? 'bg-muted-foreground/50'
                    : 'bg-muted',
            )}
          />
        )
      })}
    </div>
  )
}

function isSeasonField(field: BrandField) {
  return (
    field.type === 'season' ||
    field.systemKey === 'seasonCode' ||
    field.systemKey === 'seasonId'
  )
}

function isGenderField(field: BrandField) {
  return field.type === 'gender' || field.systemKey === 'gender'
}

/**
 * 부서 보기에서 표 안에서 바로 고칠 수 있는 칸.
 * 편집 상태를 칸이 직접 들고 있어서 다른 칸을 건드리지 않는다.
 */
function EditableFieldCell({
  style,
  field,
  seasonCode,
  seasons,
  disabled,
  onSave,
}: {
  style: Style
  field: BrandField
  seasonCode?: string
  seasons: Season[]
  disabled: boolean
  onSave: (styleId: string, key: string, value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const key = fieldValueKey(field)
  const seasonValue = seasonCode ?? ''
  const raw = isSeasonField(field)
    ? seasonValue
    : getStyleFieldRaw(style, field, { seasonCode })
  const filled = isFieldFilled(style, field)
  const display = getStyleFieldDisplay(style, field, { seasonCode })

  function begin() {
    setDraft(raw)
    setEditing(true)
  }

  function commit(value: string) {
    setEditing(false)
    if (value === raw) return
    onSave(style.id, key, value)
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          'block w-full rounded px-2 py-1 text-left transition-colors hover:bg-muted',
          !filled && 'text-muted-foreground',
        )}
        onClick={(e) => {
          e.stopPropagation()
          begin()
        }}
      >
        {isImageField(field) ? (
          <span className="flex items-center gap-2">
            <ProductThumb
              sources={pickImageSources(raw, style.styleNo, key)}
              alt={style.styleNo}
              size={28}
            />
            <span className="truncate text-xs text-muted-foreground">
              {display}
            </span>
          </span>
        ) : filled ? (
          display
        ) : (
          <Badge variant="muted">{OWNER_LABEL[field.owner]}</Badge>
        )}
      </button>
    )
  }

  if (isSeasonField(field)) {
    return (
      <Select
        className="h-8 w-full"
        autoFocus
        value={draft}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          setDraft(e.target.value)
          if (!e.target.value) {
            setEditing(false)
            return
          }
          commit(e.target.value)
        }}
        onBlur={() => setEditing(false)}
      >
        <option value="">선택</option>
        {seasons.map((season) => (
          <option key={season.id} value={season.code}>
            {formatSeasonLabel(season)}
          </option>
        ))}
      </Select>
    )
  }

  if (isGenderField(field)) {
    return (
      <Select
        className="h-8 w-full"
        autoFocus
        value={draft}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          setDraft(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => setEditing(false)}
      >
        <option value="W">W · 여성</option>
        <option value="M">M · 남성</option>
        <option value="U">U · 공용</option>
      </Select>
    )
  }

  return (
    <Input
      className="h-8"
      autoFocus
      value={draft}
      disabled={disabled}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(draft)
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setEditing(false)
        }
      }}
    />
  )
}

function parsePageSize(raw: string | null): number {
  const value = Number(raw)
  if (PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number])) {
    return value
  }
  return DEFAULT_PAGE_SIZE
}

function parsePage(raw: string | null): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 1) return 1
  return Math.trunc(value)
}

function parseColumnPreset(raw: string | null): ColumnPreset {
  if (
    raw === 'planning' ||
    raw === 'design' ||
    raw === 'md' ||
    raw === 'logistics'
  ) {
    return raw
  }
  return 'all'
}

function styleMatchesSearch(
  style: Style,
  keyword: string,
  seasonCode?: string,
): boolean {
  if (!keyword) return true

  const haystack = [
    style.styleNo,
    style.name,
    style.category,
    style.gender,
    style.status,
    STYLE_STATUS_LABEL[style.status],
    style.planner,
    style.designer,
    style.description,
    style.colors.join(' '),
    seasonCode,
    style.weightG != null ? String(style.weightG) : '',
    ...Object.values(style.values ?? {}),
    ...Object.values(style.customFields ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(keyword)
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
  for (let page = start; page <= end; page += 1) items.push(page)
  if (end < total - 1) items.push('ellipsis')
  items.push(total)
  return items
}

export function ProductsPage({
  lockedOwner,
}: {
  lockedOwner?: FieldOwner
} = {}) {
  const { brand } = useBrand()
  const navigate = useNavigate()
  const { styleNo: activeStyleNoParam } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeStyleNo = activeStyleNoParam
    ? decodeURIComponent(activeStyleNoParam)
    : null

  const search = searchParams.get('q') ?? ''
  const seasonId = searchParams.get('season') ?? 'all'
  const statusFilter = searchParams.get('status') ?? 'all'
  const categoryFilter = searchParams.get('category') ?? 'all'
  const columnPreset = lockedOwner ?? parseColumnPreset(searchParams.get('cols'))
  const emptyFilterKey = searchParams.get('empty')
  const pageSize = parsePageSize(searchParams.get('size'))
  const page = parsePage(searchParams.get('page'))
  const queryClient = useQueryClient()
  const [saveError, setSaveError] = useState<string | null>(null)

  const listBasePath = lockedOwner
    ? `/b/${brand.slug}/work/${lockedOwner}`
    : `/b/${brand.slug}/products`

  const fieldsQuery = useQuery({
    queryKey: ['brand-fields', brand.id],
    queryFn: () => getBrandFields(brand.id),
  })

  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })

  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'products'],
    queryFn: () => getStylesByBrand(brand.id),
  })

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data])
  const seasons = useMemo(() => seasonsQuery.data ?? [], [seasonsQuery.data])
  const allStyles = useMemo(() => stylesQuery.data ?? [], [stylesQuery.data])
  const listLoading =
    stylesQuery.isLoading || fieldsQuery.isLoading || seasonsQuery.isLoading

  const seasonMap = useMemo(
    () => new Map(seasons.map((s) => [s.id, s])),
    [seasons],
  )

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const style of allStyles) {
      const category = style.category.trim()
      if (category) set.add(category)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [allStyles])

  const ownerFields = useMemo(() => {
    if (columnPreset === 'all') return [] as BrandField[]
    return fields
      .filter(
        (f) =>
          f.owner === columnPreset &&
          f.systemKey !== 'styleNo' &&
          f.level !== 'sku',
      )
      .sort((a, b) => a.order - b.order)
  }, [fields, columnPreset])

  const baseStyles = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return allStyles.filter((style) => {
      if (seasonId !== 'all' && style.seasonId !== seasonId) return false
      if (statusFilter !== 'all' && style.status !== statusFilter) return false
      if (categoryFilter !== 'all' && style.category !== categoryFilter) {
        return false
      }
      return styleMatchesSearch(
        style,
        keyword,
        seasonMap.get(style.seasonId)?.code,
      )
    })
  }, [
    allStyles,
    search,
    seasonId,
    statusFilter,
    categoryFilter,
    seasonMap,
  ])

  /** 지금 보고 있는 범위에서 부서 항목별 미입력 건수 */
  const emptyCounts = useMemo(() => {
    return ownerFields.map((field) => ({
      field,
      count: baseStyles.filter((style) => !isFieldFilled(style, field)).length,
    }))
  }, [baseStyles, ownerFields])

  const activeEmptyField = useMemo(() => {
    if (!emptyFilterKey) return undefined
    return ownerFields.find((field) => fieldValueKey(field) === emptyFilterKey)
  }, [ownerFields, emptyFilterKey])

  const filteredStyles = useMemo(() => {
    if (!activeEmptyField) return baseStyles
    return baseStyles.filter((style) => !isFieldFilled(style, activeEmptyField))
  }, [baseStyles, activeEmptyField])

  const totalCount = filteredStyles.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize) || 1)
  const safePage = Math.min(page, totalPages)

  const pageStyles = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredStyles.slice(start, start + pageSize)
  }, [filteredStyles, safePage, pageSize])

  const rangeStart = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeEnd = Math.min(safePage * pageSize, totalCount)
  const pageItems = buildPageItems(safePage, totalPages)

  const hasActiveFilters =
    Boolean(search.trim()) ||
    seasonId !== 'all' ||
    statusFilter !== 'all' ||
    categoryFilter !== 'all' ||
    (!lockedOwner && columnPreset !== 'all') ||
    Boolean(emptyFilterKey) ||
    pageSize !== DEFAULT_PAGE_SIZE ||
    page !== 1

  useEffect(() => {
    if (page === safePage) return
    const next = new URLSearchParams(searchParams)
    if (safePage <= 1) next.delete('page')
    else next.set('page', String(safePage))
    setSearchParams(next, { replace: true })
  }, [page, safePage, searchParams, setSearchParams])

  function patchParams(
    patch: Record<string, string | null>,
    options?: { resetPage?: boolean },
  ) {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      // 기본값은 주소에서 빼서 링크를 짧게 유지한다.
      const isDefault =
        value == null ||
        value === '' ||
        value === 'all' ||
        (key === 'size' && Number(value) === DEFAULT_PAGE_SIZE) ||
        (key === 'page' && value === '1')
      if (isDefault) next.delete(key)
      else next.set(key, value)
    }
    if (options?.resetPage !== false && patch.page === undefined) {
      next.delete('page')
    }
    setSearchParams(next, { replace: true })
  }

  function resetFilters() {
    setSearchParams({}, { replace: true })
  }

  const saveMutation = useMutation({
    mutationFn: ({
      styleId,
      patch,
    }: {
      styleId: string
      patch: Record<string, string>
    }) => updateStyleFields(styleId, patch),
    onSuccess: async () => {
      setSaveError(null)
      await queryClient.invalidateQueries({ queryKey: ['styles', brand.id] })
    },
    onError: (error) => {
      setSaveError(
        error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.',
      )
    },
  })

  const handleSaveField = useCallback(
    (styleId: string, key: string, value: string) => {
      setSaveError(null)
      saveMutation.mutate({ styleId, patch: { [key]: value } })
    },
    [saveMutation],
  )

  const styleNoLabel =
    fields.find((field) => field.systemKey === 'styleNo')?.label || '품번'
  const nameLabel =
    fields.find((field) => field.systemKey === 'name')?.label || '상품명'

  const hasImageField = fields.some(isImageField)

  const columns = useMemo(() => {
    const base = [
      ...(hasImageField
        ? [
            columnHelper.display({
              id: 'thumb',
              header: '',
              cell: ({ row }) => (
                <ProductThumb
                  sources={resolveProductImageSources(row.original)}
                  alt={row.original.styleNo}
                  size={36}
                />
              ),
            }),
          ]
        : []),
      columnHelper.accessor('styleNo', {
        header: styleNoLabel,
        cell: (info) => (
          <span className="font-medium tabular-nums">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('name', {
        header: nameLabel,
      }),
    ]

    if (columnPreset === 'all') {
      return [
        ...base,
        columnHelper.accessor('seasonId', {
          header: '출시 기획',
          cell: (info) => {
            const season = seasonMap.get(info.getValue())
            return season ? formatSeasonLabel(season) : '—'
          },
        }),
        columnHelper.accessor('category', {
          header: '카테고리',
        }),
        columnHelper.accessor('status', {
          header: '상태',
          cell: (info) => (
            <Badge variant={statusVariant(info.getValue())}>
              {STYLE_STATUS_LABEL[info.getValue()]}
            </Badge>
          ),
        }),
        columnHelper.display({
          id: 'completeness',
          header: '완성도',
          cell: ({ row }) => (
            <CompletenessDots style={row.original} fields={fields} />
          ),
        }),
      ]
    }

    return [
      ...base,
      ...ownerFields.map((field) =>
        columnHelper.display({
          id: `field:${field.id}`,
          header: field.label,
          cell: ({ row }) => (
            <EditableFieldCell
              style={row.original}
              field={field}
              seasonCode={seasonMap.get(row.original.seasonId)?.code}
              seasons={seasons}
              disabled={saveMutation.isPending}
              onSave={handleSaveField}
            />
          ),
        }),
      ),
    ]
  }, [
    columnPreset,
    fields,
    hasImageField,
    ownerFields,
    seasonMap,
    seasons,
    saveMutation.isPending,
    handleSaveField,
    styleNoLabel,
    nameLabel,
  ])

  const table = useReactTable({
    data: pageStyles,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const querySuffix = searchParams.toString()
  const detailQuery = querySuffix ? `?${querySuffix}` : ''

  return (
    <div>
      <PageHeader
        title={
          lockedOwner ? `${OWNER_LABEL[lockedOwner]} · 상품 정보` : '전체 상품'
        }
        description={
          lockedOwner
            ? `${OWNER_LABEL[lockedOwner]} 부서가 채울 항목만 보입니다. 표에서 칸을 눌러 바로 입력할 수 있습니다.`
            : `${brand.name} 브랜드의 상품 마스터입니다. 보기를 부서로 바꾸면 그 부서 항목만 열로 보이고 표에서 바로 입력할 수 있습니다.`
        }
        actions={
          lockedOwner ? undefined : (
            <Link to={`/b/${brand.slug}/data/upload?mode=single`}>
              <Button type="button">+ 상품 등록</Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          className="sm:max-w-xs"
          placeholder="품번, 상품명, 담당, 항목값 검색..."
          value={search}
          onChange={(e) => patchParams({ q: e.target.value || null })}
        />
        <Select
          value={seasonId}
          onChange={(e) => patchParams({ season: e.target.value })}
        >
          <option value="all">전체 출시 기획</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {formatSeasonLabel(s)}
              {s.status === 'archived'
                ? ` · ${SEASON_STATUS_LABEL[s.status]}`
                : ''}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => patchParams({ status: e.target.value })}
        >
          <option value="all">전체 상태</option>
          {(Object.keys(STYLE_STATUS_LABEL) as StyleStatus[]).map((status) => (
            <option key={status} value={status}>
              {STYLE_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
        <Select
          value={categoryFilter}
          onChange={(e) => patchParams({ category: e.target.value })}
        >
          <option value="all">전체 카테고리</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </Select>
        {lockedOwner ? null : (
          <Select
            value={columnPreset}
            onChange={(e) =>
              // 보기를 바꾸면 이전 보기의 미입력 필터는 의미가 없다.
              patchParams({ cols: e.target.value as ColumnPreset, empty: null })
            }
          >
            <option value="all">보기: 전체</option>
            {OWNER_PRESETS.map((owner) => (
              <option key={owner} value={owner}>
                보기: {OWNER_LABEL[owner]} 항목
              </option>
            ))}
          </Select>
        )}
        <Select
          value={String(pageSize)}
          onChange={(e) => patchParams({ size: e.target.value })}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}건씩
            </option>
          ))}
        </Select>
        {hasActiveFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetFilters}
          >
            <RotateCcw className="size-3.5" />
            필터 초기화
          </Button>
        ) : null}
        <div className="text-sm text-muted-foreground sm:ml-auto">
          {totalCount === 0
            ? '0건'
            : `전체 ${formatNumber(totalCount)}건 중 ${formatNumber(rangeStart)}–${formatNumber(rangeEnd)}건`}
        </div>
      </div>

      {columnPreset !== 'all' ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {OWNER_LABEL[columnPreset]} 미입력
          </span>
          {emptyCounts.map(({ field, count }) => {
            const key = fieldValueKey(field)
            const active = emptyFilterKey === key
            return (
              <button
                key={field.id}
                type="button"
                onClick={() =>
                  patchParams({ empty: active ? null : key })
                }
                className={cn(
                  'rounded-md border px-2.5 py-1 text-sm transition-colors',
                  active
                    ? 'border-foreground/30 bg-primary text-primary-foreground'
                    : 'border-border hover:bg-muted',
                  count === 0 && !active && 'opacity-50',
                )}
              >
                {field.label}{' '}
                <span className="tabular-nums">{formatNumber(count)}</span>
              </button>
            )
          })}
          <span className="text-xs text-muted-foreground">
            · 표에서 칸을 눌러 바로 입력할 수 있습니다
          </span>
        </div>
      ) : null}

      {saveError ? (
        <p className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {saveError}
        </p>
      ) : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th key={header.id} className="px-4 py-3 font-medium">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {listLoading ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    불러오는 중...
                  </td>
                </tr>
              ) : allStyles.length === 0 && !hasActiveFilters ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12">
                    <div className="mx-auto max-w-md space-y-3 text-center">
                      <p className="text-sm font-medium">
                        등록된 상품이 없습니다
                      </p>
                      <p className="text-sm text-muted-foreground">
                        가져오기에서 양식으로 일괄 등록하거나, 한건 등록으로
                        첫 상품을 추가하세요. 기획안에서 확정한 뒤 상품으로
                        올리는 흐름도 사용할 수 있습니다.
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Link to={`/b/${brand.slug}/data/upload?mode=single`}>
                          <Button type="button" size="sm">
                            한건 등록
                          </Button>
                        </Link>
                        <Link to={`/b/${brand.slug}/data/upload`}>
                          <Button type="button" size="sm" variant="outline">
                            일괄 가져오기
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : pageStyles.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    조건에 맞는 상품이 없습니다.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => {
                  const isActive = activeStyleNo === row.original.styleNo
                  return (
                    <tr
                      key={row.id}
                      onClick={() =>
                        navigate(
                          `${listBasePath}/${encodeURIComponent(row.original.styleNo)}${detailQuery}`,
                        )
                      }
                      className={cn(
                        'cursor-pointer border-b border-border last:border-0 transition-colors',
                        isActive ? 'bg-accent/60' : 'hover:bg-muted/40',
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {totalCount > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {safePage} / {formatNumber(totalPages)} 페이지
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="첫 페이지"
                disabled={safePage <= 1}
                onClick={() =>
                  patchParams({ page: '1' }, { resetPage: false })
                }
              >
                <ChevronsLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="이전 페이지"
                disabled={safePage <= 1}
                onClick={() =>
                  patchParams(
                    { page: String(safePage - 1) },
                    { resetPage: false },
                  )
                }
              >
                <ChevronLeft className="size-4" />
              </Button>
              {pageItems.map((item, index) =>
                item === 'ellipsis' ? (
                  <span
                    key={`ellipsis-${index}`}
                    className="px-2 text-sm text-muted-foreground"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={item}
                    type="button"
                    variant={item === safePage ? 'default' : 'outline'}
                    size="sm"
                    className="min-w-8 px-2"
                    onClick={() =>
                      patchParams(
                        { page: String(item) },
                        { resetPage: false },
                      )
                    }
                  >
                    {item}
                  </Button>
                ),
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="다음 페이지"
                disabled={safePage >= totalPages}
                onClick={() =>
                  patchParams(
                    { page: String(safePage + 1) },
                    { resetPage: false },
                  )
                }
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="마지막 페이지"
                disabled={safePage >= totalPages}
                onClick={() =>
                  patchParams(
                    { page: String(totalPages) },
                    { resetPage: false },
                  )
                }
              >
                <ChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Outlet />
    </div>
  )
}

/** 부서 화면 — 전체 상품 표를 그 부서 항목으로 고정해서 보여 준다. */
export function DepartmentProductsPage() {
  const { owner } = useParams()
  if (!owner || !OWNER_PRESETS.includes(owner as (typeof OWNER_PRESETS)[number])) {
    return <Navigate to=".." replace />
  }
  return <ProductsPage lockedOwner={owner as FieldOwner} />
}
