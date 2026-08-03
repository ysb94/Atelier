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
import { getInventoryByBrand, getMovementsByBrand } from '@/lib/api'
import {
  MOVEMENT_TYPE_LABEL,
  type InventoryItem,
  type StockMovement,
  type Style,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'

type InvRow = InventoryItem & { style: Style }
type MvRow = StockMovement & { style: Style }

const invHelper = createColumnHelper<InvRow>()
const mvHelper = createColumnHelper<MvRow>()

export function LogisticsPage() {
  const { brand } = useBrand()

  const invQuery = useQuery({
    queryKey: ['inventory', brand.id],
    queryFn: () => getInventoryByBrand(brand.id),
  })

  const mvQuery = useQuery({
    queryKey: ['movements', brand.id],
    queryFn: () => getMovementsByBrand(brand.id),
  })

  const inventory = invQuery.data ?? []
  const movements = mvQuery.data ?? []

  const invColumns = useMemo(
    () => [
      invHelper.accessor((r) => r.style.styleNo, {
        id: 'styleNo',
        header: '품번',
        cell: (info) => (
          <span className="font-medium tabular-nums">{info.getValue()}</span>
        ),
      }),
      invHelper.accessor((r) => r.style.name, {
        id: 'name',
        header: '스타일',
      }),
      invHelper.accessor('warehouse', {
        header: '창고/매장',
      }),
      invHelper.accessor('onHand', {
        header: '보유',
        cell: (info) => (
          <span className="tabular-nums">{formatNumber(info.getValue())}</span>
        ),
      }),
      invHelper.accessor('reserved', {
        header: '예약',
        cell: (info) => (
          <span className="tabular-nums">{formatNumber(info.getValue())}</span>
        ),
      }),
      invHelper.accessor('available', {
        header: '가용',
        cell: (info) => (
          <span className="font-medium tabular-nums">
            {formatNumber(info.getValue())}
          </span>
        ),
      }),
    ],
    [],
  )

  const mvColumns = useMemo(
    () => [
      mvHelper.accessor('date', {
        header: '일자',
        cell: (info) => (
          <span className="tabular-nums">{info.getValue()}</span>
        ),
      }),
      mvHelper.accessor((r) => r.style.styleNo, {
        id: 'styleNo',
        header: '품번',
        cell: (info) => (
          <span className="font-medium tabular-nums">{info.getValue()}</span>
        ),
      }),
      mvHelper.accessor((r) => r.style.name, {
        id: 'name',
        header: '스타일',
      }),
      mvHelper.accessor('type', {
        header: '구분',
        cell: (info) => {
          const t = info.getValue()
          return (
            <Badge
              variant={
                t === 'in'
                  ? 'success'
                  : t === 'out'
                    ? 'danger'
                    : t === 'return'
                      ? 'warning'
                      : 'outline'
              }
            >
              {MOVEMENT_TYPE_LABEL[t]}
            </Badge>
          )
        },
      }),
      mvHelper.accessor('qty', {
        header: '수량',
        cell: (info) => (
          <span className="tabular-nums">{formatNumber(info.getValue())}</span>
        ),
      }),
      mvHelper.accessor('warehouse', {
        header: '위치',
      }),
      mvHelper.accessor('note', {
        header: '비고',
      }),
    ],
    [],
  )

  const invTable = useReactTable({
    data: inventory,
    columns: invColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const mvTable = useReactTable({
    data: movements,
    columns: mvColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const totalOnHand = inventory.reduce((s, i) => s + i.onHand, 0)
  const totalAvailable = inventory.reduce((s, i) => s + i.available, 0)

  return (
    <div>
      <PageHeader
        title="물류"
        description="창고·매장 재고 현황과 입출고 이력"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">총 보유 재고</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {formatNumber(totalOnHand)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">총 가용 재고</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {formatNumber(totalAvailable)}
          </div>
        </Card>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">재고 현황</h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                {invTable.getHeaderGroups().map((hg) => (
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
                {invQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={invColumns.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      불러오는 중...
                    </td>
                  </tr>
                ) : inventory.length === 0 ? (
                  <tr>
                    <td
                      colSpan={invColumns.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      재고 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  invTable.getRowModel().rows.map((row) => (
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
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">
          입출고 이력
        </h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                {mvTable.getHeaderGroups().map((hg) => (
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
                {mvQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={mvColumns.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      불러오는 중...
                    </td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td
                      colSpan={mvColumns.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      이력이 없습니다.
                    </td>
                  </tr>
                ) : (
                  mvTable.getRowModel().rows.map((row) => (
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
      </section>
    </div>
  )
}
