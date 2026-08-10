import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Download, Settings2, Upload } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  getBrandFields,
  getSeasonsByBrand,
  getStylesFiltered,
  getStylesPage,
  type StyleFilter,
} from '@/lib/api'
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
  type Style,
  type StyleStatus,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { SheetTable, type SheetRow } from './SheetTable'

const DATA_OWNERS: DataSheetOwner[] = [
  'planning',
  'design',
  'md',
  'logistics',
  'all',
]

const PAGE_SIZES = [50, 100, 200] as const

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
  seasonLabel?: string,
): SheetRow {
  const values: Record<string, string> = {}
  for (const column of columns) {
    values[fieldValueKey(column)] = getStyleFieldDisplay(style, column, {
      // 읽기 전용 표라서 코드보다 사람이 읽는 이름을 보여준다.
      seasonCode: seasonLabel,
    })
  }
  return { id: style.id, styleNo: style.styleNo, values }
}

export function DataSheetPage() {
  const { brand } = useBrand()
  const { owner: ownerParam } = useParams()
  const owner = parseOwner(ownerParam)
  const [searchParams, setSearchParams] = useSearchParams()

  const search = searchParams.get('q') ?? ''
  const seasonId = searchParams.get('season') ?? 'all'
  const statusFilter = searchParams.get('status') ?? 'all'
  const pageSize = parsePageSize(searchParams.get('size'))
  const page = parsePage(searchParams.get('page'))

  const [banner, setBanner] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // 입력할 때마다 요청이 나가지 않게 잠깐 기다린다.
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const filter = useMemo<StyleFilter>(
    () => ({
      seasonId: seasonId === 'all' ? undefined : seasonId,
      status:
        statusFilter === 'all' ? undefined : (statusFilter as StyleStatus),
      search: debouncedSearch.trim() || undefined,
    }),
    [seasonId, statusFilter, debouncedSearch],
  )

  const fieldsQuery = useQuery({
    queryKey: ['brand-fields', brand.id],
    queryFn: () => getBrandFields(brand.id),
  })
  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })
  const pageQuery = useQuery({
    queryKey: ['styles-page', brand.id, filter, page, pageSize],
    queryFn: () => getStylesPage(brand.id, filter, (page - 1) * pageSize, pageSize),
    // 페이지를 넘길 때 표가 비면서 깜빡이지 않게 이전 결과를 유지한다.
    placeholderData: keepPreviousData,
  })

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data])
  const seasons = useMemo(() => seasonsQuery.data ?? [], [seasonsQuery.data])
  const hasSeasons = seasons.length > 0

  const columns = useMemo(
    () => (owner ? columnsForSheet(fields, owner) : []),
    [fields, owner],
  )

  const seasonById = useMemo(
    () => new Map(seasons.map((s) => [s.id, s])),
    [seasons],
  )

  const total = pageQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const rows = useMemo(
    () =>
      (pageQuery.data?.rows ?? []).map((style) => {
        const season = seasonById.get(style.seasonId)
        return styleToRow(
          style,
          columns,
          season ? formatSeasonLabel(season) : undefined,
        )
      }),
    [pageQuery.data, columns, seasonById],
  )

  useEffect(() => {
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
  }, [page, totalPages, setSearchParams])

  function patchParams(patch: Record<string, string | null>) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === '' || value === 'all') next.delete(key)
        else if (key === 'size' && value === '100') next.delete(key)
        else if (key === 'page' && value === '1') next.delete(key)
        else next.set(key, value)
      }
      // 조건이 바뀌면 1페이지부터 다시 본다.
      if (!('page' in patch)) next.delete('page')
      return next
    })
  }

  async function handleExport() {
    if (!owner) return
    try {
      setExporting(true)
      setBanner(null)
      const styles = await getStylesFiltered(brand.id, filter)
      await downloadStylesExport({
        brandName: brand.name,
        owner,
        fields,
        styles,
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
    return <Navigate to="../data/all" replace />
  }

  const loading =
    fieldsQuery.isLoading || seasonsQuery.isLoading || pageQuery.isLoading
  const hasFilter =
    Boolean(filter.search) || Boolean(filter.seasonId) || Boolean(filter.status)

  const pageTitle =
    owner === 'all' ? '전체 상품' : `${sheetOwnerLabel(owner)} 시트`
  const pageDescription =
    owner === 'all'
      ? '상품 데이터를 엑셀처럼 한눈에 보는 표입니다. 열 범위로 부서를 좁히고, 값은 내보내기·일괄 업로드로 고칩니다.'
      : `${sheetOwnerLabel(owner)} 항목만 모아 봅니다. 값은 내보내기로 받아 엑셀에서 고친 뒤 일괄 업로드로 되돌립니다.`

  return (
    <div className="-mx-1">
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        actions={
          <>
            <Link to={`/b/${brand.slug}/settings/fields`}>
              <Button type="button" variant="outline" size="sm">
                <Settings2 className="size-3.5" />
                항목 관리
              </Button>
            </Link>
            <Link to={`/b/${brand.slug}/data/upload`}>
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
              to={`/b/${brand.slug}/data/${item}?${searchParams.toString()}`}
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
          <Input
            className="h-8 max-w-[14rem] bg-background text-sm"
            placeholder="품번·상품명 검색"
            value={search}
            onChange={(e) => patchParams({ q: e.target.value || null })}
          />
          <Select
            className="h-8 bg-background text-sm"
            value={seasonId}
            onChange={(e) => patchParams({ season: e.target.value })}
          >
            <option value="all">전체 출시 기획</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {formatSeasonLabel(s)}
                {s.status === 'archived' ? ' · 마감' : ''}
              </option>
            ))}
          </Select>
          <Select
            className="h-8 bg-background text-sm"
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
            className="h-8 bg-background text-sm"
            value={String(pageSize)}
            onChange={(e) => patchParams({ size: e.target.value })}
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
          {pageQuery.isFetching ? ' · 불러오는 중' : ''}
        </span>
      </div>

      <p className="mb-3 text-[11px] text-muted-foreground">
        값을 고치려면 <b className="font-medium">내보내기</b>로 받아 엑셀에서
        편집한 뒤 <b className="font-medium">일괄 업로드</b>에 다시 올리세요.
        품번이 같은 행만 덮어쓰고, <code>_작업</code> 열에 &quot;삭제&quot;라고
        적은 행은 지워집니다. 열을 늘리거나 이름을 바꾸려면{' '}
        <b className="font-medium">항목 관리</b>를 쓰세요.
      </p>

      {banner ? (
        <p className="mb-3 text-sm text-muted-foreground">{banner}</p>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          불러오는 중...
        </p>
      ) : total === 0 && !hasFilter ? (
        <Card>
          <CardContent className="space-y-4 px-6 py-12 text-center">
            <p className="text-sm font-medium">시트에 표시할 상품이 없습니다</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              일괄 업로드로 엑셀 파일을 올려 상품을 채우세요. 시즌 값이 없는
              상품은 &quot;기획 미지정&quot;에 담깁니다.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link to={`/b/${brand.slug}/data/upload`}>
                <Button type="button" size="sm">
                  <Upload className="size-3.5" />
                  일괄 업로드
                </Button>
              </Link>
              {!hasSeasons ? (
                <Link to={`/b/${brand.slug}/settings/seasons`}>
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
          showOwnerGroups={owner === 'all'}
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
    </div>
  )
}
