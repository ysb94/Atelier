import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
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

export function PlanningPage() {
  const { brand } = useBrand()
  const [seasonId, setSeasonId] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })

  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, seasonId],
    queryFn: () =>
      getStylesByBrand(brand.id, seasonId === 'all' ? undefined : seasonId),
  })

  const styles = stylesQuery.data ?? []
  const seasons = useMemo(() => seasonsQuery.data ?? [], [seasonsQuery.data])
  const selected = styles.find((s) => s.id === selectedId) ?? styles[0] ?? null

  const seasonMap = useMemo(
    () => new Map(seasons.map((s) => [s.id, s])),
    [seasons],
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor('styleNo', {
        header: '품번',
        cell: (info) => (
          <span className="font-medium tabular-nums">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('name', {
        header: '스타일명',
        cell: (info) => info.getValue(),
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
      columnHelper.accessor('plannedQty', {
        header: '기획수량',
        cell: (info) => (
          <span className="tabular-nums">{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor('targetCost', {
        header: '목표원가',
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
    ],
    [seasonMap],
  )

  const table = useReactTable({
    data: styles,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div>
      <PageHeader
        title="기획"
        description={`${brand.name} 시즌 라인업과 스타일 기획을 관리합니다.`}
        actions={
          <>
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
            <Button type="button" disabled>
              + 스타일 추가
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
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
                      스타일이 없습니다.
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
              스타일 상세
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                선택한 스타일이 없습니다.
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
                <dl className="space-y-2 text-sm">
                  <DetailRow label="카테고리" value={selected.category} />
                  <DetailRow
                    label="시즌"
                    value={seasonMap.get(selected.seasonId)?.code ?? '—'}
                  />
                  <DetailRow
                    label="컬러웨이"
                    value={selected.colors.join(', ')}
                  />
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
                  <DetailRow
                    label="상태"
                    value={STYLE_STATUS_LABEL[selected.status]}
                  />
                  <DetailRow label="기획" value={selected.planner ?? '—'} />
                  <DetailRow label="디자인" value={selected.designer ?? '—'} />
                </dl>
                {selected.description ? (
                  <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    {selected.description}
                  </p>
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
