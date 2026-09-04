import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import { cn, formatNumber } from '@/lib/utils'

const PAGE_SIZES = [50, 100, 200] as const

type OrderColumn = {
  key: keyof Omit<SabangnetOrderRow, 'rowNumber'>
  label: string
  personal?: boolean
  align?: 'left' | 'right'
  className?: string
}

const ORDER_COLUMNS: OrderColumn[] = [
  { key: 'productName', label: '품목명', className: 'min-w-72 max-w-96' },
  { key: 'itemName', label: '내품명', className: 'min-w-64 max-w-96' },
  { key: 'quantity', label: '내품수량', align: 'right' },
  { key: 'recipientName', label: '받는분성명', personal: true },
  {
    key: 'recipientPhone',
    label: '받는분전화번호',
    personal: true,
    className: 'min-w-36',
  },
  {
    key: 'recipientOtherPhone',
    label: '받는분기타연락처',
    personal: true,
    className: 'min-w-36',
  },
  { key: 'shippingType', label: '운임구분' },
  {
    key: 'recipientAddress',
    label: '받는분주소',
    personal: true,
    className: 'min-w-96 max-w-140',
  },
  {
    key: 'shippingMessage',
    label: '배송메세지',
    personal: true,
    className: 'min-w-64 max-w-96',
  },
  {
    key: 'customerOrderNo',
    label: '고객주문번호',
    className: 'min-w-40',
  },
  { key: 'mallName', label: '쇼핑몰명', className: 'min-w-32' },
  {
    key: 'orderedAt',
    label: '주문일시',
    className: 'min-w-40',
  },
  {
    key: 'ownProductCode',
    label: '자체품번코드',
    className: 'min-w-32',
  },
]

function searchableText(row: SabangnetOrderRow): string {
  return [
    row.rowNumber,
    row.productName,
    row.itemName,
    row.quantity,
    row.recipientName,
    row.recipientPhone,
    row.recipientOtherPhone,
    row.shippingType,
    row.recipientAddress,
    row.shippingMessage,
    row.customerOrderNo,
    row.mallName,
    row.orderedAt,
    row.ownProductCode,
  ]
    .join(' ')
    .toLocaleLowerCase('ko-KR')
}

export function SabangnetOrderTable({
  rows,
  columnCount,
  sourceRowCount,
  excludedOrderCount = 0,
  excludedRowCount = 0,
}: {
  rows: SabangnetOrderRow[]
  columnCount: number
  sourceRowCount?: number
  excludedOrderCount?: number
  excludedRowCount?: number
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(50)
  const [showPersonalInfo, setShowPersonalInfo] = useState(true)

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    if (!query) return rows
    return rows.filter((row) => searchableText(row).includes(query))
  }, [rows, search])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const startIndex = (safePage - 1) * pageSize
  const pageRows = filteredRows.slice(startIndex, startIndex + pageSize)

  useEffect(() => {
    setSearch('')
    setPage(1)
    setShowPersonalInfo(true)
  }, [rows])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <div>
      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">사방넷 원본 전체 보기</h3>
            <Badge variant="muted">{columnCount}열 인식</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {excludedRowCount > 0
              ? `원본 ${formatNumber(sourceRowCount ?? rows.length + excludedRowCount)}행 · 이전 백업 제외 ${formatNumber(excludedOrderCount)}건 · ${formatNumber(excludedRowCount)}행 / 작업 대상 ${formatNumber(rows.length)}행`
              : `업로드한 ${formatNumber(rows.length)}행 전체를 검색하고 페이지별로 확인할 수 있습니다.`}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="주문번호·상품·수령인·주소 검색"
              className="pl-8"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowPersonalInfo((current) => !current)}
          >
            {showPersonalInfo ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
            {showPersonalInfo ? '개인정보 숨기기' : '개인정보 표시'}
          </Button>
          <Select
            aria-label="페이지당 행 수"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value) as typeof pageSize)
              setPage(1)
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}행
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="max-h-[42rem] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[2300px] text-left text-xs">
          <thead className="sticky top-0 z-20 bg-muted">
            <tr>
              <th className="sticky left-0 z-30 min-w-16 border-r border-border bg-muted px-3 py-2.5 font-medium">
                원본 행
              </th>
              {ORDER_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    'px-3 py-2.5 font-medium',
                    column.className,
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.rowNumber} className="border-t border-border align-top">
                <td className="sticky left-0 z-10 border-r border-border bg-card px-3 py-3 text-muted-foreground">
                  {row.rowNumber}
                </td>
                {ORDER_COLUMNS.map((column) => {
                  const value = row[column.key]
                  const hidden = column.personal && !showPersonalInfo
                  return (
                    <td
                      key={`${row.rowNumber}-${column.key}`}
                      className={cn(
                        'whitespace-normal break-words px-3 py-3',
                        column.className,
                        column.align === 'right' && 'text-right tabular-nums',
                      )}
                    >
                      {hidden ? (
                        <span className="text-muted-foreground">숨김</span>
                      ) : column.key === 'ownProductCode' && !value ? (
                        <Badge variant="warning">없음</Badge>
                      ) : (
                        value || '-'
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {search.trim()
            ? `검색 결과 ${formatNumber(filteredRows.length)}행 · `
            : `전체 ${formatNumber(rows.length)}행 · `}
          {filteredRows.length > 0
            ? `${formatNumber(startIndex + 1)}–${formatNumber(
                Math.min(startIndex + pageRows.length, filteredRows.length),
              )}행 표시`
            : '표시할 행 없음'}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft className="size-4" />
            이전
          </Button>
          <span className="min-w-20 text-center text-xs tabular-nums text-muted-foreground">
            {safePage} / {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage >= pageCount}
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
          >
            다음
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
