import { Package, QrCode, Truck } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useBrand } from '@/components/layout/brand-context'
import { SingleBrandOrList } from '@/components/layout/SingleBrandOrList'
import { CompanyWarehouseList } from '@/features/workspace/company-operation-lists'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn } from '@/lib/utils'
import { WarehouseInventoryPanel } from './WarehouseInventoryPanel'
import { WarehouseQrPanel } from './WarehouseQrPanel'
import { WarehouseSlotSettingsPanel } from './WarehouseSlotSettingsPanel'

type WarehouseView = 'box' | 'outbound' | 'qr'
type WarehousePanel = 'stock' | 'slots'

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
  {
    value: 'qr',
    label: 'QR 생성',
    description: '아이라벨용 자리 엑셀을 만듭니다',
    detail:
      '자리번호를 자리·QR 두 열 엑셀로 내려받습니다. QR 그림은 아이라벨에서 용지에 맞춰 만듭니다.',
    icon: QrCode,
  },
]

function isWarehouseView(value: string | null): value is WarehouseView {
  return WAREHOUSE_VIEWS.some((item) => item.value === value)
}

function isWarehousePanel(value: string | null): value is WarehousePanel {
  return value === 'stock' || value === 'slots'
}

export function WarehousePage() {
  useRenderWatch('WarehousePage')
  const { brand } = useBrand()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: WarehouseView = isWarehouseView(requestedView)
    ? requestedView
    : 'box'
  const active = WAREHOUSE_VIEWS.find((item) => item.value === activeView)!
  const requestedPanel = searchParams.get('panel')
  const activePanel: WarehousePanel =
    activeView !== 'qr' && isWarehousePanel(requestedPanel)
      ? requestedPanel
      : 'stock'
  const sectionTabs = [
    { value: 'stock' as const, label: active.label },
    { value: 'slots' as const, label: `${active.label} 자리 설정` },
  ]

  function selectView(view: WarehouseView) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (view === 'box') next.delete('view')
      else next.set('view', view)
      if (view === 'qr') next.delete('panel')
      return next
    })
  }

  function selectPanel(panel: WarehousePanel) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (panel === 'stock') next.delete('panel')
      else next.set('panel', panel)
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title="창고 관리"
        description={`${brand.name} 박스 단위 보관과 피킹용 낱개 보관을 나눠 보는 작업 공간입니다.`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
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

      <Card className="overflow-hidden shadow-none">
        {activeView !== 'qr' ? (
          <div
            role="tablist"
            aria-label={`${active.label} 작업`}
            className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted/40 px-2 pt-2"
          >
            {sectionTabs.map((tab) => {
              const selected = tab.value === activePanel
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectPanel(tab.value)}
                  className={cn(
                    'flex max-w-[16rem] shrink-0 items-center rounded-t-md border border-b-0 px-2.5 py-1.5 text-sm transition-colors',
                    selected
                      ? 'border-border bg-background text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground',
                  )}
                >
                  <span className="truncate">{tab.label}</span>
                </button>
              )
            })}
          </div>
        ) : null}
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>
              {activePanel === 'slots'
                ? `${active.label} 자리 설정`
                : active.label}
            </CardTitle>
            <CardDescription className="mt-1">
              {activePanel === 'slots'
                ? `${active.label}에 속하는 자리번호를 등록합니다. 등록된 출고창고 자리만 입고 시트에서 출고창고로 분류됩니다.`
                : active.detail}
            </CardDescription>
          </div>
          {activeView === 'qr' || activePanel === 'slots' ? null : (
            <Badge variant="warning">연습 데이터</Badge>
          )}
        </CardHeader>
        <CardContent>
          {activeView === 'qr' ? (
            <WarehouseQrPanel brandName={brand.name} />
          ) : activePanel === 'slots' ? (
            <WarehouseSlotSettingsPanel
              brandId={brand.id}
              warehouseLabel={active.label}
              zone={activeView === 'box' ? 'box_storage' : 'picking'}
            />
          ) : (
            <WarehouseInventoryPanel
              brandId={brand.id}
              brandName={brand.name}
              view={activeView}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function CompanyWarehousePage() {
  return (
    <SingleBrandOrList list={<CompanyWarehouseList />}>
      <WarehousePage />
    </SingleBrandOrList>
  )
}
