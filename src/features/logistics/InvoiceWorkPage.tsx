import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileSpreadsheet,
  Gift,
  History,
  Loader2,
  MapPin,
  Package,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Tag,
  Tags,
  Upload,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useBrand } from '@/components/layout/brand-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  getInvoiceGiftAllocations,
  getInvoiceGiftRequests,
  getInvoiceGiftSourceAllocations,
  getInvoiceGiftSourceMaps,
  saveInvoiceGiftSourceMap,
  getInvoiceAccessoryRules,
  getInvoiceDiscontinuedStyles,
  getInvoiceItemNameRules,
  getInvoiceNameRules,
  getInvoiceOptionMaps,
  getInvoicePreorderHolds,
  getInvoiceProductNameExclusions,
  getInvoiceProductNameMaps,
  getInvoiceProductNameTagRoles,
  getCodeUsageTargetAliases,
  getCodeUsageTargetFolders,
  getCodeUsageTargets,
  getInvoiceWorkInstructions,
  getInvoiceWorkRuns,
  getAiFeatureRoute,
  listAllStyleRefs,
  getActiveWarehouseInventorySet,
  getBrandFields,
  getInvoicePackingSizeMaps,
  getStylesByBrand,
  getWarehouseStockPositions,
} from '@/lib/api'
import {
  ITEM_NAME_FEATURE_KEY,
} from '@/lib/ai/gateway-core'
import { parseSabangnetInvoiceFile } from '@/lib/invoice/parse-sabangnet'
import {
  normalizePackingSizeValue,
  PACKING_SIZE_SOURCE_FIELD_LABEL,
} from '@/lib/invoice/packing-size-map'
import {
  createGiftSeed,
  type GiftAssignmentPlan,
} from '@/lib/invoice/gift-assign'
import { finalizeUnifiedGiftPlanForDownload } from '@/lib/invoice/gift-confirm'
import {
  buildInvoiceOutputRows,
  downloadInvoiceStepSnapshot,
  type InvoiceStepSnapshotStage,
} from '@/lib/invoice/invoice-output'
import {
  buildOutgoingComponentRowsFromStages,
  buildItemNameTransformIndex,
  transformInvoiceItemNames,
  type InvoiceItemNameTransformation,
} from '@/lib/invoice/item-name-transform'
import {
  buildStockHoldCandidateBundles,
  excludedRowNumbersFromStockHoldBundles,
} from '@/lib/invoice/stock-hold-match'
import {
  transformInvoiceNamesByCode,
  type InvoiceNameTransformation,
} from '@/lib/invoice/name-transform'
import {
  createInvoiceWorkJob,
  finishInvoiceWorkJob,
  markInvoiceWorkStage,
  timeInvoiceWork,
  type InvoiceWorkJob,
} from '@/lib/invoice/invoice-work-perf'
import {
  buildProductNameLookupIndex,
  catalogFromStyles,
  overlayGiftSourceOnProductNames,
  transformInvoiceProductNames,
  type InvoiceProductNameTransformation,
} from '@/lib/invoice/product-name-transform'
import {
  collectGiftSourceSlots,
  effectiveGiftSourceAppliedKeys,
  emptyGiftSourcePlan,
  giftSourceGroupKey,
  inspectGiftSourceGroup,
  type GiftSourceGroup,
  type GiftSourceSessionRule,
} from '@/lib/invoice/gift-source-transform'
import { planUnifiedGifts } from '@/lib/invoice/gift-unified'
import { planInvoicePrefixes } from '@/lib/invoice/prefix-transform'
import {
  isInvoiceMallReady,
  resolveInvoiceMalls,
} from '@/lib/invoice/mall-resolution'
import {
  type SabangnetInspection,
  type SabangnetOrderRow,
} from '@/lib/invoice/sabangnet'
import {
  buildWorkInstructionIndex,
  planWorkInstructions,
  type WorkInstructionPlan,
} from '@/lib/invoice/work-instruction-transform'
import type {
  InvoiceGiftRequest,
  InvoiceGiftSourceMap,
  InvoiceNameRule,
  StyleRef,
  InvoiceOptionMap,
  InvoiceProductNameMap,
  InvoiceWorkInstruction,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { InvoiceDiscontinuedListPanel } from './InvoiceDiscontinuedListPanel'
import { InvoicePreorderHoldPanel } from './InvoicePreorderHoldPanel'
import { InvoiceItemNameTransformPanel } from './InvoiceItemNameTransformPanel'
import { InvoiceOptionMapRulesPanel } from './InvoiceOptionMapRulesPanel'
import { InvoiceOutputStepPanel } from './InvoiceOutputStepPanel'
import { InvoiceProductListStepPanel } from './InvoiceProductListStepPanel'
import { InvoiceStockHoldStepPanel } from './InvoiceStockHoldStepPanel'
import { InvoicePackingSizeMapPanel } from './InvoicePackingSizeMapPanel'
import { InvoiceGiftSourceMapPanel } from './InvoiceGiftSourceMapPanel'
import { InvoicePrefixRequestPanel } from './InvoicePrefixRequestPanel'
import { InvoicePrefixStepPanel } from './InvoicePrefixStepPanel'
import { InvoiceGiftSetupDialog } from './InvoiceGiftSetupDialog'
import { InvoiceMallResolutionDialog } from './InvoiceMallResolutionDialog'
import { InvoiceProductNameTransformPanel } from './InvoiceProductNameTransformPanel'
import { InvoiceWorkInstructionPanel } from './InvoiceWorkInstructionPanel'
import { InvoiceWorkInstructionStepPanel } from './InvoiceWorkInstructionStepPanel'
import { SabangnetOrderTable } from './SabangnetOrderTable'
import {
  invoiceStepDepsKey,
  useInvoiceStepCompute,
  type InvoiceStepComputeStatus,
} from './useInvoiceStepCompute'

const MAX_FILE_BYTES = 50 * 1024 * 1024
const PRODUCT_FEATURE_KEY = 'invoice_product_recommendation'

function invoiceCriteriaQueryOptions(snapshot: boolean) {
  return {
    staleTime: snapshot ? Infinity : 5 * 60_000,
    refetchOnWindowFocus: !snapshot,
  }
}

function prefetchInvoiceWorkCriteria(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
) {
  const options = { staleTime: 5 * 60_000 }
  void Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['invoice-name-rules', brandId],
      queryFn: () => getInvoiceNameRules(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-option-maps', brandId],
      queryFn: () => getInvoiceOptionMaps(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-item-name-rules', brandId],
      queryFn: () => getInvoiceItemNameRules(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-accessory-rules', brandId],
      queryFn: () => getInvoiceAccessoryRules(brandId, true),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-product-name-maps', brandId],
      queryFn: () => getInvoiceProductNameMaps(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-product-name-exclusions', brandId],
      queryFn: () => getInvoiceProductNameExclusions(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-product-name-tag-roles', brandId],
      queryFn: () => getInvoiceProductNameTagRoles(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-prefix-requests', brandId],
      queryFn: () => getInvoiceGiftRequests(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-gift-allocations', brandId],
      queryFn: () => getInvoiceGiftAllocations(brandId, { activeOnly: false }),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-work-instructions', brandId],
      queryFn: () => getInvoiceWorkInstructions(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-preorder-holds', brandId, 'active'],
      queryFn: () => getInvoicePreorderHolds(brandId, 'active'),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-discontinued-styles', brandId],
      queryFn: () => getInvoiceDiscontinuedStyles(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-gift-source-maps', brandId],
      queryFn: () => getInvoiceGiftSourceMaps(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-product-name-all-styles', brandId],
      queryFn: () => listAllStyleRefs(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['codeUsageTargets', brandId],
      queryFn: () => getCodeUsageTargets(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['codeUsageTargetAliases', brandId],
      queryFn: () => getCodeUsageTargetAliases(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['codeUsageTargetFolders', brandId],
      queryFn: () => getCodeUsageTargetFolders(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['ai-feature-route', brandId, PRODUCT_FEATURE_KEY],
      queryFn: () => getAiFeatureRoute(brandId, PRODUCT_FEATURE_KEY),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['ai-feature-route', brandId, ITEM_NAME_FEATURE_KEY],
      queryFn: () => getAiFeatureRoute(brandId, ITEM_NAME_FEATURE_KEY),
      ...options,
    }),
  ])
}

function SummaryItem({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

type InvoiceView = 'today' | 'waiting' | 'rules' | 'history'

const INVOICE_VIEWS: {
  value: InvoiceView
  label: string
  icon: typeof Upload
}[] = [
  { value: 'today', label: '오늘 작업', icon: Upload },
  { value: 'rules', label: '기준정보', icon: Settings2 },
  { value: 'waiting', label: '출고 대기', icon: Clock3 },
  { value: 'history', label: '작업 이력', icon: History },
]

function isInvoiceView(value: string | null): value is InvoiceView {
  return INVOICE_VIEWS.some((item) => item.value === value)
}

function InvoiceViewTabs({
  activeView,
  onChange,
}: {
  activeView: InvoiceView
  onChange: (view: InvoiceView) => void
}) {
  return (
    <div className="mb-6 flex items-stretch gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border px-1 pb-px">
      {INVOICE_VIEWS.map((item) => {
        const Icon = item.icon
        const active = item.value === activeView
        return (
          <button
            key={item.value}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(item.value)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs transition-colors',
              active
                ? 'border-border bg-card text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            <Icon className="size-3.5 shrink-0 opacity-70" />
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

type WaitingOrder = {
  id: string
  orderNo: string
  mallName: string
  productName: string
  optionName: string
  quantity: number
  reason: 'preorder' | 'stockout'
  heldAt: string
  releaseDate: string | null
  status: 'waiting' | 'ready'
}

function WaitingOrdersPanel() {
  const [filter, setFilter] = useState<
    'all' | 'preorder' | 'stockout' | 'ready'
  >('all')
  const orders: WaitingOrder[] = []
  const preorderCount = orders.filter(
    (order) => order.reason === 'preorder',
  ).length
  const stockoutCount = orders.filter(
    (order) => order.reason === 'stockout',
  ).length
  const readyCount = orders.filter((order) => order.status === 'ready').length
  const filteredOrders = orders.filter((order) => {
    if (filter === 'all') return true
    if (filter === 'ready') return order.status === 'ready'
    return order.reason === filter
  })

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>출고 대기 주문</CardTitle>
            <CardDescription className="mt-1">
              예발 또는 갑작스러운 재고부족으로 오늘 송장에서 제외한 주문을
              잃어버리지 않고 보관합니다.
            </CardDescription>
          </div>
          <Badge variant="muted">DB 연결 전</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryItem
              label="전체 대기"
              value={`${formatNumber(orders.length)}건`}
            />
            <SummaryItem
              label="예발 대기"
              value={`${formatNumber(preorderCount)}건`}
              tone="warning"
            />
            <SummaryItem
              label="재고부족 대기"
              value={`${formatNumber(stockoutCount)}건`}
              tone="danger"
            />
            <SummaryItem
              label="오늘 출고 가능"
              value={`${formatNumber(readyCount)}건`}
              tone="success"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>대기 목록</CardTitle>
              {(
                [
                  ['all', '전체', orders.length],
                  ['preorder', '예발', preorderCount],
                  ['stockout', '재고부족', stockoutCount],
                  ['ready', '출고 가능', readyCount],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    filter === value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label} {count}
                </button>
              ))}
            </div>
            <CardDescription>
              실제 주문이 저장되면 주문번호, 상품, 대기 사유와 출고 가능일을
              표시합니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredOrders.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-220 text-left text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">주문번호</th>
                      <th className="px-3 py-2.5 font-medium">상품·옵션</th>
                      <th className="px-3 py-2.5 font-medium">쇼핑몰</th>
                      <th className="px-3 py-2.5 text-right font-medium">
                        수량
                      </th>
                      <th className="px-3 py-2.5 font-medium">대기 사유</th>
                      <th className="px-3 py-2.5 font-medium">대기 시작</th>
                      <th className="px-3 py-2.5 font-medium">출고 가능일</th>
                      <th className="px-3 py-2.5 font-medium">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => (
                      <tr key={order.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-3 py-3 font-medium">
                          {order.orderNo}
                        </td>
                        <td className="max-w-72 px-3 py-3">
                          <p>{order.productName}</p>
                          {order.optionName ? (
                            <p className="mt-0.5 text-muted-foreground">
                              {order.optionName}
                            </p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {order.mallName}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {order.quantity}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Badge
                            variant={
                              order.reason === 'preorder' ? 'warning' : 'danger'
                            }
                          >
                            {order.reason === 'preorder' ? '예발' : '재고부족'}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                          {order.heldAt}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {order.releaseDate ?? '해제할 때까지'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Badge
                            variant={
                              order.status === 'ready' ? 'success' : 'muted'
                            }
                          >
                            {order.status === 'ready' ? '출고 가능' : '대기중'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
                <CalendarClock className="size-7 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  이 조건에 해당하는 대기 주문이 없습니다.
                </p>
                <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                  자동 변환을 연결하면 사방넷 파일에서 제외된 예발·재고부족
                  주문이 이곳으로 이동합니다.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>직원이 보는 흐름</CardTitle>
            <CardDescription>
              복잡한 판단 없이 상태만 따라가도록 구성합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              [
                '1',
                '자동 보류',
                '업로드할 때 규칙에 맞는 주문을 자동으로 분리',
              ],
              [
                '2',
                '출고일 알림',
                '예발일 도착 또는 재고 확보 시 출고 가능 표시',
              ],
              ['3', '다시 출력', '선택한 대기 주문을 다음 CJ 파일에 자동 포함'],
            ].map(([number, title, description]) => (
              <div key={number} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {number}
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

type RuleView = 'prefixes' | 'aliases' | 'holds' | 'gifts' | 'packing'

const RULE_VIEWS: {
  value: RuleView
  label: string
  description: string
  icon: typeof Tags
}[] = [
  {
    value: 'gifts',
    label: '사은품 증정',
    description: '행 추가 행사 · 원본행 품목명 대체',
    icon: Gift,
  },
  {
    value: 'prefixes',
    label: '작업 지시',
    description: '표시 문구 · 완전일치/시작어 · 항상/기간',
    icon: Tag,
  },
  {
    value: 'aliases',
    label: '품목명·내품명 변환',
    description: '품목명과 내품명을 따로 연결',
    icon: Tags,
  },
  {
    value: 'holds',
    label: '출고상태',
    description: '예발·재고부족·단종 설정',
    icon: CalendarClock,
  },
  {
    value: 'packing',
    label: '포장·위치',
    description: '위치·사이즈',
    icon: Package,
  },
]

const RULE_TABLES: Record<
  RuleView,
  { title: string; description: string; columns: string[] }
> = {
  gifts: {
    title: '사은품 증정',
    description:
      '사은품 행을 추가하는 행사 요청과, 원본 [사은품] 행을 M번호로 바꾸는 품목명 대체 매핑을 함께 관리합니다.',
    columns: ['제목', '쇼핑몰명', '기간', '대상 수', '상태'],
  },
  prefixes: {
    title: '작업 지시',
    description:
      '원본 품목명이 완전일치하거나 등록한 시작어로 시작할 때 최종 공식명 앞에 붙일 표시 문구를 관리합니다. 적용은 항상 또는 기간으로 고릅니다.',
    columns: ['지시명', '표시 문구', '기간', '대상 수', '상태'],
  },
  aliases: {
    title: '품목명·내품명 변환',
    description:
      '품목명 연결, 실제 나가는 세트·구성, 내품명 문구 변환 규칙을 각각 관리합니다.',
    columns: ['원본 품목명', '원본 옵션값', '본품', '구성', '상태'],
  },
  holds: {
    title: '출고 보류 규칙',
    description:
      '상품 또는 옵션별로 예발일·재고부족·단종 상태를 관리하고 실제 주문은 출고 대기로 보냅니다.',
    columns: ['상품·옵션', '보류 사유', '시작일', '출고 가능일', '상태'],
  },
  packing: {
    title: '포장·위치 규칙',
    description:
      '상품별 기본 위치와 포장 사이즈를 관리합니다.',
    columns: ['상품', '현재 위치', '포장 사이즈', '상태'],
  },
}

function RulesPanel({
  brandId,
  brandName,
  nameRules,
  nameRulesLoading,
  nameRulesError,
  optionMaps,
  optionMapsLoading,
  optionMapsError,
  productNameMaps,
  productNameMapsLoading,
  productNameMapsError,
  giftRequests,
  giftRequestsLoading,
  giftRequestsError,
  giftSourceMaps,
  giftSourceMapsLoading,
  giftSourceMapsError,
  workInstructions,
  workInstructionsLoading,
  workInstructionsError,
}: {
  brandId: string
  brandName: string
  nameRules: InvoiceNameRule[]
  nameRulesLoading: boolean
  nameRulesError: string | null
  optionMaps: InvoiceOptionMap[]
  optionMapsLoading: boolean
  optionMapsError: string | null
  productNameMaps: InvoiceProductNameMap[]
  productNameMapsLoading: boolean
  productNameMapsError: string | null
  giftRequests: InvoiceGiftRequest[]
  giftRequestsLoading: boolean
  giftRequestsError: string | null
  giftSourceMaps: InvoiceGiftSourceMap[]
  giftSourceMapsLoading: boolean
  giftSourceMapsError: string | null
  workInstructions: InvoiceWorkInstruction[]
  workInstructionsLoading: boolean
  workInstructionsError: string | null
}) {
  const [activeRule, setActiveRule] = useState<RuleView>('gifts')
  const [activePackingCard, setActivePackingCard] = useState<'size' | null>(
    null,
  )
  const [activeHoldCard, setActiveHoldCard] = useState<
    'preorder' | 'stockout' | 'discontinued' | null
  >(null)
  const table = RULE_TABLES[activeRule]

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>기준정보</CardTitle>
            <CardDescription className="mt-1">
              숙련자의 판단을 규칙으로 관리합니다. 일반 직원은 이 화면을
              수정하지 않아도 송장작업을 할 수 있습니다.
            </CardDescription>
          </div>
          <Badge variant="muted">관리자용 · 자체품번 DB 연결</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {RULE_VIEWS.map((item) => {
              const Icon = item.icon
              const active = item.value === activeRule
              return (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveRule(item.value)}
                  className={cn(
                    'rounded-lg border p-4 text-left transition-colors',
                    active
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border hover:bg-muted/40',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        'size-4',
                        active ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <p className="text-sm font-medium">{item.label}</p>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {activeRule === 'holds' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {(
            [
              {
                value: 'preorder' as const,
                icon: CalendarClock,
                title: '예발',
                description:
                  '출고 가능일을 필수로 적고, 해당 날짜가 되면 대기 주문을 자동으로 다시 보여줍니다.',
                tone: 'warning',
              },
              {
                value: 'stockout' as const,
                icon: Boxes,
                title: '재고부족',
                description:
                  '종료일 없이 즉시 보류하고, 재고가 확보됐다고 해제할 때만 출고 가능 상태로 바꿉니다.',
                tone: 'danger',
              },
              {
                value: 'discontinued' as const,
                icon: Ban,
                title: '단종',
                description:
                  '단종 상품 리스트를 직접 관리합니다. 송장 재고·예약 단계에서 제외 후보로 보여줍니다.',
                tone: 'muted',
              },
            ] as const
          ).map((item) => {
            const ItemIcon = item.icon
            const active = activeHoldCard === item.value
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setActiveHoldCard((current) =>
                    current === item.value ? null : item.value,
                  )
                }
                className={cn(
                  'rounded-xl border bg-card p-5 text-left shadow-none transition-colors',
                  item.tone === 'warning' && 'border-warning/30',
                  item.tone === 'danger' && 'border-danger/30',
                  item.tone === 'muted' && 'border-border',
                  active
                    ? 'ring-2 ring-primary/30'
                    : 'hover:bg-muted/20',
                )}
              >
                <div className="flex items-start gap-3">
                  <ItemIcon
                    className={cn(
                      'mt-0.5 size-5 shrink-0',
                      item.tone === 'warning' && 'text-warning',
                      item.tone === 'danger' && 'text-danger',
                      item.tone === 'muted' && 'text-muted-foreground',
                    )}
                  />
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      ) : null}

      {activeRule === 'packing' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              icon: MapPin,
              title: '현재 위치',
              description: '상품을 꺼내는 방·선반 위치',
              value: null,
            },
            {
              icon: Boxes,
              title: '포장 사이즈',
              description: 'S·M·L 또는 실제 박스 규격',
              value: 'size' as const,
            },
          ].map((item) => {
            const ItemIcon = item.icon
            const active =
              item.value === 'size' && activePackingCard === item.value
            const content = (
              <>
                <ItemIcon
                  className={cn(
                    'size-4',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <p className="mt-2 text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.description}
                </p>
              </>
            )
            return item.value === 'size' ? (
              <button
                key={item.title}
                type="button"
                aria-pressed={active}
                onClick={() => setActivePackingCard('size')}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors',
                  active
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-muted/20 hover:bg-muted/40',
                )}
              >
                {content}
              </button>
            ) : (
              <div
                key={item.title}
                className="rounded-lg border border-border bg-muted/20 p-4"
              >
                {content}
              </div>
            )
          })}
        </div>
      ) : null}

      {activeRule === 'gifts' ? (
        <>
          <InvoicePrefixRequestPanel
            brandId={brandId}
            requests={giftRequests}
            loading={giftRequestsLoading}
            error={giftRequestsError}
          />
          <InvoiceGiftSourceMapPanel
            brandId={brandId}
            maps={giftSourceMaps}
            loading={giftSourceMapsLoading}
            error={giftSourceMapsError}
          />
        </>
      ) : activeRule === 'prefixes' ? (
        <InvoiceWorkInstructionPanel
          brandId={brandId}
          instructions={workInstructions}
          loading={workInstructionsLoading}
          error={workInstructionsError}
        />
      ) : activeRule === 'aliases' ? (
        <InvoiceOptionMapRulesPanel
          brandId={brandId}
          brandName={brandName}
          maps={optionMaps}
          mapsLoading={optionMapsLoading}
          mapsError={optionMapsError}
          productNameMaps={productNameMaps}
          productNameMapsLoading={productNameMapsLoading}
          productNameMapsError={productNameMapsError}
          nameRules={nameRules}
          nameRulesLoading={nameRulesLoading}
          nameRulesError={nameRulesError}
        />
      ) : activeRule === 'packing' && activePackingCard === 'size' ? (
        <InvoicePackingSizeMapPanel brandId={brandId} />
      ) : activeRule === 'holds' && activeHoldCard === 'preorder' ? (
        <InvoicePreorderHoldPanel brandId={brandId} />
      ) : activeRule === 'holds' && activeHoldCard === 'discontinued' ? (
        <InvoiceDiscontinuedListPanel brandId={brandId} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {activeRule === 'holds' && activeHoldCard === 'stockout'
                ? '재고부족 규칙'
                : table.title}
            </CardTitle>
            <CardDescription>
              {activeRule === 'holds' && activeHoldCard === 'stockout'
                ? '종료일 없는 재고부족 보류 규칙을 관리합니다. 아직 DB에 연결하지 않았습니다.'
                : table.description}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-180 text-left text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column} className="px-3 py-2.5 font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td
                      colSpan={table.columns.length}
                      className="px-4 py-16 text-center text-muted-foreground"
                    >
                      아직 DB에 연결하지 않은 기준정보입니다. 자체품번코드
                      단계가 끝난 뒤 실제 데이터 구조를 정합니다.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function formatWorkedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function HistoryPanel({ brandId }: { brandId: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const historyQuery = useQuery({
    queryKey: ['invoiceWorkRuns', brandId],
    queryFn: () => getInvoiceWorkRuns(brandId),
  })
  const history = historyQuery.data ?? []
  const exportedRows = history.reduce(
    (total, item) => total + item.exportedRowCount,
    0,
  )
  const orderCount = history.reduce(
    (total, item) => total + item.sourceOrderCount,
    0,
  )
  const reviewRows = history.reduce(
    (total, item) => total + item.reviewRowCount,
    0,
  )
  const error =
    historyQuery.error instanceof Error
      ? historyQuery.error.message
      : historyQuery.error
        ? '작업 이력을 불러오지 못했습니다.'
        : null

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>작업 이력</CardTitle>
            <CardDescription className="mt-1">
              어떤 파일을 누가 변환했고, 사이트별로 몇 건이 나갔는지
              확인합니다. 같은 파일은 한 작업으로 갱신됩니다.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryItem
              label="표시된 변환"
              value={`${formatNumber(history.length)}회`}
            />
            <SummaryItem
              label="주문 건수"
              value={`${formatNumber(orderCount)}건`}
            />
            <SummaryItem
              label="CJ 출력"
              value={`${formatNumber(exportedRows)}행`}
              tone="success"
            />
            <SummaryItem
              label="확인 필요"
              value={`${formatNumber(reviewRows)}행`}
              tone="danger"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>최근 작업</CardTitle>
          <CardDescription>
            고객정보 대신 작업 단위와 사이트별 출고 수량만 보여 줍니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              이력을 불러오는 중...
            </p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-danger">{error}</p>
          ) : history.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-200 text-left text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5 font-medium">작업 시각</th>
                    <th className="px-3 py-2.5 font-medium">원본 파일</th>
                    <th className="px-3 py-2.5 font-medium">작업자</th>
                    <th className="px-3 py-2.5 text-right font-medium">원본</th>
                    <th className="px-3 py-2.5 text-right font-medium">주문</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      CJ 출력
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      확인 필요
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => {
                    const open = openId === item.id
                    return (
                      <Fragment key={item.id}>
                        <tr className="border-t border-border">
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-muted"
                              aria-expanded={open}
                              onClick={() =>
                                setOpenId(open ? null : item.id)
                              }
                            >
                              <ChevronDown
                                className={cn(
                                  'size-4 transition-transform',
                                  open && 'rotate-180',
                                )}
                              />
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                            {formatWorkedAt(item.completedAt)}
                          </td>
                          <td className="max-w-72 px-3 py-3 font-medium">
                            {item.sourceFileName || '(파일명 없음)'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            {item.workerLabel || '-'}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {formatNumber(item.sourceRowCount)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {formatNumber(item.sourceOrderCount)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-success">
                            {formatNumber(item.exportedRowCount)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-danger">
                            {formatNumber(item.reviewRowCount)}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-t border-border bg-muted/30">
                            <td colSpan={8} className="px-3 py-3">
                              {item.sites.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  사이트 집계가 없습니다.
                                </p>
                              ) : (
                                <table className="w-full min-w-160 text-left text-xs">
                                  <thead>
                                    <tr className="text-muted-foreground">
                                      <th className="py-1.5 font-medium">사이트</th>
                                      <th className="py-1.5 font-medium">원본 표기</th>
                                      <th className="py-1.5 text-right font-medium">주문</th>
                                      <th className="py-1.5 text-right font-medium">원본 수량</th>
                                      <th className="py-1.5 text-right font-medium">CJ 주문</th>
                                      <th className="py-1.5 text-right font-medium">사은품</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.sites.map((site) => (
                                      <tr key={site.id}>
                                        <td className="py-1.5 font-medium">
                                          {site.targetName}
                                        </td>
                                        <td className="py-1.5 text-muted-foreground">
                                          {site.sourceMallNames || '-'}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatNumber(site.orderCount)}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatNumber(site.sourceQuantity)}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatNumber(site.cjOrderQuantity)}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatNumber(site.cjGiftQuantity)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
              <History className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                아직 기록된 송장작업이 없습니다.
              </p>
              <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
                CJ 13열을 내려받으면 파일명·작업자·사이트별 주문·출고 수량이
                남습니다. 수령인 정보는 저장하지 않습니다.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

type TodayStep =
  | 'upload'
  | 'check'
  | 'gift'
  | 'instruction'
  | 'product'
  | 'item'
  | 'stock'
  | 'list'
  | 'output'

const TODAY_STEPS: { value: TodayStep; label: string }[] = [
  { value: 'upload', label: '파일 올리기' },
  { value: 'check', label: '파일 확인' },
  { value: 'gift', label: '사은품 추가' },
  { value: 'instruction', label: '작업 지시' },
  { value: 'product', label: '품목명 변환' },
  { value: 'item', label: '내품명 변환' },
  { value: 'stock', label: '재고·예약' },
  { value: 'list', label: '상품 리스트' },
  { value: 'output', label: '최종 행' },
]

const TODAY_STEP_INDEX: Record<TodayStep, number> = {
  upload: 0,
  check: 1,
  gift: 2,
  instruction: 3,
  product: 4,
  item: 5,
  stock: 6,
  list: 7,
  output: 8,
}

type UploadAiProgress = {
  settled: boolean
  collecting: boolean
  done: number
  total: number
}

const IDLE_UPLOAD_AI: UploadAiProgress = {
  settled: true,
  collecting: false,
  done: 0,
  total: 0,
}

const PENDING_UPLOAD_AI: UploadAiProgress = {
  settled: false,
  collecting: false,
  done: 0,
  total: 0,
}

function isStepComputeSettled(status: InvoiceStepComputeStatus) {
  return status === 'ready' || status === 'error'
}

function TodayStepProgress({
  stepIndex,
  maxStepIndex,
  onChange,
}: {
  stepIndex: number
  maxStepIndex: number
  onChange: (step: TodayStep) => void
}) {
  return (
    <div className="flex items-stretch gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border pb-px">
      {TODAY_STEPS.map((item, index) => {
        const active = index === stepIndex
        const reachable = index <= maxStepIndex
        return (
          <button
            key={item.value}
            type="button"
            disabled={!reachable}
            aria-current={active ? 'step' : undefined}
            onClick={() => onChange(item.value)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs transition-colors',
              active
                ? 'border-border bg-card text-foreground'
                : reachable
                  ? 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  : 'border-transparent text-muted-foreground/40',
            )}
          >
            {index < stepIndex ? (
              <CheckCircle2 className="size-3.5 text-success" />
            ) : (
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-full text-[10px] font-semibold',
                  active ? 'bg-muted' : 'bg-muted/70',
                )}
              >
                {index + 1}
              </span>
            )}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/** 단계 공통 기준 로딩 표시 */
function StepCriteriaLoading({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

/** 작업 화면 전체를 덮는 단계 로딩. 스크롤 영역 위에 고정한다. */
function TodayStepBusyOverlay({
  label,
  hint,
}: {
  label: string
  hint?: string
}) {
  const [box, setBox] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)

  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>('[data-brand-page-scroll]')
    if (!host) return
    const sync = () => {
      const rect = host.getBoundingClientRect()
      setBox({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    const previousOverflow = host.style.overflow
    host.style.overflow = 'hidden'
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
      host.style.overflow = previousOverflow
    }
  }, [])

  if (!box) return null
  return createPortal(
    <div
      role="status"
      aria-live="assertive"
      aria-busy="true"
      className="fixed z-[80] flex flex-col items-center justify-center gap-3 bg-background/75 backdrop-blur-sm"
      style={{
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      }}
      onWheel={(event) => event.preventDefault()}
      onTouchMove={(event) => event.preventDefault()}
    >
      <Loader2 className="size-10 animate-spin text-foreground" />
      <p className="text-2xl font-semibold tracking-wide">로딩중</p>
      <p className="text-sm text-muted-foreground">{label}</p>
      {hint ? (
        <p className="max-w-md px-6 text-center text-xs text-muted-foreground/80">
          {hint}
        </p>
      ) : null}
    </div>,
    document.body,
  )
}

/** 단계 공통 기준 오류 표시. 항상 다시 불러오기를 함께 보여준다. */
function StepCriteriaError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        다시 불러오기
      </Button>
    </div>
  )
}

/** 한 번 열어본 단계는 숨겨만 둔다. 탭을 옮겨도 검수표·초안이 남는다. */
function TodayStepPanel({
  active,
  keepMounted,
  children,
}: {
  active: boolean
  keepMounted: boolean
  children: ReactNode
}) {
  if (!keepMounted) return null
  return (
    <div hidden={!active} className={active ? undefined : 'hidden'}>
      {children}
    </div>
  )
}

function StepSnapshotButton({
  stage,
  brandName,
  sourceFileName,
  sourceRows,
  giftPlan,
  workPlan,
  nameTransformation,
  productTransformation,
  itemTransformation,
  resolveItemTransformation,
  disabled,
}: {
  stage: InvoiceStepSnapshotStage
  brandName: string
  sourceFileName?: string
  sourceRows: SabangnetOrderRow[]
  giftPlan?: GiftAssignmentPlan | null
  workPlan?: WorkInstructionPlan | null
  nameTransformation?: InvoiceNameTransformation | null
  productTransformation?: InvoiceProductNameTransformation | null
  itemTransformation?: InvoiceItemNameTransformation | null
  resolveItemTransformation?: () => InvoiceItemNameTransformation | null
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy}
        title="이 단계까지 적용된 전체 13열입니다. 선착순 확정은 하지 않습니다."
        onClick={() => {
          setBusy(true)
          setError(null)
          window.setTimeout(() => {
            const item =
              itemTransformation ?? resolveItemTransformation?.() ?? null
            void downloadInvoiceStepSnapshot({
              stage,
              brandName,
              sourceFileName,
              sourceRows,
              giftPlan,
              workPlan,
              nameTransformation,
              productTransformation,
              itemTransformation: item,
            })
              .catch((reason) => {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : '엑셀을 내려받지 못했습니다.',
                )
              })
              .finally(() => setBusy(false))
          }, 0)
        }}
      >
        <Download className="size-4" />
        {busy ? '받는 중...' : '이 단계까지 내려받기'}
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  )
}

export function InvoiceWorkPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: InvoiceView = isInvoiceView(requestedView)
    ? requestedView
    : 'today'
  const inputRef = useRef<HTMLInputElement>(null)
  const workGenerationRef = useRef(0)
  const workJobRef = useRef<InvoiceWorkJob | null>(null)
  const [workGeneration, setWorkGeneration] = useState(0)
  const [step, setStep] = useState<TodayStep>('upload')
  const [reachedStepIndex, setReachedStepIndex] = useState(0)
  const [giftExclusionSig, setGiftExclusionSig] = useState('')
  const [inspection, setInspection] = useState<SabangnetInspection | null>(null)
  const [fileName, setFileName] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [uploadPipeline, setUploadPipeline] = useState(false)
  const [productAiPipeline, setProductAiPipeline] =
    useState<UploadAiProgress>(IDLE_UPLOAD_AI)
  const [itemAiPipeline, setItemAiPipeline] =
    useState<UploadAiProgress>(IDLE_UPLOAD_AI)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [productSaveBlockCount, setProductSaveBlockCount] = useState(0)
  const [mallDialogOpen, setMallDialogOpen] = useState(false)
  const mallAutoOpenedRef = useRef<string | null>(null)
  const rulesView = activeView === 'rules'
  const reachedGift = reachedStepIndex >= TODAY_STEP_INDEX.gift
  const reachedInstruction = reachedStepIndex >= TODAY_STEP_INDEX.instruction
  const reachedProduct = reachedStepIndex >= TODAY_STEP_INDEX.product
  const reachedItem = reachedStepIndex >= TODAY_STEP_INDEX.item
  const reachedStock = reachedStepIndex >= TODAY_STEP_INDEX.stock
  const criteriaSnapshot = uploadPipeline
  const criteriaQueryOptions = invoiceCriteriaQueryOptions(criteriaSnapshot)
  useEffect(() => {
    prefetchInvoiceWorkCriteria(queryClient, brand.id)
  }, [brand.id, queryClient])
  const nameRulesQuery = useQuery({
    queryKey: ['invoice-name-rules', brand.id],
    queryFn: () => getInvoiceNameRules(brand.id),
    enabled: rulesView || reachedProduct,
    ...criteriaQueryOptions,
  })
  const optionMapsQuery = useQuery({
    queryKey: ['invoice-option-maps', brand.id],
    queryFn: () => getInvoiceOptionMaps(brand.id),
    enabled: rulesView || reachedItem,
    ...criteriaQueryOptions,
  })
  const itemNameRulesQuery = useQuery({
    queryKey: ['invoice-item-name-rules', brand.id],
    queryFn: () => getInvoiceItemNameRules(brand.id),
    enabled: rulesView || reachedItem,
    ...criteriaQueryOptions,
  })
  const accessoryRulesQuery = useQuery({
    queryKey: ['invoice-accessory-rules', brand.id],
    queryFn: () => getInvoiceAccessoryRules(brand.id, true),
    enabled: reachedItem,
    ...criteriaQueryOptions,
  })
  const productNameMapsQuery = useQuery({
    queryKey: ['invoice-product-name-maps', brand.id],
    queryFn: () => getInvoiceProductNameMaps(brand.id),
    enabled: rulesView || reachedProduct,
    ...criteriaQueryOptions,
  })
  const productNameExclusionsQuery = useQuery({
    queryKey: ['invoice-product-name-exclusions', brand.id],
    queryFn: () => getInvoiceProductNameExclusions(brand.id),
    enabled: reachedProduct,
    ...criteriaQueryOptions,
  })
  const productNameTagRolesQuery = useQuery({
    queryKey: ['invoice-product-name-tag-roles', brand.id],
    queryFn: () => getInvoiceProductNameTagRoles(brand.id),
    enabled: rulesView || reachedGift,
    ...criteriaQueryOptions,
  })
  const preorderHoldsQuery = useQuery({
    queryKey: ['invoice-preorder-holds', brand.id, 'active'],
    queryFn: () => getInvoicePreorderHolds(brand.id, 'active'),
    enabled: rulesView || reachedStock,
    ...criteriaQueryOptions,
  })
  const discontinuedStylesQuery = useQuery({
    queryKey: ['invoice-discontinued-styles', brand.id],
    queryFn: () => getInvoiceDiscontinuedStyles(brand.id),
    enabled: rulesView || reachedStock,
    ...criteriaQueryOptions,
  })
  const usageTargetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
    enabled: Boolean(inspection) && reachedStepIndex >= TODAY_STEP_INDEX.check,
    ...criteriaQueryOptions,
  })
  const usageAliasesQuery = useQuery({
    queryKey: ['codeUsageTargetAliases', brand.id],
    queryFn: () => getCodeUsageTargetAliases(brand.id),
    enabled: Boolean(inspection) && reachedStepIndex >= TODAY_STEP_INDEX.check,
    ...criteriaQueryOptions,
  })
  const usageFoldersQuery = useQuery({
    queryKey: ['codeUsageTargetFolders', brand.id],
    queryFn: () => getCodeUsageTargetFolders(brand.id),
    enabled: Boolean(inspection) && reachedStepIndex >= TODAY_STEP_INDEX.check,
    ...criteriaQueryOptions,
  })
  const giftRequestsQuery = useQuery({
    queryKey: ['invoice-prefix-requests', brand.id],
    queryFn: () => getInvoiceGiftRequests(brand.id),
    enabled: rulesView || reachedGift,
    ...criteriaQueryOptions,
  })
  const giftAllocationsQuery = useQuery({
    queryKey: ['invoice-gift-allocations', brand.id],
    queryFn: () => getInvoiceGiftAllocations(brand.id, { activeOnly: false }),
    enabled: reachedGift,
    ...criteriaQueryOptions,
  })
  const workInstructionsQuery = useQuery({
    queryKey: ['invoice-work-instructions', brand.id],
    queryFn: () => getInvoiceWorkInstructions(brand.id),
    enabled: rulesView || reachedInstruction,
    ...criteriaQueryOptions,
  })
  const giftSourceMapsQuery = useQuery({
    queryKey: ['invoice-gift-source-maps', brand.id],
    queryFn: () => getInvoiceGiftSourceMaps(brand.id),
    enabled: rulesView || reachedGift,
    ...criteriaQueryOptions,
  })
  const giftRequests = useMemo(
    () => giftRequestsQuery.data ?? [],
    [giftRequestsQuery.data],
  )
  const giftAllocations = useMemo(
    () => giftAllocationsQuery.data ?? [],
    [giftAllocationsQuery.data],
  )
  const workInstructions = useMemo(
    () => workInstructionsQuery.data ?? [],
    [workInstructionsQuery.data],
  )
  const giftRequestsError =
    giftRequestsQuery.error instanceof Error
      ? giftRequestsQuery.error.message
      : giftRequestsQuery.error
        ? '사은품 증정 요청 건을 불러오지 못했습니다.'
        : null
  const giftSourceMapsError =
    giftSourceMapsQuery.error instanceof Error
      ? giftSourceMapsQuery.error.message
      : giftSourceMapsQuery.error
        ? '품목명 대체 매핑을 불러오지 못했습니다.'
        : null
  const workInstructionsError =
    workInstructionsQuery.error instanceof Error
      ? workInstructionsQuery.error.message
      : workInstructionsQuery.error
        ? '작업 지시를 불러오지 못했습니다.'
        : null
  // 기간이 겹치는 사은품 요청 건이 둘 이상일 때 사용자가 고른 값. 단계를 옮겨도 유지한다.
  const [giftResolutions, setGiftResolutions] = useState<
    Record<string, string>
  >({})
  const [giftSeed, setGiftSeed] = useState(createGiftSeed)
  const [excludedGiftStyleIds, setExcludedGiftStyleIds] = useState<string[]>(
    [],
  )
  const [stockHoldExcludedOverride, setStockHoldExcludedOverride] = useState<
    number[] | null
  >(null)
  const handleStockHoldExcludedChange = useCallback((rowNumbers: number[]) => {
    setStockHoldExcludedOverride((current) =>
      current &&
      current.length === rowNumbers.length &&
      current.every((value, index) => value === rowNumbers[index])
        ? current
        : rowNumbers,
    )
  }, [])
  const [giftSourceSessionRules, setGiftSourceSessionRules] = useState<
    Record<string, GiftSourceSessionRule>
  >({})
  const [giftSourceSessionAllocations, setGiftSourceSessionAllocations] =
    useState<Record<string, StyleRef>>({})
  const [giftSourceIgnoredKeys, setGiftSourceIgnoredKeys] = useState<string[]>(
    [],
  )
  const [giftSourceApplyingKey, setGiftSourceApplyingKey] = useState<
    string | null
  >(null)
  const [giftSourceError, setGiftSourceError] = useState<string | null>(null)
  const [giftSourceAppliedKeys, setGiftSourceAppliedKeys] = useState<string[]>(
    [],
  )
  const [giftSetupTarget, setGiftSetupTarget] = useState<{
    mallName: string
    productName: string
  } | null>(null)
  const nameRules = useMemo(
    () => nameRulesQuery.data ?? [],
    [nameRulesQuery.data],
  )
  const activeNameRules = useMemo(
    () =>
      nameRules.filter(
        (rule) =>
          rule.isActive &&
          !rule.isTest &&
          rule.matchType === 'own_product_code',
      ),
    [nameRules],
  )
  const nameTransformation = useMemo(() => {
    if (!inspection || !nameRulesQuery.isSuccess || nameRulesQuery.error) {
      return null
    }
    return transformInvoiceNamesByCode(inspection.rows, activeNameRules)
  }, [
    activeNameRules,
    inspection,
    nameRulesQuery.error,
    nameRulesQuery.isSuccess,
  ])
  const optionMaps = useMemo(
    () => optionMapsQuery.data ?? [],
    [optionMapsQuery.data],
  )
  const optionMapsError =
    optionMapsQuery.error instanceof Error
      ? optionMapsQuery.error.message
      : optionMapsQuery.error
        ? '내품명 변환 기준을 불러오지 못했습니다.'
        : null
  const itemNameRules = useMemo(
    () => itemNameRulesQuery.data ?? [],
    [itemNameRulesQuery.data],
  )
  const itemNameRulesError =
    itemNameRulesQuery.error instanceof Error
      ? itemNameRulesQuery.error.message
      : itemNameRulesQuery.error
        ? '내품명 규칙을 불러오지 못했습니다.'
        : null
  const accessoryRules = useMemo(
    () => accessoryRulesQuery.data ?? [],
    [accessoryRulesQuery.data],
  )
  const accessoryRulesError =
    accessoryRulesQuery.error instanceof Error
      ? accessoryRulesQuery.error.message
      : accessoryRulesQuery.error
        ? '부속품 사전을 불러오지 못했습니다.'
        : null
  const itemNameCriteriaError =
    optionMapsError || itemNameRulesError || accessoryRulesError
  const itemNameCriteriaLoading =
    optionMapsQuery.isLoading ||
    itemNameRulesQuery.isLoading ||
    accessoryRulesQuery.isLoading
  const productNameMaps = useMemo(
    () => productNameMapsQuery.data ?? [],
    [productNameMapsQuery.data],
  )
  const productNameExclusions = useMemo(
    () => productNameExclusionsQuery.data ?? [],
    [productNameExclusionsQuery.data],
  )
  const productNameTagRoles = useMemo(
    () => productNameTagRolesQuery.data ?? [],
    [productNameTagRolesQuery.data],
  )
  const giftSourceMaps = useMemo(
    () => giftSourceMapsQuery.data ?? [],
    [giftSourceMapsQuery.data],
  )
  const giftSourceIgnoredKeySet = useMemo(
    () => new Set(giftSourceIgnoredKeys),
    [giftSourceIgnoredKeys],
  )
  const giftSourceFileMapIds = useMemo(() => {
    if (!inspection) return []
    const keys = new Set(
      inspection.rows.map((row) =>
        giftSourceGroupKey(row.mallName, row.productName),
      ),
    )
    return giftSourceMaps
      .filter((map) =>
        keys.has(giftSourceGroupKey(map.mallName, map.productName)),
      )
      .map((map) => map.id)
  }, [giftSourceMaps, inspection])
  const giftSourceAllocationsQuery = useQuery({
    queryKey: ['invoice-gift-source-allocations', brand.id, giftSourceFileMapIds],
    queryFn: () =>
      getInvoiceGiftSourceAllocations(brand.id, {
        mapIds: giftSourceFileMapIds,
      }),
    enabled:
      reachedGift &&
      Boolean(inspection) &&
      giftSourceFileMapIds.length > 0,
  })
  const giftSourceAllocations = useMemo(
    () => giftSourceAllocationsQuery.data ?? [],
    [giftSourceAllocationsQuery.data],
  )
  const giftSourceSessionRuleMap = useMemo(
    () => new Map(Object.entries(giftSourceSessionRules)),
    [giftSourceSessionRules],
  )
  const giftSourceSessionAllocationMap = useMemo(
    () => new Map(Object.entries(giftSourceSessionAllocations)),
    [giftSourceSessionAllocations],
  )
  const giftSourceAppliedKeySet = useMemo(
    () => new Set(giftSourceAppliedKeys),
    [giftSourceAppliedKeys],
  )
  const giftSourceEffectiveAppliedKeys = useMemo(
    () =>
      effectiveGiftSourceAppliedKeys({
        maps: giftSourceMaps,
        sessionRules: giftSourceSessionRuleMap,
        appliedKeys: giftSourceAppliedKeySet,
        ignoredKeys: giftSourceIgnoredKeySet,
      }),
    [
      giftSourceAppliedKeySet,
      giftSourceIgnoredKeySet,
      giftSourceMaps,
      giftSourceSessionRuleMap,
    ],
  )
  const giftSourceCriteriaReady =
    giftSourceMapsQuery.isSuccess &&
    (giftSourceFileMapIds.length === 0 ||
      giftSourceAllocationsQuery.isSuccess)
  const giftSourceAllocationsError =
    giftSourceAllocationsQuery.error instanceof Error
      ? giftSourceAllocationsQuery.error.message
      : giftSourceAllocationsQuery.error
        ? '사은품 원본행 배정을 불러오지 못했습니다.'
        : null
  const productNameMapsError =
    productNameMapsQuery.error instanceof Error
      ? productNameMapsQuery.error.message
      : productNameMapsQuery.error
        ? '품목명 변환 기준을 불러오지 못했습니다.'
        : null
  const productNameExclusionsError =
    productNameExclusionsQuery.error instanceof Error
      ? productNameExclusionsQuery.error.message
      : productNameExclusionsQuery.error
        ? '상품 연결 예외 기준을 불러오지 못했습니다.'
        : null
  const productStyleLookupQuery = useQuery({
    queryKey: ['invoice-product-name-all-styles', brand.id],
    queryFn: () => listAllStyleRefs(brand.id),
    enabled: reachedProduct && Boolean(inspection),
    ...criteriaQueryOptions,
  })
  // 규칙 저장 직후 수천 행 재변환이 입력을 막지 않도록 한 박자 늦춰 계산한다.
  const deferredOptionMaps = useDeferredValue(optionMaps)
  const deferredItemNameRules = useDeferredValue(itemNameRules)
  const deferredAccessoryRules = useDeferredValue(accessoryRules)
  const deferredProductNameMaps = useDeferredValue(productNameMaps)
  const deferredProductNameExclusions = useDeferredValue(productNameExclusions)
  const deferredProductNameTagRoles = useDeferredValue(productNameTagRoles)
  const usageTargets = useMemo(
    () => usageTargetsQuery.data ?? [],
    [usageTargetsQuery.data],
  )
  const usageAliases = useMemo(
    () => usageAliasesQuery.data ?? [],
    [usageAliasesQuery.data],
  )
  const usageFolders = useMemo(
    () => usageFoldersQuery.data ?? [],
    [usageFoldersQuery.data],
  )
  const mallResolution = useMemo(
    () =>
      inspection
        ? resolveInvoiceMalls(inspection.rows, usageTargets, usageAliases)
        : resolveInvoiceMalls([], [], []),
    [inspection, usageTargets, usageAliases],
  )
  const mallPartnersReady =
    !usageTargetsQuery.isPending &&
    !usageAliasesQuery.isPending &&
    !usageTargetsQuery.error &&
    !usageAliasesQuery.error
  const mallsReady =
    mallPartnersReady && isInvoiceMallReady(mallResolution)
  const headerReady = Boolean(
    inspection && inspection.missingHeaders.length === 0,
  )
  const fileReady = Boolean(
    headerReady && inspection && inspection.blockingRowCount === 0,
  )
  const maxStepIndex = !inspection
    ? 0
    : headerReady && mallsReady
      ? reachedStepIndex
      : Math.min(reachedStepIndex, 1)
  const stepIndex = Math.min(
    TODAY_STEPS.findIndex((item) => item.value === step),
    maxStepIndex,
  )
  const activeStep = TODAY_STEPS[stepIndex]!.value
  useEffect(() => {
    if (!inspection || !headerReady || !mallPartnersReady) return
    const autoKey = `${fileName}:${inspection.rowCount}:${mallResolution.unresolvedCount}`
    if (mallResolution.unresolvedCount === 0) {
      setMallDialogOpen(false)
      return
    }
    if (
      !uploadPipeline &&
      activeStep === 'check' &&
      mallAutoOpenedRef.current !== autoKey
    ) {
      mallAutoOpenedRef.current = autoKey
      setMallDialogOpen(true)
    }
  }, [
    activeStep,
    fileName,
    headerReady,
    inspection,
    mallPartnersReady,
    mallResolution.unresolvedCount,
    uploadPipeline,
  ])
  const visitedStepsRef = useRef(new Set<TodayStep>())
  visitedStepsRef.current.add(activeStep)
  const giftQueriesReady =
    giftRequestsQuery.isSuccess &&
    giftAllocationsQuery.isSuccess &&
    giftSourceMapsQuery.isSuccess &&
    productNameTagRolesQuery.isSuccess &&
    (giftSourceFileMapIds.length === 0 || giftSourceAllocationsQuery.isSuccess)
  const productQueriesReady =
    productNameMapsQuery.isSuccess &&
    productNameExclusionsQuery.isSuccess &&
    productNameTagRolesQuery.isSuccess &&
    productStyleLookupQuery.isSuccess &&
    giftSourceCriteriaReady
  const itemQueriesReady =
    optionMapsQuery.isSuccess &&
    itemNameRulesQuery.isSuccess &&
    accessoryRulesQuery.isSuccess &&
    productStyleLookupQuery.isSuccess
  const giftSourceSlots = useMemo(() => {
    if (!inspection) return []
    return collectGiftSourceSlots(
      inspection.rows,
      deferredProductNameTagRoles,
      giftSourceIgnoredKeySet,
      giftSourceEffectiveAppliedKeys,
    )
  }, [
    deferredProductNameTagRoles,
    giftSourceEffectiveAppliedKeys,
    giftSourceIgnoredKeySet,
    inspection,
  ])
  const giftSourceAppliedRowNumbers = useMemo(
    () =>
      new Set(
        giftSourceSlots
          .filter((slot) => giftSourceEffectiveAppliedKeys.has(slot.groupKey))
          .map((slot) => slot.source.rowNumber),
      ),
    [giftSourceEffectiveAppliedKeys, giftSourceSlots],
  )
  const productStyleCatalog = useMemo(
    () => catalogFromStyles(productStyleLookupQuery.data ?? []),
    [productStyleLookupQuery.data],
  )
  const productLookupIndex = useMemo(
    () =>
      buildProductNameLookupIndex(
        deferredProductNameMaps.filter((map) => map.isActive),
        deferredProductNameTagRoles,
      ),
    [deferredProductNameMaps, deferredProductNameTagRoles],
  )
  const itemNameIndex = useMemo(
    () =>
      buildItemNameTransformIndex(
        deferredOptionMaps,
        deferredItemNameRules,
        productStyleLookupQuery.data ?? [],
      ),
    [
      deferredItemNameRules,
      deferredOptionMaps,
      productStyleLookupQuery.data,
    ],
  )
  const workInstructionIndex = useMemo(
    () => buildWorkInstructionIndex(workInstructions),
    [workInstructions],
  )
  const giftSetupGroup = useMemo(() => {
    if (!inspection || !giftSetupTarget) return null
    return inspectGiftSourceGroup({
      rows: inspection.rows,
      mallName: giftSetupTarget.mallName,
      productName: giftSetupTarget.productName,
      tagRoles: deferredProductNameTagRoles,
      maps: giftSourceMaps,
      allocations: giftSourceAllocations,
      sessionRules: giftSourceSessionRuleMap,
      sessionAllocations: giftSourceSessionAllocationMap,
      ignoredKeys: giftSourceIgnoredKeySet,
      appliedKeys: giftSourceEffectiveAppliedKeys,
    })
  }, [
    deferredProductNameTagRoles,
    giftSetupTarget,
    giftSourceAllocations,
    giftSourceEffectiveAppliedKeys,
    giftSourceIgnoredKeySet,
    giftSourceMaps,
    giftSourceSessionAllocationMap,
    giftSourceSessionRuleMap,
    inspection,
  ])
  const processRowsCacheRef = useRef<{
    inspectionRows: SabangnetOrderRow[]
    signature: string
    rows: SabangnetOrderRow[]
  } | null>(null)
  const productExclusionSigRef = useRef('')
  const giftSourcePlanRef = useRef(emptyGiftSourcePlan())
  const giftSourceSigRef = useRef('')
  const productCacheRef = useRef<{
    base: InvoiceProductNameTransformation
    product: InvoiceProductNameTransformation
  } | null>(null)
  const campaignRows = useMemo(
    () =>
      (inspection?.rows ?? []).filter(
        (row) => !giftSourceAppliedRowNumbers.has(row.rowNumber),
      ),
    [giftSourceAppliedRowNumbers, inspection],
  )
  const giftCompute = useInvoiceStepCompute({
    enabled:
      Boolean(inspection) &&
      giftQueriesReady &&
      reachedGift,
    depsKey: invoiceStepDepsKey([
      fileName,
      inspection?.rowCount,
      campaignRows.length,
      giftSeed,
      excludedGiftStyleIds.join(','),
      JSON.stringify(giftResolutions),
      giftRequests.length,
      giftAllocations.length,
      giftSourceMaps.length,
      giftSourceAllocations.length,
      [...giftSourceEffectiveAppliedKeys].join(','),
      giftSourceIgnoredKeys.join(','),
      Object.keys(giftSourceSessionRules).join(','),
      giftExclusionSig,
      deferredProductNameTagRoles.length,
    ]),
    label: 'gift-unified-plan',
    jobRef: workJobRef,
    stage: 'gift',
    compute: () => {
      const excluded = new Set(
        productExclusionSigRef.current
          .split(',')
          .filter(Boolean)
          .map((value) => Number(value)),
      )
      const rows = (inspection?.rows ?? []).filter(
        (row) =>
          !excluded.has(row.rowNumber) &&
          !giftSourceAppliedRowNumbers.has(row.rowNumber),
      )
      const eligibility = planInvoicePrefixes(
        rows,
        giftRequests,
        giftResolutions,
      )
      return {
        eligibility,
        unified: planUnifiedGifts({
          campaignRows: rows,
          sourceRows: inspection!.rows,
          prefixPlan: eligibility,
          requests: giftRequests,
          seed: giftSeed,
          excludedGiftStyleIds,
          existingAllocations: giftAllocations,
          tagRoles: deferredProductNameTagRoles,
          maps: giftSourceMaps,
          sourceAllocations: giftSourceAllocations,
          sessionRules: giftSourceSessionRuleMap,
          sessionAllocations: giftSourceSessionAllocationMap,
          ignoredKeys: giftSourceIgnoredKeySet,
          appliedKeys: giftSourceEffectiveAppliedKeys,
          sourceSlots: giftSourceSlots,
        }),
      }
    },
  })
  const giftEligibilityPlan = giftCompute.result?.eligibility ?? null
  const giftPlan = giftCompute.result?.unified.giftPlan ?? null
  const giftSourcePlan =
    giftCompute.result?.unified.giftSourcePlan ?? emptyGiftSourcePlan()
  if (giftCompute.status === 'ready' && giftCompute.result) {
    giftSourcePlanRef.current = giftSourcePlan
    giftSourceSigRef.current = giftSourcePlan.groups
      .map((group) => `${group.key}:${group.status}`)
      .join(',')
  }
  const productCompute = useInvoiceStepCompute({
    enabled:
      Boolean(inspection) &&
      productQueriesReady &&
      reachedProduct,
    depsKey: invoiceStepDepsKey([
      fileName,
      inspection?.rowCount,
      deferredProductNameMaps.length,
      deferredProductNameExclusions.length,
      deferredProductNameTagRoles.length,
      productStyleLookupQuery.data?.length,
      giftSourceSigRef.current,
    ]),
    label: 'product-transform',
    jobRef: workJobRef,
    stage: 'product',
    compute: () => {
      const base = transformInvoiceProductNames(
        inspection!.rows,
        deferredProductNameMaps,
        productStyleCatalog,
        deferredProductNameTagRoles,
        deferredProductNameExclusions,
        productLookupIndex,
      )
      return {
        base,
        product: overlayGiftSourceOnProductNames(
          base,
          giftSourcePlanRef.current,
        ),
      }
    },
  })
  if (productCompute.result) {
    productCacheRef.current = productCompute.result
  } else if (productCompute.status === 'error') {
    productCacheRef.current = null
  }
  const baseProductTransformation =
    productCompute.result?.base ?? productCacheRef.current?.base ?? null
  const productTransformation =
    productCompute.result?.product ?? productCacheRef.current?.product ?? null
  const excludedRowSignature = useMemo(() => {
    if (!baseProductTransformation) return ''
    return baseProductTransformation.rows
      .filter((row) => row.status === 'excluded')
      .map((row) => row.source.rowNumber)
      .sort((left, right) => left - right)
      .join(',')
  }, [baseProductTransformation])
  productExclusionSigRef.current = excludedRowSignature
  useEffect(() => {
    setGiftExclusionSig(excludedRowSignature)
  }, [excludedRowSignature])
  const processRows = useMemo(() => {
    if (!inspection) {
      processRowsCacheRef.current = null
      return []
    }
    const cached = processRowsCacheRef.current
    if (
      cached &&
      cached.inspectionRows === inspection.rows &&
      cached.signature === excludedRowSignature
    ) {
      return cached.rows
    }
    const excluded = excludedRowSignature
      ? new Set(
          excludedRowSignature.split(',').map((value) => Number(value)),
        )
      : null
    const rows =
      !excluded || excluded.size === 0
        ? inspection.rows
        : inspection.rows.filter((row) => !excluded.has(row.rowNumber))
    processRowsCacheRef.current = {
      inspectionRows: inspection.rows,
      signature: excludedRowSignature,
      rows,
    }
    return rows
  }, [excludedRowSignature, inspection])
  const prefixRows = useMemo(
    () =>
      processRows.filter(
        (row) => !giftSourceAppliedRowNumbers.has(row.rowNumber),
      ),
    [giftSourceAppliedRowNumbers, processRows],
  )
  const workCompute = useInvoiceStepCompute({
    enabled:
      Boolean(inspection) &&
      workInstructionsQuery.isSuccess &&
      reachedInstruction,
    depsKey: invoiceStepDepsKey([
      fileName,
      processRows.length,
      excludedRowSignature,
      workInstructions.length,
    ]),
    label: 'work-plan',
    jobRef: workJobRef,
    stage: 'instruction',
    compute: () =>
      planWorkInstructions(processRows, workInstructions, workInstructionIndex),
  })
  const workPlan = workCompute.result
  const canComputeItemTransformation = Boolean(
    inspection &&
      productTransformation &&
      itemQueriesReady &&
      !optionMapsQuery.error &&
      !itemNameRulesQuery.error &&
      !accessoryRulesQuery.error &&
      !productStyleLookupQuery.error,
  )
  const computeItemTransformation =
    useCallback((): InvoiceItemNameTransformation | null => {
      if (!inspection || !productTransformation || !canComputeItemTransformation) {
        return null
      }
      return timeInvoiceWork(
        'item-transform',
        () =>
          transformInvoiceItemNames(
            inspection.rows,
            deferredOptionMaps,
            productTransformation.rows,
            deferredItemNameRules,
            deferredAccessoryRules,
            productStyleLookupQuery.data ?? [],
            itemNameIndex,
          ),
        workJobRef.current,
      )
    }, [
      canComputeItemTransformation,
      deferredAccessoryRules,
      deferredItemNameRules,
      deferredOptionMaps,
      inspection,
      itemNameIndex,
      productStyleLookupQuery.data,
      productTransformation,
    ])
  const itemCacheRef = useRef<InvoiceItemNameTransformation | null>(null)
  const itemCompute = useInvoiceStepCompute({
    enabled:
      Boolean(inspection) &&
      itemQueriesReady &&
      productCompute.status === 'ready' &&
      reachedItem,
    depsKey: invoiceStepDepsKey([
      fileName,
      productTransformation?.mappedRowCount,
      productTransformation?.unresolvedRowCount,
      productTransformation?.excludedRowCount,
      deferredOptionMaps.length,
      deferredItemNameRules.length,
      deferredAccessoryRules.length,
      productStyleLookupQuery.data?.length,
    ]),
    label: 'item-transform',
    jobRef: workJobRef,
    stage: 'item',
    compute: () => {
      const next = computeItemTransformation()
      if (!next) {
        throw new Error('내품명 변환 기준이 아직 준비되지 않았습니다.')
      }
      itemCacheRef.current = next
      return next
    },
  })
  const itemTransformation = itemCompute.result ?? itemCacheRef.current
  const stockHoldBundles = useMemo(() => {
    if (!inspection || !productTransformation) return []
    return buildStockHoldCandidateBundles({
      sourceRows: inspection.rows,
      productRows: productTransformation.rows,
      itemRows: itemTransformation?.rows ?? null,
      discontinued: discontinuedStylesQuery.data ?? [],
      preorderHolds: preorderHoldsQuery.data ?? [],
    })
  }, [
    discontinuedStylesQuery.data,
    inspection,
    itemTransformation,
    preorderHoldsQuery.data,
    productTransformation,
  ])
  const stockHoldBundleKeySig = useMemo(
    () =>
      stockHoldBundles
        .map((bundle) => `${bundle.key}:${bundle.rowNumbers.join(',')}`)
        .join('|'),
    [stockHoldBundles],
  )
  const defaultStockHoldExcludedRowNumbers = useMemo(
    () => excludedRowNumbersFromStockHoldBundles(stockHoldBundles),
    [stockHoldBundles],
  )
  useEffect(() => {
    setStockHoldExcludedOverride(null)
  }, [stockHoldBundleKeySig])
  const stockHoldExcludedRowNumbers =
    stockHoldExcludedOverride ?? defaultStockHoldExcludedRowNumbers
  const stockHoldExcludedSet = useMemo(
    () => new Set(stockHoldExcludedRowNumbers),
    [stockHoldExcludedRowNumbers],
  )
  const listCompute = useInvoiceStepCompute({
    enabled:
      reachedStepIndex >= TODAY_STEP_INDEX.list &&
      Boolean(
        productTransformation && itemTransformation && workPlan && giftPlan,
      ),
    depsKey: invoiceStepDepsKey([
      fileName,
      productTransformation?.mappedRowCount,
      itemTransformation?.mappedRowCount,
      giftPlan?.shipments.length,
      workPlan?.matchedRowCount,
      stockHoldExcludedRowNumbers.join(','),
    ]),
    label: 'product-list-outgoing',
    jobRef: workJobRef,
    stage: 'list',
    compute: () => {
      const productRows =
        stockHoldExcludedSet.size === 0
          ? productTransformation!.rows
          : productTransformation!.rows.filter(
              (row) => !stockHoldExcludedSet.has(row.source.rowNumber),
            )
      const itemRows =
        stockHoldExcludedSet.size === 0
          ? itemTransformation!.rows
          : itemTransformation!.rows.filter(
              (row) => !stockHoldExcludedSet.has(row.source.rowNumber),
            )
      return buildOutgoingComponentRowsFromStages({
        productRows,
        itemRows,
        giftRowsBySource: giftPlan!.giftsBySourceRowNumber,
        giftAssignments: giftPlan!.shipments.flatMap(
          (item) => item.assignments,
        ),
        packingMaterials: workPlan!.materialTotals,
      })
    },
  })
  const outputCompute = useInvoiceStepCompute({
    enabled:
      reachedStepIndex >= TODAY_STEP_INDEX.output &&
      Boolean(
        productTransformation && itemTransformation && workPlan && giftPlan,
      ),
    depsKey: invoiceStepDepsKey([
      fileName,
      productTransformation?.mappedRowCount,
      itemTransformation?.mappedRowCount,
      giftPlan?.shipments.length,
      workPlan?.matchedRowCount,
      stockHoldExcludedRowNumbers.join(','),
    ]),
    label: 'invoice-output-rows',
    jobRef: workJobRef,
    stage: 'output',
    compute: () => {
      const productTransformationForOutput =
        stockHoldExcludedSet.size === 0
          ? productTransformation!
          : {
              ...productTransformation!,
              rows: productTransformation!.rows.filter(
                (row) => !stockHoldExcludedSet.has(row.source.rowNumber),
              ),
            }
      const itemTransformationForOutput =
        stockHoldExcludedSet.size === 0
          ? itemTransformation!
          : {
              ...itemTransformation!,
              rows: itemTransformation!.rows.filter(
                (row) => !stockHoldExcludedSet.has(row.source.rowNumber),
              ),
            }
      return buildInvoiceOutputRows({
        workMatches: workPlan!.matchByRowNumber,
        giftRowsBySource: giftPlan!.giftsBySourceRowNumber,
        giftAssignments: giftPlan!.shipments.flatMap(
          (item) => item.assignments,
        ),
        productTransformation: productTransformationForOutput,
        itemTransformation: itemTransformationForOutput,
      })
    },
  })
  const giftStageError = Boolean(
    giftRequestsError ||
      giftSourceMapsError ||
      giftSourceAllocationsError ||
      giftAllocationsQuery.error ||
      giftCompute.error,
  )
  const giftStageSettled =
    giftStageError || isStepComputeSettled(giftCompute.status)
  const workStageSettled =
    Boolean(workInstructionsError) || isStepComputeSettled(workCompute.status)
  const productStageError = Boolean(
    productNameMapsError ||
      productNameExclusionsError ||
      giftSourceMapsError ||
      giftSourceAllocationsError ||
      productCompute.error,
  )
  const productStageSettled =
    productStageError || isStepComputeSettled(productCompute.status)
  const itemStageSettled =
    Boolean(itemNameCriteriaError) ||
    productStageError ||
    isStepComputeSettled(itemCompute.status)
  const canBuildLaterStages = Boolean(
    productTransformation && itemTransformation && workPlan && giftPlan,
  )
  const laterStageSupportEnabled =
    Boolean(inspection) &&
    headerReady &&
    reachedStepIndex >= TODAY_STEP_INDEX.list
  const laterWarehouseSetQuery = useQuery({
    queryKey: ['warehouse-inventory-set', brand.id],
    queryFn: () => getActiveWarehouseInventorySet(brand.id),
    enabled: laterStageSupportEnabled,
  })
  const laterWarehousePositionsQuery = useQuery({
    queryKey: [
      'warehouse-stock-positions',
      brand.id,
      laterWarehouseSetQuery.data?.id,
    ],
    queryFn: () =>
      getWarehouseStockPositions(brand.id, laterWarehouseSetQuery.data!.id),
    enabled:
      laterStageSupportEnabled && Boolean(laterWarehouseSetQuery.data?.id),
  })
  const laterBrandFieldsQuery = useQuery({
    queryKey: ['brand-fields', brand.id],
    queryFn: () => getBrandFields(brand.id),
    enabled:
      laterStageSupportEnabled &&
      reachedStepIndex >= TODAY_STEP_INDEX.output,
  })
  const laterPackingField = useMemo(() => {
    const target = normalizePackingSizeValue(PACKING_SIZE_SOURCE_FIELD_LABEL)
    return (
      laterBrandFieldsQuery.data?.find(
        (item) => normalizePackingSizeValue(item.label) === target,
      ) ?? null
    )
  }, [laterBrandFieldsQuery.data])
  const laterPackingMapsQuery = useQuery({
    queryKey: [
      'invoice-packing-size-maps',
      brand.id,
      laterPackingField?.id ?? '',
    ],
    queryFn: () => getInvoicePackingSizeMaps(brand.id, laterPackingField!.id),
    enabled:
      laterStageSupportEnabled &&
      reachedStepIndex >= TODAY_STEP_INDEX.output &&
      Boolean(laterPackingField?.id),
  })
  const laterStylesQuery = useQuery({
    queryKey: ['styles', brand.id],
    queryFn: () => getStylesByBrand(brand.id),
    enabled:
      laterStageSupportEnabled &&
      reachedStepIndex >= TODAY_STEP_INDEX.output,
  })
  const productListSupportBusyLabel = (() => {
    if (!laterStageSupportEnabled) return null
    if (laterWarehouseSetQuery.isPending) {
      return '창고 재고를 불러오고 있습니다.'
    }
    if (
      laterWarehouseSetQuery.data?.id &&
      laterWarehousePositionsQuery.isPending
    ) {
      return '창고 자리를 불러오고 있습니다.'
    }
    return null
  })()
  const outputSupportBusyLabel = (() => {
    if (
      !laterStageSupportEnabled ||
      reachedStepIndex < TODAY_STEP_INDEX.output
    ) {
      return null
    }
    if (laterStylesQuery.isPending || laterBrandFieldsQuery.isPending) {
      return '상품·포장 기준을 불러오고 있습니다.'
    }
    if (laterPackingField && laterPackingMapsQuery.isPending) {
      return '포장 규격을 불러오고 있습니다.'
    }
    return productListSupportBusyLabel
  })()
  const productAiAutoCollect =
    uploadPipeline &&
    headerReady &&
    giftStageSettled &&
    giftExclusionSig === excludedRowSignature &&
    productCompute.status === 'ready'
  const itemAiAutoCollect =
    uploadPipeline && headerReady && itemCompute.status === 'ready'
  const handleProductAiProgress = useCallback(
    (progress: { collecting: boolean; done: number; total: number }) => {
      if (workGenerationRef.current !== workGeneration) return
      setProductAiPipeline((current) => ({
        ...current,
        collecting: progress.collecting,
        done: progress.done,
        total: progress.total,
      }))
    },
    [workGeneration],
  )
  const handleProductAiSettled = useCallback(() => {
    if (workGenerationRef.current !== workGeneration) return
    markInvoiceWorkStage(workJobRef.current, 'product-ai')
    setProductAiPipeline((current) =>
      current.settled
        ? current
        : { ...current, settled: true, collecting: false },
    )
  }, [workGeneration])
  const handleItemAiProgress = useCallback(
    (progress: { collecting: boolean; done: number; total: number }) => {
      if (workGenerationRef.current !== workGeneration) return
      setItemAiPipeline((current) => ({
        ...current,
        collecting: progress.collecting,
        done: progress.done,
        total: progress.total,
      }))
    },
    [workGeneration],
  )
  const handleItemAiSettled = useCallback(() => {
    if (workGenerationRef.current !== workGeneration) return
    markInvoiceWorkStage(workJobRef.current, 'item-ai')
    setItemAiPipeline((current) =>
      current.settled
        ? current
        : { ...current, settled: true, collecting: false },
    )
  }, [workGeneration])
  useEffect(() => {
    if (!uploadPipeline) return
    if (productStageError) {
      setProductAiPipeline((current) =>
        current.settled
          ? current
          : { ...current, settled: true, collecting: false },
      )
    }
  }, [productStageError, uploadPipeline])
  useEffect(() => {
    if (!uploadPipeline) return
    if (itemStageSettled && itemCompute.status !== 'ready') {
      setItemAiPipeline((current) =>
        current.settled
          ? current
          : { ...current, settled: true, collecting: false },
      )
    }
  }, [itemCompute.status, itemStageSettled, uploadPipeline])
  useEffect(() => {
    if (!uploadPipeline || !workJobRef.current) return
    if (
      giftQueriesReady &&
      workInstructionsQuery.isSuccess &&
      productQueriesReady &&
      itemQueriesReady
    ) {
      markInvoiceWorkStage(workJobRef.current, 'criteria')
    }
  }, [
    giftQueriesReady,
    itemQueriesReady,
    productQueriesReady,
    uploadPipeline,
    workInstructionsQuery.isSuccess,
  ])
  useEffect(() => {
    if (!uploadPipeline || isParsing) return
    if (!headerReady) {
      setUploadPipeline(false)
      return
    }
    if (excludedRowSignature !== giftExclusionSig) return
    if (
      !giftStageSettled ||
      !workStageSettled ||
      !productStageSettled ||
      !itemStageSettled
    ) {
      return
    }
    if (canBuildLaterStages) {
      if (!isStepComputeSettled(listCompute.status)) return
      if (!isStepComputeSettled(outputCompute.status)) return
    }
    if (!productAiPipeline.settled || !itemAiPipeline.settled) return
    finishInvoiceWorkJob(workJobRef.current)
    setUploadPipeline(false)
  }, [
    canBuildLaterStages,
    excludedRowSignature,
    giftExclusionSig,
    giftStageSettled,
    headerReady,
    isParsing,
    itemAiPipeline.settled,
    itemStageSettled,
    listCompute.status,
    outputCompute.status,
    productAiPipeline.settled,
    productStageSettled,
    uploadPipeline,
    workStageSettled,
  ])
  const nameRulesError =
    nameRulesQuery.error instanceof Error
      ? nameRulesQuery.error.message
      : nameRulesQuery.error
        ? '송장 자체품번코드 기준을 불러오지 못했습니다.'
        : null

  function selectView(view: InvoiceView) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (view === 'today') next.delete('view')
      else next.set('view', view)
      return next
    })
  }

  function resetGiftState() {
    setGiftResolutions({})
    setGiftSeed(createGiftSeed())
    setExcludedGiftStyleIds([])
    setStockHoldExcludedOverride(null)
    setGiftSourceSessionRules({})
    setGiftSourceSessionAllocations({})
    setGiftSourceIgnoredKeys([])
    setGiftSourceApplyingKey(null)
    setGiftSourceError(null)
    setGiftSourceAppliedKeys([])
    setGiftSetupTarget(null)
  }

  function resetFile() {
    workGenerationRef.current += 1
    setWorkGeneration(workGenerationRef.current)
    workJobRef.current = null
    visitedStepsRef.current = new Set<TodayStep>(['upload'])
    itemCacheRef.current = null
    processRowsCacheRef.current = null
    productCacheRef.current = null
    productExclusionSigRef.current = ''
    giftSourcePlanRef.current = emptyGiftSourcePlan()
    giftSourceSigRef.current = ''
    mallAutoOpenedRef.current = null
    setMallDialogOpen(false)
    setInspection(null)
    setFileName('')
    setError(null)
    setProductSaveBlockCount(0)
    setReachedStepIndex(0)
    setGiftExclusionSig('')
    setUploadPipeline(false)
    setProductAiPipeline(IDLE_UPLOAD_AI)
    setItemAiPipeline(IDLE_UPLOAD_AI)
    setStep('upload')
    resetGiftState()
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
      setError('사방넷에서 내려받은 엑셀 파일(.xlsx, .xls)을 선택해주세요.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('파일이 50MB를 넘습니다. 주문 기간을 나눠서 내려받아 주세요.')
      return
    }

    workGenerationRef.current += 1
    setWorkGeneration(workGenerationRef.current)
    const generation = workGenerationRef.current
    workJobRef.current = createInvoiceWorkJob()
    setIsParsing(true)
    setUploadPipeline(true)
    setProductAiPipeline(PENDING_UPLOAD_AI)
    setItemAiPipeline(PENDING_UPLOAD_AI)
    setError(null)
    visitedStepsRef.current = new Set<TodayStep>(['upload'])
    itemCacheRef.current = null
    processRowsCacheRef.current = null
    productCacheRef.current = null
    productExclusionSigRef.current = ''
    giftSourcePlanRef.current = emptyGiftSourcePlan()
    giftSourceSigRef.current = ''
    mallAutoOpenedRef.current = null
    setMallDialogOpen(false)
    setInspection(null)
    setFileName(file.name)
    setProductSaveBlockCount(0)
    setReachedStepIndex(0)
    setGiftExclusionSig('')
    resetGiftState()

    try {
      const nextInspection = await parseSabangnetInvoiceFile(file)
      if (generation !== workGenerationRef.current) return
      markInvoiceWorkStage(workJobRef.current, 'parse', {
        rows: nextInspection.rowCount,
      })
      setInspection(nextInspection)
      setStep('check')
      if (nextInspection.missingHeaders.length === 0) {
        setReachedStepIndex(TODAY_STEP_INDEX.output)
      } else {
        setReachedStepIndex(TODAY_STEP_INDEX.check)
        setUploadPipeline(false)
        setProductAiPipeline(IDLE_UPLOAD_AI)
        setItemAiPipeline(IDLE_UPLOAD_AI)
      }
    } catch (reason) {
      if (generation !== workGenerationRef.current) return
      setUploadPipeline(false)
      setProductAiPipeline(IDLE_UPLOAD_AI)
      setItemAiPipeline(IDLE_UPLOAD_AI)
      workJobRef.current = null
      setError(
        reason instanceof Error
          ? reason.message
          : '파일을 읽지 못했습니다. 사방넷 원본 엑셀인지 확인해주세요.',
      )
    } finally {
      if (generation === workGenerationRef.current) {
        setIsParsing(false)
      }
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function changeTodayStep(next: TodayStep) {
    if (TODAY_STEP_INDEX[next] > reachedStepIndex) return
    if (
      step === 'product' &&
      next !== 'product' &&
      productSaveBlockCount > 0
    ) {
      return
    }
    setStep(next)
  }

  function goNextStep(next: TodayStep) {
    if (
      step === 'product' &&
      next !== 'product' &&
      productSaveBlockCount > 0
    ) {
      return
    }
    setReachedStepIndex((current) =>
      Math.max(current, TODAY_STEP_INDEX[next]),
    )
    setStep(next)
  }

  function markGiftSourceApplied(key: string) {
    setGiftSourceAppliedKeys((current) =>
      current.includes(key) ? current : [...current, key],
    )
    setGiftSourceIgnoredKeys((current) => current.filter((item) => item !== key))
    setGiftSetupTarget(null)
  }

  function applyGiftSourceSession(
    group: GiftSourceGroup,
    rule: GiftSourceSessionRule,
  ) {
    setGiftSourceError(null)
    setGiftSourceSessionRules((current) => ({ ...current, [group.key]: rule }))
    markGiftSourceApplied(group.key)
  }

  async function applyGiftSourcePersist(
    group: GiftSourceGroup,
    rule: GiftSourceSessionRule,
  ) {
    setGiftSourceApplyingKey(group.key)
    setGiftSourceError(null)
    try {
      await saveInvoiceGiftSourceMap(brand.id, {
        mallName: group.mallName,
        productName: group.productName,
        assignmentMode: rule.assignmentMode,
        styleIds: rule.poolStyles.map((style) => style.styleId),
        uniquePerRecipient: true,
      })
      setGiftSourceSessionRules((current) => ({ ...current, [group.key]: rule }))
      markGiftSourceApplied(group.key)
      await queryClient.invalidateQueries({
        queryKey: ['invoice-gift-source-maps', brand.id],
      })
    } catch (error) {
      setGiftSourceError(
        error instanceof Error
          ? error.message
          : '사은품 원본행 설정을 저장하지 못했습니다.',
      )
    } finally {
      setGiftSourceApplyingKey(null)
    }
  }

  const todayStepBusyLabel = ((): string | null => {
    if (activeView !== 'today') return null
    if (isParsing) return '파일을 확인하고 있습니다.'
    if (uploadPipeline) {
      if (!giftQueriesReady && !giftStageError) {
        return '사은품 기준을 불러오고 있습니다.'
      }
      if (!giftStageSettled) {
        return '사은품 추가를 계산하고 있습니다.'
      }
      if (workInstructionsQuery.isLoading && !workInstructionsError) {
        return '작업 지시를 불러오고 있습니다.'
      }
      if (!workStageSettled) {
        return '작업 지시를 계산하고 있습니다.'
      }
      if (!productQueriesReady && !productStageError) {
        return '품목명 변환 기준을 불러오고 있습니다.'
      }
      if (!productStageSettled) {
        return '품목명 변환을 계산하고 있습니다.'
      }
      if (!productAiPipeline.settled) {
        if (productAiPipeline.collecting && productAiPipeline.total > 0) {
          return `품목명 전체 AI 추천을 모으고 있습니다. ${formatNumber(productAiPipeline.done)} / ${formatNumber(productAiPipeline.total)}`
        }
        return '품목명 전체 AI 추천을 준비하고 있습니다.'
      }
      if (itemNameCriteriaLoading && !itemNameCriteriaError) {
        return '내품명 변환 기준을 불러오고 있습니다.'
      }
      if (!itemStageSettled) {
        return '내품명 변환을 계산하고 있습니다.'
      }
      if (!itemAiPipeline.settled) {
        if (itemAiPipeline.collecting && itemAiPipeline.total > 0) {
          return `내품명 추천을 모으고 있습니다. ${formatNumber(itemAiPipeline.done)} / ${formatNumber(itemAiPipeline.total)}`
        }
        return '내품명 추천을 준비하고 있습니다.'
      }
      if (
        canBuildLaterStages &&
        !isStepComputeSettled(listCompute.status)
      ) {
        return '상품 리스트를 계산하고 있습니다.'
      }
      if (
        canBuildLaterStages &&
        !isStepComputeSettled(outputCompute.status)
      ) {
        return '최종 행을 계산하고 있습니다.'
      }
      if (canBuildLaterStages && outputSupportBusyLabel) {
        return outputSupportBusyLabel
      }
      if (canBuildLaterStages && productListSupportBusyLabel) {
        return productListSupportBusyLabel
      }
      return '업로드 작업을 마무리하고 있습니다.'
    }
    if (activeStep === 'check') {
      if (
        usageTargetsQuery.isLoading ||
        usageAliasesQuery.isLoading ||
        usageFoldersQuery.isLoading
      ) {
        return '사이트 연결 기준을 불러오고 있습니다.'
      }
      return null
    }
    if (activeStep === 'gift') {
      if (
        giftRequestsError ||
        giftSourceMapsError ||
        giftSourceAllocationsError ||
        giftCompute.error
      ) {
        return null
      }
      if (!giftQueriesReady) return '사은품 기준을 불러오고 있습니다.'
      if (
        giftCompute.status === 'computing' ||
        !giftPlan ||
        !giftEligibilityPlan
      ) {
        return '사은품 추가를 계산하고 있습니다.'
      }
      return null
    }
    if (activeStep === 'instruction') {
      if (workInstructionsError || workCompute.error) return null
      if (workInstructionsQuery.isLoading) {
        return '작업 지시를 불러오고 있습니다.'
      }
      if (workCompute.status === 'computing' || !workPlan) {
        return '작업 지시를 계산하고 있습니다.'
      }
      return null
    }
    if (activeStep === 'product') {
      if (
        productNameMapsError ||
        productNameExclusionsError ||
        giftSourceMapsError ||
        giftSourceAllocationsError ||
        productCompute.error
      ) {
        return null
      }
      if (!productQueriesReady) return '품목명 변환 기준을 불러오고 있습니다.'
      if (productCompute.status === 'computing') {
        return '품목명 변환을 계산하고 있습니다.'
      }
      return null
    }
    if (activeStep === 'item') {
      if (itemNameCriteriaError || itemCompute.error) return null
      if (itemNameCriteriaLoading) {
        return '내품명 변환 기준을 불러오고 있습니다.'
      }
      if (itemCompute.status === 'computing') {
        return '내품명 변환을 계산하고 있습니다.'
      }
      return null
    }
    if (activeStep === 'stock') {
      if (!itemTransformation || !workPlan || !giftPlan) {
        return '이전 단계 결과를 기다리고 있습니다.'
      }
      if (
        discontinuedStylesQuery.isLoading ||
        preorderHoldsQuery.isLoading
      ) {
        return '단종·예발 기준을 불러오고 있습니다.'
      }
      return null
    }
    if (activeStep === 'list') {
      if (listCompute.error) return null
      if (listCompute.status === 'computing' || !listCompute.result) {
        return '상품 리스트를 계산하고 있습니다.'
      }
      if (productListSupportBusyLabel) return productListSupportBusyLabel
      return null
    }
    if (activeStep === 'output') {
      if (outputCompute.error) return null
      if (outputCompute.status === 'computing' || !outputCompute.result) {
        return '최종 행을 계산하고 있습니다.'
      }
      if (outputSupportBusyLabel) return outputSupportBusyLabel
      return null
    }
    return null
  })()

  return (
    <div>
      {todayStepBusyLabel ? (
        <TodayStepBusyOverlay
          label={todayStepBusyLabel}
          hint={
            uploadPipeline || isParsing
              ? '전 단계 계산과 AI 추천이 끝날 때까지 이 화면을 유지합니다. 자리를 비워도 됩니다.'
              : undefined
          }
        />
      ) : null}
      <PageHeader
        title="송장작업"
        description={`${brand.name} 사방넷 주문 파일을 확인하고 CJ 업로드용 엑셀로 바꾸는 작업 공간입니다.`}
      />

      <InvoiceViewTabs activeView={activeView} onChange={selectView} />

      {activeView === 'today' ? (
        <div className="space-y-4">
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <TodayStepProgress
              stepIndex={stepIndex}
              maxStepIndex={maxStepIndex}
              onChange={changeTodayStep}
            />
          </div>

          <TodayStepPanel
            active={activeStep === 'upload'}
            keepMounted={visitedStepsRef.current.has('upload')}
          >
            <Card>
              <CardHeader>
                <CardTitle>사방넷 파일 올리기</CardTitle>
                <CardDescription>
                  사방넷에서 받은 운송장출력용 엑셀을 수정하지 말고 그대로
                  올려주세요.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  role="button"
                  tabIndex={0}
                  aria-busy={isParsing}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      inputRef.current?.click()
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setIsDragging(false)
                    void handleFile(event.dataTransfer.files[0])
                  }}
                  onClick={() => inputRef.current?.click()}
                  className={cn(
                    'flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                    isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-muted/20 hover:bg-muted/40',
                  )}
                >
                  <div className="flex size-11 items-center justify-center rounded-full bg-muted">
                    <Upload className="size-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {isParsing
                        ? '파일을 안전하게 확인하고 있습니다...'
                        : '엑셀 파일을 여기에 놓으세요'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      또는 눌러서 파일 선택 · XLSX, XLS · 최대 50MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isParsing}
                    onClick={(event) => {
                      event.stopPropagation()
                      inputRef.current?.click()
                    }}
                  >
                    <FileSpreadsheet className="size-4" />
                    {isParsing ? '읽는 중...' : '사방넷 파일 선택'}
                  </Button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsm"
                    className="hidden"
                    onChange={(event) =>
                      void handleFile(event.target.files?.[0])
                    }
                  />
                </div>

                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                  <p>
                    받는 분 이름·전화번호·주소는 서버에 올리거나 저장하지 않고
                    브라우저 메모리에서만 읽습니다.
                  </p>
                </div>

                {error ? (
                  <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}

                {inspection ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <p className="min-w-0 truncate text-xs text-muted-foreground">
                      올린 파일 · {fileName}
                    </p>
                    <Button type="button" onClick={() => setStep('check')}>
                      파일 확인으로
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'check'}
            keepMounted={visitedStepsRef.current.has('check') && Boolean(inspection)}
          >
            {inspection ? (
            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>파일 점검 결과</CardTitle>
                    <Badge
                      variant={
                        fileReady
                          ? 'success'
                          : headerReady
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {fileReady
                        ? '원본 형식 확인 완료'
                        : headerReady
                          ? '일부 행 확인 필요'
                          : '다른 형식의 파일'}
                    </Badge>
                  </div>
                  <CardDescription className="mt-1">
                    {fileName} · {inspection.sheetName} 시트 · 헤더{' '}
                    {inspection.headerRowNumber}행
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryItem
                    label="불러온 상품 행"
                    value={`${formatNumber(inspection.rowCount)}행`}
                  />
                  <SummaryItem
                    label="고유 주문번호"
                    value={`${formatNumber(inspection.orderCount)}건`}
                    tone="success"
                  />
                  <SummaryItem
                    label="자체품번코드 빈 행"
                    value={`${formatNumber(inspection.missingProductCodeCount)}행`}
                    tone={
                      inspection.missingProductCodeCount > 0
                        ? 'warning'
                        : 'success'
                    }
                  />
                  <SummaryItem
                    label="배송 필수값 확인 필요"
                    value={`${formatNumber(inspection.blockingRowCount)}행`}
                    tone={
                      inspection.blockingRowCount > 0 ? 'danger' : 'success'
                    }
                  />
                </div>

                {inspection.missingHeaders.length > 0 ? (
                  <div className="rounded-lg border border-danger/30 bg-danger/10 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                      <div>
                        <p className="text-sm font-medium text-danger">
                          사방넷 필수 항목을 찾지 못했습니다.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          빠진 항목: {inspection.missingHeaders.join(', ')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : inspection.blockingRowCount > 0 ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                      <div>
                        <p className="text-sm font-medium">
                          배송 정보를 확인해주세요.
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          수령인 없음 {inspection.missingRecipientCount}행 ·
                          연락처 없음 {inspection.missingPhoneCount}행 · 주소
                          없음 {inspection.missingAddressCount}행 · 수량 오류{' '}
                          {inspection.invalidQuantityCount}행
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-4">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    <div>
                      <p className="text-sm font-medium text-success">
                        사방넷 원본 파일로 확인했습니다.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        13개 필수 열과 배송 필수값이 모두 있습니다. 같은
                        주문번호의 추가 상품 행은{' '}
                        {inspection.repeatedOrderRowCount}행입니다.
                      </p>
                    </div>
                  </div>
                )}

                {inspection.missingProductCodeCount > 0 && headerReady ? (
                  <p className="text-xs text-muted-foreground">
                    자체품번코드가 빈 행은 이번 단계에서 품목명을 바꾸지
                    않습니다. 코드 없는 행의 처리 방식은 자체품번코드 단계가
                    끝난 뒤 별도로 정합니다.
                  </p>
                ) : null}

                {headerReady ? (
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">사이트 연결</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          고유 {formatNumber(mallResolution.uniqueCount)}곳 ·
                          연결 완료 {formatNumber(mallResolution.matchedCount)}곳
                          · 연결 필요{' '}
                          {formatNumber(mallResolution.unresolvedCount)}곳
                        </p>
                      </div>
                      {mallResolution.unresolvedCount > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!mallPartnersReady}
                          onClick={() => setMallDialogOpen(true)}
                        >
                          사이트 연결
                        </Button>
                      ) : (
                        <Badge variant="success">연결 완료</Badge>
                      )}
                    </div>
                    {!mallPartnersReady && inspection ? (
                      <p className="text-xs text-muted-foreground">
                        출고업체 목록을 확인하는 중...
                      </p>
                    ) : usageTargetsQuery.error || usageAliasesQuery.error ? (
                      <p className="text-xs text-danger">
                        출고업체를 불러오지 못해 사이트를 연결할 수 없습니다.
                      </p>
                    ) : mallResolution.unresolvedCount > 0 ? (
                      <p className="text-xs text-warning">
                        미등록·빈 값·비활성 사이트를 정리하기 전에는 사은품
                        추가로 갈 수 없습니다.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <SabangnetOrderTable
                  rows={inspection.rows}
                  columnCount={inspection.columnCount}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={resetFile}>
                      <RotateCcw className="size-4" />
                      다른 파일 선택
                    </Button>
                    <StepSnapshotButton
                      stage="check"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={inspection.rows}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={!headerReady || !mallsReady}
                    onClick={() => goNextStep('gift')}
                  >
                    사은품 추가로
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'gift'}
            keepMounted={
              visitedStepsRef.current.has('gift') &&
              Boolean(inspection) &&
              headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>사은품 추가</CardTitle>
                <CardDescription>
                  원본 품목명으로 대상을 확인하고, 합포장별로 사은품 행을
                  만듭니다. 사은품 이름은 품목명에만 들어갑니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {!giftQueriesReady ||
                giftCompute.status === 'computing' ||
                !giftPlan ||
                !giftEligibilityPlan ? (
                  giftRequestsError ||
                  giftSourceMapsError ||
                  giftSourceAllocationsError ||
                  giftCompute.error ? (
                    <StepCriteriaError
                      message={
                        giftRequestsError ||
                        giftSourceMapsError ||
                        giftSourceAllocationsError ||
                        giftCompute.error ||
                        '사은품 추가를 계산하지 못했습니다.'
                      }
                      onRetry={() => {
                        void giftRequestsQuery.refetch()
                        void giftAllocationsQuery.refetch()
                        void giftSourceMapsQuery.refetch()
                        void giftSourceAllocationsQuery.refetch()
                        void productNameTagRolesQuery.refetch()
                      }}
                    />
                  ) : (
                    <StepCriteriaLoading
                      label={
                        giftQueriesReady
                          ? '이 파일의 사은품 추가를 계산하고 있습니다.'
                          : '이 브랜드의 사은품 기준을 불러오고 있습니다.'
                      }
                    />
                  )
                ) : (
                <InvoicePrefixStepPanel
                  brandId={brand.id}
                  rows={prefixRows}
                  requests={giftRequests}
                  existingAllocations={giftAllocations}
                  prefixPlan={giftEligibilityPlan}
                  giftPlan={giftPlan}
                  loading={false}
                  error={giftRequestsError}
                  resolutions={giftResolutions}
                  onResolve={(key, requestId) =>
                    setGiftResolutions((current) => ({
                      ...current,
                      [key]: requestId,
                    }))
                  }
                  giftSeed={giftSeed}
                  excludedGiftStyleIds={excludedGiftStyleIds}
                  onRedrawGifts={() => setGiftSeed(createGiftSeed())}
                  onToggleExcludeGift={(styleId) =>
                    setExcludedGiftStyleIds((current) =>
                      current.includes(styleId)
                        ? current.filter((id) => id !== styleId)
                        : [...current, styleId],
                    )
                  }
                  sourceFileName={fileName}
                />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep('check')}
                    >
                      <ArrowLeft className="size-4" />
                      파일 확인으로
                    </Button>
                    <StepSnapshotButton
                      stage="gift"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={inspection.rows}
                      giftPlan={giftPlan}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={!giftPlan}
                    onClick={() => goNextStep('instruction')}
                  >
                    작업 지시로
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'instruction'}
            keepMounted={
              visitedStepsRef.current.has('instruction') &&
              Boolean(inspection) &&
              headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>작업 지시</CardTitle>
                <CardDescription>
                  활성 지시의 완전일치·시작어를 확인합니다. 항상이면 모든
                  주문에, 기간이면 주문일시가 그 안인 행에만 붙습니다. 표시
                  문구는 자체품번 변환이 끝난 최종 품목명 앞에 붙습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {workInstructionsQuery.isLoading ||
                workCompute.status === 'computing' ||
                !workPlan ? (
                  workInstructionsError || workCompute.error ? (
                    <StepCriteriaError
                      message={
                        workInstructionsError ||
                        workCompute.error ||
                        '작업 지시를 계산하지 못했습니다.'
                      }
                      onRetry={() => {
                        void workInstructionsQuery.refetch()
                      }}
                    />
                  ) : (
                    <StepCriteriaLoading
                      label={
                        workInstructionsQuery.isSuccess
                          ? '이 파일의 작업 지시를 계산하고 있습니다.'
                          : '이 브랜드의 작업 지시를 불러오고 있습니다.'
                      }
                    />
                  )
                ) : (
                <InvoiceWorkInstructionStepPanel
                  rows={processRows}
                  instructions={workInstructions}
                  workPlan={workPlan}
                  loading={false}
                  error={workInstructionsError}
                />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep('gift')}
                    >
                      <ArrowLeft className="size-4" />
                      사은품 추가로
                    </Button>
                    <StepSnapshotButton
                      stage="instruction"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={inspection.rows}
                      giftPlan={giftPlan}
                      workPlan={workPlan}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={!workPlan}
                    onClick={() => goNextStep('product')}
                  >
                    품목명 변환하기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'product'}
            keepMounted={
              reachedProduct && Boolean(inspection) && headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>품목명 변환</CardTitle>
                <CardDescription>
                  원본 품목명을 본품 공식명으로 바꿉니다. 품목명·품목명+내품명·
                  옵션 일부 결합 다음에 내품명 /·, 앞부분 단독을 보고, 내품명
                  전체 단독이 맞으면 내품명을 비웁니다. 앞부분 단독이 맞으면
                  남은 옵션만 다음 단계로 넘깁니다. 자체상품코드는 이 단계
                  조회 키로 쓰지 않습니다. 세트 구성품은 이 단계부터 행을
                  펼칩니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {productNameMapsQuery.isLoading ||
                productNameExclusionsQuery.isLoading ||
                productNameTagRolesQuery.isLoading ||
                productStyleLookupQuery.isLoading ||
                giftSourceMapsQuery.isLoading ||
                (giftSourceFileMapIds.length > 0 &&
                  giftSourceAllocationsQuery.isLoading) ||
                productCompute.status === 'computing' ? (
                  <StepCriteriaLoading
                    label={
                      productQueriesReady
                        ? '이 파일의 품목명 변환을 계산하고 있습니다.'
                        : '이 브랜드의 품목명 변환 기준을 불러오고 있습니다.'
                    }
                  />
                ) : productNameMapsError ||
                  productNameExclusionsError ||
                  productNameTagRolesQuery.error ||
                  productStyleLookupQuery.error ||
                  giftSourceMapsError ||
                  giftSourceAllocationsError ||
                  productCompute.error ? (
                  <StepCriteriaError
                    message={
                      productNameMapsError ||
                      productNameExclusionsError ||
                      giftSourceMapsError ||
                      giftSourceAllocationsError ||
                      productCompute.error ||
                      (productNameTagRolesQuery.error
                        ? '품목명 태그 역할을 불러오지 못했습니다.'
                        : productStyleLookupQuery.error instanceof Error
                          ? productStyleLookupQuery.error.message
                          : '상품 마스터를 대조하지 못했습니다.')
                    }
                    onRetry={() => {
                      void productNameMapsQuery.refetch()
                      void productNameExclusionsQuery.refetch()
                      void productNameTagRolesQuery.refetch()
                      void productStyleLookupQuery.refetch()
                      void giftSourceMapsQuery.refetch()
                      void giftSourceAllocationsQuery.refetch()
                    }}
                  />
                ) : productTransformation ? (
                  <InvoiceProductNameTransformPanel
                    key={`${fileName}:${workGeneration}`}
                    brandId={brand.id}
                    transformation={productTransformation}
                    renderUi={activeStep === 'product'}
                    autoCollect={productAiAutoCollect}
                    autoCollectKey={`${fileName}:${workGeneration}`}
                    onAutoCollectProgress={handleProductAiProgress}
                    onAutoCollectSettled={handleProductAiSettled}
                    onBlockingSaveCountChange={setProductSaveBlockCount}
                    giftGroups={giftSourcePlan.groups}
                    onOpenGiftSetup={(row) => {
                      setGiftSourceError(null)
                      setGiftSetupTarget({
                        mallName: row.mallName,
                        productName: row.productName,
                      })
                    }}
                  />
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={productSaveBlockCount > 0}
                      onClick={() => setStep('instruction')}
                    >
                      <ArrowLeft className="size-4" />
                      작업 지시로
                    </Button>
                    <StepSnapshotButton
                      stage="product"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={inspection.rows}
                      giftPlan={giftPlan}
                      workPlan={workPlan}
                      nameTransformation={nameTransformation}
                      productTransformation={productTransformation}
                      itemTransformation={itemTransformation}
                      resolveItemTransformation={computeItemTransformation}
                      disabled={
                        !productTransformation || productSaveBlockCount > 0
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={
                      !productTransformation || productSaveBlockCount > 0
                    }
                    onClick={() => goNextStep('item')}
                  >
                    내품명 변환하기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'item'}
            keepMounted={reachedItem && Boolean(inspection) && headerReady}
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>내품명 변환</CardTitle>
                <CardDescription>
                  공통 규칙 또는 조회 키 선택 규칙으로 내품명을 지거나 구성품
                  공식명으로 바꿉니다. 품목명 원장이 내품명 전체로 본품을 찾은
                  행은 빈 값으로 정리되어 여기 검토 목록에 나오지 않습니다.
                  내품명 / 또는 , 앞부분만으로 본품을 찾은 행은 남은 옵션만
                  여기서 변환합니다. 예전 조합 원장은 호환용으로만 읽습니다.
                  내품명 규칙의 M번호는 공식 내품명과 출고구성에만 넣고,
                  실제 세트 구성만 최종 CJ 행에서 펼칩니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {itemNameCriteriaLoading ||
                itemCompute.status === 'computing' ? (
                  <StepCriteriaLoading
                    label={
                      itemQueriesReady
                        ? '이 파일의 내품명 변환을 계산하고 있습니다.'
                        : '이 브랜드의 내품명 변환 기준을 불러오고 있습니다.'
                    }
                  />
                ) : itemNameCriteriaError || itemCompute.error ? (
                  <StepCriteriaError
                    message={
                      itemNameCriteriaError ||
                      itemCompute.error ||
                      '내품명 변환을 계산하지 못했습니다.'
                    }
                    onRetry={() => {
                      void optionMapsQuery.refetch()
                      void itemNameRulesQuery.refetch()
                      void accessoryRulesQuery.refetch()
                    }}
                  />
                ) : itemTransformation ? (
                  <InvoiceItemNameTransformPanel
                    key={`${fileName}:${workGeneration}`}
                    brandId={brand.id}
                    brandName={brand.name}
                    transformation={itemTransformation}
                    itemNameRules={itemNameRules}
                    accessoryRules={accessoryRules}
                    styles={productStyleLookupQuery.data ?? []}
                    renderUi={activeStep === 'item'}
                    autoCollect={itemAiAutoCollect}
                    autoCollectKey={`${fileName}:${workGeneration}`}
                    onAutoCollectProgress={handleItemAiProgress}
                    onAutoCollectSettled={handleItemAiSettled}
                  />
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep('product')}
                    >
                      <ArrowLeft className="size-4" />
                      품목명 변환으로
                    </Button>
                    <StepSnapshotButton
                      stage="item"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={inspection.rows}
                      giftPlan={giftPlan}
                      workPlan={workPlan}
                      nameTransformation={nameTransformation}
                      productTransformation={productTransformation}
                      itemTransformation={itemTransformation}
                      disabled={!itemTransformation}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={
                      !itemTransformation || !workPlan || !giftPlan
                    }
                    onClick={() => goNextStep('stock')}
                  >
                    재고·예약 보기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'stock'}
            keepMounted={
              reachedStock && Boolean(inspection) && headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>재고·예약</CardTitle>
                <CardDescription>
                  단종·재고부족·예약발송 상품을 모아 이번 송장에서 제외할지
                  유지할지 정합니다. 제외한 상품은 이후 상품 리스트와 최종
                  행에서 빠집니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {!itemTransformation || !workPlan || !giftPlan ? (
                  <StepCriteriaLoading label="이전 단계 결과를 기다리고 있습니다." />
                ) : discontinuedStylesQuery.error || preorderHoldsQuery.error ? (
                  <StepCriteriaError
                    message={
                      (discontinuedStylesQuery.error instanceof Error
                        ? discontinuedStylesQuery.error.message
                        : null) ||
                      (preorderHoldsQuery.error instanceof Error
                        ? preorderHoldsQuery.error.message
                        : null) ||
                      '단종·예발 기준을 불러오지 못했습니다.'
                    }
                    onRetry={() => {
                      void discontinuedStylesQuery.refetch()
                      void preorderHoldsQuery.refetch()
                    }}
                  />
                ) : (
                  <InvoiceStockHoldStepPanel
                    key={`${fileName}:${workGeneration}`}
                    bundles={stockHoldBundles}
                    loading={
                      discontinuedStylesQuery.isLoading ||
                      preorderHoldsQuery.isLoading
                    }
                    onExcludedRowNumbersChange={handleStockHoldExcludedChange}
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep('item')}
                  >
                    <ArrowLeft className="size-4" />
                    내품명 변환으로
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      !itemTransformation || !workPlan || !giftPlan
                    }
                    onClick={() => goNextStep('list')}
                  >
                    상품 리스트 보기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'list'}
            keepMounted={
              visitedStepsRef.current.has('list') &&
              Boolean(inspection) &&
              headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>상품 리스트</CardTitle>
                <CardDescription>
                  선택한 품목(본품·세트 구성)·내품·사은품·포장재를 M번호로
                  합친 뒤 출고창고용·박스창고용 자리로 나눕니다. 같은 M번호는
                  강제우선 → 입고일 → 마지막 위치 순으로 자리를 채우고,
                  자리번호 오름차순으로 보여 줍니다. 출력 전에 비슷한 위치를
                  동선으로 묶어 A4를 미리 봅니다. 연습 창고를 읽기만 하며
                  재고를 차감하지 않습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {listCompute.status === 'computing' ? (
                  <StepCriteriaLoading label="상품 리스트를 계산하고 있습니다." />
                ) : listCompute.error ? (
                  <StepCriteriaError
                    message={listCompute.error}
                    onRetry={() => {
                      void optionMapsQuery.refetch()
                      void itemNameRulesQuery.refetch()
                      void accessoryRulesQuery.refetch()
                    }}
                  />
                ) : listCompute.result &&
                  productTransformation &&
                  itemTransformation &&
                  workPlan &&
                  giftPlan ? (
                  <InvoiceProductListStepPanel
                    brandId={brand.id}
                    productTransformation={productTransformation}
                    itemTransformation={itemTransformation}
                    workPlan={workPlan}
                    giftPlan={giftPlan}
                    outgoingRows={listCompute.result}
                  />
                ) : (
                  <StepCriteriaLoading label="이전 단계 결과를 기다리고 있습니다." />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep('stock')}
                  >
                    <ArrowLeft className="size-4" />
                    재고·예약으로
                  </Button>
                  <Button
                    type="button"
                    disabled={!listCompute.result}
                    onClick={() => goNextStep('output')}
                  >
                    최종 행 보기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'output'}
            keepMounted={
              visitedStepsRef.current.has('output') &&
              Boolean(inspection) &&
              headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>최종 행</CardTitle>
                <CardDescription>
                  품목명과 내품명은 각 단계 결과를 마지막에만 합칩니다. 내품명
                  규칙의 M번호는 CJ 행을 늘리지 않고 출고구성에 반영합니다. 실제
                  세트로 등록한 행만 구성품 수만큼 CJ 행을 펼치고, 수령인·주소·
                  전화·주문번호는 그대로 복사합니다. 수량은 원본 내품수량 × 구성
                  수량입니다. 내품명 전체로 본품을 찾은 행은 빈 내품명을 유지하고,
                  앞부분만 쓴 행은 남은 옵션을 유지합니다. 변환 내품명을 저장하지
                  않은 나머지 행은 유효 내품명을 유지합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {outputCompute.status === 'computing' ? (
                  <StepCriteriaLoading label="최종 행을 계산하고 있습니다." />
                ) : outputCompute.error ? (
                  <StepCriteriaError
                    message={outputCompute.error}
                    onRetry={() => {
                      void productNameMapsQuery.refetch()
                      void optionMapsQuery.refetch()
                    }}
                  />
                ) : outputCompute.result &&
                  productTransformation &&
                  itemTransformation &&
                  workPlan &&
                  giftPlan ? (
                <InvoiceOutputStepPanel
                  brandId={brand.id}
                  brandName={brand.name}
                  sourceFileName={fileName}
                  rows={processRows}
                  giftRequests={giftRequests}
                  giftResolutions={giftResolutions}
                  giftSeed={giftSeed}
                  excludedGiftStyleIds={excludedGiftStyleIds}
                  productTransformation={productTransformation}
                  itemTransformation={itemTransformation}
                  workPlan={workPlan}
                  giftPlan={giftPlan}
                  giftSourcePlan={giftSourcePlan}
                  baseProductTransformation={
                    baseProductTransformation ?? undefined
                  }
                  mallResolution={mallResolution}
                  previewRows={outputCompute.result}
                  finalizeUnified={
                    giftEligibilityPlan && baseProductTransformation
                      ? () =>
                          finalizeUnifiedGiftPlanForDownload({
                            brandId: brand.id,
                            rows: inspection.rows,
                            campaignRows,
                            prefixPlan: giftEligibilityPlan,
                            requests: giftRequests,
                            giftPlan,
                            giftSourcePlan,
                            seed: giftSeed,
                            excludedGiftStyleIds,
                            sourceFileName: fileName,
                            tagRoles: deferredProductNameTagRoles,
                            sessionRules: giftSourceSessionRuleMap,
                            sessionAllocations: giftSourceSessionAllocationMap,
                            ignoredKeys: giftSourceIgnoredKeySet,
                            appliedKeys: giftSourceEffectiveAppliedKeys,
                          })
                      : undefined
                  }
                />
                ) : (
                  <StepCriteriaLoading label="이전 단계 결과를 기다리고 있습니다." />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep('list')}
                  >
                    <ArrowLeft className="size-4" />
                    상품 리스트로
                  </Button>
                  <Button type="button" variant="outline" onClick={resetFile}>
                    <RotateCcw className="size-4" />
                    다른 파일 선택
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>
        </div>
      ) : activeView === 'waiting' ? (
        <WaitingOrdersPanel />
      ) : activeView === 'rules' ? (
        <RulesPanel
          brandId={brand.id}
          brandName={brand.name}
          nameRules={nameRules}
          nameRulesLoading={nameRulesQuery.isPending}
          nameRulesError={nameRulesError}
          optionMaps={optionMaps}
          optionMapsLoading={optionMapsQuery.isPending}
          optionMapsError={optionMapsError}
          productNameMaps={productNameMaps}
          productNameMapsLoading={productNameMapsQuery.isPending}
          productNameMapsError={productNameMapsError}
          giftRequests={giftRequests}
          giftRequestsLoading={giftRequestsQuery.isPending}
          giftRequestsError={giftRequestsError}
          giftSourceMaps={giftSourceMaps}
          giftSourceMapsLoading={giftSourceMapsQuery.isPending}
          giftSourceMapsError={giftSourceMapsError}
          workInstructions={workInstructions}
          workInstructionsLoading={workInstructionsQuery.isPending}
          workInstructionsError={workInstructionsError}
        />
      ) : (
        <HistoryPanel brandId={brand.id} />
      )}

      {mallDialogOpen && inspection ? (
        <InvoiceMallResolutionDialog
          brandId={brand.id}
          brandSlug={brand.slug}
          sites={mallResolution.sites}
          targets={usageTargets}
          aliases={usageAliases}
          folders={usageFolders}
          onClose={() => setMallDialogOpen(false)}
        />
      ) : null}

      {giftSetupGroup ? (
        <InvoiceGiftSetupDialog
          brandId={brand.id}
          group={giftSetupGroup}
          applying={giftSourceApplyingKey === giftSetupGroup.key}
          error={giftSourceError}
          existingRequests={giftRequests}
          onClose={() => {
            if (giftSourceApplyingKey) return
            setGiftSourceError(null)
            setGiftSetupTarget(null)
          }}
          onApplySession={(rule) => applyGiftSourceSession(giftSetupGroup, rule)}
          onApplyPersist={(rule) => {
            void applyGiftSourcePersist(giftSetupGroup, rule)
          }}
        />
      ) : null}
    </div>
  )
}
