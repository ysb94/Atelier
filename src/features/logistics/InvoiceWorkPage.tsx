import { Fragment, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  Gift,
  History,
  MapPin,
  Package,
  RotateCcw,
  Settings2,
  ShieldCheck,
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
import { getInvoiceNameRules } from '@/lib/api'
import { parseFile } from '@/lib/import/parse'
import { transformInvoiceNamesByCode } from '@/lib/invoice/name-transform'
import {
  inspectSabangnetSheets,
  type SabangnetInspection,
} from '@/lib/invoice/sabangnet'
import type { InvoiceNameRule } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { InvoiceCodeRuleBulkPanel } from './InvoiceCodeRuleBulkPanel'
import { InvoiceCodeRuleForm } from './InvoiceCodeRuleForm'
import { InvoiceCodeRuleTable } from './InvoiceCodeRuleTable'
import { InvoiceNameTransformTable } from './InvoiceNameTransformTable'
import { SabangnetOrderTable } from './SabangnetOrderTable'
import { UnresolvedInvoiceCodePanel } from './UnresolvedInvoiceCodePanel'

const MAX_FILE_BYTES = 50 * 1024 * 1024

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
    <div className="mb-6 flex items-stretch gap-0.5 overflow-x-auto border-b border-border px-1">
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

type RuleView = 'aliases' | 'holds' | 'gifts' | 'packing'

const RULE_VIEWS: {
  value: RuleView
  label: string
  description: string
  icon: typeof Tags
}[] = [
  {
    value: 'aliases',
    label: '이름변경',
    description: '자체품번코드와 업체 공식명 연결',
    icon: Tags,
  },
  {
    value: 'holds',
    label: '출고상태',
    description: '예발·재고부족 설정',
    icon: CalendarClock,
  },
  {
    value: 'gifts',
    label: '사은품',
    description: '증정 조건과 송장 표시',
    icon: Gift,
  },
  {
    value: 'packing',
    label: '포장·위치',
    description: '봉투·박스·사이즈·위치',
    icon: Package,
  },
]

const RULE_TABLES: Record<
  RuleView,
  { title: string; description: string; columns: string[] }
> = {
  aliases: {
    title: '자체품번코드 기준',
    description:
      '자체품번코드에 상품업체 공식 상품명을 연결하거나 원본명을 유지할 예외 코드로 등록합니다.',
    columns: ['자체품번코드', '처리', '공식 상품명', '메모', '상태'],
  },
  holds: {
    title: '출고 보류 규칙',
    description:
      '상품 또는 옵션별로 예발일과 재고부족 상태를 관리하고 실제 주문은 출고 대기로 보냅니다.',
    columns: ['상품·옵션', '보류 사유', '시작일', '출고 가능일', '상태'],
  },
  gifts: {
    title: '사은품 지급 규칙',
    description:
      '쇼핑몰·기간·구매상품·수량 조건을 만족할 때 송장 표시와 사은품 행을 자동 생성합니다.',
    columns: ['조건 이름', '적용 조건', '사은품', '송장 표시', '상태'],
  },
  packing: {
    title: '포장·위치 규칙',
    description:
      '상품별 기본 위치와 봉투·박스 종류를 정하고 수량 또는 합포장일 때 예외 규칙을 적용합니다.',
    columns: ['상품', '현재 위치', '포장재', '사이즈·패킹코드', '상태'],
  },
}

function RulesPanel({
  brandId,
  brandName,
  nameRules,
  nameRulesLoading,
  nameRulesError,
}: {
  brandId: string
  brandName: string
  nameRules: InvoiceNameRule[]
  nameRulesLoading: boolean
  nameRulesError: string | null
}) {
  const [activeRule, setActiveRule] = useState<RuleView>('aliases')
  const [registerMode, setRegisterMode] = useState<'single' | 'bulk'>('single')
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
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-warning/30 shadow-none">
            <CardContent className="flex items-start gap-3 p-5">
              <CalendarClock className="mt-0.5 size-5 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-medium">예발</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  출고 가능일을 필수로 적고, 해당 날짜가 되면 대기 주문을
                  자동으로 다시 보여줍니다.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-danger/30 shadow-none">
            <CardContent className="flex items-start gap-3 p-5">
              <Boxes className="mt-0.5 size-5 shrink-0 text-danger" />
              <div>
                <p className="text-sm font-medium">재고부족</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  종료일 없이 즉시 보류하고, 재고가 확보됐다고 해제할 때만 출고
                  가능 상태로 바꿉니다.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeRule === 'packing' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [MapPin, '현재 위치', '상품을 꺼내는 방·선반 위치'],
            [Package, '포장재', '봉투 또는 박스 종류'],
            [Boxes, '포장 사이즈', 'S·M·L 또는 실제 박스 규격'],
            [FileSpreadsheet, '패킹코드', '송장에 표시할 작업 코드'],
          ].map(([Icon, title, description]) => {
            const ItemIcon = Icon as typeof MapPin
            return (
              <div
                key={String(title)}
                className="rounded-lg border border-border bg-muted/20 p-4"
              >
                <ItemIcon className="size-4 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">{String(title)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {String(description)}
                </p>
              </div>
            )
          })}
        </div>
      ) : null}

      {activeRule === 'aliases' ? (
        <>
          <InvoiceCodeRuleTable
            brandId={brandId}
            rules={nameRules}
            loading={nameRulesLoading}
            error={nameRulesError}
          />
          <Card className="shadow-none">
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>자체품번코드 등록</CardTitle>
                <CardDescription className="mt-1">
                  저장한 값은 이후 모든 송장작업에 다시 사용됩니다.
                </CardDescription>
              </div>
              <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
                <button
                  type="button"
                  aria-pressed={registerMode === 'single'}
                  onClick={() => setRegisterMode('single')}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    registerMode === 'single'
                      ? 'bg-card shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  직접 입력
                </button>
                <button
                  type="button"
                  aria-pressed={registerMode === 'bulk'}
                  onClick={() => setRegisterMode('bulk')}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    registerMode === 'bulk'
                      ? 'bg-card shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  엑셀 일괄 등록
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {registerMode === 'single' ? (
                <InvoiceCodeRuleForm brandId={brandId} />
              ) : (
                <InvoiceCodeRuleBulkPanel
                  brandId={brandId}
                  brandName={brandName}
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{table.title}</CardTitle>
            <CardDescription>{table.description}</CardDescription>
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

type InvoiceHistoryItem = {
  id: string
  workedAt: string
  fileName: string
  workerLabel: string
  sourceRows: number
  exportedRows: number
  waitingRows: number
  reviewRows: number
}

function HistoryPanel() {
  const history: InvoiceHistoryItem[] = []
  const exportedRows = history.reduce(
    (total, item) => total + item.exportedRows,
    0,
  )
  const waitingRows = history.reduce(
    (total, item) => total + item.waitingRows,
    0,
  )
  const reviewRows = history.reduce((total, item) => total + item.reviewRows, 0)

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>작업 이력</CardTitle>
            <CardDescription className="mt-1">
              어떤 파일을 누가 변환했고, 몇 건이 출력·보류·제외됐는지
              확인합니다.
            </CardDescription>
          </div>
          <Badge variant="muted">DB 연결 전</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryItem
              label="표시된 변환"
              value={`${formatNumber(history.length)}회`}
            />
            <SummaryItem
              label="CJ 출력"
              value={`${formatNumber(exportedRows)}건`}
              tone="success"
            />
            <SummaryItem
              label="출고 대기 이동"
              value={`${formatNumber(waitingRows)}건`}
              tone="warning"
            />
            <SummaryItem
              label="확인 필요"
              value={`${formatNumber(reviewRows)}건`}
              tone="danger"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>최근 작업</CardTitle>
          <CardDescription>
            고객정보 대신 작업 단위와 처리 결과만 빠르게 확인합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-200 text-left text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">작업 시각</th>
                    <th className="px-3 py-2.5 font-medium">원본 파일</th>
                    <th className="px-3 py-2.5 font-medium">작업자</th>
                    <th className="px-3 py-2.5 text-right font-medium">원본</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      CJ 출력
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      출고 대기
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      확인 필요
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                        {item.workedAt}
                      </td>
                      <td className="max-w-72 px-3 py-3 font-medium">
                        {item.fileName}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {item.workerLabel}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatNumber(item.sourceRows)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-success">
                        {formatNumber(item.exportedRows)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-warning">
                        {formatNumber(item.waitingRows)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-danger">
                        {formatNumber(item.reviewRows)}
                      </td>
                    </tr>
                  ))}
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
                자동 변환을 연결하면 파일명·작업자·처리 건수·적용한 규칙 버전을
                남겨 같은 결과를 다시 확인할 수 있게 합니다.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

type TodayStep = 'upload' | 'check' | 'transform'

const TODAY_STEPS: { value: TodayStep; label: string }[] = [
  { value: 'upload', label: '파일 올리기' },
  { value: 'check', label: '파일 확인' },
  { value: 'transform', label: '품목명 변환' },
]

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
    <div className="flex flex-wrap items-center gap-1">
      {TODAY_STEPS.map((item, index) => {
        const active = index === stepIndex
        const reachable = index <= maxStepIndex
        return (
          <Fragment key={item.value}>
            <button
              type="button"
              disabled={!reachable}
              aria-current={active ? 'step' : undefined}
              onClick={() => onChange(item.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : reachable
                    ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    : 'text-muted-foreground/50',
              )}
            >
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-full text-[10px] font-semibold',
                  active ? 'bg-primary-foreground/20' : 'bg-muted',
                )}
              >
                {index < stepIndex ? (
                  <CheckCircle2 className="size-3 text-success" />
                ) : (
                  index + 1
                )}
              </span>
              {item.label}
            </button>
            {index < TODAY_STEPS.length - 1 ? (
              <ChevronRight className="size-3.5 text-muted-foreground/50" />
            ) : null}
          </Fragment>
        )
      })}
    </div>
  )
}

