import { Package, Truck } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { WarehouseInventoryPanel } from './WarehouseInventoryPanel'

type WarehouseView = 'box' | 'outbound'

const WAREHOUSE_VIEWS: {
  value: WarehouseView
  label: string
  description: string
  detail: string
  icon: typeof Package
}[] = [
  {
    value: 'box',
    label: '박스창고',
    description: '제품을 박스 단위로 보관하는 곳',
    detail:
      '아직 낱개로 풀지 않은 제품을 박스 단위로 모아 둡니다. 대량 입고·보관이 여기서 이뤄집니다.',
    icon: Package,
  },
  {
    value: 'outbound',
    label: '출고창고',
    description: '피킹을 위해 낱개로 나가는 곳',
    detail:
      '출고할 제품을 낱개로 꺼내 두는 곳입니다. 피킹은 여기서 합니다.',
    icon: Truck,
  },
]

function isWarehouseView(value: string | null): value is WarehouseView {
  return WAREHOUSE_VIEWS.some((item) => item.value === value)
}

export function WarehousePage() {
  const { brand } = useBrand()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: WarehouseView = isWarehouseView(requestedView)
    ? requestedView
    : 'box'
  const active = WAREHOUSE_VIEWS.find((item) => item.value === activeView)!

  function selectView(view: WarehouseView) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (view === 'box') next.delete('view')
      else next.set('view', view)
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title="창고 관리"
        description={`${brand.name} 박스 단위 보관과 피킹용 낱개 보관을 나눠 보는 작업 공간입니다.`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {WAREHOUSE_VIEWS.map((item) => {
          const Icon = item.icon
          const selected = item.value === activeView
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={selected}
              onClick={() => selectView(item.value)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                selected
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-muted/20 hover:bg-muted/40',
              )}
            >
              <Icon
                className={cn(
                  'size-4',
                  selected ? 'text-primary' : 'text-muted-foreground',
                )}
              />
              <p className="mt-2 text-sm font-medium">{item.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.description}
              </p>
            </button>
          )
        })}
      </div>

      <Card className="shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{active.label}</CardTitle>
            <CardDescription className="mt-1">{active.detail}</CardDescription>
          </div>
          <Badge variant="warning">연습 데이터</Badge>
        </CardHeader>
        <CardContent>
          <WarehouseInventoryPanel
            brandId={brand.id}
            brandName={brand.name}
            view={activeView}
          />
        </CardContent>
      </Card>
    </div>
  )
}
