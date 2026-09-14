import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Check,
  CircleHelp,
  Copy,
  ImagePlus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn } from '@/lib/utils'

import {
  PRODUCT_PHOTO_MIN,
  PRODUCT_PHOTO_MAX,
  PRODUCT_PHOTO_SLOTS,
  OUTPUT_RATIOS,
  USAGE_PURPOSES,
  REFERENCE_EXCLUDE_ITEMS,
  REFERENCE_PHOTO_GUIDE,
  REFERENCE_ROLE_SLOTS,
  EXPLORATION_SLOTS,
  VARIATION_COUNTS,
  revokeExplorationPhotos,
  type ExplorationKey,
  type ExplorationPhotoMap,
  activeReferencePhotos,
  revokeReferencePhotos,
  emptyProductPhotos,
  revokeProductPhotos,
  createInitialForm,
  createStyledPhoto,
  buildStyledCutsPrompt,
  missingRequiredPhotos,
  type ImageSlot,
  type ProductPhotoKey,
  type ProductPhotoMap,
  type ReferenceRoleKey,
  type ReferencePhotoMap,
  type FormState,
} from '@/lib/design/styled-cuts'

function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-foreground"
      >
        {children}
      </label>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  )
}

function ChoiceChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'rounded-md border px-3 py-1.5 text-sm transition-colors',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

function ImageThumb({
  slot,
  caption,
  onRemove,
}: {
  slot: ImageSlot
  caption?: string
  onRemove: () => void
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="aspect-square">
        <img
          src={slot.url}
          alt={slot.file.name}
          className="size-full object-contain"
        />
      </div>
      {caption ? (
        <p className="truncate border-t border-border bg-card/90 px-2 py-1 text-[11px] text-muted-foreground">
          {caption}
        </p>
      ) : null}
      <div className="space-y-1 border-t border-border bg-card px-2 py-2">
        <p className="break-all text-xs font-medium" title={slot.file.name}>{slot.file.name}</p>
      </div>
      <button
        type="button"
        aria-label="이미지 제거"
        title="이미지 제거"
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-md bg-black/55 text-white hover:bg-black/70"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function UploadTile({
  onPick,
  label,
  sublabel,
  inputId,
  multiple = false,
}: {
  onPick: (files: FileList | null) => void
  label: string
  sublabel?: string
  inputId: string
  multiple?: boolean
}) {
  return (
    <label
      htmlFor={inputId}
      className="flex min-h-[8.5rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center transition-colors hover:bg-muted/40"
    >
      <ImagePlus className="size-5 text-muted-foreground" />
      <span className="text-sm font-medium">{label}</span>
      {sublabel ? (
        <span className="text-xs text-muted-foreground">{sublabel}</span>
      ) : null}
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        multiple={multiple}
        onChange={(event) => {
          onPick(event.target.files)
          event.target.value = ''
        }}
      />
    </label>
  )
}

function LabeledUploadSlot({
  inputId,
  label,
  guide,
  optional,
  slot,
  onPick,
  onRemove,
}: {
  inputId: string
  label: string
  guide: string
  optional?: boolean
  slot: ImageSlot | undefined
  onPick: (files: FileList | null) => void
  onRemove: () => void
}) {
  return (
    <div className="relative z-0 space-y-1.5 hover:z-[100] focus-within:z-[100]">
      <div className="relative z-[101] flex items-center justify-center gap-0.5 px-0.5">
        <p className="truncate text-center text-xs font-medium text-foreground">
          {label}
        </p>
        <span
          className="group/guide relative z-[102] inline-flex shrink-0 cursor-help"
          tabIndex={0}
          aria-label={`${label} 촬영 안내: ${guide}`}
          title={guide}
        >
          <CircleHelp className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span
            role="tooltip"
            className="invisible absolute left-1/2 top-full z-[9999] mt-2 w-56 -translate-x-1/2 rounded-lg bg-foreground px-3 py-2 text-left text-xs font-normal leading-relaxed text-background opacity-0 shadow-lg transition-opacity group-hover/guide:visible group-hover/guide:opacity-100 group-focus/guide:visible group-focus/guide:opacity-100"
          >
            {guide}
          </span>
        </span>
        {!optional ? (
          <span
            className="text-xs font-semibold leading-none text-danger"
            aria-label="필수"
            title="필수"
          >
            *
          </span>
        ) : null}
      </div>
      {slot ? (
        <ImageThumb slot={slot} onRemove={onRemove} />
      ) : (
        <UploadTile
          inputId={inputId}
          label="사진 선택"
          onPick={onPick}
        />
      )}
    </div>
  )
}

