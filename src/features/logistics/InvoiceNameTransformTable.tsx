import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type {
  InvoiceNameMatchStatus,
  InvoiceNameTransformRow,
} from '@/lib/invoice/name-transform'
import { cn, formatNumber } from '@/lib/utils'

const PAGE_SIZES = [50, 100, 200] as const

type StatusFilter = 'all' | InvoiceNameMatchStatus

const STATUS_META: Record<
  InvoiceNameMatchStatus,
  {
    label: string
    variant: 'success' | 'default' | 'warning' | 'danger'
  }
> = {
  renamed: { label: '공식명 변경', variant: 'success' },
  exception: { label: '예외 코드', variant: 'default' },
  unmapped_code: { label: '코드 미등록', variant: 'danger' },
  missing_code: { label: '코드 없음', variant: 'warning' },
}

const STATUS_DESCRIPTION: Record<InvoiceNameMatchStatus, string> = {
  renamed: 'DB에 저장된 상품업체 공식 상품명을 적용함',
  exception: '등록된 예외 코드라 원본 품목명을 유지함',
  unmapped_code: '자체품번코드는 있지만 DB 기준이 없음',
  missing_code: '원본 행에 자체품번코드가 없음',
}

function searchableText(row: InvoiceNameTransformRow): string {
  return [
    row.source.rowNumber,
    row.source.ownProductCode,
    row.source.productName,
    row.source.itemName,
    row.transformedName,
  ]
    .join(' ')
    .toLocaleLowerCase('ko-KR')
}

export function InvoiceNameTransformTable({
  rows,
}: {
  rows: InvoiceNameTransformRow[]
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(50)

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    return rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false
      return !query || searchableText(row).includes(query)
    })
  }, [rows, search, status])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const startIndex = (safePage - 1) * pageSize
  const pageRows = filteredRows.slice(startIndex, startIndex + pageSize)

  useEffect(() => {
    setSearch('')
    setStatus('all')
    setPage(1)
  }, [rows])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <div>
      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h3 className="text-sm font-medium">
            자체품번코드 변환 결과 전체 보기
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            원본을 덮어쓰지 않고 공식명 변경·예외·미등록 상태를 행마다
            표시합니다.
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
              placeholder="코드·원본명·변환명 검색"
              className="pl-8"
            />
          </div>
          <Select
            aria-label="자체품번코드 처리 상태 필터"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter)
              setPage(1)
            }}
          >
            <option value="all">전체 단계</option>
            <option value="renamed">공식명 변경</option>
            <option value="exception">예외 코드</option>
            <option value="unmapped_code">코드 미등록</option>
            <option value="missing_code">코드 없음</option>
          </Select>
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
        <table className="w-full min-w-[1500px] text-left text-xs">
          <thead className="sticky top-0 z-20 bg-muted">
            <tr>
              <th className="sticky left-0 z-30 min-w-18 border-r border-border bg-muted px-3 py-2.5 font-medium">
                원본 행
              </th>
              <th className="min-w-40 px-3 py-2.5 font-medium">자체품번코드</th>
              <th className="min-w-72 px-3 py-2.5 font-medium">원본 품목명</th>
              <th className="min-w-64 px-3 py-2.5 font-medium">내품명</th>
              <th className="min-w-64 px-3 py-2.5 font-medium">변환 품목명</th>
              <th className="min-w-40 px-3 py-2.5 font-medium">적용 단계</th>
              <th className="min-w-72 px-3 py-2.5 font-medium">처리 설명</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const meta = STATUS_META[row.status]
              return (
                <tr
                  key={row.source.rowNumber}
                  className={cn(
                    'border-t border-border align-top',
                    row.status === 'unmapped_code' && 'bg-danger/5',
                    row.status === 'missing_code' && 'bg-warning/5',
                  )}
                >
                  <td className="sticky left-0 z-10 border-r border-border bg-card px-3 py-3 text-muted-foreground">
                    {row.source.rowNumber}
                  </td>
                  <td className="px-3 py-3">
                    {row.source.ownProductCode || '-'}
                  </td>
                  <td className="whitespace-normal break-words px-3 py-3">
                    {row.source.productName || '-'}
                  </td>
                  <td className="whitespace-normal break-words px-3 py-3 text-muted-foreground">
                    {row.source.itemName || '-'}
                  </td>
                  <td
                    className={cn(
                      'whitespace-normal break-words px-3 py-3 font-medium',
                      row.status === 'unmapped_code' && 'text-danger',
                    )}
                  >
                    {row.transformedName || '-'}
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </td>
                  <td className="whitespace-normal break-words px-3 py-3 text-muted-foreground">
                    {STATUS_DESCRIPTION[row.status]}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          필터 결과 {formatNumber(filteredRows.length)}행 ·{' '}
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
