import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Boxes,
  CalendarRange,
  LayoutGrid,
  Lightbulb,
  Palette,
  PenLine,
  ScanBarcode,
  Shirt,
  Store,
} from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  getProductDrafts,
  getSeasonsByBrand,
  getStylesByBrand,
} from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { HomeScheduleBoard } from './HomeScheduleBoard'

const shortcuts = [
  {
    to: 'products',
    label: '전체 상품',
    description: '품번이 부여된 상품 마스터',
    icon: Shirt,
  },
  {
    to: 'drafts',
    label: '기획안',
    description: '출시 전 기획 시트',
    icon: Lightbulb,
  },
  {
    to: 'work/planning',
    label: '기획 · 상품 정보',
    description: '필요한 상품만 불러 기획 항목 입력',
    icon: PenLine,
  },
  {
    to: 'work/design',
    label: '디자인 · 상품 정보',
    description: '필요한 상품만 불러 디자인 항목 입력',
    icon: Palette,
  },
  {
    to: 'work/md',
    label: 'MD · 상품 정보',
    description: '필요한 상품만 불러 MD 항목 입력',
    icon: LayoutGrid,
  },
  {
    to: 'work/logistics',
    label: '물류 · 상품 정보',
    description: '필요한 상품만 불러 물류 항목 입력',
    icon: Boxes,
  },
  {
    to: 'barcodes',
    label: '88바코드 관리',
    description: '회사에서 발급한 88코드',
    icon: ScanBarcode,
  },
  {
    to: 'usage-codes',
    label: '출고업체별 바코드',
    description: '판매처 코드 연결',
    icon: Store,
  },
] as const

export function BrandHomePage() {
  const { brand } = useBrand()

  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'products'],
    queryFn: () => getStylesByBrand(brand.id),
  })
  const draftsQuery = useQuery({
    queryKey: ['product-drafts', brand.id],
    queryFn: () => getProductDrafts(brand.id),
  })
  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })

  const loading =
    stylesQuery.isLoading || draftsQuery.isLoading || seasonsQuery.isLoading
  const styleCount = stylesQuery.data?.length ?? 0
  const draftCount = draftsQuery.data?.length ?? 0
  const seasonCount = seasonsQuery.data?.length ?? 0
  const needsSeason = !loading && seasonCount === 0

  return (
    <div>
      <PageHeader
        title="홈"
        description={`${brand.name} 작업장입니다. 아래에서 업무로 바로 이동하세요.`}
      />

      <div className="mb-8 flex items-start gap-4">
        <BrandAvatar
          brand={brand}
          className="size-14 rounded-xl"
          textClassName="text-sm"
        />
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">
            {brand.name}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {brand.nameKo}
            {brand.foundedYear ? ` · est. ${brand.foundedYear}` : null}
          </p>
          {brand.description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {brand.description}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">상품</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {loading ? '—' : formatNumber(styleCount)}
          </div>
        </div>
        <div className="rounded-lg border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">기획안</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {loading ? '—' : formatNumber(draftCount)}
          </div>
        </div>
        <div className="rounded-lg border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">출시 기획</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {loading ? '—' : formatNumber(seasonCount)}
          </div>
        </div>
      </div>

      {needsSeason ? (
        <Card className="mb-8 border-accent">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
                <CalendarRange className="size-5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold">출시 기획부터 시작하세요</h3>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  상품·기획안·가져오기는 출시 기획이 있어야 합니다. SS, 홀리데이
                  등 출시 묶음을 먼저 만든 뒤 기획안과 상품을 등록하세요.
                </p>
              </div>
            </div>
            <Link to={`/b/${brand.slug}/settings/seasons`} className="shrink-0">
              <Button type="button">출시 기획 만들기</Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <HomeScheduleBoard events={[]} />

      <h3 className="mb-3 text-sm font-medium text-muted-foreground">바로가기</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {shortcuts.map(({ to, label, description, icon: Icon }) => (
          <Link
            key={to}
            to={`/b/${brand.slug}/${to}`}
            className="group flex items-start gap-3 rounded-lg border border-border px-3 py-3 transition-colors hover:bg-muted/50"
          >
            <span className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground transition-colors group-hover:text-foreground">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {description}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