export function InvoiceWorkPage() {
  const { brand } = useBrand()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: InvoiceView = isInvoiceView(requestedView)
    ? requestedView
    : 'today'
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<TodayStep>('upload')
  const [inspection, setInspection] = useState<SabangnetInspection | null>(null)
  const [fileName, setFileName] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRulesQuery = useQuery({
    queryKey: ['invoice-name-rules', brand.id],
    queryFn: () => getInvoiceNameRules(brand.id),
  })
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
    if (!inspection || nameRulesQuery.isPending || nameRulesQuery.error) {
      return null
    }
    return transformInvoiceNamesByCode(inspection.rows, activeNameRules)
  }, [
    activeNameRules,
    inspection,
    nameRulesQuery.error,
    nameRulesQuery.isPending,
  ])
  const nameRulesError =
    nameRulesQuery.error instanceof Error
      ? nameRulesQuery.error.message
      : nameRulesQuery.error
        ? '송장 자체품번코드 기준을 불러오지 못했습니다.'
        : null

  const headerReady = Boolean(
    inspection && inspection.missingHeaders.length === 0,
  )
  const fileReady = Boolean(
    headerReady && inspection && inspection.blockingRowCount === 0,
  )

  // 준비되지 않은 단계로는 갈 수 없게 현재 단계를 되돌린다.
  const maxStepIndex = !inspection ? 0 : headerReady ? 2 : 1
  const stepIndex = Math.min(
    TODAY_STEPS.findIndex((item) => item.value === step),
    maxStepIndex,
  )
  const activeStep = TODAY_STEPS[stepIndex].value

  function selectView(view: InvoiceView) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (view === 'today') next.delete('view')
      else next.set('view', view)
      return next
    })
  }

  function resetFile() {
    setInspection(null)
    setFileName('')
    setError(null)
    setStep('upload')
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

    setIsParsing(true)
    setError(null)
    setInspection(null)
    setFileName(file.name)

    try {
      const sheets = await parseFile(file)
      if (sheets.length === 0) {
        throw new Error('읽을 수 있는 시트가 없습니다.')
      }
      setInspection(inspectSabangnetSheets(sheets))
      setStep('check')
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '파일을 읽지 못했습니다. 사방넷 원본 엑셀인지 확인해주세요.',
      )
    } finally {
      setIsParsing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <PageHeader
        title="송장작업"
        description={`${brand.name} 사방넷 주문 파일을 확인하고 CJ 업로드용 엑셀로 바꾸는 작업 공간입니다.`}
      />

      <InvoiceViewTabs activeView={activeView} onChange={selectView} />

      {activeView === 'today' ? (
        <div className="space-y-4">
          <TodayStepProgress
            stepIndex={stepIndex}
            maxStepIndex={maxStepIndex}
            onChange={setStep}
          />

          {activeStep === 'upload' ? (
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
          ) : null}

          {activeStep === 'check' && inspection ? (
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

                <SabangnetOrderTable
                  rows={inspection.rows}
                  columnCount={inspection.columnCount}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button type="button" variant="outline" onClick={resetFile}>
                    <RotateCcw className="size-4" />
                    다른 파일 선택
                  </Button>
                  <Button
                    type="button"
                    disabled={!headerReady}
                    onClick={() => setStep('transform')}
                  >
                    품목명 변환하기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {activeStep === 'transform' && inspection && headerReady ? (
            <Card>
              <CardHeader>
                <CardTitle>자체품번코드로 품목명 변경</CardTitle>
                <CardDescription>
                  데이터 시트에 등록된 상품명을 검색해 고르거나, Enter로 예외만
                  체크한 뒤 저장 버튼으로 반영합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {nameRulesQuery.isPending ? (
                  <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                    Supabase에서 이 브랜드의 자체품번코드 기준만 불러오고
                    있습니다.
                  </div>
                ) : nameRulesError ? (
                  <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{nameRulesError}</span>
                  </div>
                ) : nameTransformation ? (
                  <>
                    <UnresolvedInvoiceCodePanel
                      brandId={brand.id}
                      codes={nameTransformation.unresolvedCodes}
                    />

                    <InvoiceNameTransformTable rows={nameTransformation.rows} />
                  </>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep('check')}
                  >
                    <ArrowLeft className="size-4" />
                    파일 확인으로
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    다음 변환 단계는 자체품번코드 검증이 끝난 뒤 추가합니다.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}
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
        />
      ) : (
        <HistoryPanel />
      )}
    </div>
  )
}
