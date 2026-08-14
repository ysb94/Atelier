import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { StylePicker, formatStyleRef } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { PROVIDER_LABEL } from '@/lib/ai/gateway-core'
import { withRecommendSlot } from '@/lib/ai/recommend-queue'
import {
  getAiFeatureRoute,
  recommendInvoiceProduct,
  saveInvoiceProductNameMap,
  searchInvoiceProductCandidates,
} from '@/lib/api'
import type {
  InvoiceProductNameMatchStatus,
  InvoiceProductNameTransformation,
  UnresolvedProductNameCombo,
} from '@/lib/invoice/product-name-transform'
import type {
  AiProductRecommendation,
  InvoiceProductNameMap,
  StyleRef,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'

const STATUS_META: Record<
  InvoiceProductNameMatchStatus,
  { label: string; variant: 'success' | 'default' | 'warning' | 'danger' }
> = {
  mapped: { label: '자동 완료', variant: 'success' },
  candidate: { label: '후보 1개', variant: 'default' },
  missing_style: { label: 'M번호 발급 필요', variant: 'warning' },
  conflict: { label: '충돌', variant: 'warning' },
  unresolved: { label: '검토 필요', variant: 'danger' },
}

const RULE_LABELS: Record<string, string> = {
  exact: '쇼핑몰·품목명·내품명 조합',
  product_item: '품목명 + 내품명 전체',
  product: '품목명 단독',
  product_item_slash_prefix: '품목명 + 내품명 / 앞부분',
  product_item_comma_prefix: '품목명 + 내품명 , 앞부분',
  product_item_color_label: '품목명 + Color: 구간',
  product_item_colon_prefix: '품목명 + 내품명 : 앞부분',
  item_slash_prefix: '내품명 / 앞부분',
  item_comma_prefix: '내품명 , 앞부분',
  item_full: '내품명 전체 단독(내품명 비움)',
  item_value: '옵션값 단독(내품명 비움)',
  item_slash_suffix: '내품명 / 뒷부분(SSG)',
  own_code: '자체상품코드',
}

function ruleLabel(rule: string | null) {
  if (!rule) return '-'
  return RULE_LABELS[rule] ?? rule
}

type ProductReviewGroup = {
  productName: string
  combos: UnresolvedProductNameCombo[]
  rowCount: number
}

function upsertInvoiceProductNameMapCache(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  saved: InvoiceProductNameMap,
) {
  const queryKey = ['invoice-product-name-maps', brandId] as const
  const current = queryClient.getQueryData<InvoiceProductNameMap[]>(queryKey)
  if (!current) {
    return queryClient.invalidateQueries({ queryKey })
  }
  queryClient.setQueryData<InvoiceProductNameMap[]>(queryKey, (maps = []) => {
    const next = maps.filter((map) => {
      if (map.id === saved.id) return false
      return !(
        saved.normalizedLookupKey &&
        map.normalizedLookupKey === saved.normalizedLookupKey
      )
    })
    return [saved, ...next]
  })
}

function groupCombos(
  combos: UnresolvedProductNameCombo[],
): ProductReviewGroup[] {
  const byName = new Map<string, UnresolvedProductNameCombo[]>()
  for (const combo of combos) {
    const list = byName.get(combo.productName) ?? []
    list.push(combo)
    byName.set(combo.productName, list)
  }
  return [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'ko-KR'))
    .map(([productName, items]) => ({
      productName,
      combos: items,
      rowCount: items.reduce((sum, item) => sum + item.rowCount, 0),
    }))
}

