import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import type {
  BarcodeField,
  ProductCode,
  ProductCodeComponent,
  ProductCodeInput,
  ProductCodeKind,
  Style,
} from '@/lib/types'
import { parsePositiveCm } from '@/lib/codes/barcode-fields'
import {
  barcodePrefix,
  describeEan13Problem,
  nextOwnBarcode,
} from '@/lib/codes/ean'
import { componentSignature } from '@/lib/codes/signature'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { cn, formatNumber } from '@/lib/utils'

const MAX_SEARCH_RESULTS = 6

export type ProductCodeDialogMode = 'create' | 'edit'

type ProductCodeDialogProps = {
  open: boolean
  mode: ProductCodeDialogMode
  kind: ProductCodeKind
  brandId: string
  /** 수정 대상, 또는 복제 등록 시 값을 가져올 원본 */
  source?: ProductCode | null
  styles: Style[]
  fields: BarcodeField[]
  existingCodes: ProductCode[]
  isSubmitting?: boolean
  errorMessage?: string | null
  onClose: () => void
  onSubmit: (input: ProductCodeInput) => void | Promise<void>
}

type Draft = {
  code: string
  name: string
  weight: string
  width: string
  depth: string
  height: string
  note: string
  values: Record<string, string>
  components: ProductCodeComponent[]
}

const EMPTY_DRAFT: Draft = {
  code: '',
  name: '',
  weight: '',
  width: '',
  depth: '',
  height: '',
  note: '',
  values: {},
  components: [],
}

function numberToInput(value: number | null | undefined) {
  return value === null || value === undefined ? '' : String(value)
}

function inputToNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function toDraft(source: ProductCode | null | undefined, keepCode: boolean) {
  if (!source) return EMPTY_DRAFT
  return {
    code: keepCode ? source.code : '',
    name: source.name,
    weight: numberToInput(source.weightG),
    width: numberToInput(source.widthCm),
    depth: numberToInput(source.depthCm),
    height: numberToInput(source.heightCm),
    note: source.note,
    values: { ...source.values },
    components: source.components.map((component) => ({ ...component })),
  }
}

