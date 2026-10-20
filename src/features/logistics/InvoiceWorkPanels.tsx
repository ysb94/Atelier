import { memo, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'

import {
  AlertTriangle,
  Ban,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Download,
  Gift,
  Loader2,
  MapPin,
  Package,
  Tag,
  Tags,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { type GiftAssignmentPlan } from '@/lib/invoice/gift-assign'

import { downloadInvoiceStepSnapshot, type InvoiceStepSnapshotStage } from '@/lib/invoice/invoice-output'
import { type InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'

import { type InvoiceNameTransformation } from '@/lib/invoice/name-transform'

import { type InvoiceProductNameTransformation } from '@/lib/invoice/product-name-transform'

import { type SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import { type WorkInstructionPlan } from '@/lib/invoice/work-instruction-transform'
import type {
  InvoiceGiftRequest,
  InvoiceGiftSourceMap,
  InvoiceNameRule,
  InvoiceOptionMap,
  InvoiceProductNameMap,
  InvoiceWorkInstruction,
} from '@/lib/types'

import { cn, formatNumber } from '@/lib/utils'
import { InvoiceDiscontinuedListPanel } from './InvoiceDiscontinuedListPanel'
import { InvoicePreorderHoldPanel } from './InvoicePreorderHoldPanel'

import { InvoiceOptionMapRulesPanel } from './InvoiceOptionMapRulesPanel'

import { InvoicePackingSizeMapPanel } from './InvoicePackingSizeMapPanel'
import { InvoiceGiftSourceMapPanel } from './InvoiceGiftSourceMapPanel'
import { InvoicePrefixRequestPanel } from './InvoicePrefixRequestPanel'

import { InvoiceWorkInstructionPanel } from './InvoiceWorkInstructionPanel'

import { INVOICE_VIEWS, TODAY_STEPS, type InvoiceView, type TodayStep } from './invoice-work-steps'

// 송장작업 화면의 탭·진행 상태·규칙 패널.
export function SummaryItem({
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

export function InvoiceViewTabs({
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

export function WaitingOrdersPanel() {
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

export function RulesPanel({
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
  const [searchParams] = useSearchParams()
  const manage = searchParams.get('manage')
  const edit = searchParams.get('edit')
  const [activeRule, setActiveRule] = useState<RuleView>(
    manage === 'preorder' || manage === 'discontinued' ? 'holds' : 'gifts',
  )
  const [activePackingCard, setActivePackingCard] = useState<'size' | null>(
    null,
  )
  const [activeHoldCard, setActiveHoldCard] = useState<
    'preorder' | 'stockout' | 'discontinued' | null
  >(
    manage === 'preorder'
      ? 'preorder'
      : manage === 'discontinued'
        ? 'discontinued'
        : null,
  )
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
            openCreate={manage === 'gifts' && edit === 'new'}
            openEditId={manage === 'gifts' && edit && edit !== 'new' ? edit : null}
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
        <InvoicePreorderHoldPanel
          brandId={brandId}
          openEditId={manage === 'preorder' ? edit : null}
        />
      ) : activeRule === 'holds' && activeHoldCard === 'discontinued' ? (
        <InvoiceDiscontinuedListPanel
          brandId={brandId}
          focusId={manage === 'discontinued' ? edit : null}
        />
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

export function TodayStepProgress({
  stepIndex,
  maxStepIndex,
  pending,
  onChange,
}: {
  stepIndex: number
  maxStepIndex: number
  pending?: boolean
  onChange: (step: TodayStep) => void
}) {
  return (
    <div
      className="flex items-stretch gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border pb-px"
      aria-busy={pending || undefined}
    >
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
            {pending && active ? (
              <span className="text-[10px] text-muted-foreground">전환 중</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** 단계 공통 기준 로딩 표시 */
export function StepCriteriaLoading({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

/** 작업 화면 전체를 덮는 단계 로딩. 스크롤 영역 위에 고정한다. */
export function TodayStepBusyOverlay({
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
export function StepCriteriaError({
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

export function StepCriteriaNotice({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  )
}

/** 한 번 열어본 단계는 숨겨만 둔다. 탭을 옮겨도 검수표·초안이 남는다. */
export const TodayStepPanel = memo(function TodayStepPanel({
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
})

export function StepSnapshotButton({
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
