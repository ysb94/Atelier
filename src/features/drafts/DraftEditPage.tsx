import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import {
  MAX_DRAFT_COLORS,
  createProductDraft,
  deleteProductDraft,
  emptyDraftInput,
  getProductDraftById,
  getProductDrafts,
  getSeasonsByBrand,
  getStylesByBrand,
  newColorRow,
  newOptionRow,
  updateProductDraft,
} from '@/lib/api'
import { readImageFile } from '@/lib/images'
import {
  COST_CURRENCY_LABEL,
  DRAFT_OPEN_DETAIL_OPTIONS,
  DRAFT_OPEN_TYPE_OPTIONS,
  DRAFT_ORIGIN_OPTIONS,
  DRAFT_OWNER_OPTIONS,
  DRAFT_REGISTER_TYPE_OPTIONS,
  DRAFT_SPEC_LABEL,
  DRAFT_STATUS_LABEL,
  formatSeasonLabel,
  type CostCurrency,
  type DraftSpecKey,
  type ProductDraftInput,
  type ProductDraftStatus,
  type Season,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

const TEXT_SPEC_KEYS = ['fabric', 'coating'] as const satisfies DraftSpecKey[]

const SPEC_PLACEHOLDER: Record<(typeof TEXT_SPEC_KEYS)[number], string> = {
  fabric: '겉감: Nylon 75% / 안감: Polyester 100%',
  coating: '생활 발수 OK',
}

const PROGRESS_STEPS: {
  key: 'sampleDone' | 'orderDone' | 'photoSampleDone'
  label: string
}[] = [
  { key: 'sampleDone', label: '샘플 진행 중' },
  { key: 'orderDone', label: '생산 발주 완료' },
  { key: 'photoSampleDone', label: '최종 촬영 샘플 입고 완료' },
]

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
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

function CheckRow({
  label,
  checked,
  onChange,
  tone = 'progress',
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  tone?: 'progress' | 'hold'
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
        checked && tone === 'progress' && 'border-success/40 bg-success/5',
        checked && tone === 'hold' && 'border-danger/40 bg-danger/5',
        !checked && 'border-border hover:bg-muted/50',
      )}
    >
      <span
        className={cn(
          'font-medium',
          checked && tone === 'hold' && 'text-danger',
        )}
      >
        {label}
      </span>
      <input
        type="checkbox"
        className="size-4 accent-current"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
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
  const extras =
    value && !options.includes(value) ? [value] : ([] as string[])
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
        className="pr-12"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(sanitizeNumberText(e.target.value))}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
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
  const strap =
    value.match(/(?:STRAP|어깨끈)[^\d]*([\d.]+)/i)?.[1] ?? ''

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

