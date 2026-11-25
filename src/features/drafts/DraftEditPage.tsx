import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
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
  getSeasonsByBrand,
  getStylesByBrand,
  newColorRow,
  newOptionRow,
  updateProductDraft,
} from '@/lib/api'
import { readFileAsDataUrl, readImageFile } from '@/lib/images'
import { SampleWorkOrderRegistration } from './SampleWorkOrderRegistration'
import { SAMPLE_WORK_ORDER_ACCEPT, SAMPLE_WORK_ORDER_MAX_BYTES, type SampleWorkOrderFile } from './SampleWorkOrderFileField'
import { SampleWorkOrderPackField } from './SampleWorkOrderPackField'
import { SampleWorkOrderPackDetails } from './SampleWorkOrderPackDetails'
import { samplePackId } from '@/lib/supabase/sample-work-order-packs'
import { RegisteredSampleCard } from './RegisteredSampleCard'
import { RegisteredColorSampleCards } from './RegisteredColorSampleCards'
import { DraftProposerPicker } from './DraftProposerPicker'
import { useDraftSabangnetPartners, withSavedDraftPartner } from './use-draft-sabangnet-partners'
import { SampleDestinationSelect } from './SampleDestinationSelect'
import { resolveColorSampleRounds } from '@/lib/drafts/draft-flow'
import { registerDraftSampleStage, updateDraftColorSample } from '@/lib/drafts/sample-registration'
import {
  COST_CURRENCY_LABEL,
  DRAFT_OPEN_TYPE_OPTIONS,
  DRAFT_REGISTER_TYPE_OPTIONS,
  DRAFT_SPEC_LABEL,
  type CostCurrency,
  type DraftSpecKey,
  type ProductDraft,
  type ProductDraftInput,
  type Season,
  type Style,
} from '@/lib/types'
import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import {
  DRAFT_NAMES_REQUIRED, hasBothDraftNames, requiresDraftBrand,
} from '@/lib/drafts/company-draft'
import {
  colorWorkOrderFileName,
} from '@/lib/drafts/draft-flow'
import { applySampleOrigin, isSampleDestination, sampleCountry, sampleReadyForNextStage } from '@/lib/drafts/sample-receipt'
import { sampleOrderLabel } from '@/lib/drafts/sample-registration'
import {
  attachSampleWorkOrderFile,
  draftToInput,
  filledSampleWorkOrders,
  latestFilledSampleWorkOrder,
  legacyWorkOrderFields,
  patchSampleWorkOrder,
  sampleWorkOrderFileName,
  withPendingNextSampleWorkOrder,
} from '@/lib/drafts/sample-work-order'
import { useAuth } from '@/lib/supabase/auth'
import { useBasicWorkAccess, canWriteDraft } from '@/lib/supabase/basic-work-access'
import {
  formatSizeSpec,
  parseSizeSpec,
} from '@/lib/drafts/spec-format'
import { draftDetailPath } from '@/lib/workspace/company-paths'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn, formatNumber } from '@/lib/utils'

const EMPTY_SEASONS: Season[] = []
const EMPTY_STYLES: Style[] = []