export function ProductCodeDialog({
  open,
  mode,
  kind,
  brandId,
  source,
  styles,
  fields,
  existingCodes,
  isSubmitting = false,
  errorMessage,
  onClose,
  onSubmit,
}: ProductCodeDialogProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [search, setSearch] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSearch('')
    setLocalError(null)
    setDraft(toDraft(source, mode === 'edit'))
  }, [open, mode, source])

  const styleMap = useMemo(
    () => new Map(styles.map((style) => [style.id, style])),
    [styles],
  )

  const customFields = useMemo(
    () => fields.filter((field) => field.systemKey === null),
    [fields],
  )

  const usedStyleIds = useMemo(
    () => new Set(draft.components.map((component) => component.styleId)),
    [draft.components],
  )

  const searchResults = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return []
    return styles
      .filter((style) => {
        if (usedStyleIds.has(style.id)) return false
        return (
          style.styleNo.toLowerCase().includes(keyword) ||
          style.name.toLowerCase().includes(keyword)
        )
      })
      .slice(0, MAX_SEARCH_RESULTS)
  }, [search, styles, usedStyleIds])

  const weightSuggestion = useMemo(() => {
    if (draft.components.length === 0) return null
    let total = 0
    for (const component of draft.components) {
      const styleWeight = styleMap.get(component.styleId)?.weightG
      if (!styleWeight) return null
      total += styleWeight * component.qty
    }
    return total
  }, [draft.components, styleMap])

  const totalQty = draft.components.reduce(
    (sum, component) => sum + component.qty,
    0,
  )

  const codeProblem =
    kind === 'own'
      ? draft.code.trim()
        ? describeEan13Problem(draft.code)
        : null
      : null

  const duplicateCode = useMemo(() => {
    const value = draft.code.trim()
    if (!value) return null
    return (
      existingCodes.find(
        (item) =>
          item.kind === kind &&
          item.code === value &&
          item.id !== (mode === 'edit' ? source?.id : undefined),
      ) ?? null
    )
  }, [draft.code, existingCodes, kind, mode, source?.id])

  const sameComponentCodes = useMemo(() => {
    const signature = componentSignature(draft.components)
    if (!signature) return []
    return existingCodes.filter(
      (item) =>
        item.kind === kind &&
        item.id !== (mode === 'edit' ? source?.id : undefined) &&
        componentSignature(item.components) === signature,
    )
  }, [draft.components, existingCodes, kind, mode, source?.id])

  function patch(next: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...next }))
    setLocalError(null)
  }

  function patchCustomValue(fieldId: string, value: string) {
    setDraft((prev) => {
      const values = { ...prev.values }
      if (value) values[fieldId] = value
      else delete values[fieldId]
      return { ...prev, values }
    })
    setLocalError(null)
  }

  function addComponent(style: Style) {
    setDraft((prev) => ({
      ...prev,
      components: [
        ...prev.components,
        { styleId: style.id, styleNo: style.styleNo, qty: 1 },
      ],
    }))
    setSearch('')
    setLocalError(null)
  }

  function changeQty(styleId: string, nextQty: number) {
    setDraft((prev) => ({
      ...prev,
      components: prev.components.map((component) =>
        component.styleId === styleId
          ? { ...component, qty: Math.max(1, nextQty) }
          : component,
      ),
    }))
  }

  function removeComponent(styleId: string) {
    setDraft((prev) => ({
      ...prev,
      components: prev.components.filter(
        (component) => component.styleId !== styleId,
      ),
    }))
  }

  function issueBarcode() {
    const issued = nextOwnBarcode(
      brandId,
      existingCodes.map((item) => item.code),
    )
    if (!issued) {
      setLocalError(
        '이 업체코드에서 발급할 수 있는 번호를 모두 썼습니다. 업체코드를 추가로 받아야 합니다.',
      )
      return
    }
    patch({ code: issued })
  }

  function handleSubmit() {
    if (!draft.name.trim()) {
      setLocalError('코드명을 입력하세요.')
      return
    }
    if (kind === 'own') {
      const problem = describeEan13Problem(draft.code)
      if (problem) {
        setLocalError(problem)
        return
      }
    } else if (!draft.code.trim()) {
      setLocalError('코드값을 입력하세요.')
      return
    }
    if (duplicateCode) {
      setLocalError(`이미 등록된 코드입니다. (${duplicateCode.name})`)
      return
    }
    const invalidNumberField = customFields.find((field) => {
      const value = draft.values[field.id]
      return (
        field.type === 'number' &&
        value !== undefined &&
        value.trim() !== '' &&
        !Number.isFinite(Number(value.replace(/,/g, '')))
      )
    })
    if (invalidNumberField) {
      setLocalError(`${invalidNumberField.label}은(는) 숫자로 입력하세요.`)
      return
    }

    const width = parsePositiveCm(draft.width, '가로')
    const depth = parsePositiveCm(draft.depth, '세로')
    const height = parsePositiveCm(draft.height, '높이')
    const dimensionError = width.error ?? depth.error ?? height.error
    if (dimensionError) {
      setLocalError(dimensionError)
      return
    }

    void onSubmit({
      kind,
      code: draft.code.trim(),
      name: draft.name.trim(),
      weightG: inputToNumber(draft.weight),
      widthCm: width.value ?? null,
      depthCm: depth.value ?? null,
      heightCm: height.value ?? null,
      note: draft.note,
      values: draft.values,
      components: draft.components,
    })
  }

  if (!open) return null

  const hasStyles = styles.length > 0

  const title =
    mode === 'edit'
      ? '코드 수정'
      : source
        ? '코드 복제 등록'
        : '88바코드 등록'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        disabled={isSubmitting}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-code-title"
        className="relative z-10 max-h-[min(92vh,860px)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card px-5 py-4">
          <div>
            <h2
              id="product-code-title"
              className="text-base font-semibold tracking-tight"
            >
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              상품·구성까지 확정된 자사 바코드 마스터입니다. 출고업체 등록은 출고업체별
              바코드 메뉴에서 합니다.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="닫기"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-6 px-5 py-5">
          <section className="space-y-3">
            <SectionTitle>기본 정보</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Field
                label="바코드"
                hint={`업체 프리픽스 ${barcodePrefix(brandId)} + 일련번호 5자리 + 체크디지트`}
                error={codeProblem ?? undefined}
              >
                <div className="flex gap-2">
                  <Input
                    value={draft.code}
                    inputMode="numeric"
                    placeholder="8801234000015"
                    disabled={isSubmitting}
                    onChange={(event) =>
                      patch({ code: event.target.value.replace(/\s/g, '') })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={isSubmitting}
                    onClick={issueBarcode}
                  >
                    <RefreshCw className="size-3.5" />
                    자동 발급
                  </Button>
                </div>
              </Field>
              <Field label="코드명" hint="라벨과 작업지시서에 표시되는 이름">
                <Input
                  value={draft.name}
                  placeholder="봄 트렌치 2종 세트"
                  disabled={isSubmitting}
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </Field>
            </div>
            {duplicateCode ? (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                이미 등록된 바코드입니다. ({duplicateCode.name})
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <SectionTitle>
              구성
              {draft.components.length > 0 ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  {draft.components.length}종 · 총 {formatNumber(totalQty)}개
                </span>
              ) : null}
            </SectionTitle>

            {!hasStyles ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm">
                <p className="font-medium">등록된 상품이 없습니다</p>
                <p className="mt-1 text-muted-foreground">
                  바코드 구성품은 품번이 부여된 상품에서만 고를 수 있습니다.
                  가져오기나 상품 등록으로 단품을 먼저 추가하세요.
                </p>
              </div>
            ) : (
              <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                placeholder="품번 또는 상품명으로 검색해서 담기"
                disabled={isSubmitting}
                onChange={(event) => setSearch(event.target.value)}
              />
              {searchResults.length > 0 ? (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
                  {searchResults.map((style) => (
                    <li key={style.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => addComponent(style)}
                      >
                        <span className="min-w-0">
                          <span className="font-medium tabular-nums">
                            {style.styleNo}
                          </span>
                          <span className="ml-2 text-muted-foreground">
                            {style.name}
                          </span>
                        </span>
                        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {search.trim() && searchResults.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  검색 결과가 없습니다. 이미 담은 단품은 목록에서 수량을 늘리세요.
                </p>
              ) : null}
            </div>

            {draft.components.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                담은 구성품이 없습니다. 비워 두면 M번호 미지정으로 저장되고,
                88바코드 관리 화면의 미지정 탭에서 나중에 채울 수 있습니다.
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {draft.components.map((component) => {
                  const style = styleMap.get(component.styleId)
                  return (
                    <li
                      key={component.styleId}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium tabular-nums">
                          {component.styleNo}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {style ? style.name : '삭제된 단품'}
                          {style?.weightG
                            ? ` · ${formatNumber(style.weightG)}g`
                            : ' · 무게 미등록'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="수량 줄이기"
                          disabled={isSubmitting || component.qty <= 1}
                          onClick={() =>
                            changeQty(component.styleId, component.qty - 1)
                          }
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <Input
                          className="h-8 w-14 text-center tabular-nums"
                          inputMode="numeric"
                          value={String(component.qty)}
                          disabled={isSubmitting}
                          onChange={(event) => {
                            const parsed = Number(
                              event.target.value.replace(/\D/g, ''),
                            )
                            changeQty(
                              component.styleId,
                              Number.isFinite(parsed) ? parsed : 1,
                            )
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="수량 늘리기"
                          disabled={isSubmitting}
                          onClick={() =>
                            changeQty(component.styleId, component.qty + 1)
                          }
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-danger hover:bg-danger/10"
                        aria-label={`${component.styleNo} 제거`}
                        disabled={isSubmitting}
                        onClick={() => removeComponent(component.styleId)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}

            {sameComponentCodes.length > 0 ? (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                같은 구성의 코드가 이미 있습니다.{' '}
                {sameComponentCodes
                  .map((item) => `${item.code} (${item.name})`)
                  .join(', ')}
              </p>
            ) : null}
              </>
            )}
          </section>

          <section className="space-y-3">
            <SectionTitle>포장 정보</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="실측 무게 (g)"
                hint={
                  weightSuggestion
                    ? `구성품 합 ${formatNumber(weightSuggestion)}g. 포장재 포함 실측값으로 덮어쓰세요.`
                    : '구성품에 단품 무게가 없어 합계를 제안할 수 없습니다.'
                }
              >
                <div className="flex gap-2">
                  <Input
                    value={draft.weight}
                    inputMode="numeric"
                    placeholder={
                      weightSuggestion ? String(weightSuggestion) : '0'
                    }
                    disabled={isSubmitting}
                    onChange={(event) => patch({ weight: event.target.value })}
                  />
                  {weightSuggestion ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={isSubmitting}
                      onClick={() =>
                        patch({ weight: String(weightSuggestion) })
                      }
                    >
                      구성 합 적용
                    </Button>
                  ) : null}
                </div>
              </Field>
              <Field
                label="규격 (cm)"
                hint="가로 × 세로 × 높이. 소수 첫째 자리까지"
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    className="text-center"
                    inputMode="decimal"
                    placeholder="가로"
                    value={draft.width}
                    disabled={isSubmitting}
                    onChange={(event) => patch({ width: event.target.value })}
                  />
                  <span className="text-muted-foreground">×</span>
                  <Input
                    className="text-center"
                    inputMode="decimal"
                    placeholder="세로"
                    value={draft.depth}
                    disabled={isSubmitting}
                    onChange={(event) => patch({ depth: event.target.value })}
                  />
                  <span className="text-muted-foreground">×</span>
                  <Input
                    className="text-center"
                    inputMode="decimal"
                    placeholder="높이"
                    value={draft.height}
                    disabled={isSubmitting}
                    onChange={(event) => patch({ height: event.target.value })}
                  />
                </div>
              </Field>
            </div>
            <Field label="비고">
              <Textarea
                rows={2}
                value={draft.note}
                placeholder="포장 방법, 동봉물 등 창고 작업자에게 전달할 내용"
                disabled={isSubmitting}
                onChange={(event) => patch({ note: event.target.value })}
              />
            </Field>
          </section>

          {customFields.length > 0 ? (
            <section className="space-y-3">
              <SectionTitle>추가 정보</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                {customFields.map((field) => (
                  <Field key={field.id} label={field.label}>
                    <Input
                      value={draft.values[field.id] ?? ''}
                      inputMode={field.type === 'number' ? 'decimal' : undefined}
                      disabled={isSubmitting}
                      onChange={(event) =>
                        patchCustomValue(field.id, event.target.value)
                      }
                    />
                  </Field>
                ))}
              </div>
            </section>
          ) : null}

          {localError || errorMessage ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {localError ?? errorMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            {draft.components.length > 0 ? (
              <Badge variant="muted" className="mr-auto">
                {draft.components.length}종 · 총 {formatNumber(totalQty)}개
              </Badge>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !hasStyles}
            >
              {isSubmitting ? '저장 중...' : mode === 'edit' ? '저장' : '등록'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  )
}

function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error ? (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      ) : null}
      {error ? <span className="block text-xs text-danger">{error}</span> : null}
    </div>
  )
}
