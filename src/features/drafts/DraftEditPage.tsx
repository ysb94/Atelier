import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Check,
  ChevronLeft,
  FileText,
  ImagePlus,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import {
  MAX_DRAFT_COLORS,
  createProductDraft,
  deleteProductDraft,
  emptyDraftInput,
  getProductDraftById,
  getCompanyProductDrafts,
  getSeasonsByBrand,
  getStylesByBrand,
  newColorRow,
  newOptionRow,
  updateProductDraft,
} from '@/lib/api'
import { readFileAsDataUrl, readImageFile } from '@/lib/images'
import {
  COST_CURRENCY_LABEL,
  DRAFT_OPEN_DETAIL_OPTIONS,
  DRAFT_OPEN_TYPE_OPTIONS,
  DRAFT_ORIGIN_OPTIONS,
  DRAFT_OWNER_OPTIONS,
  DRAFT_REGISTER_TYPE_OPTIONS,
  DRAFT_SPEC_LABEL,
  type CostCurrency,
  type DraftSpecKey,
  type ProductDraftInput,
  type Season,
  type Style,
} from '@/lib/types'
import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import {
  applyDraftBrandChange,
  canChangeDraftBrand,
  draftBrandChangeMessage,
  requiresDraftBrand,
} from '@/lib/drafts/company-draft'
import {
  canPassLatestSampleWorkOrder,
  failLatestSampleWorkOrder,
  isSamplePassed,
  latestFilledSampleWorkOrder,
  legacyWorkOrderFields,
  patchSampleWorkOrder,
  previousSampleFailReason,
  removeSampleWorkOrder,
  samplePhase,
  samplePhaseHint,
  samplePhaseLabel,
  sampleWorkOrderFileName,
  sampleWorkOrderLabel,
  setLatestSampleWorkOrderPassed,
  withPendingNextSampleWorkOrder,
} from '@/lib/drafts/sample-work-order'
import { useAuth } from '@/lib/supabase/auth'
import { draftDetailPath } from '@/lib/workspace/company-paths'
import { cn, formatNumber } from '@/lib/utils'

const SAMPLE_WORK_ORDER_ACCEPT =
  'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx'
const SAMPLE_WORK_ORDER_MAX_BYTES = 8 * 1024 * 1024

const EMPTY_SEASONS: Season[] = []
const EMPTY_STYLES: Style[] = []

const TEXT_SPEC_KEYS = ['fabric', 'coating'] as const satisfies DraftSpecKey[]

const SPEC_PLACEHOLDER: Record<(typeof TEXT_SPEC_KEYS)[number], string> = {
  fabric: '겉감: Nylon 75% / 안감: Polyester 100%',
  coating: '생활 발수 OK',
}

const DRAFT_FLOW_STEPS = [
  {
    key: 'sample',
    label: '샘플 진행 중',
    hint: '작업 지시서를 올리면 시작합니다',
    interactive: false,
  },
  {
    key: 'orderInProgress',
    label: '발주 진행중',
    hint: '발주 준비',
    interactive: true,
  },
  {
    key: 'orderDone',
    label: '생산 발주 완료',
    hint: '발주 완료',
    interactive: true,
  },
] as const

type DraftFlowKey = (typeof DRAFT_FLOW_STEPS)[number]['key']

function draftFlowActive(
  form: ProductDraftInput,
): Record<DraftFlowKey, boolean> {
  const phase = samplePhase(form.sampleWorkOrders)
  return {
    sample: phase !== 'empty',
    orderInProgress: form.orderInProgress || phase === 'passed',
    orderDone: form.orderDone,
  }
}

function draftFlowState(
  form: ProductDraftInput,
  index: number,
): 'done' | 'current' | 'todo' {
  const phase = samplePhase(form.sampleWorkOrders)
  const step = DRAFT_FLOW_STEPS[index]
  if (step.key === 'sample') {
    if (phase === 'passed') return 'done'
    if (phase === 'empty') return 'todo'
    return 'current'
  }
  if (step.key === 'orderInProgress') {
    if (form.orderDone) return 'done'
    if (form.orderInProgress || phase === 'passed') return 'current'
    return 'todo'
  }
  return form.orderDone ? 'done' : 'todo'
}

