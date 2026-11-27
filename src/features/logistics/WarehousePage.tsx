import { useState } from 'react'
import { ListChecks, MapPin, Package, QrCode, Truck } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { BrandScope, useBrand } from '@/components/layout/brand-context'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { CompanyWarehouseList } from '@/features/workspace/company-operation-lists'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { FilterTabs } from '@/components/ui/filter-tabs'
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
import { WarehouseFixedLocationsPanel } from './WarehouseFixedLocationsPanel'
import { WarehouseOrganizationPanel } from './WarehouseOrganizationPanel'
import { WarehousePopularLocationsPanel } from './WarehousePopularLocationsPanel'
import { previousWarehouseOutboundMonth } from './warehouse-organization-outbound'
import { WarehouseQrPanel } from './WarehouseQrPanel'
import { WarehouseQrAuditReviewPanel } from './WarehouseQrAuditReviewPanel'
import { WarehouseSlotSettingsPanel } from './WarehouseSlotSettingsPanel'
import { WarehouseBoxHistoryPanel } from './TemporaryWarehousePanel'
import { WarehouseActivityPanel } from './WarehouseActivityPanel'

type WarehouseView = 'box' | 'outbound' | 'boxes' | 'fixed' | 'qr' | 'organize'
type WarehousePanel = 'stock' | 'slots' | 'qr-audit'

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
    value: 'boxes',
    label: '개별 박스·이력',
    description: 'QR별 박스와 창고 전체 이력',
    detail: '박스 QR별 이력과 창고에서 처리한 작업을 확인합니다.',
    icon: Package,
  },
  {
    value: 'fixed',
    label: '고정 자리',
    description: '고정 자리 목록',
    detail: '상품별 고정 자리를 확인하는 화면입니다.',
    icon: MapPin,
  },
  {
    value: 'qr',
    label: 'QR 생성',
    description: '렉·고정 자리 라벨을 인쇄하고 엑셀을 만듭니다',
    detail:
      '박스창고 자리번호, 출고창고 렉 번호와 렉 안의 A1~D4 고정 자리를 A4 4칸 라벨로 인쇄합니다. 고정 자리는 아이라벨용 엑셀도 내려받을 수 있습니다.',
    icon: QrCode,
  },
  {
    value: 'organize',
    label: '창고 정리',
    description: '창고 개편 작업 공간',
    detail: '월별 상품 출고 수량을 창고 개편 자료로 저장합니다.',
    icon: ListChecks,
  },
]

function isWarehouseView(value: string | null): value is WarehouseView {
  return WAREHOUSE_VIEWS.some((item) => item.value === value)
}

function isWarehousePanel(value: string | null): value is WarehousePanel {
  return value === 'stock' || value === 'slots' || value === 'qr-audit'
}

function WarehouseHistoryView({ brandId }: { brandId: string }) {
  const [view, setView] = useState<'qr' | 'all'>('qr')
  return <div className="space-y-4">
    <FilterTabs
      ariaLabel="창고 이력 보기"
      tabs={[{ value: 'qr', label: 'QR별 이력' }, { value: 'all', label: '창고 전체 이력' }]}
      value={view}
      onChange={setView}
    />
    {view === 'qr'
      ? <WarehouseBoxHistoryPanel brandId={brandId} includeActive />
      : <WarehouseActivityPanel brandId={brandId} />}
  </div>
}

export function WarehousePage() {
  useRenderWatch('WarehousePage')
  const { brand } = useBrand()
  const [outboundMonth, setOutboundMonth] = useState(previousWarehouseOutboundMonth)
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: WarehouseView = isWarehouseView(requestedView)
    ? requestedView
    : 'box'
  const active = WAREHOUSE_VIEWS.find((item) => item.value === activeView)!
  const hasInventory = activeView === 'box' || activeView === 'outbound'
  const requestedPanel = searchParams.get('panel')
  const activePanel: WarehousePanel =
    hasInventory && isWarehousePanel(requestedPanel) && (requestedPanel !== 'qr-audit' || brand.slug === 'masmarulez')
      ? requestedPanel
      : 'stock'
  const sectionTabs = [
    { value: 'stock' as const, label: active.label },
    { value: 'slots' as const, label: `${active.label} 자리 설정` },
    ...(brand.slug === 'masmarulez' ? [{ value: 'qr-audit' as const, label: 'QR 연결 검수' }] : []),
  ]

  function selectView(view: WarehouseView) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (view === 'box') next.delete('view')
      else next.set('view', view)
      if (view !== 'box' && view !== 'outbound') next.delete('panel')
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

      <WarehousePopularLocationsPanel key={brand.id} brandId={brand.id} month={outboundMonth} onMonthChange={setOutboundMonth} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
                  ? 'border-primary/40 bg-accent'
                  : 'border-border bg-card hover:bg-muted',
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
        {hasInventory ? (
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
              {activePanel === 'qr-audit' ? 'QR 연결 검수' : activePanel === 'slots'
                ? `${active.label} 자리 설정`
                : active.label}
            </CardTitle>
            <CardDescription className="mt-1">
              {activePanel === 'qr-audit' ? '현장 사진을 확인해 상품을 연결합니다.' : activePanel === 'slots'
                ? activeView === 'outbound' ? '형식에 상관없이 출고창고 자리번호를 입력합니다. 저장하면 현재 재고도 정확히 일치하는 번호는 출고창고, 나머지는 박스창고로 다시 분류됩니다.' : `${active.label}에 속하는 자리번호를 등록합니다. 등록된 출고창고 자리만 입고 시트에서 출고창고로 분류됩니다.`
                : active.detail}
            </CardDescription>
          </div>
          {!hasInventory || activePanel !== 'stock' ? null : (
            <Badge variant="warning">연습 데이터</Badge>
          )}
        </CardHeader>
        <CardContent>
          {activeView === 'organize' ? (
            <WarehouseOrganizationPanel key={brand.id} brandId={brand.id} month={outboundMonth} onMonthChange={setOutboundMonth} />
          ) : activeView === 'qr' ? (
            <WarehouseQrPanel brandName={brand.name} brandId={brand.id} />
          ) : activeView === 'boxes' ? (
            <WarehouseHistoryView key={brand.id} brandId={brand.id} />
          ) : activeView === 'fixed' ? (
            <WarehouseFixedLocationsPanel key={brand.id} brandId={brand.id} />
          ) : activePanel === 'qr-audit' ? (
            <WarehouseQrAuditReviewPanel key={`${brand.id}-${activeView}`} brandId={brand.id} includeUnplaced={activeView === 'box'} />
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
              sheetConditionEnabled={brand.slug === 'masmarulez'}
              view={activeView}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function CompanyWarehousePage() {
  const { selection, selectedBrands, brandBySlug, loading, error } = useCompanyBrandScope()
  const brand = (selection.canEdit ? selectedBrands[0] : undefined) ?? brandBySlug.get('masmarulez')

  if (loading || error) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {loading ? '창고를 불러오는 중...' : '창고 정보를 불러오지 못했습니다.'}
      </p>
    )
  }

  if (!brand) return <CompanyWarehouseList />

  return (
    <BrandScope brand={brand}>
      <WarehousePage />
    </BrandScope>
  )
}
