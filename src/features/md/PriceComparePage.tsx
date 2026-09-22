import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList, formatCurrency } from '@/lib/utils'

type CompareRow = {
  styleNo: string
  name: string
  ourPrice: number
  malls: { label: string; price: number | null }[]
}

const SAMPLE_ROWS: CompareRow[] = [
  {
    styleNo: 'M24011',
    name: '미니 토트백',
    ourPrice: 89000,
    malls: [
      { label: '29CM', price: 92000 },
      { label: '무신사', price: 89000 },
      { label: '지그재그', price: 86000 },
    ],
  },
  {
    styleNo: 'M24018',
    name: '크로스 버킷백',
    ourPrice: 128000,
    malls: [
      { label: '29CM', price: 128000 },
      { label: '무신사', price: 134000 },
      { label: '지그재그', price: null },
    ],
  },
  {
    styleNo: 'M24027',
    name: '나일론 숄더',
    ourPrice: 79000,
    malls: [
      { label: '29CM', price: 74000 },
      { label: '무신사', price: 79000 },
      { label: '지그재그', price: 79000 },
    ],
  },
]

const MALL_FILTERS = ['전체', '29CM', '무신사', '지그재그'] as const

function lowestMallPrice(row: CompareRow) {
  const prices = row.malls.map((mall) => mall.price).filter((price): price is number => price != null)
  return prices.length ? Math.min(...prices) : null
}

function gapBadge(ourPrice: number, lowest: number | null) {
  if (lowest == null) return <Badge variant="muted">비교가 없음</Badge>
  const gap = ourPrice - lowest
  if (gap === 0) return <Badge variant="outline">동일</Badge>
  if (gap > 0) return <Badge variant="danger">+{formatCurrency(gap)}</Badge>
  return <Badge variant="success">{formatCurrency(gap)}</Badge>
}

export function PriceComparePage() {
  useRenderWatch('PriceComparePage')
  const [query, setQuery] = useState('')
  const [mall, setMall] = useState<(typeof MALL_FILTERS)[number]>('전체')

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return SAMPLE_ROWS.filter((row) => {
      const matchesQuery = !keyword
        || row.styleNo.toLowerCase().includes(keyword)
        || row.name.toLowerCase().includes(keyword)
      const matchesMall = mall === '전체' || row.malls.some((item) => item.label === mall && item.price != null)
      return matchesQuery && matchesMall
    })
  }, [mall, query])
  const visible = rows.length ? rows : emptyList<CompareRow>()

  return (
    <div>
      <PageHeader
        title="가격 비교"
        description="자사 판매가와 비교몰 가격을 한 화면에서 봅니다. 지금은 화면 구성만 있으며 실제 수집·저장은 없습니다."
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="M번호 또는 품목명"
          aria-label="가격 비교 검색"
          className="sm:max-w-72"
        />
        <Select
          value={mall}
          aria-label="비교몰"
          onChange={(event) => setMall(event.target.value as (typeof MALL_FILTERS)[number])}
        >
          {MALL_FILTERS.map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">M번호</th>
                <th className="px-4 py-3 font-medium">품목명</th>
                <th className="px-4 py-3 font-medium">자사 판매가</th>
                <th className="px-4 py-3 font-medium">29CM</th>
                <th className="px-4 py-3 font-medium">무신사</th>
                <th className="px-4 py-3 font-medium">지그재그</th>
                <th className="px-4 py-3 font-medium">최저가 대비</th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? visible.map((row) => (
                <tr key={row.styleNo} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{row.styleNo}</td>
                  <td className="px-4 py-3">{row.name}</td>
                  <td className="px-4 py-3">{formatCurrency(row.ourPrice)}</td>
                  {row.malls.map((item) => (
                    <td key={item.label} className="px-4 py-3 text-muted-foreground">
                      {item.price == null ? '—' : formatCurrency(item.price)}
                    </td>
                  ))}
                  <td className="px-4 py-3">{gapBadge(row.ourPrice, lowestMallPrice(row))}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    조건에 맞는 상품이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