function listPathForSeason(
  brandSlug: string,
  seasonId: string | null,
  seasons: Season[],
) {
  if (!seasonId) return `/b/${brandSlug}/drafts/season/unassigned`
  const season = seasons.find((item) => item.id === seasonId)
  if (!season) return `/b/${brandSlug}/drafts`
  return `/b/${brandSlug}/drafts/season/${encodeURIComponent(season.code)}`
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
  const { brand } = useBrand()
  const { draftId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isNew = draftId === 'new'
  const [form, setForm] = useState<ProductDraftInput>(() => emptyDraftInput())
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [seasonPrefillDone, setSeasonPrefillDone] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const draftQuery = useQuery({
    queryKey: ['product-draft', draftId],
    queryFn: () => getProductDraftById(draftId ?? ''),
    enabled: !isNew && Boolean(draftId),
  })

  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })
  const seasons = seasonsQuery.data ?? []

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', brand.id],
    queryFn: () => getProductDrafts(brand.id),
  })

  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id],
    queryFn: () => getStylesByBrand(brand.id),
  })
  const styles = stylesQuery.data ?? []

  const ownerOptions = useMemo(() => {
    const fromDrafts = (draftsQuery.data ?? [])
      .map((d) => d.owner.trim())
      .filter(Boolean)
    return Array.from(
      new Set([...DRAFT_OWNER_OPTIONS, ...fromDrafts]),
    ).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [draftsQuery.data])

  const loaded = draftQuery.data
  useEffect(() => {
    if (!loaded) return
    const {
      id: _id,
      brandId: _brandId,
      draftNo: _draftNo,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      promotedStyleId: _promoted,
      ...rest
    } = loaded
    setForm(rest)
  }, [loaded])

  useEffect(() => {
    if (!isNew || seasonPrefillDone || seasonsQuery.isLoading) return
    const fromQuery = seasonIdFromQuery(searchParams.get('season'), seasons)
    if (fromQuery !== undefined) {
      setForm((prev) => ({ ...prev, seasonId: fromQuery }))
    }
    setSeasonPrefillDone(true)
  }, [isNew, seasonPrefillDone, seasonsQuery.isLoading, searchParams, seasons])

  const listPath = listPathForSeason(brand.slug, form.seasonId, seasons)

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) return createProductDraft(brand.id, form)
      if (!draftId) throw new Error('기획안을 찾을 수 없습니다.')
      return updateProductDraft(draftId, form)
    },
    onSuccess: async (saved) => {
      setError(null)
      setSavedAt(new Date().toLocaleTimeString('ko-KR'))
      await queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
      await queryClient.invalidateQueries({ queryKey: ['product-draft'] })
      if (isNew) navigate(`/b/${brand.slug}/drafts/${saved.id}`, { replace: true })
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

  if (!isNew && draftQuery.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        불러오는 중...
      </div>
    )
  }

  if (!isNew && !draftQuery.isLoading && !loaded) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          기획안을 찾을 수 없습니다.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate(`/b/${brand.slug}/drafts`)}
        >
          출시 기획 선택으로
        </Button>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => navigate(listPath)}
      >
        <ChevronLeft className="size-4" />
        기획안 목록
      </button>

      <PageHeader
        title={isNew ? '새 기획안' : (loaded?.draftNo ?? '기획안')}
        description={
          isNew
            ? '품번 없이 저장됩니다. 저장하면 PL번호가 발급됩니다.'
            : '품번은 출시 확정 단계에서 발급됩니다.'
        }
        actions={
          <>
            {savedAt ? (
              <span className="text-xs text-muted-foreground">
                {savedAt} 저장됨
              </span>
            ) : null}
            {!isNew ? (
              <Button
                type="button"
                variant="ghost"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm('이 기획안을 삭제할까요?')) {
                    deleteMutation.mutate()
                  }
                }}
              >
                <Trash2 className="size-4" />
                삭제
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? '저장 중...' : '저장'}
            </Button>
          </>
        }
      />

      {error ? (
        <p className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 기본 정보 + 사진 */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>기본</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
                {form.imageUrl ? (
                  <img
                    src={form.imageUrl}
                    alt=""
                    className="size-full object-contain"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    사진 없음
                  </span>
                )}
              </div>
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
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="size-3.5" />
                  사진 선택
                </Button>
                {form.imageUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ imageUrl: null })}
                  >
                    제거
                  </Button>
                ) : null}
              </div>
            </div>

            <Field label="한글명">
              <Input
                value={form.nameKo}
                placeholder="투웨이 셔링 호보백_글로우"
                onChange={(e) => patch({ nameKo: e.target.value })}
              />
            </Field>
            <Field label="영문명">
              <Input
                value={form.nameEn}
                placeholder="2way shirring hobo bag_Glow"
                onChange={(e) => patch({ nameEn: e.target.value })}
              />
            </Field>
            <Field label="담당자">
              <OptionSelect
                value={form.owner}
                options={ownerOptions}
                placeholder="담당자 선택"
                onChange={(owner) => patch({ owner })}
              />
            </Field>
            <Field label="출시 기획">
              <Select
                className="w-full"
                value={form.seasonId ?? ''}
                onChange={(e) =>
                  patch({ seasonId: e.target.value || null })
                }
              >
                <option value="">미정</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {formatSeasonLabel(season)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="상태">
              <Select
                className="w-full"
                value={form.status}
                onChange={(e) =>
                  patch({ status: e.target.value as ProductDraftStatus })
                }
              >
                {(
                  Object.keys(DRAFT_STATUS_LABEL) as ProductDraftStatus[]
                ).map((status) => (
                  <option key={status} value={status}>
                    {DRAFT_STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
            </Field>
          </CardContent>
        </Card>

        {/* 진행 + 컬러 */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>진행</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {PROGRESS_STEPS.map((step) => (
                <CheckRow
                  key={step.key}
                  label={step.label}
                  checked={form[step.key]}
                  onChange={(next) => patch({ [step.key]: next })}
                />
              ))}
              <CheckRow
                label="출시 보류"
                tone="hold"
                checked={form.held}
                onChange={(next) => patch({ held: next })}
              />
              {form.held ? (
                <Textarea
                  rows={2}
                  placeholder="보류 사유를 적어주세요."
                  value={form.holdReason}
                  onChange={(e) => patch({ holdReason: e.target.value })}
                />
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">
                  컬러명 / 발주 수량
                </span>
                <span className="text-xs text-muted-foreground">
                  {filledColors}컬러
                  {totalQty > 0 ? ` · 총 ${formatNumber(totalQty)}EA` : ''}
                </span>
              </div>
              <div className="space-y-1.5">
                {form.colors.map((color, index) => (
                  <div key={color.id} className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <Input
                      className="min-w-0 flex-1"
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
                      className="w-24 shrink-0 text-right tabular-nums"
                      inputMode="numeric"
                      placeholder="수량"
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patch({ colors: [...form.colors, newColorRow()] })
                  }
                >
                  <Plus className="size-3.5" />
                  컬러 추가
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  최대 {MAX_DRAFT_COLORS}컬러까지 잡을 수 있습니다.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 가격 + 발매 */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>가격 · 발매</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="목표 단가">
                <Input
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
                  className="w-full"
                  value={form.costCurrency}
                  onChange={(e) =>
                    patch({ costCurrency: e.target.value as CostCurrency })
                  }
                >
                  {(
                    Object.keys(COST_CURRENCY_LABEL) as CostCurrency[]
                  ).map((currency) => (
                    <option key={currency} value={currency}>
                      {COST_CURRENCY_LABEL[currency]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <CheckRow
              label="단가 최종 확인"
              checked={form.costConfirmed}
              onChange={(next) => patch({ costConfirmed: next })}
            />
            {!form.costConfirmed && form.targetCost != null ? (
              <p className="text-xs text-muted-foreground">
                공장 협의 전 잠정 단가입니다.
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="판매가 (원)">
                <Input
                  inputMode="numeric"
                  placeholder="65000"
                  value={
                    form.retailPrice == null ? '' : String(form.retailPrice)
                  }
                  onChange={(e) =>
                    patch({ retailPrice: toNumber(e.target.value) })
                  }
                />
              </Field>
              <Field label="제조국">
                <OptionSelect
                  value={form.originCountry}
                  options={DRAFT_ORIGIN_OPTIONS}
                  placeholder="제조국 선택"
                  onChange={(originCountry) => patch({ originCountry })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="등록유형">
                <OptionSelect
                  value={form.registerType}
                  options={DRAFT_REGISTER_TYPE_OPTIONS}
                  placeholder="등록유형 선택"
                  onChange={(registerType) => patch({ registerType })}
                />
              </Field>
              <Field label="오픈유형">
                <OptionSelect
                  value={form.openType}
                  options={DRAFT_OPEN_TYPE_OPTIONS}
                  placeholder="오픈유형 선택"
                  onChange={(openType) => patch({ openType })}
                />
              </Field>
            </div>

            <Field label="오픈 채널">
              <OptionSelect
                value={form.openTypeDetail}
                options={DRAFT_OPEN_DETAIL_OPTIONS}
                placeholder="채널 선택"
                onChange={(openTypeDetail) => patch({ openTypeDetail })}
              />
            </Field>
          </CardContent>
        </Card>

        {/* 상세는 접어 두고 나중에 채운다 */}
        <div className="lg:col-span-3">
          <button
            type="button"
            className="mb-3 flex w-full items-center justify-between rounded-lg border border-dashed border-border px-4 py-3 text-left text-sm hover:bg-muted/40"
            onClick={() => setShowDetails((prev) => !prev)}
          >
            <span>
              <span className="font-medium">상세 정보</span>
              <span className="ml-2 text-muted-foreground">
                스펙 · 할인 · 발매 이슈 · 옵션 — 나중에 채워도 됩니다
              </span>
            </span>
            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                showDetails && 'rotate-180',
              )}
            />
          </button>

          {showDetails ? (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle>할인 · 발매</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="할인가">
                    <UnitInput
                      value={
                        form.discountPrice == null
                          ? ''
                          : String(form.discountPrice)
                      }
                      unit="원"
                      placeholder="59000"
                      onChange={(value) =>
                        patch({ discountPrice: toNumber(value) })
                      }
                    />
                  </Field>
                  <Field label="발매 이슈">
                    <Textarea
                      rows={2}
                      placeholder="** 카카오선물하기 단독 **"
                      value={form.releaseIssue}
                      onChange={(e) =>
                        patch({ releaseIssue: e.target.value })
                      }
                    />
                  </Field>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>스펙</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    크기와 무게는 숫자만 입력하세요. 단위는 자동으로 붙습니다.
                  </p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-medium">Size</span>
                        <p className="text-xs text-muted-foreground">
                          가로(W) × 세로(D) × 높이(H)
                        </p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                        확인
                        <input
                          type="checkbox"
                          className="size-3.5"
                          checked={form.specs.size.confirmed}
                          onChange={(e) =>
                            patch({
                              specs: {
                                ...form.specs,
                                size: {
                                  ...form.specs.size,
                                  confirmed: e.target.checked,
                                },
                              },
                            })
                          }
                        />
                      </label>
                    </div>
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
                    <label className="block space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        사이즈 추가 메모 (선택)
                      </span>
                      <Textarea
                        rows={2}
                        placeholder="예: 스트랩 최대 1060mm, 스트랩 없음, 손잡이 높이"
                        value={form.specs.size.note}
                        onChange={(e) =>
                          patch({
                            specs: {
                              ...form.specs,
                              size: {
                                ...form.specs.size,
                                note: e.target.value,
                              },
                            },
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">Weight</span>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                          확인
                          <input
                            type="checkbox"
                            className="size-3.5"
                            checked={form.specs.weight.confirmed}
                            onChange={(e) =>
                              patch({
                                specs: {
                                  ...form.specs,
                                  weight: {
                                    ...form.specs.weight,
                                    confirmed: e.target.checked,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
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

                    {TEXT_SPEC_KEYS.map((key) => {
                    const spec = form.specs[key]
                    return (
                      <div key={key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {DRAFT_SPEC_LABEL[key]}
                          </span>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                            확인
                            <input
                              type="checkbox"
                              className="size-3.5"
                              checked={spec.confirmed}
                              onChange={(e) =>
                                patch({
                                  specs: {
                                    ...form.specs,
                                    [key]: {
                                      ...spec,
                                      confirmed: e.target.checked,
                                    },
                                  },
                                })
                              }
                            />
                          </label>
                        </div>
                        <Textarea
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
                </CardContent>
              </Card>

              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle>옵션 · 메모</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-4">
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
                      <div className="space-y-2">
                        {form.options.map((row, index) => {
                          const currentStyle = styles.find(
                            (style) => style.id === row.styleId,
                          )
                          return (
                            <div
                              key={row.id}
                              className="grid grid-cols-[minmax(0,1fr)_9rem_auto] items-end gap-2"
                            >
                              <label className="space-y-1">
                                <span className="text-[11px] text-muted-foreground">
                                  옵션 상품 {index + 1}
                                </span>
                                <Select
                                  className="w-full"
                                  value={row.styleId}
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
                              </label>
                              <label className="space-y-1">
                                <span className="text-[11px] text-muted-foreground">
                                  옵션 가격
                                </span>
                                <UnitInput
                                  value={
                                    row.price == null ? '' : String(row.price)
                                  }
                                  unit="원"
                                  placeholder="18500"
                                  onChange={(value) =>
                                    patch({
                                      options: form.options.map((item) =>
                                        item.id === row.id
                                          ? {
                                              ...item,
                                              price: toNumber(value),
                                            }
                                          : item,
                                      ),
                                    })
                                  }
                                />
                              </label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
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
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            patch({
                              options: [...form.options, newOptionRow()],
                            })
                          }
                        >
                          <Plus className="size-3.5" />
                          옵션 추가
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <Field label="메모">
                    <Textarea
                      rows={3}
                      value={form.note}
                      onChange={(e) => patch({ note: e.target.value })}
                    />
                  </Field>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>

        {loaded?.promotedStyleId ? (
          <div className="lg:col-span-3">
            <Badge variant="success">상품으로 승격됨</Badge>
          </div>
        ) : (
          <p className="lg:col-span-3 text-xs text-muted-foreground">
            출시 확정 시 품번을 발급해 상품으로 넘기는 기능은 다음 단계입니다.
          </p>
        )}
      </div>
    </div>
  )
}
