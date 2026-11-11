import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { FilterBar } from '@/components/ui/filter-bar'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { readWarehouseFixedLocations, type FixedLocationRow } from '@/lib/supabase/warehouse-fixed-locations'

const PAGE_SIZE = 50

export function WarehouseFixedLocationsPanel({ brandId }: { brandId: string }) {
  const { session } = useAuth()
  return <FixedLocationList key={session?.user.id} brandId={brandId} />
}

function FixedLocationList({ brandId }: { brandId: string }) {
  const [rows, setRows] = useState<FixedLocationRow[] | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const readSheet = useMutation({
    mutationFn: () => readWarehouseFixedLocations(brandId),
    onSuccess: (nextRows) => {
      setRows(nextRows)
      setPage(1)
    },
  })

  const term = search.trim().toLowerCase()
  const filteredRows = rows?.filter(({ productName, location }) =>
    productName.toLowerCase().includes(term) || location.toLowerCase().includes(term),
  )
  const pageCount = Math.max(1, Math.ceil((filteredRows?.length ?? 0) / PAGE_SIZE))
  const visibleRows = filteredRows?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <FilterBar>
        <Button type="button" disabled={readSheet.isPending} onClick={() => readSheet.mutate()}>
          {readSheet.isPending ? '불러오는 중…' : rows ? '새로 불러오기' : '구글 시트에서 불러오기'}
        </Button>
        {rows ? (
          <Input
            aria-label="상품명 또는 고정 자리 검색"
            placeholder="상품명 또는 고정 자리 검색"
            className="sm:max-w-xs"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
        ) : null}
      </FilterBar>
      {readSheet.isError ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {readSheet.error.message}
          {rows ? ' 마지막으로 불러온 목록을 표시합니다.' : ''}
        </p>
      ) : null}
      {rows === null ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          ‘1+1 이름변경’ 시트에서 상품명과 고정 자리를 불러옵니다.
        </p>
      ) : visibleRows?.length ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm" aria-label="상품별 고정 자리">
              <thead className="bg-primary text-primary-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">상품명</th>
                  <th scope="col" className="w-1/3 px-3 py-2">고정 자리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleRows.map(({ sheetRow, productName, location }) => (
                  <tr key={sheetRow}>
                    <td className="whitespace-pre-wrap px-3 py-2">{productName || '—'}</td>
                    <td className="whitespace-pre-wrap px-3 py-2">{location || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span role="status" className="text-muted-foreground">{filteredRows?.length.toLocaleString()}건</span>
            {pageCount > 1 ? (
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>이전</Button>
                <span>{page} / {pageCount}</span>
                <Button type="button" variant="outline" size="sm" disabled={page === pageCount} onClick={() => setPage(page + 1)}>다음</Button>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          {rows.length ? '검색 결과가 없습니다.' : '시트에 표시할 고정 자리 데이터가 없습니다.'}
        </p>
      )}
    </>
  )
}
