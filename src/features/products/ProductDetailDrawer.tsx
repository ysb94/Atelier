import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { useOptionalBrand } from '@/components/layout/brand-context'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tabs'
import { ProductThumb } from '@/components/products/ProductThumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SelectFieldInput } from '@/components/fields/SelectFieldInput'
import { Input, Select, Textarea } from '@/components/ui/input'
import {
  getBrandBySlug,
  getBrandFields,
  getCodeUsageAssignments,
  getCodeUsageTargets,
  getProductCodes,
  getSabangnetStyleCodes,
  getSeasonsByBrand,
  getStylesByBrand,
  StyleStoreError,
  updateStyleFields,
} from '@/lib/api'
import { OWNER_LABEL, OWNER_ORDER } from '@/lib/import/fields'
import { outboundPartnerDisplayName } from '@/lib/codes/outbound-partner'
import {
  isSabangnetCodeField,
  sabangnetCodeByStyleId,
} from '@/lib/codes/sabangnet-style-codes'
import { isImageField, pickImageSources } from '@/lib/products/product-image'
import {
  fieldValueKey,
  getStyleFieldRaw,
  isFieldFilled,
  ownerCompleteness,
} from '@/lib/products/style-fields'
import {
  CODE_USAGE_STATUS_LABEL,
  STYLE_STATUS_LABEL,
  formatSeasonLabel,
  type BrandField,
  type FieldOwner,
  type Style,
  type StyleStatus,
} from '@/lib/types'
import { cn, emptyList } from '@/lib/utils'

const COMPLETENESS_OWNERS: Exclude<FieldOwner, 'common'>[] = [
  'planning',
  'design',
  'md',
  'logistics',
]

type TabId = 'info' | 'codes' | 'history'

function statusVariant(
  status: StyleStatus,
): 'default' | 'success' | 'warning' | 'muted' | 'outline' {
  switch (status) {
    case 'confirmed':
    case 'received':
      return 'success'
    case 'sampling':
    case 'ordered':
      return 'warning'
    case 'draft':
      return 'muted'
    default:
      return 'outline'
  }
}

function CompletenessDots({
  style,
  fields,
}: {
  style: Style
  fields: BrandField[]
}) {
  return (
    <div className="flex items-center gap-1">
      {COMPLETENESS_OWNERS.map((owner) => {
        const { ratio } = ownerCompleteness(style, fields, owner)
        const pct = Math.round(ratio * 100)
        return (
          <span
            key={owner}
            title={`${OWNER_LABEL[owner]} ${pct}%`}
            className={cn(
              'inline-block h-2 w-2 rounded-sm',
              pct >= 100
                ? 'bg-success'
                : pct >= 50
                  ? 'bg-warning'
                  : pct > 0
                    ? 'bg-muted-foreground/50'
                    : 'bg-muted',
            )}
          />
        )
      })}
    </div>
  )
}

function ProductImagePreview({
  sources,
  alt,
}: {
  sources: string[]
  alt: string
}) {
  const [currentUrl, setCurrentUrl] = useState<string | null>(
    sources[0] ?? null,
  )

  return (
    <div className="space-y-2">
      {currentUrl ? (
        <a
          href={currentUrl}
          target="_blank"
          rel="noreferrer"
          className="block break-all text-xs text-primary underline-offset-2 hover:underline"
        >
          {currentUrl}
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">
          표시할 이미지 주소가 없습니다.
        </p>
      )}
      <ProductThumb
        sources={sources}
        alt={alt}
        size={200}
        className="object-contain"
        onCurrentSourceChange={setCurrentUrl}
      />
    </div>
  )
}

function componentSummary(
  components: { styleNo: string; qty: number }[],
): string {
  if (components.length === 0) return '—'
  return components
    .map((c) => `${c.styleNo}${c.qty > 1 ? `×${c.qty}` : ''}`)
    .join(' + ')
}