function DraftProgressStrip({
  form,
  onToggle,
}: {
  form: ProductDraftInput
  onToggle: (key: 'orderInProgress' | 'orderDone') => void
}) {
  const active = draftFlowActive(form)
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      <ol className="flex min-w-[28rem] items-start justify-between gap-1">
        {DRAFT_FLOW_STEPS.map((step, index) => {
          const state = draftFlowState(form, index)
          const nextState =
            index < DRAFT_FLOW_STEPS.length - 1
              ? draftFlowState(form, index + 1)
              : null
          const connectorDone =
            state === 'done' &&
            (nextState === 'done' || nextState === 'current')
          const label =
            step.key === 'sample'
              ? samplePhaseLabel(form.sampleWorkOrders)
              : step.label
          const hint =
            step.key === 'sample'
              ? samplePhaseHint(form.sampleWorkOrders)
              : step.hint
          const className = cn(
            'relative z-[1] flex w-full flex-col items-center gap-1 rounded-md px-0.5 py-0.5 text-center outline-none',
            step.interactive && 'focus-visible:ring-2 focus-visible:ring-ring',
            !step.interactive && 'cursor-default',
          )
          const body = (
            <>
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors',
                  state === 'done' &&
                    'border-foreground bg-foreground text-background',
                  state === 'current' &&
                    'border-foreground bg-background text-foreground ring-4 ring-foreground/10',
                  state === 'todo' &&
                    'border-border bg-background text-muted-foreground',
                )}
              >
                {state === 'done' ? (
                  <Check className="size-3" strokeWidth={2.5} />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  'max-w-[9rem] text-[11px] leading-tight',
                  state === 'current'
                    ? 'font-semibold text-foreground'
                    : state === 'done'
                      ? 'font-medium text-foreground/80'
                      : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              {state === 'current' || state === 'done' ? (
                <span className="text-[10px] leading-none text-muted-foreground">
                  {hint}
                </span>
              ) : (
                <span className="h-2.5" aria-hidden />
              )}
            </>
          )
          return (
            <li
              key={step.key}
              className="relative flex min-w-0 flex-1 flex-col items-center"
            >
              {index < DRAFT_FLOW_STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-[calc(50%+0.85rem)] right-[calc(-50%+0.85rem)] top-3 h-px',
                    connectorDone ? 'bg-foreground/40' : 'bg-border',
                  )}
                />
              ) : null}
              {step.interactive ? (
                <button
                  type="button"
                  aria-pressed={active[step.key]}
                  aria-current={state === 'current' ? 'step' : undefined}
                  title={hint}
                  onClick={() => onToggle(step.key)}
                  className={className}
                >
                  {body}
                </button>
              ) : (
                <div
                  aria-current={state === 'current' ? 'step' : undefined}
                  title={hint}
                  className={className}
                >
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function toNumber(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, '').trim()
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
        checked && 'border-success/40 bg-success/5',
        !checked && 'border-border hover:bg-muted/50',
      )}
    >
      <span className="font-medium">{label}</span>
      <input
        type="checkbox"
        className="size-3.5 accent-current"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

/** 헤더가 얇은 밀집형 섹션 카드 */
function SectionCard({
  title,
  aside,
  className,
  children,
}: {
  title: string
  aside?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {aside ? (
          <span className="text-xs text-muted-foreground">{aside}</span>
        ) : null}
      </div>
      <div className="flex-1 space-y-3 p-4">{children}</div>
    </Card>
  )
}

/** 스펙 항목 라벨 + 확인 체크 */
function SpecHead({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-xs font-medium text-muted-foreground">
        {label}
        {hint ? (
          <span className="ml-1 text-[11px] font-normal">{hint}</span>
        ) : null}
      </span>
      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
        확인
        <input
          type="checkbox"
          className="size-3.5"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    </div>
  )
}

/** 고정 목록 + 기존 값이 목록에 없으면 그대로 보이게 */
function OptionSelect({
  value,
  options,
  onChange,
  placeholder = '선택',
  className,
}: {
  value: string
  options: readonly string[]
  onChange: (next: string) => void
  placeholder?: string
  className?: string
}) {
  const extras = value && !options.includes(value) ? [value] : ([] as string[])
  return (
    <Select
      className={cn('w-full', className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {[...extras, ...options].map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  )
}

function sanitizeNumberText(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '')
  const [integer = '', ...decimals] = cleaned.split('.')
  return decimals.length > 0 ? `${integer}.${decimals.join('')}` : integer
}

function UnitInput({
  value,
  unit,
  onChange,
  placeholder,
  className,
}: {
  value: string
  unit: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        className="h-8 pr-9"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(sanitizeNumberText(e.target.value))}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-muted-foreground">
        {unit}
      </span>
    </div>
  )
}

type SizeParts = {
  width: string
  depth: string
  height: string
  strap: string
}

function parseSizeSpec(value: string): SizeParts {
  function labeled(label: string) {
    const match = value.match(
      new RegExp(`(?:\\[${label}\\]|${label}\\s*=?)\\s*([\\d.]+)`, 'i'),
    )
    return match?.[1] ?? ''
  }
  const width = labeled('W')
  const depth = labeled('D')
  const height = labeled('H')
  const strap = value.match(/(?:STRAP|어깨끈)[^\d]*([\d.]+)/i)?.[1] ?? ''

  if (width || depth || height || strap) {
    return { width, depth, height, strap }
  }

  const numbers = value.match(/\d+(?:\.\d+)?/g) ?? []
  return {
    width: numbers[0] ?? '',
    depth: numbers[1] ?? '',
    height: numbers[2] ?? '',
    strap: numbers[3] ?? '',
  }
}

function formatSizeSpec(parts: SizeParts) {
  if (!Object.values(parts).some(Boolean)) return ''
  return `W=${parts.width};D=${parts.depth};H=${parts.height};STRAP=${parts.strap};UNIT=mm`
}

function parseWeightSpec(value: string) {
  return value.match(/\d+(?:\.\d+)?/)?.[0] ?? ''
}

function formatWeightSpec(value: string) {
  return value ? `${value} g` : ''
}

function listPathForSeason(seasonId: string | null, seasons: Season[]) {
  if (!seasonId) return '/drafts?season=unassigned'
  const season = seasons.find((item) => item.id === seasonId)
  if (!season) return '/drafts'
  return `/drafts?season=${encodeURIComponent(season.code)}`
}

function seasonIdFromQuery(
  value: string | null,
  seasons: Season[],
): string | null | undefined {
  if (value == null) return undefined
  if (value === '' || value === 'none') return null
  if (seasons.some((season) => season.id === value)) return value
  return undefined
}

export function DraftEditPage() {
  const { brands, brandById, brandBySlug } = useCompanyBrandScope()
  const { profile } = useAuth()
  const { draftId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const workOrderInputRef = useRef<HTMLInputElement>(null)
  const uploadOrderIdRef = useRef<string | null>(null)
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID

  const isNew = !draftId || draftId === 'new'
  const [form, setForm] = useState<ProductDraftInput>(() => emptyDraftInput())
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [seasonPrefillDone, setSeasonPrefillDone] = useState(false)
  const [seasonFromQueryDone, setSeasonFromQueryDone] = useState(false)
  const [failOpen, setFailOpen] = useState(false)
  const [failReason, setFailReason] = useState('')

  const selectedBrand = form.brandId ? brandById.get(form.brandId) : undefined

  const draftQuery = useQuery({
    queryKey: ['product-draft', draftId],
    queryFn: () => getProductDraftById(draftId ?? ''),
    enabled: !isNew && Boolean(draftId),
    retry: 1,
  })

  const seasonsQuery = useQuery({
    queryKey: ['seasons', form.brandId],
    queryFn: () => getSeasonsByBrand(form.brandId ?? ''),
    enabled: Boolean(form.brandId),
  })
  const seasons = form.brandId
    ? (seasonsQuery.data ?? EMPTY_SEASONS)
    : EMPTY_SEASONS

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })

  const stylesQuery = useQuery({
    queryKey: ['styles', form.brandId],
    queryFn: () => getStylesByBrand(form.brandId ?? ''),
    enabled: Boolean(form.brandId),
  })
  const styles = form.brandId
    ? (stylesQuery.data ?? EMPTY_STYLES)
    : EMPTY_STYLES

  const ownerOptions = useMemo(() => {
    const fromDrafts = (draftsQuery.data ?? [])
      .map((d) => d.owner.trim())
      .filter(Boolean)
    return Array.from(new Set([...DRAFT_OWNER_OPTIONS, ...fromDrafts])).sort(
      (a, b) => a.localeCompare(b, 'ko'),
    )
  }, [draftsQuery.data])

  const loaded = draftQuery.data
  useEffect(() => {
    if (!loaded) return
    const {
      id: _id,
      companyId: _companyId,
      draftNo: _draftNo,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      promotedStyleId: _promoted,
      ...rest
    } = loaded
    setForm(rest)
  }, [loaded])

  useEffect(() => {
    if (!isNew || seasonPrefillDone) return
    const requestedBrand = searchParams.get('brand')?.trim() ?? ''
    const brand = requestedBrand ? brandBySlug.get(requestedBrand) : undefined
    if (requestedBrand && !brand && brands.length === 0) return
    setForm((prev) => ({ ...prev, brandId: brand?.id ?? null }))
    setSeasonPrefillDone(true)
  }, [brandBySlug, brands.length, isNew, searchParams, seasonPrefillDone])

  useEffect(() => {
    if (
      !isNew ||
      seasonFromQueryDone ||
      !form.brandId ||
      seasonsQuery.isLoading
    ) {
      return
    }
    const fromQuery = seasonIdFromQuery(
      searchParams.get('season'),
      seasonsQuery.data ?? [],
    )
    if (fromQuery !== undefined) {
      setForm((prev) => ({ ...prev, seasonId: fromQuery }))
    }
    setSeasonFromQueryDone(true)
  }, [
    form.brandId,
    isNew,
    searchParams,
    seasonFromQueryDone,
    seasonsQuery.data,
    seasonsQuery.isLoading,
  ])

  const brandLocked = !canChangeDraftBrand(loaded?.status ?? form.status)
  const listPath = listPathForSeason(form.seasonId, seasons)

  const totalQty = useMemo(
    () => form.colors.reduce((sum, color) => sum + (color.orderQty ?? 0), 0),
    [form.colors],
  )
  const filledColors = form.colors.filter((color) => color.name.trim()).length

  function patch(next: Partial<ProductDraftInput>) {
    setForm((prev) => ({ ...prev, ...next }))
    setError(null)
    setSavedAt(null)
  }

  const workOrders = withPendingNextSampleWorkOrder(form.sampleWorkOrders)

  function patchWorkOrders(
    next: ProductDraftInput['sampleWorkOrders'],
  ) {
    patch({
      sampleWorkOrders: next,
      ...legacyWorkOrderFields(next),
    })
  }

  function selectBrand(nextBrandId: string | null) {
    if (brandLocked) return
    const styleBrandById = new Map(
      styles.map((style) => [style.id, style.brandId]),
    )
    const currentSeason = form.seasonId
      ? seasons.find((season) => season.id === form.seasonId)
      : undefined
    const result = applyDraftBrandChange({
      nextBrandId,
      seasonId: form.seasonId,
      seasonBrandId: currentSeason?.brandId ?? form.brandId,
      options: form.options,
      styleBrandById,
    })
    if (result.needsConfirm) {
      const message = draftBrandChangeMessage(result)
      if (message && !window.confirm(message)) return
    }
    patch({
      brandId: result.brandId,
      seasonId: result.seasonId,
      options: result.options,
    })
  }

  const saveMutation = useMutation({
    mutationFn: async (next?: ProductDraftInput) => {
      const payload = next ?? form
      if (requiresDraftBrand(payload.status) && !payload.brandId) {
        throw new Error('출시 확정 전에 브랜드를 지정하세요.')
      }
      if (isNew) return createProductDraft(companyId, payload)
      if (!draftId) throw new Error('기획안을 찾을 수 없습니다.')
      return updateProductDraft(draftId, payload)
    },
    onSuccess: async (saved) => {
      setError(null)
      setSavedAt(new Date().toLocaleTimeString('ko-KR'))
      await queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
      await queryClient.invalidateQueries({ queryKey: ['product-draft'] })
      if (isNew) {
        navigate(draftDetailPath(saved.id), { replace: true })
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!draftId || isNew) return
      return deleteProductDraft(draftId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
      navigate(listPath)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.')
    },
  })

  if (!isNew && draftQuery.isPending) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        불러오는 중...
      </div>
    )
  }

  if (!isNew && draftQuery.isError) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-danger">
          {draftQuery.error instanceof Error
            ? draftQuery.error.message
            : '기획안을 불러오지 못했습니다.'}
        </p>
        <div className="flex justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void draftQuery.refetch()}
          >
            다시 불러오기
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/drafts')}
          >
            기획안 목록으로
          </Button>
        </div>
      </div>
    )
  }

  if (!isNew && !loaded) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          기획안을 찾을 수 없습니다.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('/drafts')}
        >
          기획안 목록으로
        </Button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => navigate(listPath)}
        >
          <ChevronLeft className="size-4" />
          목록
        </button>
        <h1 className="text-lg font-semibold tracking-tight">
          {isNew ? '새 기획안' : (loaded?.draftNo ?? '기획안')}
        </h1>
        {loaded?.promotedStyleId ? (
          <Badge variant="success">상품 승격됨</Badge>
        ) : null}
        <span className="hidden text-xs text-muted-foreground xl:inline">
          {isNew
            ? 'PL번호는 저장할 때 발급됩니다.'
            : '품번은 출시 확정 단계에서 발급됩니다.'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {savedAt ? (
            <span className="text-xs text-muted-foreground">
              {savedAt} 저장됨
            </span>
          ) : null}
          {!isNew ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (window.confirm('이 기획안을 삭제할까요?')) {
                  deleteMutation.mutate()
                }
              }}
            >
              <Trash2 className="size-3.5" />
              삭제
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(form)}
          >
            <Save className="size-3.5" />
            {saveMutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </div>
      </div>

      <div className="mb-3">
        <DraftProgressStrip
          form={form}
          onToggle={(key) => patch({ [key]: !form[key] })}
        />
      </div>

      {error ? (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        {/* 기본 정보 + 사진 */}
        <SectionCard title="기본">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              try {
                patch({ imageUrl: await readImageFile(file) })
              } catch {
                setError('사진을 불러오지 못했습니다.')
              }
            }}
          />
          <div className="flex gap-3">
            <div className="relative shrink-0">
              <button
                type="button"
                title="사진 선택"
                onClick={() => fileInputRef.current?.click()}
                className="flex size-[5.5rem] items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40 transition-colors hover:bg-muted"
              >
                {form.imageUrl ? (
                  <img
                    src={form.imageUrl}
                    alt=""
                    className="size-full object-contain"
                  />
                ) : (
                  <ImagePlus className="size-5 text-muted-foreground" />
                )}
              </button>
              {form.imageUrl ? (
                <button
                  type="button"
                  aria-label="사진 제거"
                  title="사진 제거"
                  onClick={() => patch({ imageUrl: null })}
                  className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-1 text-muted-foreground shadow-sm hover:text-foreground"
                >
                  <Trash2 className="size-3" />
                </button>
              ) : null}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Field label="한글명">
                <Input
                  className="h-8"
                  value={form.nameKo}
                  placeholder="투웨이 셔링 호보백_글로우"
                  onChange={(e) => patch({ nameKo: e.target.value })}
                />
              </Field>
              <Field label="영문명">
                <Input
                  className="h-8"
                  value={form.nameEn}
                  placeholder="2way shirring hobo bag_Glow"
                  onChange={(e) => patch({ nameEn: e.target.value })}
                />
              </Field>
            </div>
          </div>

          <Field label="담당자">
            <OptionSelect
              className="h-8"
              value={form.owner}
              options={ownerOptions}
              placeholder="담당자 선택"
              onChange={(owner) => patch({ owner })}
            />
          </Field>

          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                브랜드
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {brandLocked
                  ? '확정 후 변경 불가'
                  : selectedBrand
                    ? '기존 상품 연결 가능'
                    : '고르면 상품 연결 가능'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={!form.brandId}
                disabled={brandLocked}
                onClick={() => selectBrand(null)}
                className={cn(
                  'inline-flex items-center rounded-md border px-2 py-1 text-xs transition-colors',
                  !form.brandId
                    ? 'border-foreground bg-background font-medium text-foreground'
                    : 'border-border bg-background/60 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                  brandLocked &&
                    form.brandId &&
                    'cursor-not-allowed opacity-50',
                )}
              >
                미정
              </button>
              {brands.map((item) => {
                const selected = item.id === form.brandId
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={brandLocked && !selected}
                    onClick={() => selectBrand(item.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                      selected
                        ? 'border-foreground bg-background font-medium text-foreground'
                        : 'border-border bg-background/60 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                      brandLocked &&
                        !selected &&
                        'cursor-not-allowed opacity-50',
                    )}
                  >
                    <BrandAvatar brand={item} className="size-4" />
                    <span className="truncate">{item.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </SectionCard>

        {/* 1차 샘플 작업 지시서 + 컬러 */}
        <SectionCard
          title="컬러"
          aside={
            <>
              {filledColors}컬러
              {totalQty > 0 ? ` · ${formatNumber(totalQty)}EA` : ''}
            </>
          }
        >
          <div className="space-y-2">
            <input
              ref={workOrderInputRef}
              type="file"
              accept={SAMPLE_WORK_ORDER_ACCEPT}
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                const targetId = uploadOrderIdRef.current
                event.target.value = ''
                uploadOrderIdRef.current = null
                if (!file || !targetId) return
                if (file.size > SAMPLE_WORK_ORDER_MAX_BYTES) {
                  setError('작업 지시서는 8MB 이하만 올릴 수 있습니다.')
                  return
                }
                try {
                  const url = await readFileAsDataUrl(file)
                  patchWorkOrders(
                    patchSampleWorkOrder(workOrders, targetId, {
                      url,
                      name: file.name,
                      shipped: false,
                      shippedAt: null,
                    }),
                  )
                } catch {
                  setError('작업 지시서를 불러오지 못했습니다.')
                }
              }}
            />
            {workOrders.map((order) => (
              <div key={order.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {sampleWorkOrderLabel(order.round)} 샘플 작업 지시서
                  </span>
                  {order.passed ? (
                    <span className="rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 text-[11px] font-medium">
                      합격
                    </span>
                  ) : order.failReason?.trim() ? (
                    <span className="rounded-md border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium">
                      불합격
                    </span>
                  ) : order.shipped ? (
                    <span className="rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 text-[11px] font-medium">
                      발송 완료
                    </span>
                  ) : null}
                </div>
                {order.url ? (
                  <div className="flex items-center gap-0.5 rounded-md border border-border px-2 py-1">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <a
                      href={order.url}
                      download={sampleWorkOrderFileName(order)}
                      className="min-w-0 flex-1 truncate px-1 text-xs underline-offset-2 hover:underline"
                    >
                      {sampleWorkOrderFileName(order)}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="바꾸기"
                      title="바꾸기"
                      onClick={() => {
                        uploadOrderIdRef.current = order.id
                        workOrderInputRef.current?.click()
                      }}
                    >
                      <Upload className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="제거"
                      title="제거"
                      onClick={() =>
                        patchWorkOrders(
                          order.round > 1
                            ? removeSampleWorkOrder(workOrders, order.id)
                            : patchSampleWorkOrder(workOrders, order.id, {
                                url: null,
                                name: '',
                              }),
                        )
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      className="size-7"
                      aria-label="저장"
                      title="저장"
                      disabled={saveMutation.isPending}
                      onClick={() => saveMutation.mutate(form)}
                    >
                      <Save className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      uploadOrderIdRef.current = order.id
                      workOrderInputRef.current?.click()
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                  >
                    <Upload className="size-3.5" />
                    업로드
                  </button>
                )}
                {order.failReason?.trim() ? (
                  <p className="rounded-md bg-muted/70 px-2 py-1.5 text-xs whitespace-pre-wrap">
                    불합격 사유: {order.failReason.trim()}
                  </p>
                ) : null}
                {!order.failReason?.trim() &&
                previousSampleFailReason(workOrders, order.id) ? (
                  <p className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs whitespace-pre-wrap">
                    다음 샘플 중점:{' '}
                    {previousSampleFailReason(workOrders, order.id)}
                  </p>
                ) : null}
              </div>
            ))}
            {canPassLatestSampleWorkOrder(workOrders) ? (
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const nextOrders = setLatestSampleWorkOrderPassed(
                      workOrders,
                      true,
                    )
                    const nextForm = {
                      ...form,
                      sampleWorkOrders: nextOrders,
                      ...legacyWorkOrderFields(nextOrders),
                      sampleDone: true,
                      orderInProgress: true,
                    }
                    patch({
                      sampleWorkOrders: nextOrders,
                      ...legacyWorkOrderFields(nextOrders),
                      sampleDone: true,
                      orderInProgress: true,
                    })
                    if (!isNew) saveMutation.mutate(nextForm)
                  }}
                >
                  <Check className="size-3.5" />
                  합격
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFailReason('')
                    setFailOpen(true)
                  }}
                >
                  <Plus className="size-3.5" />
                  불합격 · 다음 차수
                </Button>
              </div>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              {isSamplePassed(workOrders)
                ? '샘플이 합격되어 발주 진행중으로 넘어갑니다.'
                : canPassLatestSampleWorkOrder(workOrders)
                  ? '도착한 샘플이 기획과 같으면 합격, 다르면 사유를 남기고 다음 차수를 올립니다.'
                  : latestFilledSampleWorkOrder(workOrders)
                    ? '중국팀이 발송 완료하면 합격·불합격을 고릅니다.'
                    : '작업 지시서를 올리면 1차 샘플 진행중이 됩니다.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="grid grid-cols-[1rem_minmax(0,1fr)_4.5rem_2.5rem_1.75rem] items-center gap-1.5 text-[11px] text-muted-foreground">
              <span />
              <span>컬러명</span>
              <span className="text-right">발주</span>
              <span className="text-center">샘플</span>
              <span />
            </div>
            <div className="space-y-1">
              {form.colors.map((color, index) => (
                <div
                  key={color.id}
                  className="grid grid-cols-[1rem_minmax(0,1fr)_4.5rem_2.5rem_1.75rem] items-center gap-1.5"
                >
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <Input
                    className="h-8 min-w-0"
                    placeholder="Silver (실버)"
                    value={color.name}
                    onChange={(e) =>
                      patch({
                        colors: form.colors.map((row) =>
                          row.id === color.id
                            ? { ...row, name: e.target.value }
                            : row,
                        ),
                      })
                    }
                  />
                  <Input
                    className="h-8 px-2 text-right tabular-nums"
                    inputMode="numeric"
                    placeholder="0"
                    value={color.orderQty == null ? '' : String(color.orderQty)}
                    onChange={(e) =>
                      patch({
                        colors: form.colors.map((row) =>
                          row.id === color.id
                            ? { ...row, orderQty: toNumber(e.target.value) }
                            : row,
                        ),
                      })
                    }
                  />
                  <label className="flex cursor-pointer items-center justify-center">
                    <span className="sr-only">
                      {color.name || `컬러 ${index + 1}`} 샘플 진행중
                    </span>
                    <input
                      type="checkbox"
                      className="size-3.5 accent-current"
                      checked={color.sampleInProgress}
                      onChange={(e) =>
                        patch({
                          colors: form.colors.map((row) =>
                            row.id === color.id
                              ? { ...row, sampleInProgress: e.target.checked }
                              : row,
                          ),
                        })
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="컬러 삭제"
                    onClick={() =>
                      patch({
                        colors: form.colors.filter(
                          (row) => row.id !== color.id,
                        ),
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            {form.colors.length < MAX_DRAFT_COLORS ? (
              <button
                type="button"
                onClick={() =>
                  patch({ colors: [...form.colors, newColorRow()] })
                }
                className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <Plus className="size-3.5" />
                컬러 추가
              </button>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                최대 {MAX_DRAFT_COLORS}컬러까지 잡을 수 있습니다.
              </p>
            )}
          </div>
        </SectionCard>

        {/* 가격 + 발매 */}
        <SectionCard title="가격 · 발매">
          <div className="grid grid-cols-2 gap-x-2 gap-y-2">
            <Field label="목표 단가">
              <Input
                className="h-8"
                inputMode="decimal"
                placeholder="48.5"
                value={form.targetCost == null ? '' : String(form.targetCost)}
                onChange={(e) =>
                  patch({ targetCost: toNumber(e.target.value) })
                }
              />
            </Field>
            <Field label="통화">
              <Select
                className="h-8 w-full"
                value={form.costCurrency}
                onChange={(e) =>
                  patch({ costCurrency: e.target.value as CostCurrency })
                }
              >
                {(Object.keys(COST_CURRENCY_LABEL) as CostCurrency[]).map(
                  (currency) => (
                    <option key={currency} value={currency}>
                      {COST_CURRENCY_LABEL[currency]}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field label="판매가 (원)">
              <Input
                className="h-8"
                inputMode="numeric"
                placeholder="65000"
                value={form.retailPrice == null ? '' : String(form.retailPrice)}
                onChange={(e) =>
                  patch({ retailPrice: toNumber(e.target.value) })
                }
              />
            </Field>
            <Field label="할인가 (원)">
              <Input
                className="h-8"
                inputMode="numeric"
                placeholder="59000"
                value={
                  form.discountPrice == null ? '' : String(form.discountPrice)
                }
                onChange={(e) =>
                  patch({ discountPrice: toNumber(e.target.value) })
                }
              />
            </Field>
            <Field label="제조국">
              <OptionSelect
                className="h-8"
                value={form.originCountry}
                options={DRAFT_ORIGIN_OPTIONS}
                placeholder="제조국 선택"
                onChange={(originCountry) => patch({ originCountry })}
              />
            </Field>
            <Field label="등록유형">
              <OptionSelect
                className="h-8"
                value={form.registerType}
                options={DRAFT_REGISTER_TYPE_OPTIONS}
                placeholder="등록유형 선택"
                onChange={(registerType) => patch({ registerType })}
              />
            </Field>
            <Field label="오픈유형">
              <OptionSelect
                className="h-8"
                value={form.openType}
                options={DRAFT_OPEN_TYPE_OPTIONS}
                placeholder="오픈유형 선택"
                onChange={(openType) => patch({ openType })}
              />
            </Field>
            <Field label="오픈 채널">
              <OptionSelect
                className="h-8"
                value={form.openTypeDetail}
                options={DRAFT_OPEN_DETAIL_OPTIONS}
                placeholder="채널 선택"
                onChange={(openTypeDetail) => patch({ openTypeDetail })}
              />
            </Field>
          </div>

          <CheckRow
            label="단가 최종 확인"
            checked={form.costConfirmed}
            onChange={(next) => patch({ costConfirmed: next })}
          />
          {!form.costConfirmed && form.targetCost != null ? (
            <p className="text-[11px] text-muted-foreground">
              공장 협의 전 잠정 단가입니다.
            </p>
          ) : null}

          <Field label="발매 이슈">
            <Textarea
              className="p-2"
              rows={2}
              placeholder="** 카카오선물하기 단독 **"
              value={form.releaseIssue}
              onChange={(e) => patch({ releaseIssue: e.target.value })}
            />
          </Field>
        </SectionCard>

        <SectionCard
          title="스펙"
          aside="숫자만 넣으면 단위가 붙습니다"
          className="lg:col-span-2"
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
            <div className="space-y-1">
              <SpecHead
                label="Size"
                hint="W × D × H"
                checked={form.specs.size.confirmed}
                onChange={(next) =>
                  patch({
                    specs: {
                      ...form.specs,
                      size: { ...form.specs.size, confirmed: next },
                    },
                  })
                }
              />
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['width', '가로 (W)'],
                    ['depth', '세로 (D)'],
                    ['height', '높이 (H)'],
                  ] as const
                ).map(([part, label]) => {
                  const size = parseSizeSpec(form.specs.size.value)
                  return (
                    <label key={part} className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        {label}
                      </span>
                      <UnitInput
                        value={size[part]}
                        unit="mm"
                        placeholder="0"
                        onChange={(value) =>
                          patch({
                            specs: {
                              ...form.specs,
                              size: {
                                ...form.specs.size,
                                value: formatSizeSpec({
                                  ...size,
                                  [part]: value,
                                }),
                              },
                            },
                          })
                        }
                      />
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="space-y-1">
              <SpecHead
                label="Weight"
                checked={form.specs.weight.confirmed}
                onChange={(next) =>
                  patch({
                    specs: {
                      ...form.specs,
                      weight: { ...form.specs.weight, confirmed: next },
                    },
                  })
                }
              />
              <UnitInput
                value={parseWeightSpec(form.specs.weight.value)}
                unit="g"
                placeholder="244.5"
                onChange={(value) =>
                  patch({
                    specs: {
                      ...form.specs,
                      weight: {
                        ...form.specs.weight,
                        value: formatWeightSpec(value),
                      },
                    },
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                사이즈 메모 (선택)
              </span>
              <Textarea
                className="p-2"
                rows={2}
                placeholder="예: 스트랩 최대 1060mm"
                value={form.specs.size.note}
                onChange={(e) =>
                  patch({
                    specs: {
                      ...form.specs,
                      size: { ...form.specs.size, note: e.target.value },
                    },
                  })
                }
              />
            </label>

            {TEXT_SPEC_KEYS.map((key) => {
              const spec = form.specs[key]
              return (
                <div key={key} className="space-y-1">
                  <SpecHead
                    label={DRAFT_SPEC_LABEL[key]}
                    checked={spec.confirmed}
                    onChange={(next) =>
                      patch({
                        specs: {
                          ...form.specs,
                          [key]: { ...spec, confirmed: next },
                        },
                      })
                    }
                  />
                  <Textarea
                    className="p-2"
                    rows={2}
                    placeholder={SPEC_PLACEHOLDER[key]}
                    value={spec.value}
                    onChange={(e) =>
                      patch({
                        specs: {
                          ...form.specs,
                          [key]: { ...spec, value: e.target.value },
                        },
                      })
                    }
                  />
                </div>
              )
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="옵션 · 메모"
          aside={form.hasOptions ? `옵션 ${form.options.length}` : undefined}
        >
          <CheckRow
            label="옵션 추가 있음"
            checked={form.hasOptions}
            onChange={(next) =>
              patch({
                hasOptions: next,
                options:
                  next && form.options.length === 0
                    ? [newOptionRow()]
                    : form.options,
              })
            }
          />
          {form.hasOptions ? (
            <div className="space-y-1.5">
              {form.options.map((row, index) => {
                const currentStyle = styles.find(
                  (style) => style.id === row.styleId,
                )
                return (
                  <div
                    key={row.id}
                    className="grid grid-cols-[1rem_minmax(0,1fr)_5rem_1.75rem] items-center gap-1.5"
                  >
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <Select
                      className="h-8 w-full min-w-0"
                      value={row.styleId}
                      disabled={!form.brandId}
                      onChange={(e) => {
                        const style = styles.find(
                          (item) => item.id === e.target.value,
                        )
                        patch({
                          options: form.options.map((item) =>
                            item.id === row.id
                              ? {
                                  ...item,
                                  styleId: style?.id ?? '',
                                  name: style?.name ?? '',
                                }
                              : item,
                          ),
                        })
                      }}
                    >
                      <option value="">
                        {row.name && !row.styleId
                          ? `기존: ${row.name}`
                          : !form.brandId
                            ? '브랜드를 먼저 고르세요'
                            : stylesQuery.isLoading
                              ? '상품 불러오는 중...'
                              : '상품 선택'}
                      </option>
                      {row.styleId && !currentStyle ? (
                        <option value={row.styleId}>
                          {row.name || '기존 상품'}
                        </option>
                      ) : null}
                      {styles.map((style) => (
                        <option key={style.id} value={style.id}>
                          {style.styleNo} · {style.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      className="h-8 px-2 text-right tabular-nums"
                      inputMode="numeric"
                      placeholder="가격"
                      value={row.price == null ? '' : String(row.price)}
                      onChange={(e) =>
                        patch({
                          options: form.options.map((item) =>
                            item.id === row.id
                              ? {
                                  ...item,
                                  price: toNumber(e.target.value),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`옵션 ${index + 1} 삭제`}
                      onClick={() =>
                        patch({
                          options: form.options.filter(
                            (item) => item.id !== row.id,
                          ),
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() =>
                  patch({ options: [...form.options, newOptionRow()] })
                }
                className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <Plus className="size-3.5" />
                옵션 추가
              </button>
            </div>
          ) : null}
          <Field label="메모">
            <Textarea
              className="p-2"
              rows={3}
              value={form.note}
              onChange={(e) => patch({ note: e.target.value })}
            />
          </Field>
        </SectionCard>
      </div>

      {failOpen ? (
        <SampleFailReasonDialog
          value={failReason}
          saving={saveMutation.isPending}
          onChange={setFailReason}
          onClose={() => setFailOpen(false)}
          onConfirm={() => {
            const nextOrders = failLatestSampleWorkOrder(workOrders, failReason)
            if (nextOrders === workOrders) {
              setError('불합격 사유를 적어 주세요.')
              return
            }
            const nextForm = {
              ...form,
              sampleWorkOrders: nextOrders,
              ...legacyWorkOrderFields(nextOrders),
            }
            patchWorkOrders(nextOrders)
            setFailOpen(false)
            setFailReason('')
            if (!isNew) saveMutation.mutate(nextForm)
          }}
        />
      ) : null}
    </div>
  )
}

function SampleFailReasonDialog({
  value,
  saving,
  onChange,
  onClose,
  onConfirm,
}: {
  value: string
  saving: boolean
  onChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sample-fail-title"
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl"
      >
        <h2 id="sample-fail-title" className="text-base font-semibold">
          불합격 사유
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          다음 샘플에서 어디를 고칠지 남겨 두면 중국팀이 그 부분을 중점으로
          봅니다.
        </p>
        <Textarea
          className="mt-4 min-h-28"
          autoFocus
          placeholder="예: 소매 기장 1cm 짧게, 원단 두께 한 단계 올리기"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            disabled={!value.trim() || saving}
            onClick={onConfirm}
          >
            {saving ? '저장 중...' : '저장하고 다음 차수'}
          </Button>
        </div>
      </div>
    </div>
  )
}
