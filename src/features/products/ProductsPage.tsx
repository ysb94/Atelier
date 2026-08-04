import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Link } from 'react-router-dom'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { getSeasonsByBrand, getStylesByBrand } from '@/lib/api'
import {
  SEASON_STATUS_LABEL,
  STYLE_STATUS_LABEL,
  type Style,
  type StyleStatus,
} from '@/lib/types'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'

const columnHelper = createColumnHelper<Style>()

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

export function ProductsPage() {
  const { brand } = useBrand()
  const [seasonId, setSeasonId] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })

  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'products'],
    queryFn: () => getStylesByBrand(brand.id),
  })

  const seasons = useMemo(() => seasonsQuery.data ?? [], [seasonsQuery.data])
  const allStyles = useMemo(() => stylesQuery.data ?? [], [stylesQuery.data])

  // 가져오기에서 매핑되지 않은 컬럼: 브랜드 전체 상품에서 쓰인 원본 헤더 이름을 모은다.
  const customFieldKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const style of allStyles) {
      if (!style.customFields) continue
      for (const key of Object.keys(style.customFields)) keys.add(key)
    }
    return Array.from(keys)
  }, [allStyles])

  const seasonMap = useMemo(
    () => new Map(seasons.map((s) => [s.id, s])),
    [seasons],
  )

  const styles = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return allStyles.filter((style) => {
      if (seasonId !== 'all' && style.seasonId !== seasonId) return false
      if (statusFilter !== 'all' && style.status !== statusFilter) return false
      if (!keyword) return true
      return (
        style.styleNo.toLowerCase().includes(keyword) ||
        style.name.toLowerCase().includes(keyword) ||
        style.category.toLowerCase().includes(keyword)
      )
    })
  }, [allStyles, search, seasonId, statusFilter])

  const selected =
    styles.find((s) => s.id === selectedId) ?? styles[0] ?? null

  const columns = useMemo(
    () => [
      columnHelper.accessor('styleNo', {
        header: '품번',
        cell: (info) => (
          <span className="font-medium tabular-nums">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('name', {
        header: '상품명',
      }),
      columnHelper.accessor('category', {
        header: '카테고리',
      }),
      columnHelper.accessor('seasonId', {
        header: '시즌',
        cell: (info) => seasonMap.get(info.getValue())?.code ?? '—',
      }),
      columnHelper.accessor('colors', {
        header: '컬러',
        cell: (info) => info.getValue().join(', '),
      }),
      columnHelper.accessor('retailPrice', {
        header: '소비자가',
        cell: (info) => (
          <span className="tabular-nums">{formatCurrency(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: (info) => (
          <Badge variant={statusVariant(info.getValue())}>
            {STYLE_STATUS_LABEL[info.getValue()]}
          </Badge>
        ),
      }),
      // 가져오기에서 매핑되지 않은 컬럼: 업로드 파일의 원본 헤더 이름을 그대로 컬럼명으로 쓴다.
      ...customFieldKeys.map((key) =>
        columnHelper.accessor((row) => row.customFields?.[key] ?? '—', {
          id: `custom:${key}`,
          header: key,
        }),
      ),
    ],
    [seasonMap, customFieldKeys],
  )

  const table = useReactTable({
    data: styles,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div>
      <PageHeader
        title="전체 상품"
        description={`${brand.name} 브랜드의 상품 마스터입니다. 부서별 정보는 이 상품을 기준으로 연결됩니다.`}
        actions={
          <Link to={`/b/${brand.slug}/upload?mode=single`}>
            <Button type="button">+ 상품 등록</Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="sm:max-w-xs"
          placeholder="품번, 상품명 검색..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setSelectedId(null)
          }}
        />
        <Select
          value={seasonId}
          onChange={(e) => {
            setSeasonId(e.target.value)
            setSelectedId(null)
          }}
        >
          <option value="all">전체 시즌</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {SEASON_STATUS_LABEL[s.status]}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setSelectedId(null)
          }}
        >
          <option value="all">전체 상태</option>
          {(Object.keys(STYLE_STATUS_LABEL) as StyleStatus[]).map((status) => (
            <option key={status} value={status}>
              {STYLE_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
        <div className="text-sm text-muted-foreground sm:ml-auto">
          {formatNumber(styles.length)}건
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
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
                {stylesQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      불러오는 중...
                    </td>
                  </tr>
                ) : styles.length === 0 ? (
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
                    const isActive =
                      (selectedId ?? styles[0]?.id) === row.original.id
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedId(row.original.id)}
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
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              상품 상세
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                선택한 상품이 없습니다.
              </p>
            ) : (
              <div className="space-y-4">
                <div
                  className="flex h-36 items-end rounded-lg p-4 text-white"
                  style={{ backgroundColor: selected.thumbnailColor }}
                >
                  <div>
                    <div className="text-xs opacity-80">{selected.styleNo}</div>
                    <div className="text-lg font-semibold">{selected.name}</div>
                  </div>
                </div>

                <section className="space-y-2 text-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    기본 정보
                  </h3>
                  <DetailRow label="카테고리" value={selected.category} />
                  <DetailRow
                    label="시즌"
                    value={seasonMap.get(selected.seasonId)?.code ?? '—'}
                  />
                  <DetailRow
                    label="성별"
                    value={
                      selected.gender === 'W'
                        ? '여성'
                        : selected.gender === 'M'
                          ? '남성'
                          : '유니섹스'
                    }
                  />
                  <DetailRow
                    label="컬러웨이"
                    value={selected.colors.join(', ')}
                  />
                  <DetailRow
                    label="상태"
                    value={STYLE_STATUS_LABEL[selected.status]}
                  />
                </section>

                <section className="space-y-2 text-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    담당
                  </h3>
                  <DetailRow label="기획" value={selected.planner ?? '—'} />
                  <DetailRow label="디자인" value={selected.designer ?? '—'} />
                </section>

                <section className="space-y-2 text-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    가격 · 수량
                  </h3>
                  <DetailRow
                    label="기획수량"
                    value={formatNumber(selected.plannedQty)}
                  />
                  <DetailRow
                    label="목표원가"
                    value={formatCurrency(selected.targetCost)}
                  />
                  <DetailRow
                    label="소비자가"
                    value={formatCurrency(selected.retailPrice)}
                  />
                </section>

                {selected.description ? (
                  <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    {selected.description}
                  </p>
                ) : null}

                {selected.customFields &&
                Object.keys(selected.customFields).length > 0 ? (
                  <section className="space-y-2 text-sm">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      업로드 원본 컬럼
                    </h3>
                    {Object.entries(selected.customFields).map(
                      ([key, value]) => (
                        <DetailRow key={key} label={key} value={value} />
                      ),
                    )}
                  </section>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}