export function InvoiceProductNameTransformPanel({
  brandId,
  transformation,
}: {
  brandId: string
  transformation: InvoiceProductNameTransformation
}) {
  const groups = useMemo(
    () => groupCombos(transformation.unresolvedCombos),
    [transformation.unresolvedCombos],
  )
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | InvoiceProductNameMatchStatus>(
    'all',
  )
  const [openProductName, setOpenProductName] = useState<string | null>(
    groups[0]?.productName ?? null,
  )

  const reviewCount =
    transformation.unresolvedRowCount +
    transformation.conflictRowCount +
    transformation.missingStyleRowCount +
    transformation.candidateRowCount

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ko-KR')
    return transformation.rows
      .filter((row) => {
        if (status !== 'all' && row.status !== status) return false
        if (!q) return true
        return [
          row.source.productName,
          row.source.itemName,
          row.source.mallName,
          row.source.ownProductCode,
          row.transformedProductName,
          row.style?.styleNo,
          row.appliedRule,
        ]
          .join(' ')
          .toLocaleLowerCase('ko-KR')
          .includes(q)
      })
      .sort(
        (left, right) =>
          left.source.productName.localeCompare(
            right.source.productName,
            'ko-KR',
          ) ||
          left.source.itemName.localeCompare(right.source.itemName, 'ko-KR') ||
          left.source.rowNumber - right.source.rowNumber,
      )
  }, [query, status, transformation.rows])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge variant="success">
          자동 완료 {formatNumber(transformation.mappedRowCount)}
        </Badge>
        <Badge variant="outline">
          후보 {formatNumber(transformation.candidateRowCount)}
        </Badge>
        <Badge variant="warning">
          M번호 발급 필요 {formatNumber(transformation.missingStyleRowCount)}
        </Badge>
        <Badge variant="warning">
          충돌 {formatNumber(transformation.conflictRowCount)}
        </Badge>
        <Badge variant="danger">
          검토 필요 {formatNumber(transformation.unresolvedRowCount)}
        </Badge>
      </div>

      {reviewCount > 0 ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              본품 확인 {formatNumber(groups.length)}개 품목 · 내품명{' '}
              {formatNumber(transformation.unresolvedCombos.length)}개
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              같은 품목명은 한 그룹입니다. 색상·구성만 다른 내품명은 안에서
              각각 본품을 지정합니다.
            </p>
          </div>
          <div className="space-y-2">
            {groups.map((group) => (
              <ProductReviewGroupCard
                key={group.productName}
                brandId={brandId}
                group={group}
                open={openProductName === group.productName}
                onToggle={() =>
                  setOpenProductName((current) =>
                    current === group.productName ? null : group.productName,
                  )
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
          이 파일의 품목명은 모두 본품 기준으로 연결됐습니다.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="행 검색"
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) =>
            setStatus(
              event.target.value as 'all' | InvoiceProductNameMatchStatus,
            )
          }
          className="w-40"
        >
          <option value="all">상태 전체</option>
          <option value="mapped">자동 완료</option>
          <option value="candidate">후보 1개</option>
          <option value="missing_style">M번호 발급 필요</option>
          <option value="conflict">충돌</option>
          <option value="unresolved">검토 필요</option>
        </Select>
      </div>

      <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="sticky top-0 bg-muted/80">
            <tr>
              <th className="px-3 py-2 font-medium">행</th>
              <th className="px-3 py-2 font-medium">원본 품목명</th>
              <th className="px-3 py-2 font-medium">내품명 문맥</th>
              <th className="px-3 py-2 font-medium">본품</th>
              <th className="px-3 py-2 font-medium">후보 규칙</th>
              <th className="px-3 py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((row) => {
              const meta = STATUS_META[row.status]
              return (
                <tr
                  key={row.source.rowNumber}
                  className="border-t border-border"
                >
                  <td className="px-3 py-2 tabular-nums">
                    {row.source.rowNumber}
                  </td>
                  <td className="max-w-48 truncate px-3 py-2">
                    {row.source.productName}
                  </td>
                  <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                    {row.source.itemName || '-'}
                  </td>
                  <td className="max-w-48 truncate px-3 py-2">
                    {row.style
                      ? `${row.style.styleNo} · ${row.transformedProductName}`
                      : row.transformedProductName}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ruleLabel(row.appliedRule)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProductReviewGroupCard({
  brandId,
  group,
  open,
  onToggle,
}: {
  brandId: string
  group: ProductReviewGroup
  open: boolean
  onToggle: () => void
}) {
  const variantCount = group.combos.length

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{group.productName}</p>
          <p className="truncate text-xs text-muted-foreground">
            내품명 {formatNumber(variantCount)}개 ·{' '}
            {formatNumber(group.rowCount)}행
            {variantCount > 1 ? ' · 색상·구성 변형' : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={variantCount > 1 ? 'default' : 'warning'}>
            {variantCount > 1
              ? `변형 ${formatNumber(variantCount)}`
              : STATUS_META[group.combos[0]!.status].label}
          </Badge>
          <Button type="button" size="sm" variant="ghost">
            {open ? '접기' : '지정'}
          </Button>
        </div>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border p-3">
          <div className="space-y-2">
            {group.combos.map((combo) => (
              <VariantAssignRow
                key={combo.key}
                brandId={brandId}
                combo={combo}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function VariantAssignRow({
  brandId,
  combo,
}: {
  brandId: string
  combo: UnresolvedProductNameCombo
}) {
  const queryClient = useQueryClient()
  const [selectedLookupKey, setSelectedLookupKey] = useState('')
  const [style, setStyle] = useState<StyleRef | null>(
    combo.candidateStyles[0] ?? null,
  )
  const [savedMessage, setSavedMessage] = useState('')
  const [pickedRecommendation, setPickedRecommendation] =
    useState<AiProductRecommendation | null>(null)
  const meta = STATUS_META[combo.status]

  const mutation = useMutation({
    mutationFn: ({
      lookupKey,
      nextStyle,
    }: {
      lookupKey: string
      nextStyle: StyleRef
    }) => {
      const shownRank = pickedRecommendation?.products.findIndex(
        (product) => product.styleId === nextStyle.styleId,
      )
      const usedRecommendation =
        pickedRecommendation &&
        pickedRecommendation.lookupKey === lookupKey &&
        shownRank !== undefined &&
        shownRank >= 0
      return saveInvoiceProductNameMap(brandId, {
        productName: lookupKey,
        lookupKey,
        styleId: nextStyle.styleId,
        feedback: {
          source: usedRecommendation
            ? pickedRecommendation.source === 'local'
              ? 'local'
              : 'ai'
            : 'manual',
          cacheId: usedRecommendation ? pickedRecommendation.cacheId : null,
          shownRank: usedRecommendation ? shownRank + 1 : null,
          provider: usedRecommendation ? pickedRecommendation.provider : null,
          modelId: usedRecommendation ? pickedRecommendation.modelId : null,
        },
      })
    },
    onSuccess: async (saved) => {
      await upsertInvoiceProductNameMapCache(queryClient, brandId, saved)
      await queryClient.invalidateQueries({
        queryKey: ['ai-product-recommendation', brandId, combo.key],
        refetchType: 'none',
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-usage-summary', brandId],
      })
      setSavedMessage('조회 키와 본품 연결을 저장했습니다. 바로 다시 적용됩니다.')
    },
  })
  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : null

  return (
    <div className="rounded-md border border-border/80 p-2.5">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {combo.itemName || '내품명 없음'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {combo.mallName || '모든 쇼핑몰'}
                {combo.appliedRule ? ` · ${ruleLabel(combo.appliedRule)}` : ''}
                {` · ${formatNumber(combo.rowCount)}행`}
              </p>
            </div>
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>

          {combo.candidates.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {combo.candidates.map((candidate) => {
                const selected = selectedLookupKey === candidate.text
                return (
                  <li key={candidate.rule} className="truncate">
                    <button
                      type="button"
                      disabled={mutation.isPending}
                      title={`${candidate.text} · ${ruleLabel(candidate.rule)}`}
                      className={`w-full truncate rounded px-1 text-left ${
                        selected
                          ? 'bg-primary/10 font-medium'
                          : 'hover:bg-muted/40'
                      }`}
                      onClick={() => {
                        setSelectedLookupKey(candidate.text)
                        setPickedRecommendation(null)
                        setSavedMessage('')
                        mutation.reset()
                      }}
                    >
                      <span
                        className={selected ? 'text-primary' : 'text-foreground'}
                      >
                        {selected ? '✓ ' : ''}
                        {candidate.text}
                      </span>{' '}
                      · {ruleLabel(candidate.rule)}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-danger">
              이 행에서 선택할 조회 키를 만들지 못했습니다.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <StylePicker
                brandId={brandId}
                value={style}
                disabled={mutation.isPending}
                onChange={(next) => {
                  setStyle(next)
                  setPickedRecommendation(null)
                  setSavedMessage('')
                  mutation.reset()
                }}
                placeholder="본품 1개만 고르세요"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!selectedLookupKey || !style || mutation.isPending}
              onClick={() => {
                if (!selectedLookupKey || !style) return
                setSavedMessage('')
                mutation.mutate({
                  lookupKey: selectedLookupKey,
                  nextStyle: style,
                })
              }}
            >
              {mutation.isPending ? '저장 중...' : '등록'}
            </Button>
          </div>
          {errorMessage ? (
            <p className="mt-1 text-xs text-danger">{errorMessage}</p>
          ) : savedMessage ? (
            <p className="mt-1 text-xs text-success">{savedMessage}</p>
          ) : selectedLookupKey && style ? (
            <p className="mt-1 break-words text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {selectedLookupKey}
              </span>
              을(를){' '}
              <span className="font-medium text-foreground">
                {formatStyleRef(style)}
              </span>
              (으)로 바꿉니다.
            </p>
          ) : selectedLookupKey ? (
            <p
              className="mt-1 truncate text-xs text-muted-foreground"
              title={selectedLookupKey}
            >
              선택: <span className="text-foreground">{selectedLookupKey}</span> ·
              바꿀 본품 M번호를 고르세요.
            </p>
          ) : null}
        </div>
        <AiRecommendPanel
          brandId={brandId}
          combo={combo}
          disabled={mutation.isPending}
          onPick={({ lookupKey, nextStyle, recommendation }) => {
            setSelectedLookupKey(lookupKey)
            if (nextStyle) setStyle(nextStyle)
            setPickedRecommendation(recommendation)
            setSavedMessage('')
            mutation.reset()
          }}
        />
      </div>
    </div>
  )
}

function AiRecommendPanel({
  brandId,
  combo,
  disabled,
  onPick,
}: {
  brandId: string
  combo: UnresolvedProductNameCombo
  disabled: boolean
  onPick: (next: {
    lookupKey: string
    nextStyle?: StyleRef
    recommendation: AiProductRecommendation
  }) => void
}) {
  const lookupKeys = useMemo(
    () =>
      combo.candidates
        .map((candidate) => candidate.text.trim())
        .filter(Boolean),
    [combo.candidates],
  )
  const routeQuery = useQuery({
    queryKey: ['ai-feature-route', brandId, 'invoice_product_recommendation'],
    queryFn: () =>
      getAiFeatureRoute(brandId, 'invoice_product_recommendation'),
    staleTime: 5 * 60_000,
  })
  const route = routeQuery.data ?? null
  const recommendQuery = useQuery({
    queryKey: [
      'ai-product-recommendation',
      brandId,
      combo.key,
      route?.provider ?? '',
      route?.modelId ?? '',
      route?.recommendationPolicy ?? 'hybrid_auto',
      JSON.stringify(route?.decisionConfig ?? {}),
    ],
    enabled: Boolean(route?.isActive && lookupKeys.length > 0),
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<AiProductRecommendation> =>
      withRecommendSlot(async () => {
        const candidates = await searchInvoiceProductCandidates(
          brandId,
          lookupKeys,
          20,
        )
        return recommendInvoiceProduct({
          brandId,
          lookupKeys,
          candidates,
          productName: combo.productName,
          itemName: combo.itemName,
          mallName: combo.mallName,
        })
      }),
  })
  const recommendation = recommendQuery.data
  const error =
    recommendQuery.error instanceof Error ? recommendQuery.error.message : null

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-2">
      <p className="text-[11px] font-medium text-muted-foreground">
        {recommendation?.source === 'local'
          ? '원장 추천'
          : recommendation?.source === 'manual'
            ? '수동 확인'
            : 'AI 추천'}
      </p>
      {routeQuery.isLoading || recommendQuery.isFetching ? (
        <p className="mt-1 text-xs text-muted-foreground">추천을 만드는 중...</p>
      ) : !route ? (
        <p className="mt-1 text-xs text-muted-foreground">
          설정 → AI 설정에서 모델을 고르면 여기에 추천이 나타납니다.
        </p>
      ) : error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : recommendation ? (
        <div className="mt-1 space-y-1.5">
          <button
            type="button"
            disabled={disabled}
            className="w-full truncate rounded px-1 text-left text-xs hover:bg-muted/60"
            onClick={() => {
              if (!recommendation.lookupKey) return
              const first = recommendation.products[0]
              onPick({
                lookupKey: recommendation.lookupKey,
                recommendation,
                nextStyle: first
                  ? {
                      styleId: first.styleId,
                      styleNo: first.styleNo,
                      name: first.name,
                    }
                  : undefined,
              })
            }}
            title={recommendation.lookupKey}
          >
            <span className="text-muted-foreground">조회 키 · </span>
            <span className="font-medium text-foreground">
              {recommendation.lookupKey || '추천 없음'}
            </span>
          </button>
          {recommendation.products.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              관련 공식상품을 고르지 못했습니다. 왼쪽에서 직접 지정하세요.
            </p>
          ) : (
            <ul className="space-y-1">
              {recommendation.products.map((product) => (
                <li key={product.styleId}>
                  <button
                    type="button"
                    disabled={disabled}
                    className="w-full rounded px-1 py-0.5 text-left text-xs hover:bg-muted/60"
                    title={`${product.styleNo} · ${product.name}`}
                    onClick={() =>
                      onPick({
                        lookupKey:
                          recommendation.lookupKey || lookupKeys[0] || '',
                        recommendation,
                        nextStyle: {
                          styleId: product.styleId,
                          styleNo: product.styleNo,
                          name: product.name,
                        },
                      })
                    }
                  >
                    <span className="font-medium text-foreground">
                      {product.styleNo}
                    </span>
                    <span className="ml-1 text-muted-foreground">
                      {product.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="truncate text-[10px] text-muted-foreground">
            {recommendation.source === 'local'
              ? '원장'
              : recommendation.cacheHit
                ? '캐시'
                : PROVIDER_LABEL[recommendation.provider]}
            {recommendation.source !== 'local' && recommendation.modelId
              ? ` · ${recommendation.modelId}`
              : ''}
            {recommendation.reason ? ` · ${recommendation.reason}` : ''}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          추천을 아직 받지 못했습니다.
        </p>
      )}
    </div>
  )
}