export function DesignStyledCutsPage() {
  useRenderWatch('DesignStyledCutsPage')
  const formId = useId()
  const referenceInputRef = useRef<HTMLInputElement>(null)

  const [productPhotos, setProductPhotos] = useState<ProductPhotoMap>(
    emptyProductPhotos,
  )
  const [referencePhoto, setReferencePhoto] = useState<ImageSlot | null>(null)
  const [splitReferences, setSplitReferences] = useState<ReferencePhotoMap>({})
  const [showExtraReferences, setShowExtraReferences] = useState(false)
  const [exploration, setExploration] = useState<ExplorationPhotoMap>({})
  const explorationRef = useRef(exploration)
  explorationRef.current = exploration
  const splitReferencesRef = useRef(splitReferences)
  splitReferencesRef.current = splitReferences
  const [form, setForm] = useState<FormState>(createInitialForm)
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const copyTimerRef = useRef<number | undefined>(undefined)
  const productPhotosRef = useRef(productPhotos)
  const referencePhotoRef = useRef(referencePhoto)
  productPhotosRef.current = productPhotos
  referencePhotoRef.current = referencePhoto

  useEffect(() => {
    return () => {
      window.clearTimeout(copyTimerRef.current)
      revokeProductPhotos(productPhotosRef.current)
      revokeReferencePhotos(splitReferencesRef.current)
      revokeExplorationPhotos(explorationRef.current)
      if (referencePhotoRef.current) {
        URL.revokeObjectURL(referencePhotoRef.current.url)
      }
    }
  }, [])

  const missingPhotos = useMemo(
    () => missingRequiredPhotos(productPhotos),
    [productPhotos],
  )
  const optionalCount = PRODUCT_PHOTO_SLOTS.filter(
    (slot) => !slot.required && productPhotos[slot.key],
  ).length
  const productCountLabel = `필수 ${PRODUCT_PHOTO_MIN - missingPhotos.length}/${PRODUCT_PHOTO_MIN} · 선택 ${optionalCount}/2`
  const generatedPrompt = useMemo(
    () => buildStyledCutsPrompt(form, productPhotos, referencePhoto, splitReferences, exploration),
    [form, productPhotos, referencePhoto, splitReferences, exploration],
  )
  const activeReferences = activeReferencePhotos(form.referenceMode, referencePhoto, splitReferences, exploration)
  const readyToCopy = missingPhotos.length === 0 && activeReferences.length > 0
  const copied = copiedPrompt !== null && copiedPrompt === generatedPrompt

  function setProductPhoto(key: ProductPhotoKey, files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    try {
      const photo = createStyledPhoto(file, key)
      const previous = productPhotosRef.current[key]
      const next = { ...productPhotosRef.current, [key]: photo }
      productPhotosRef.current = next
      setProductPhotos(next)
      if (previous) URL.revokeObjectURL(previous.url)
      setUploadError(null)
    } catch (error) {
      console.warn('[styled-cuts] 제품 사진 등록 실패', { key, name: file.name, error })
      setUploadError(error instanceof Error ? error.message : '사진 등록에 실패했습니다. 다시 선택해 주세요.')
    }
  }

  function removeProductPhoto(key: ProductPhotoKey) {
    const previous = productPhotosRef.current[key]
    const next = { ...productPhotosRef.current }
    delete next[key]
    productPhotosRef.current = next
    setProductPhotos(next)
    if (previous) URL.revokeObjectURL(previous.url)
  }

  function setReference(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    try {
      const photo = createStyledPhoto(file, 'reference')
      const previous = referencePhotoRef.current
      referencePhotoRef.current = photo
      setReferencePhoto(photo)
      if (previous) URL.revokeObjectURL(previous.url)
      setUploadError(null)
    } catch (error) {
      console.warn('[styled-cuts] 레퍼런스 사진 등록 실패', { name: file.name, error })
      setUploadError(error instanceof Error ? error.message : '사진 등록에 실패했습니다. 다시 선택해 주세요.')
    }
  }

  function clearReference() {
    const previous = referencePhotoRef.current
    referencePhotoRef.current = null
    setReferencePhoto(null)
    if (previous) URL.revokeObjectURL(previous.url)
  }

  function setSplitReference(key: ReferenceRoleKey, files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    try {
      const photo = createStyledPhoto(file, key)
      const previous = splitReferencesRef.current[key]
      const next = { ...splitReferencesRef.current, [key]: photo }
      splitReferencesRef.current = next
      setSplitReferences(next)
      if (previous) URL.revokeObjectURL(previous.url)
      setUploadError(null)
    } catch (error) {
      console.warn('[styled-cuts] 역할별 참고 사진 등록 실패', { key, error })
      setUploadError(error instanceof Error ? error.message : '사진을 다시 선택해 주세요.')
    }
  }

  function removeSplitReference(key: ReferenceRoleKey) {
    const previous = splitReferencesRef.current[key]
    const next = { ...splitReferencesRef.current }
    delete next[key]
    splitReferencesRef.current = next
    setSplitReferences(next)
    if (previous) URL.revokeObjectURL(previous.url)
  }

  function addExploration(key: ExplorationKey, files: FileList | null) {
    const added: ImageSlot[] = []
    const errors: string[] = []
    for (const file of Array.from(files ?? [])) {
      try { added.push(createStyledPhoto(file, key)) }
      catch (error) {
        console.warn('[styled-cuts] 시안 참고 사진 등록 실패', { key, name: file.name, error })
        errors.push(file.name)
      }
    }
    const next = { ...explorationRef.current, [key]: [...(explorationRef.current[key] ?? []), ...added] }
    explorationRef.current = next
    setExploration(next)
    setUploadError(errors.length ? `등록하지 못한 사진: ${errors.join(', ')}. JPG·PNG·WEBP 파일을 선택해 주세요.` : null)
  }

  function removeExploration(key: ExplorationKey, photo: ImageSlot) {
    const next = { ...explorationRef.current, [key]: (explorationRef.current[key] ?? []).filter((item) => item.url !== photo.url) }
    explorationRef.current = next
    setExploration(next)
    URL.revokeObjectURL(photo.url)
  }

  async function copyPrompt() {
    if (!readyToCopy || !generatedPrompt) return
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(generatedPrompt)
      setCopiedPrompt(generatedPrompt)
      window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopiedPrompt(null), 1600)
    } catch (error) {
      console.warn('[styled-cuts] 프롬프트 복사 실패', { error })
      setCopyError('복사하지 못했습니다. 아래 프롬프트를 선택해 직접 복사해 주세요.')
    }
  }

  function resetForm() {
    revokeExplorationPhotos(explorationRef.current)
    explorationRef.current = {}
    setExploration({})
    revokeProductPhotos(productPhotos)
    revokeReferencePhotos(splitReferencesRef.current)
    splitReferencesRef.current = {}
    setSplitReferences({})
    setShowExtraReferences(false)
    if (referencePhoto) URL.revokeObjectURL(referencePhoto.url)
    setProductPhotos(emptyProductPhotos())
    setReferencePhoto(null)
    productPhotosRef.current = emptyProductPhotos()
    referencePhotoRef.current = null
    setForm(createInitialForm())
    window.clearTimeout(copyTimerRef.current)
    setCopiedPrompt(null)
    setCopyError(null)
    setUploadError(null)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <PageHeader
        title="연출 컷 제작"
        description="제품 사진은 제품 자체를, 레퍼런스는 장소·구도·조명·소품만 참고합니다."
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>1. 업로드할 이미지</CardTitle>
            <Badge
              variant={
                missingPhotos.length === 0 ? 'success' : 'muted'
              }
            >
              제품 {productCountLabel}
            </Badge>
            <Badge variant={activeReferences.length ? 'success' : 'muted'}>
              레퍼런스 {activeReferences.length}장{form.referenceMode === 'split' ? ' · 역할별' : '/1'}
            </Badge>
          </div>
          <CardDescription>
            제품 사진 {PRODUCT_PHOTO_MIN}~{PRODUCT_PHOTO_MAX}장과 참고 사진을 올립니다.
            참고 사진은 한 장으로 쓰거나 역할별로 나눠서 사용할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-muted-foreground">
            사진의 원래 파일명을 그대로 사용합니다. 어느 사진이 정면·하단·소재 디테일·참고 사진인지
            최종 프롬프트에 자동으로 표시하므로, 선택한 원본 사진과 프롬프트를 GPT에 함께 첨부하세요.
          </p>
          {uploadError ? <p role="alert" className="text-sm text-danger">{uploadError}</p> : null}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">제품 사진</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                각도·디테일별로 각각 등록합니다. 앞 8종은 필수, 열린 상태/구조와
                크기 참고컷은 선택입니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {PRODUCT_PHOTO_SLOTS.map((item) => (
                <LabeledUploadSlot
                  key={item.key}
                  inputId={`${formId}-product-${item.key}`}
                  label={item.label}
                  guide={item.guide}
                  optional={!item.required}
                  slot={productPhotos[item.key]}
                  onPick={(files) => setProductPhoto(item.key, files)}
                  onRemove={() => removeProductPhoto(item.key)}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <FieldLabel>참고 사진 사용 방법</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <ChoiceChip selected={form.referenceMode === 'single'} onClick={() => setForm((prev) => ({ ...prev, referenceMode: 'single' }))}>한 장으로 전체 연출 참고</ChoiceChip>
              <ChoiceChip selected={form.referenceMode === 'split'} onClick={() => setForm((prev) => ({ ...prev, referenceMode: 'split' }))}>여러 장을 나눠서 참고</ChoiceChip>
              <ChoiceChip selected={form.referenceMode === 'explore'} onClick={() => setForm((prev) => ({ ...prev, referenceMode: 'explore' }))}>여러 시안 자유롭게 만들기</ChoiceChip>
            </div>
            <p className="text-xs text-muted-foreground">방식을 바꿔도 등록한 사진은 남아 있습니다. 현재 방식의 사진만 프롬프트에 포함됩니다.</p>
            {form.referenceMode === 'explore' ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">각 항목에 여러 장을 올리세요. 하나 이상의 참고 사진만 있으면 시작할 수 있어요. 시안마다 어울리는 배경·구도·놓는 모습을 골라 조합하도록 안내합니다.</p>
                <FieldLabel>받아보고 싶은 시안 수</FieldLabel>
                <div className="flex gap-2">{VARIATION_COUNTS.map((count) => <ChoiceChip key={count} selected={form.variationCount === count} onClick={() => setForm((prev) => ({ ...prev, variationCount: count }))}>{count}장</ChoiceChip>)}</div>
                <p className="text-xs text-muted-foreground">분할 없이 각각 한 장씩 요청합니다. 외부 이미지 생성 도구에서도 같은 장수를 선택하세요. 이 도구는 프롬프트를 작성하며 실제 출력 장수를 제어하지는 않아요.</p>
                {EXPLORATION_SLOTS.map((group) => (
                  <div key={group.key} className="space-y-2 rounded-lg border border-border p-3">
                    <FieldLabel hint="여러 장 선택 가능">{group.label} 참고 사진</FieldLabel>
                    <p className="text-xs text-muted-foreground">{group.guide}</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {(exploration[group.key] ?? []).map((photo) => <ImageThumb key={photo.url} slot={photo} onRemove={() => removeExploration(group.key, photo)} />)}
                      <UploadTile multiple inputId={`${formId}-explore-${group.key}`} label="사진 추가" onPick={(files) => addExploration(group.key, files)} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {form.referenceMode === 'split' ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">필요한 역할만 골라 한 장 이상 등록하세요. 비워 둔 항목은 다른 사진과 어울리게 자연스럽게 보완하도록 안내합니다.</p>
                <div className="grid grid-cols-2 gap-4">
                  {REFERENCE_ROLE_SLOTS.filter((slot, index) => index < 2 || showExtraReferences || splitReferences[slot.key]).map((slot) => (
                    <LabeledUploadSlot
                      key={slot.key}
                      inputId={`${formId}-reference-${slot.key}`}
                      label={`${slot.label} 참고 사진`}
                      guide={slot.guide}
                      optional
                      slot={splitReferences[slot.key]}
                      onPick={(files) => setSplitReference(slot.key, files)}
                      onRemove={() => removeSplitReference(slot.key)}
                    />
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowExtraReferences((prev) => !prev)}>
                  {showExtraReferences ? '빈 추가 사진 칸 접기' : '다른 참고 사진 추가 · 조명·분위기 / 소품'}
                </Button>
              </div>
            ) : null}
            <div className={cn('flex flex-wrap items-center justify-between gap-2', form.referenceMode !== 'single' && 'hidden')}>
              <div>
                <div className="relative z-0 flex items-center gap-1 hover:z-[100] focus-within:z-[100]">
                  <h3 className="text-sm font-semibold">레퍼런스 이미지</h3>
                  <span
                    className="group/guide relative z-[101] inline-flex cursor-help"
                    tabIndex={0}
                    aria-label={`레퍼런스 이미지 선택 안내: ${REFERENCE_PHOTO_GUIDE}`}
                    title={REFERENCE_PHOTO_GUIDE}
                  >
                    <CircleHelp className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span
                      role="tooltip"
                      className="invisible absolute left-1/2 top-full z-[9999] mt-2 w-64 -translate-x-1/2 rounded-lg bg-foreground px-3 py-2 text-left text-xs font-normal leading-relaxed text-background opacity-0 shadow-lg transition-opacity group-hover/guide:visible group-hover/guide:opacity-100 group-focus/guide:visible group-focus/guide:opacity-100"
                    >
                      {REFERENCE_PHOTO_GUIDE}
                    </span>
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  원하는 연출의 사진 1장을 올려 주세요. 바꾸고 싶은 점만 선택해서 적으면 됩니다.
                </p>
              </div>
              <input
                ref={referenceInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  setReference(event.target.files)
                  event.target.value = ''
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => referenceInputRef.current?.click()}
              >
                <Upload className="size-3.5" />
                {referencePhoto ? '레퍼런스 교체' : '레퍼런스 업로드'}
              </Button>
            </div>
            <div className={cn('grid gap-4', form.referenceMode === 'single' && 'lg:grid-cols-[minmax(0,14rem)_1fr]')}>
              <div className={cn('w-full max-w-[14rem]', form.referenceMode !== 'single' && 'hidden')}>
                {referencePhoto ? (
                  <ImageThumb
                    slot={referencePhoto}
                    caption="레퍼런스"
                    onRemove={clearReference}
                  />
                ) : (
                  <UploadTile
                    inputId={`${formId}-reference-upload`}
                    label="레퍼런스 1장"
                    sublabel="장면·분위기 참고용"
                    onPick={setReference}
                  />
                )}
              </div>
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="mb-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                    {form.referenceMode === 'explore' ? '후보들을 역할별로 선택하고 자유롭게 조합해 서로 다른 시안을 구성하도록 안내합니다.' : form.referenceMode === 'single' ? '참고 사진의 배경·배치·조명·분위기를 따라 연출하도록 프롬프트에 안내합니다.' : '각 참고 사진에서 지정한 역할만 가져와 하나의 장면으로 구성하도록 안내합니다.'}
                    제품 자체는 올려 주신 제품 사진대로 유지합니다.
                  </p>
                  <FieldLabel htmlFor={`${formId}-reference-changes`} hint="선택">
                    참고 사진에서 바꾸고 싶은 점이 있나요?
                  </FieldLabel>
                  <Textarea
                    id={`${formId}-reference-changes`}
                    aria-describedby={`${formId}-reference-changes-help`}
                    value={form.referenceChanges}
                    rows={3}
                    placeholder="예: 꽃은 빼주세요 / 배경을 더 밝게 / 제품을 가운데에 놓아주세요"
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, referenceChanges: event.target.value }))
                    }
                  />
                  <p id={`${formId}-reference-changes-help`} className="mt-2 text-xs text-muted-foreground">
                    비워 두어도 괜찮아요. 입력한 요청은 선택한 참고 방식 안에서 반영합니다.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. 생성 전 작성</CardTitle>
          <CardDescription>
            제품 정보와 원하는 연출을 적습니다. 제품 보존에 필요한 기본 지시문은 자동으로 포함됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor={`${formId}-name`}>제품명</FieldLabel>
              <Input
                id={`${formId}-name`}
                value={form.productName}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    productName: event.target.value,
                  }))
                }
                placeholder="예: 미니 크로스백"
              />
            </div>
            <div>
              <FieldLabel htmlFor={`${formId}-type`}>제품 종류</FieldLabel>
              <Input
                id={`${formId}-type`}
                value={form.productType}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    productType: event.target.value,
                  }))
                }
                placeholder="예: 가방 / 지갑 / 슈즈"
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor={`${formId}-fabric`}>원단 재질</FieldLabel>
            <Input
              id={`${formId}-fabric`}
              value={form.fabricMaterial}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  fabricMaterial: event.target.value,
                }))
              }
              placeholder="예: 면 100% / 나일론 / 소가죽"
            />
          </div>

          <div>
            <FieldLabel hint="mm">실제 크기</FieldLabel>
            <div className="grid grid-cols-3 gap-2 sm:max-w-md">
              <Input
                inputMode="numeric"
                placeholder="가로"
                value={form.sizeWidth}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    sizeWidth: event.target.value,
                  }))
                }
              />
              <Input
                inputMode="numeric"
                placeholder="세로"
                value={form.sizeHeight}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    sizeHeight: event.target.value,
                  }))
                }
              />
              <Input
                inputMode="numeric"
                placeholder="폭"
                value={form.sizeDepth}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    sizeDepth: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor={`${formId}-model-height`} hint="선택 · cm">크기 참고컷의 착용자 키</FieldLabel>
            <Input id={`${formId}-model-height`} type="number" min="1" step="any" placeholder="실제 키를 아는 경우만 입력 · 예: 165" value={form.modelHeightCm} onChange={(event) => setForm((prev) => ({ ...prev, modelHeightCm: event.target.value }))} />
            <p className="mt-2 text-xs text-muted-foreground">착용컷은 크기 비교에만 사용하고 모든 결과에서 사람을 제외하도록 안내합니다. 키는 크기 참고컷을 올렸을 때만 프롬프트에 적용하며, 제품 실측 치수를 우선합니다.</p>
          </div>

          <div>
            <FieldLabel>출력 비율</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {OUTPUT_RATIOS.map((ratio) => (
                <ChoiceChip
                  key={ratio}
                  selected={form.outputRatio === ratio}
                  onClick={() =>
                    setForm((prev) => ({ ...prev, outputRatio: ratio }))
                  }
                >
                  {ratio}
                </ChoiceChip>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>사용 목적</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {USAGE_PURPOSES.map((purpose) => (
                <ChoiceChip
                  key={purpose}
                  selected={form.usagePurpose === purpose}
                  onClick={() =>
                    setForm((prev) => ({ ...prev, usagePurpose: purpose }))
                  }
                >
                  {purpose}
                </ChoiceChip>
              ))}
            </div>
            {form.usagePurpose === '기타' ? (
              <Input
                className="mt-2 max-w-md"
                placeholder="기타 목적 입력"
                value={form.usageOther}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    usageOther: event.target.value,
                  }))
                }
              />
            ) : null}
          </div>

          <div>
            <div className="mb-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
              <p className="font-medium">제품 보존은 기본으로 적용해요</p>
              <p className="mt-1 text-muted-foreground">
                형태·비율·색상·소재·무늬·로고·봉제선·손잡이·부속은 원본 사진대로 유지하고,
                없는 디테일을 만들지 않도록 프롬프트에 포함합니다. 자연스러운 접촉·그림자와
                참고 이미지의 다른 제품·로고·워터마크를 가져오지 않는 지시도 함께 적용합니다.
              </p>
            </div>
            <FieldLabel htmlFor={`${formId}-highlight-details`} hint="선택">
              특히 보여주고 싶은 부분
            </FieldLabel>
            <Textarea
              id={`${formId}-highlight-details`}
              aria-describedby={`${formId}-highlight-help`}
              value={form.highlightDetails}
              rows={3}
              placeholder="예: 앞면 로고가 잘 보이게 / 가죽 질감이 드러나게 / 내부 수납공간을 보여주게"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, highlightDetails: event.target.value }))
              }
            />
            <p id={`${formId}-highlight-help`} className="mt-2 text-xs text-muted-foreground">
              비워 두어도 괜찮아요. 입력하지 않으면 제품 전체가 잘 보이도록 안내합니다.
              내부처럼 사진에 보이지 않는 부분을 보여주려면 해당 제품 사진도 올려 주세요.
            </p>
          </div>

          <div>
            <FieldLabel>레퍼런스에서 가져오지 말 것</FieldLabel>
            <p className="mb-2 text-xs text-muted-foreground">
              선택한 항목을 프롬프트에 추가로 강조합니다. 선택을 해제해도 제품 보존 기본 원칙은 유지됩니다.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {REFERENCE_EXCLUDE_ITEMS.map((item) => {
                const checked = form.referenceExclude[item]
                return (
                  <label
                    key={item}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                      checked
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-card hover:bg-muted/40',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={checked}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          referenceExclude: {
                            ...prev.referenceExclude,
                            [item]: event.target.checked,
                          },
                        }))
                      }
                    />
                    <span>{item}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle>3. 이미지 생성용 프롬프트</CardTitle>
            <Button type="button" size="sm" variant="outline" disabled={!readyToCopy} onClick={copyPrompt}>
              {copied ? (
                <>
                  <Check className="size-3.5" />
                  복사됨
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  전체 프롬프트 복사
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!readyToCopy ? (
            <p role="status" className="text-sm text-muted-foreground">
              아래 프롬프트와 업로드한 이미지를 함께 전달하세요.
              {missingPhotos.length
                ? ` 필수 사진: ${missingPhotos.map((slot) => slot.label).join(', ')}.`
                : ''}
              {!activeReferences.length ? ' 현재 방식의 참고 사진을 한 장 이상 등록해 주세요.' : ''}
              {' '}
              등록을 완료하면 전체 프롬프트를 복사할 수 있습니다.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              아래 프롬프트에 나열된 원본 제품 사진과 참고 사진만 함께 전달하세요.
            </p>
          )}
          {copyError ? <p role="alert" className="text-sm text-danger">{copyError}</p> : null}
          <Textarea
            aria-label="이미지 생성용 프롬프트"
            readOnly
            value={generatedPrompt}
            placeholder="제품 사진과 레퍼런스를 등록하면 프롬프트 미리보기가 표시됩니다."
            rows={16}
            className="min-h-[18rem] resize-y font-mono text-xs leading-relaxed"
          />
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={resetForm}>
              <Trash2 className="size-3.5" />
              양식 초기화
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