export function ProductDetailDrawer() {
  const brandContext = useOptionalBrand()
  const workspaceActive = useWorkspaceTabActivity()
  const navigate = useNavigate()
  const location = useLocation()
  const { brandSlug: brandSlugParam, styleNo: styleNoParam } = useParams()
  const [searchParams] = useSearchParams()
  const brandSlug = brandSlugParam ?? brandContext?.brandSlug ?? ''

  const contextMatches = brandContext?.brandSlug === brandSlug
  const brandQuery = useQuery({
    queryKey: ['brand', brandSlug],
    queryFn: () => getBrandBySlug(brandSlug),
    enabled: Boolean(brandSlug) && !contextMatches,
  })
  const brand =
    contextMatches && brandContext ? brandContext.brand : brandQuery.data
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabId>('info')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)

  const decodedParam = styleNoParam ? decodeURIComponent(styleNoParam) : ''
  const querySuffix = searchParams.toString()
  const listQuery = querySuffix ? `?${querySuffix}` : ''
  const productWorkMatch = location.pathname.match(/^(\/product-work\/[^/]+)/)
  const dataSheetMatch = location.pathname.match(/^(\/data\/[^/]+)/)
  const listPath = location.pathname.startsWith('/products')
    ? '/products'
    : productWorkMatch?.[1] ?? dataSheetMatch?.[1] ?? '/products'
  const detailBasePath = `${listPath}/${brandSlug}`

  const close = () => navigate(`${listPath}${listQuery}`)

  const brandId = brand?.id
  const stylesQuery = useQuery({
    queryKey: ['styles', brandId, 'products'],
    queryFn: () => getStylesByBrand(brandId!),
    enabled: Boolean(brandId),
  })

  const fieldsQuery = useQuery({
    queryKey: ['brand-fields', brandId],
    queryFn: () => getBrandFields(brandId!),
    enabled: Boolean(brandId),
  })

  const seasonsQuery = useQuery({
    queryKey: ['seasons', brandId],
    queryFn: () => getSeasonsByBrand(brandId!),
    enabled: Boolean(brandId),
  })

  const codesQuery = useQuery({
    queryKey: ['product-codes', brandId, 'own'],
    queryFn: () => getProductCodes(brandId!, 'own'),
    enabled: Boolean(brandId),
  })

  const sabangnetCodeQuery = useQuery({
    queryKey: ['sabangnetProducts', brandId, 'styleCodes'],
    queryFn: async () => {
      try {
        return await getSabangnetStyleCodes(brandId!)
      } catch (error) {
        console.warn('[product-detail] 사방넷 코드를 불러오지 못했습니다', {
          brandId,
          error,
        })
        throw error
      }
    },
    enabled: Boolean(brandId),
  })
  const sabangnetCodeByStyle = useMemo(
    () => sabangnetCodeByStyleId(sabangnetCodeQuery.data ?? emptyList()),
    [sabangnetCodeQuery.data],
  )

  const assignmentsQuery = useQuery({
    queryKey: ['code-usage-assignments', brandId],
    queryFn: () => getCodeUsageAssignments(brandId!),
    enabled: Boolean(brandId),
  })

  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brandId],
    queryFn: () => getCodeUsageTargets(brandId!),
    enabled: Boolean(brandId),
  })

  const styles = stylesQuery.data ?? emptyList()
  const fields = fieldsQuery.data ?? emptyList()
  const seasons = seasonsQuery.data ?? emptyList()
  const ownCodes = codesQuery.data ?? emptyList()
  const assignments = assignmentsQuery.data ?? emptyList()
  const targets = targetsQuery.data ?? emptyList()

  const style = useMemo(() => {
    if (!decodedParam) return undefined
    return (
      styles.find((s) => s.styleNo === decodedParam) ??
      styles.find((s) => s.id === decodedParam)
    )
  }, [styles, decodedParam])

  const seasonMap = useMemo(
    () => new Map(seasons.map((s) => [s.id, s])),
    [seasons],
  )

  const seasonCode = style
    ? seasonMap.get(style.seasonId)?.code
    : undefined

  const fieldsByOwner = useMemo(() => {
    const sorted = [...fields]
      .filter((f) => f.level !== 'sku')
      .sort((a, b) => a.order - b.order)
    return OWNER_ORDER.map((owner) => ({
      owner,
      fields: sorted.filter((f) => f.owner === owner),
    })).filter((group) => group.fields.length > 0)
  }, [fields])

  const linkedCodes = useMemo(() => {
    if (!style) return []
    return ownCodes.filter((code) =>
      code.components.some((c) => c.styleId === style.id),
    )
  }, [ownCodes, style])

  const targetMap = useMemo(
    () => new Map(targets.map((t) => [t.id, t])),
    [targets],
  )

  useEffect(() => {
    setTab('info')
    setSaveError(null)
    setDrafts({})
  }, [decodedParam])

  useEffect(() => {
    if (!style) return
    const next: Record<string, string> = {}
    for (const field of fields) {
      if (field.level === 'sku') continue
      const key = fieldValueKey(field)
      next[key] = getStyleFieldRaw(style, field, { seasonCode })
    }
    setDrafts(next)
  }, [style, fields, seasonCode])

  const saveMutation = useMutation({
    mutationFn: async ({
      key,
      value,
    }: {
      key: string
      value: string
    }) => {
      if (!style) throw new Error('상품을 찾을 수 없습니다.')
      return updateStyleFields(style.id, { [key]: value })
    },
    onSuccess: async (updated) => {
      setSaveError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['styles', brandId] }),
        queryClient.invalidateQueries({ queryKey: ['styles-page', brandId] }),
      ])
      if (updated.styleNo !== decodedParam) {
        navigate(
          `${detailBasePath}/${encodeURIComponent(updated.styleNo)}${listQuery}`,
          { replace: true },
        )
      }
    },
    onError: (err) => {
      const message =
        err instanceof StyleStoreError
          ? err.message
          : err instanceof Error
            ? err.message
            : '저장 중 오류가 발생했습니다.'
      setSaveError(message)
    },
  })

  function draftValue(field: BrandField) {
    const key = fieldValueKey(field)
    return drafts[key] ?? ''
  }

  function setDraft(field: BrandField, value: string) {
    const key = fieldValueKey(field)
    setDrafts((prev) => ({ ...prev, [key]: value }))
    setSaveError(null)
  }

  function saveField(field: BrandField) {
    if (!style) return
    const key = fieldValueKey(field)
    const value = drafts[key] ?? ''
    const current = getStyleFieldRaw(style, field, { seasonCode })
    if (value === current) return
    saveMutation.mutate({ key, value })
  }

  const loading =
    (!brand && brandQuery.isLoading) ||
    stylesQuery.isLoading ||
    fieldsQuery.isLoading ||
    seasonsQuery.isLoading

  if (!workspaceActive) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 space-y-2">
            {style ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">
                    {style.styleNo}
                  </span>
                  <Badge variant={statusVariant(style.status)}>
                    {STYLE_STATUS_LABEL[style.status]}
                  </Badge>
                  <CompletenessDots style={style} fields={fields} />
                </div>
                <h2 className="truncate text-lg font-semibold tracking-tight">
                  {style.name}
                </h2>
                {brand ? (
                  <p className="text-xs text-muted-foreground">{brand.name}</p>
                ) : null}
              </>
            ) : (
              <h2 className="text-lg font-semibold tracking-tight">상품 상세</h2>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="닫기"
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            불러오는 중...
          </div>
        ) : !style ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              상품을 찾을 수 없습니다.
            </p>
            <Button type="button" variant="outline" onClick={close}>
              목록으로
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-1 border-b border-border px-3 pt-2">
              {(
                [
                  ['info', '정보'],
                  ['codes', '코드'],
                  ['history', '이력'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    'px-3 py-2 text-sm font-medium transition-colors',
                    tab === id
                      ? 'border-b-2 border-foreground text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {saveError ? (
                <p className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                  {saveError}
                </p>
              ) : null}

              {tab === 'info' ? (
                <div className="space-y-6">
                  {fieldsByOwner.map(({ owner, fields: ownerFields }) => (
                    <section key={owner} className="space-y-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {OWNER_LABEL[owner]}
                      </h3>
                      <div className="space-y-3">
                        {ownerFields.map((field) => {
                          const sabangnetLinked = isSabangnetCodeField(field)
                          const sabangnetCode = sabangnetLinked
                            ? (sabangnetCodeByStyle.get(style.id) ?? '')
                            : ''
                          const filled = sabangnetLinked
                            ? sabangnetCode.trim().length > 0
                            : isFieldFilled(style, field)
                          const key = fieldValueKey(field)
                          const value = sabangnetLinked
                            ? sabangnetCode
                            : draftValue(field)

                          return (
                            <label key={field.id} className="block space-y-1.5">
                              <span className="flex items-center gap-2 text-sm font-medium">
                                {field.label}
                                {field.required ? (
                                  <span className="text-danger">*</span>
                                ) : null}
                                {!filled && !value.trim() ? (
                                  <Badge variant="muted">
                                    {OWNER_LABEL[owner]}
                                  </Badge>
                                ) : null}
                              </span>

                              {sabangnetLinked ? (
                                <>
                                  <Input
                                    type="text"
                                    value={
                                      sabangnetCodeQuery.isError ? '' : value
                                    }
                                    readOnly
                                    disabled
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    {sabangnetCodeQuery.isError
                                      ? '사방넷 코드를 불러오지 못했습니다.'
                                      : sabangnetCodeQuery.isLoading
                                        ? '사방넷 코드 관리에서 불러오는 중...'
                                        : '사방넷 코드 관리에서 이 M번호에 연결된 코드입니다.'}
                                  </p>
                                </>
                              ) : isImageField(field) ? (
                                <>
                                  <ProductImagePreview
                                    sources={pickImageSources(
                                      value,
                                      style.styleNo,
                                      key,
                                    )}
                                    alt={`${style.styleNo} ${field.label}`}
                                  />
                                  <Input
                                    type="url"
                                    value={value}
                                    disabled={saveMutation.isPending}
                                    placeholder="직접 넣은 주소가 있으면 규칙을 대신합니다"
                                    onChange={(e) =>
                                      setDraft(field, e.target.value)
                                    }
                                    onBlur={() => saveField(field)}
                                  />
                                </>
                              ) : field.type === 'season' ||
                              field.systemKey === 'seasonCode' ||
                              field.systemKey === 'seasonId' ? (
                                <Select
                                  value={value}
                                  disabled={saveMutation.isPending}
                                  onChange={(e) => {
                                    const next = e.target.value
                                    setDraft(field, next)
                                    if (!style) return
                                    const current = getStyleFieldRaw(
                                      style,
                                      field,
                                      { seasonCode },
                                    )
                                    if (next === current) return
                                    saveMutation.mutate({ key, value: next })
                                  }}
                                >
                                  <option value="" disabled>
                                    출시 기획 선택
                                  </option>
                                  {seasons.map((s) => (
                                    <option key={s.id} value={s.code}>
                                      {formatSeasonLabel(s)}
                                    </option>
                                  ))}
                                </Select>
                              ) : field.type === 'select' ? (
                                <SelectFieldInput
                                  field={field}
                                  value={value}
                                  disabled={saveMutation.isPending}
                                  onChange={(next) => {
                                    setDraft(field, next)
                                    if (!style) return
                                    const current = getStyleFieldRaw(
                                      style,
                                      field,
                                      { seasonCode },
                                    )
                                    if (next === current) return
                                    saveMutation.mutate({ key, value: next })
                                  }}
                                />
                              ) : field.type === 'gender' ||
                                field.systemKey === 'gender' ? (
                                <Select
                                  value={value}
                                  disabled={saveMutation.isPending}
                                  onChange={(e) => {
                                    const next = e.target.value
                                    setDraft(field, next)
                                    if (!style) return
                                    const current = getStyleFieldRaw(
                                      style,
                                      field,
                                      { seasonCode },
                                    )
                                    if (next === current) return
                                    saveMutation.mutate({ key, value: next })
                                  }}
                                >
                                  <option value="" disabled>
                                    선택
                                  </option>
                                  <option value="W">여성 (W)</option>
                                  <option value="M">남성 (M)</option>
                                  <option value="U">공용 (U)</option>
                                </Select>
                              ) : field.systemKey === 'status' ? (
                                <Select
                                  value={value}
                                  disabled={saveMutation.isPending}
                                  onChange={(e) => {
                                    const next = e.target.value
                                    setDraft(field, next)
                                    if (!style) return
                                    const current = getStyleFieldRaw(
                                      style,
                                      field,
                                      { seasonCode },
                                    )
                                    if (next === current) return
                                    saveMutation.mutate({ key, value: next })
                                  }}
                                >
                                  {(
                                    Object.keys(
                                      STYLE_STATUS_LABEL,
                                    ) as StyleStatus[]
                                  ).map((status) => (
                                    <option key={status} value={status}>
                                      {STYLE_STATUS_LABEL[status]}
                                    </option>
                                  ))}
                                </Select>
                              ) : field.type === 'list' ||
                                field.systemKey === 'description' ? (
                                <Textarea
                                  rows={3}
                                  value={value}
                                  disabled={saveMutation.isPending}
                                  onChange={(e) =>
                                    setDraft(field, e.target.value)
                                  }
                                  onBlur={() => saveField(field)}
                                />
                              ) : (
                                <Input
                                  type="text"
                                  inputMode={
                                    field.type === 'number'
                                      ? 'decimal'
                                      : undefined
                                  }
                                  value={value}
                                  disabled={saveMutation.isPending}
                                  onChange={(e) =>
                                    setDraft(field, e.target.value)
                                  }
                                  onBlur={() => saveField(field)}
                                />
                              )}
                            </label>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}

              {tab === 'codes' ? (
                <div className="space-y-3">
                  {codesQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">
                      불러오는 중...
                    </p>
                  ) : linkedCodes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      이 상품이 포함된 자사 코드가 없습니다.
                    </p>
                  ) : (
                    linkedCodes.map((code) => {
                      const codeAssignments = assignments.filter(
                        (a) => a.productCodeId === code.id,
                      )
                      return (
                        <div
                          key={code.id}
                          className="space-y-2 rounded-md border border-border p-3"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-mono text-sm font-medium tabular-nums">
                              {code.code}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {code.name}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {componentSummary(code.components)}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {codeAssignments.length === 0 ? (
                              <span className="text-xs text-muted-foreground">
                                출고업체 없음
                              </span>
                            ) : (
                              codeAssignments.map((a) => {
                                const target = targetMap.get(a.usageTargetId)
                                return (
                                  <Badge
                                    key={a.id}
                                    variant={
                                      a.status === 'active'
                                        ? 'success'
                                        : 'muted'
                                    }
                                  >
                                    {target
                                      ? outboundPartnerDisplayName(target)
                                      : '알 수 없음'}{' '}
                                    ·{' '}
                                    {CODE_USAGE_STATUS_LABEL[a.status]}
                                  </Badge>
                                )
                              })
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              ) : null}

              {tab === 'history' ? (
                <p className="text-sm text-muted-foreground">
                  변경 이력은 준비 중입니다.
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