const TEXT_SPEC_KEYS = ['fabric', 'coating'] as const satisfies DraftSpecKey[]

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
  className,
}: {
  value: string
  unit: string
  onChange: (next: string) => void
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
        onChange={(e) => onChange(sanitizeNumberText(e.target.value))}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-muted-foreground">
        {unit}
      </span>
    </div>
  )
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
  useRenderWatch('DraftEditPage')
  const { brands, brandById, brandBySlug } = useCompanyBrandScope()
  const { profile } = useAuth()
  const workAccess = useBasicWorkAccess()
  const { draftId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const workOrderInputRef = useRef<HTMLInputElement>(null)
  const uploadOrderIdRef = useRef<string | null>(null)
  const uploadColorIdRef = useRef<string | null>(null)
  const newAttachmentDraft = useRef<ProductDraft | null>(null)
  const creatingAttachmentDraft = useRef<Promise<ProductDraft> | null>(null)
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID

  const isNew = !draftId || draftId === 'new'
  const [form, setForm] = useState<ProductDraftInput>(() => emptyDraftInput())
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [seasonPrefillDone, setSeasonPrefillDone] = useState(false)
  const [seasonFromQueryDone, setSeasonFromQueryDone] = useState(false)
  const [editorPart, setEditorPart] = useState<'basic' | 'pending'>('basic')
  const partners = useDraftSabangnetPartners(form.brandId, editorPart === 'pending')
  const openChannelId = form.specs.openChannelTargetId ?? null
  const openChannel = withSavedDraftPartner(
    [{ id: 'all', label: '전체' }, ...partners.options],
    openChannelId ?? (form.openTypeDetail === '전체' ? 'all' : null),
    form.openTypeDetail,
    openChannelId ? partners.names.get(openChannelId) : undefined,
  )
  const selectedBrand = form.brandId ? brandById.get(form.brandId) : undefined
  const designer = form.owner.trim() || (isNew ? profile?.displayName?.trim() : '') || '미정'

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

  const stylesQuery = useQuery({
    queryKey: ['styles', form.brandId],
    queryFn: () => getStylesByBrand(form.brandId ?? ''),
    enabled: Boolean(form.brandId),
  })
  const styles = form.brandId
    ? (stylesQuery.data ?? EMPTY_STYLES)
    : EMPTY_STYLES

  const loaded = draftQuery.data
  const editable = canWriteDraft(workAccess.access, isNew ? null : loaded ?? { createdBy: null }, form.brandId)
  const hasBothNames = hasBothDraftNames(form)
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

  const savedSamples = filledSampleWorkOrders(form.sampleWorkOrders).slice().sort((left, right) => left.round - right.round)
  const latestSavedSample = savedSamples.at(-1)
  const canRegisterNextSample = sampleReadyForNextStage(latestSavedSample)
  const savedColorSamples = resolveColorSampleRounds(form)
  useEffect(() => {
    if (location.hash !== '#next-sample' || !canRegisterNextSample) return
    document.getElementById('next-sample')?.scrollIntoView({ block: 'start' })
  }, [location.hash, loaded?.id, canRegisterNextSample])
  async function saveSampleAttachment(nextForm: ProductDraftInput) {
    if (saveMutation.isPending) throw new Error('기획안 저장이 끝난 뒤 다시 등록해 주세요.')
    const saved = await saveMutation.mutateAsync(nextForm)
    if (!isNew) setForm(draftToInput(saved))
  }

  async function registerFirstSample(file: SampleWorkOrderFile) {
    if (!isSampleDestination(form.originCountry)) {
      throw new Error('샘플 진행처를 먼저 선택해 주세요.')
    }
    const sampleWorkOrders = applySampleOrigin(attachSampleWorkOrderFile(form.sampleWorkOrders, file), form.originCountry)
    await saveSampleAttachment({ ...form, sampleWorkOrders, ...legacyWorkOrderFields(sampleWorkOrders) })
  }

  async function createAttachmentDraft() {
    if (!editable) throw new Error('기획안 작성 권한을 확인해 주세요.')
    if (newAttachmentDraft.current) return newAttachmentDraft.current.id
    const creator = profile?.displayName?.trim() ?? ''
    return (await createDraftRecord({ ...form, owner: form.owner.trim() ? form.owner : creator })).id
  }

  function createDraftRecord(payload: ProductDraftInput) {
    if (!creatingAttachmentDraft.current) {
      creatingAttachmentDraft.current = createProductDraft(companyId, payload).then(saved => {
        newAttachmentDraft.current = saved
        return saved
      }).finally(() => { creatingAttachmentDraft.current = null })
    }
    return creatingAttachmentDraft.current
  }

  async function replaceSavedSampleFile(orderId: string, file: SampleWorkOrderFile) {
    const order = form.sampleWorkOrders.find((item) => item.id === orderId)
    if (!order || order.shipped || order.receivedAt || order.passed) {
      throw new Error('발송 전 작업지시서만 교체할 수 있습니다.')
    }
    const sampleWorkOrders = patchSampleWorkOrder(form.sampleWorkOrders, orderId, {
      ...file,
      shipped: false,
      shippedAt: order.shippedAt ?? new Date().toISOString(),
      returnedAt: null,
    })
    await saveSampleAttachment({ ...form, sampleWorkOrders, ...legacyWorkOrderFields(sampleWorkOrders) })
  }

  function updateSavedSampleCountry(orderId: string, originCountry: string) {
    const china = sampleCountry(originCountry).code === 'CN'
    const sampleWorkOrders = form.sampleWorkOrders.map((order) => order.id === orderId && !order.shipped && !order.receivedAt && !order.passed ? {
      ...order,
      originCountry,
      assigneeId: china ? order.assigneeId : null,
      assigneeName: china ? order.assigneeName : '',
    } : order)
    const latest = latestFilledSampleWorkOrder(sampleWorkOrders)
    const nextOrigin = latest?.id === orderId ? originCountry : form.originCountry
    const nextForm = { ...form, originCountry: nextOrigin, sampleWorkOrders, ...legacyWorkOrderFields(sampleWorkOrders) }
    patch({ originCountry: nextOrigin, sampleWorkOrders, ...legacyWorkOrderFields(sampleWorkOrders) })
    if (!isNew) saveMutation.mutate(nextForm)
  }

  async function replaceSavedColorSampleFile(id: string, file: SampleWorkOrderFile) {
    await saveSampleAttachment(updateDraftColorSample(form, id, { file }))
  }

  function updateSavedColorSampleCountry(id: string, country: string) {
    if (!editable || saveMutation.isPending) return
    try {
      const nextForm = updateDraftColorSample(form, id, { country })
      patch({ specs: nextForm.specs })
      if (!isNew) saveMutation.mutate(nextForm)
    } catch (cause) {
      console.warn('[drafts] 컬러샘플 진행처 저장 실패', cause)
      setError(cause instanceof Error ? cause.message : '샘플 진행처를 바꾸지 못했습니다.')
    }
  }

  function patchColor(
    colorId: string,
    next: Partial<ProductDraftInput['colors'][number]>,
  ) {
    patch({
      colors: form.colors.map((row) =>
        row.id === colorId ? { ...row, ...next } : row,
      ),
    })
  }

  const saveMutation = useMutation({
    mutationFn: async (next?: ProductDraftInput) => {
      if (!editable) throw new Error('기획안은 작성자만 수정할 수 있습니다.')
      const source = next ?? form
      const creator = profile?.displayName?.trim() ?? ''
      const payload =
        isNew && !source.owner.trim() && creator
          ? { ...source, owner: creator }
          : source
      if (requiresDraftBrand(payload.status) && !payload.brandId) {
        throw new Error('출시 확정 전에 브랜드를 지정하세요.')
      }
      if (isNew) {
        const existing = newAttachmentDraft.current
        return existing
          ? updateProductDraft(existing.id, { ...payload, expectedUpdatedAt: existing.updatedAt })
          : createDraftRecord(payload)
      }
      if (!draftId) throw new Error('기획안을 찾을 수 없습니다.')
      return updateProductDraft(draftId, { ...payload, expectedUpdatedAt: payload.expectedUpdatedAt ?? loaded?.updatedAt })
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
      if (!editable) throw new Error('기획안은 작성자만 삭제할 수 있습니다.')
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
          {!isNew && editable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!editable || deleteMutation.isPending}
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
            disabled={!editable || saveMutation.isPending}
            onClick={() => saveMutation.mutate(form)}
          >
            <Save className="size-3.5" />
            {saveMutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </div>
      </div>

      {workAccess.error ? <p role="alert" className="mb-3 text-sm text-danger">{workAccess.error.message}</p> : !editable ? <p role="status" className="mb-3 text-sm text-muted-foreground">조회 전용 · 작성자와 지정된 운영 계정만 수정·삭제할 수 있습니다.</p> : null}
      <fieldset disabled={!editable} className="min-w-0 border-0 p-0">
      {error ? (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div role="tablist" aria-label="기획안 편집 구역" className="mb-3 flex gap-2 border-b border-border pb-3">
        <Button type="button" role="tab" aria-selected={editorPart === 'basic'} variant={editorPart === 'basic' ? 'default' : 'outline'} onClick={() => setEditorPart('basic')}>기본</Button>
        <Button type="button" role="tab" aria-selected={editorPart === 'pending'} variant={editorPart === 'pending' ? 'default' : 'outline'} onClick={() => setEditorPart('pending')}>수정예정</Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {editorPart === 'basic' ? (
        <SectionCard title="기본" className="lg:col-span-3">
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
          <div className="grid items-start gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-6">
            <div className="relative aspect-square w-32 sm:w-40 lg:w-48">
              <button
                type="button"
                title="사진 선택"
                onClick={() => fileInputRef.current?.click()}
                className="flex size-full items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 transition-colors hover:bg-muted"
              >
                {form.imageUrl ? (
                  <img
                    src={form.imageUrl}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <ImagePlus className="size-8 text-muted-foreground" />
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
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-3">
              <div className="col-span-2 flex min-w-0 items-start gap-3">
                {selectedBrand && (
                  <div role="img" aria-label={`${selectedBrand.name} 브랜드`} title={selectedBrand.name}>
                    <BrandAvatar brand={selectedBrand} className="size-11 rounded-full [&>img]:object-contain" />
                  </div>
                )}
                <div className="min-w-0 space-y-0.5 break-words text-sm">
                  <p>Designer <strong>{designer}</strong></p>
                  <p className="font-semibold">{loaded?.draftNo ? `No. ${loaded.draftNo}` : 'No. 저장 시 발급'}</p>
                  <p className="text-muted-foreground">제안자 <span className="text-foreground">{form.specs.proposer?.name ?? '미지정'}</span></p>
                </div>
              </div>
              <Field label="한글명">
                <Input
                  aria-label="한글명"
                  className="h-9"
                  value={form.nameKo}
                  readOnly={Boolean(form.specs.nameConfirmed)}
                  onChange={(e) => patch({ nameKo: e.target.value })}
                />
              </Field>
              <span />
              <Field label="영문명">
                <Input
                  aria-label="영문명"
                  className="h-9"
                  value={form.nameEn}
                  readOnly={Boolean(form.specs.nameConfirmed)}
                  onChange={(e) => patch({ nameEn: e.target.value })}
                />
              </Field>
              <div className="flex gap-2">
                    {form.specs.nameConfirmed ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!editable || saveMutation.isPending}
                      onClick={() => {
                        const nextForm = { ...form, specs: { ...form.specs, nameConfirmed: false } }
                        patch({ specs: nextForm.specs })
                        if (!isNew) saveMutation.mutate(nextForm)
                      }}
                    >
                      네임수정
                    </Button>
                    ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!editable || saveMutation.isPending || !hasBothNames}
                      title={hasBothNames ? undefined : DRAFT_NAMES_REQUIRED}
                      onClick={() => {
                        const nextForm = { ...form, specs: { ...form.specs, nameConfirmed: true } }
                        patch({ specs: nextForm.specs })
                        if (!isNew) saveMutation.mutate(nextForm)
                      }}
                    >
                      네임확정
                    </Button>
                    )}
                  </div>
                </div>
              </div>
          <div className="mt-2 grid gap-5 border-t border-border pt-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="space-y-2">
              <Select aria-label="브랜드 선택" className="h-8 w-full text-xs" value={form.brandId ?? ''}
                disabled={!isNew || !editable || saveMutation.isPending}
                onChange={event => {
                  setSeasonPrefillDone(true)
                  setSeasonFromQueryDone(true)
                  patch({
                    brandId: event.target.value || null, seasonId: null,
                    ...(form.specs.openChannelTargetId
                      ? { openTypeDetail: '', specs: { ...form.specs, openChannelTargetId: null } }
                      : {}),
                  })
                }}>
                <option value="">브랜드 미정</option>
                {brands.map(brand => <option key={brand.id} value={brand.id}
                  disabled={isNew && !canWriteDraft(workAccess.access, null, brand.id)}>{brand.name}</option>)}
              </Select>
              {savedSamples.length === 0 && <SampleDestinationSelect value={form.originCountry}
                disabled={!editable || saveMutation.isPending} onChange={originCountry => {
                  const sampleWorkOrders = applySampleOrigin(form.sampleWorkOrders, originCountry)
                  const nextForm = { ...form, originCountry, sampleWorkOrders, ...legacyWorkOrderFields(sampleWorkOrders) }
                  patch({ originCountry, sampleWorkOrders, ...legacyWorkOrderFields(sampleWorkOrders) })
                  if (!isNew && latestFilledSampleWorkOrder(sampleWorkOrders)) saveMutation.mutate(nextForm)
                }} />}
              <DraftProposerPicker actorId={profile?.id} value={form.specs.proposer}
                readOnly={!editable || saveMutation.isPending}
                onChange={proposer => patch({ specs: { ...form.specs, proposer } })} />
              {savedSamples.length === 0 && <p className="text-xs text-muted-foreground">
                CHINA (김웅사장님)의 지시서는 중국팀에 전달됩니다. 다른 진행처는 기획안에 기록됩니다.
              </p>}
            </div>
            <div className="min-w-0">
              {savedSamples.length === 0 ? (
                <SampleWorkOrderPackField label="1차 샘플" draftId={isNew ? null : draftId ?? null} slot="first" readOnly={!editable}
                  saving={saveMutation.isPending} onRegister={registerFirstSample} onCreateDraft={createAttachmentDraft}
                  onTemporarySaved={id => {
                    if (!isNew) return
                    void queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
                    navigate(draftDetailPath(id), { replace: true })
                  }}
                  validateRegistration={() => {
                    if (!isSampleDestination(form.originCountry)) throw new Error('샘플 진행처를 먼저 선택해 주세요.')
                  }} />
              ) : savedSamples.map((order) => (
                <RegisteredSampleCard key={order.id} draftId={draftId ?? null} id={order.id} label={sampleOrderLabel(order, savedSamples)}
                  status={order.receivedAt ? '수령' : order.shipped ? '발송' : '진행'}
                  country={order.originCountry || form.originCountry} url={order.url} name={sampleWorkOrderFileName(order)}
                  locked={Boolean(order.shipped || order.receivedAt || order.passed)} readOnly={!editable} saving={saveMutation.isPending}
                  onRegister={file => replaceSavedSampleFile(order.id, file)} onCountry={country => updateSavedSampleCountry(order.id, country)} />
              ))}
              <RegisteredColorSampleCards draftId={draftId ?? null} rounds={savedColorSamples} originCountry={form.originCountry} readOnly={!editable} saving={saveMutation.isPending}
                onRegister={replaceSavedColorSampleFile} onCountry={updateSavedColorSampleCountry} />
              {canRegisterNextSample && (
                <div id="next-sample">
                  <SampleWorkOrderRegistration draftId={draftId ?? null} originCountry={form.originCountry}
                    nextRound={(latestSavedSample?.round ?? 1) + 1}
                    nextColorRound={Math.max(0, ...savedColorSamples.map(round => round.round)) + 1}
                    latestIsFinal={latestSavedSample?.sampleStage === 'final'}
                    finalCount={savedSamples.filter((order) => order.sampleStage === 'final').length}
                    readOnly={!editable} saving={saveMutation.isPending}
                    onRegister={async (stage, file, country) => {
                      if (isNew || !draftId) throw new Error('1차 작업지시서를 먼저 저장해 주세요.')
                      const current = await getProductDraftById(draftId)
                      if (!current) throw new Error('기획안을 다시 조회해 주세요.')
                      const nextForm = registerDraftSampleStage(draftToInput(current), stage, file, country)
                      const saved = await saveMutation.mutateAsync({ ...nextForm, expectedUpdatedAt: current.updatedAt })
                      setForm(draftToInput(saved))
                      const registeredId = stage === 'color' ? resolveColorSampleRounds(saved).at(-1)?.id : latestFilledSampleWorkOrder(saved.sampleWorkOrders)?.id
                      if (registeredId) window.requestAnimationFrame(() => document.getElementById(`sample-history-${registeredId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
                    }} />
                </div>
              )}
            </div>
          </div>

        </SectionCard>
        ) : (
        <>
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
                const colorId = uploadColorIdRef.current
                event.target.value = ''
                uploadOrderIdRef.current = null
                uploadColorIdRef.current = null
                if (!file || (!targetId && !colorId)) return
                if (file.size > SAMPLE_WORK_ORDER_MAX_BYTES) {
                  setError('작업 지시서는 8MB 이하만 올릴 수 있습니다.')
                  return
                }
                try {
                  const url = await readFileAsDataUrl(file)
                  if (colorId) {
                    patchColor(colorId, {
                      sampleWorkOrderUrl: url,
                      sampleWorkOrderName: file.name,
                      sampleWorkOrderShipped: false,
                      sampleWorkOrderShippedAt: null,
                      sampleInProgress: true,
                    })
                    return
                  }
                  patchWorkOrders(
                    patchSampleWorkOrder(workOrders, targetId!, {
                      url,
                      name: file.name,
                      shipped: false,
                      shippedAt: new Date().toISOString(),
                      returnedAt: null,
                    }),
                  )
                } catch {
                  setError('작업 지시서를 불러오지 못했습니다.')
                }
              }}
            />
            {canRegisterNextSample ? <Button type="button" size="sm" variant="outline" onClick={() => { setEditorPart('basic'); window.requestAnimationFrame(() => document.getElementById('next-sample')?.scrollIntoView({ block: 'start' })) }}>다음 샘플 진행</Button> : null}
          </div>

          <div className="space-y-1.5">
            <div className="grid grid-cols-[1rem_minmax(0,1fr)_4.5rem_2.5rem_1.75rem] items-center gap-1.5 text-[11px] text-muted-foreground">
              <span />
              <span>컬러명</span>
              <span className="text-right">발주</span>
              <span className="text-center">샘플</span>
              <span />
            </div>
            <div className="space-y-2">
              {form.colors.map((color, index) => {
                const showColorWorkOrder = canRegisterNextSample || Boolean(color.sampleWorkOrderUrl)
                const colorFileName = colorWorkOrderFileName(color)
                const colorPack = samplePackId(color.sampleWorkOrderUrl)
                return (
                  <div key={color.id} className="space-y-1">
                    <div className="grid grid-cols-[1rem_minmax(0,1fr)_4.5rem_2.5rem_1.75rem] items-center gap-1.5">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <Input
                        className="h-8 min-w-0"
                        value={color.name}
                        onChange={(e) =>
                          patchColor(color.id, { name: e.target.value })
                        }
                      />
                      <Input
                        className="h-8 px-2 text-right tabular-nums"
                        inputMode="numeric"
                        value={
                          color.orderQty == null ? '' : String(color.orderQty)
                        }
                        onChange={(e) =>
                          patchColor(color.id, {
                            orderQty: toNumber(e.target.value),
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
                            patchColor(color.id, {
                              sampleInProgress: e.target.checked,
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
                    {colorPack ? <SampleWorkOrderPackDetails id={colorPack} label={colorFileName} showBulk /> : showColorWorkOrder ? (
                      color.sampleWorkOrderUrl ? (
                        <div className="flex items-center gap-0.5 rounded-md border border-border px-2 py-1">
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <a
                            href={color.sampleWorkOrderUrl}
                            download={colorFileName}
                            className="min-w-0 flex-1 truncate px-1 text-xs underline-offset-2 hover:underline"
                          >
                            {colorFileName}
                          </a>
                          {color.sampleWorkOrderShipped ? (
                            <span className="shrink-0 rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 text-[11px] font-medium">
                              발송 완료
                            </span>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label="바꾸기"
                            title="바꾸기"
                            onClick={() => {
                              uploadOrderIdRef.current = null
                              uploadColorIdRef.current = color.id
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
                              patchColor(color.id, {
                                sampleWorkOrderUrl: null,
                                sampleWorkOrderName: '',
                                sampleWorkOrderShipped: false,
                                sampleWorkOrderShippedAt: null,
                              })
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
                            uploadOrderIdRef.current = null
                            uploadColorIdRef.current = color.id
                            workOrderInputRef.current?.click()
                          }}
                          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                        >
                          <Upload className="size-3.5" />
                          {color.name.trim() || `컬러 ${index + 1}`} 작업 지시서
                        </button>
                      )
                    ) : null}
                  </div>
                )
              })}
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
                value={
                  form.discountPrice == null ? '' : String(form.discountPrice)
                }
                onChange={(e) =>
                  patch({ discountPrice: toNumber(e.target.value) })
                }
              />
            </Field>
            <Field label="샘플 진행처">
              <SampleDestinationSelect value={form.originCountry} disabled={!editable}
                onChange={originCountry => patch({ originCountry })} />
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
              <Select aria-label="오픈 채널" className="h-8" value={openChannel.value}
                disabled={!editable || saveMutation.isPending}
                onChange={event => {
                  const value = event.currentTarget.value
                  if (value === openChannel.value) return
                  const target = partners.options.find(option => option.id === value)
                  patch({
                    openTypeDetail: target?.registeredName ?? (value === 'all' ? '전체' : ''),
                    specs: { ...form.specs, openChannelTargetId: target?.id ?? null },
                  })
                }}>
                <option value="">{partners.placeholder}</option>
                {openChannel.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </Select>
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

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                샘플 상태 메모
              </span>
              <Textarea
                className="p-2"
                rows={2}
                value={form.specs.fabric.note}
                onChange={(e) =>
                  patch({
                    specs: {
                      ...form.specs,
                      fabric: { ...form.specs.fabric, note: e.target.value },
                    },
                  })
                }
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                스펙 문서 메모
              </span>
              <Textarea
                className="p-2"
                rows={2}
                value={form.specs.coating.note}
                onChange={(e) =>
                  patch({
                    specs: {
                      ...form.specs,
                      specDocumentConfirmed: false,
                      coating: { ...form.specs.coating, note: e.target.value },
                    },
                  })
                }
              />
            </label>
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
                      aria-label="가격"
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
        </>
        )}
      </div>

      </fieldset>
    </div>
  )
}
