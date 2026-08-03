import { useMemo } from 'react'
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
import { Card } from '@/components/ui/card'
import { getMdSummariesByBrand } from '@/lib/api'
import { STYLE_STATUS_LABEL, type MdSummary, type Style } from '@/lib/types'
import { formatCurrency, formatNumber } from '@/lib/utils'

type Row = MdSummary & { style: Style }

const columnHelper = createColumnHelper<Row>()

export function MdPage() {
  const { brand } = useBrand()

  const { data = [], isLoading } = useQuery({
    queryKey: ['md', brand.id],
    queryFn: () => getMdSummariesByBrand(brand.id),
  })

  const columns = useMemo(
    () => [
      columnHelper.accessor((r) => r.style.styleNo, {
        id: 'styleNo',
        header: '품번',
        cell: (info) => (
          <span className="font-medium tabular-nums">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor((r) => r.style.name, {
        id: 'name',
        header: '스타일',
      }),
      columnHelper.accessor((r) => r.style.status, {
        id: 'status',
        header: '상태',
        cell: (info) => (
          <Badge variant="outline">{STYLE_STATUS_LABEL[info.getValue()]}</Badge>
        ),
      }),
      columnHelper.accessor('orderQty', {
        header: '발주수량',
        cell: (info) => (
          <span className="tabular-nums">{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor('soldQty', {
        header: '판매수량',
        cell: (info) => (
          <span className="tabular-nums">{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor('sellThrough', {
        header: '소진율',
        cell: (info) => (
          <span className="tabular-nums">
            {(info.getValue() * 100).toFixed(0)}%
          </span>
        ),
      }),
      columnHelper.accessor('marginRate', {
        header: '마진',
        cell: (info) => (
          <span className="tabular-nums">
            {(info.getValue() * 100).toFixed(0)}%
          </span>
        ),
      }),
      columnHelper.accessor((r) => r.style.retailPrice, {
        id: 'price',
        header: '소비자가',
        cell: (info) => (
          <span className="tabular-nums">{formatCurrency(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor('channel', {
        header: '채널',
      }),
      columnHelper.accessor('reorderFlag', {
        header: '리오더',
        cell: (info) =>
          info.getValue() ? (
            <Badge variant="success">추천</Badge>
          ) : (
            <Badge variant="muted">—</Badge>
          ),
      }),
    ],
    [],
  )

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const totalOrder = data.reduce((sum, r) => sum + r.orderQty, 0)
  const totalSold = data.reduce((sum, r) => sum + r.soldQty, 0)
  const reorderCount = data.filter((r) => r.reorderFlag).length

  return (
    <div>
      <PageHeader
        title="MD"
        description="발주 · 판매 실적 · 리오더 판단 요약"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="총 발주수량" value={formatNumber(totalOrder)} />
        <SummaryCard label="총 판매수량" value={formatNumber(totalSold)} />
        <SummaryCard
          label="리오더 추천"
          value={`${reorderCount} 스타일`}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
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
              {isLoading ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    불러오는 중...
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    MD 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0 hover:bg-muted/40"
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </Card>
  )
}
