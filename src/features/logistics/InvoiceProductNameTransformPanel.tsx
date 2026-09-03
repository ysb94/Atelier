import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  saveInvoiceProductNameExclusion,
  saveInvoiceProductNameTagRole,
} from '@/lib/api'
import type {
  InvoiceProductNameMatchStatus,
  InvoiceProductNameTransformation,
  UnresolvedProductNameCombo,
} from '@/lib/invoice/product-name-transform'
import { decideProductNameFeedbackOutcome } from '@/lib/ai/learning-core'
import { previewProductNameExclusion } from '@/lib/invoice/product-name-transform'
import {
  collectFileOptionReservationTagGroups,
  collectFileTagGroups,
  type FileOptionReservationTagGroup,
  type FileTagGroup,
  type ParsedProductNameTag,
} from '@/lib/invoice/product-name-tags'
import type {
  InvoiceProductNameExclusion,
  InvoiceProductNameTagRole,
} from '@/lib/types'
import { INVOICE_PRODUCT_NAME_TAG_ROLE_LABEL } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import type { GiftSourceGroup } from '@/lib/invoice/gift-source-transform'
import type { ProductNameAiReviewRow } from '@/lib/invoice/product-name-ai-review'
import { InvoiceTablePager } from './invoice-table-page'
import { useInvoiceTablePage } from './useInvoiceTablePage'
import { InvoiceProductNameAiApplyBar } from './InvoiceProductNameAiApplyBar'
import { InvoiceProductNameRecentSavesPanel } from './InvoiceProductNameRecentSavesPanel'
import { useInvoiceProductNameBulkAiApply } from './useInvoiceProductNameBulkAiApply'
import { useInvoiceProductNameSaveQueue } from './useInvoiceProductNameSaveQueue'

const STATUS_META: Record<
  InvoiceProductNameMatchStatus,
  {
    label: string
    variant: 'success' | 'default' | 'warning' | 'danger' | 'muted'
  }
> = {
  mapped: { label: '자동 완료', variant: 'success' },
  candidate: { label: '후보 1개', variant: 'default' },
  missing_style: { label: 'M번호 발급 필요', variant: 'warning' },
  conflict: { label: '충돌', variant: 'warning' },
  unresolved: { label: '검토 필요', variant: 'danger' },
  excluded: { label: '상품 연결 예외', variant: 'muted' },
  exclusion_guarded: { label: '예외 보류', variant: 'warning' },
  gift_pending: { label: '사은품 처리 필요', variant: 'danger' },
  gift_mapped: { label: '사은품 변환 완료', variant: 'success' },
}

const RULE_LABELS: Record<string, string> = {
  product: '품목명 단독',
  product_item: '품목명 + 내품명 전체',
  product_item_slash_prefix: '품목명 + 내품명 / 앞부분',
  product_item_comma_prefix: '품목명 + 내품명 , 앞부분',
  product_item_color_label: '품목명 + Color: 구간',
  product_item_colon_prefix: '품목명 + 내품명 : 앞부분',
  item_slash_prefix: '내품명 / 앞부분 단독',
  item_comma_prefix: '내품명 , 앞부분 단독',
  item_full: '내품명 전체 단독',
  compact: '기호·공백 정리',
}

function ruleLabel(rule: string | null) {
  if (!rule) return '-'
  return RULE_LABELS[rule] ?? rule
}

const TAG_ROLES: InvoiceProductNameTagRole[] = [
  'product_composition',
  'event_marketing',
  'composition_gift',
  'identity_condition',
  'unknown',
]


export const InvoiceProductNameTransformPanel = memo(function InvoiceProductNameTransformPanel({
  brandId,
  transformation,
  renderUi = true,
  autoCollect = false,
  autoCollectKey = '',
  onAutoCollectProgress,
  onAutoCollectSettled,
  onBlockingSaveCountChange,
  giftGroups = [],
  onOpenGiftSetup,
}: {
  brandId: string
  transformation: InvoiceProductNameTransformation
  renderUi?: boolean
  autoCollect?: boolean
  autoCollectKey?: string
  onAutoCollectProgress?: (progress: {
    collecting: boolean
    done: number
    total: number
  }) => void
  onAutoCollectSettled?: () => void
  onBlockingSaveCountChange?: (count: number) => void
  giftGroups?: GiftSourceGroup[]
  onOpenGiftSetup?: (row: ProductNameAiReviewRow) => void
}) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [status, setStatus] = useState<'all' | InvoiceProductNameMatchStatus>(
    'all',
  )
  const {
    history,
    savingCount,
    failedCount,
    enqueue,
    undo,
  } = useInvoiceProductNameSaveQueue(brandId)

  const excludeMutation = useMutation({
    mutationFn: (input: {
      mallName: string
      productName: string
      itemName: string
    }) => saveInvoiceProductNameExclusion(brandId, input),
    onSuccess: (saved) => {
      queryClient.setQueryData<InvoiceProductNameExclusion[]>(
        ['invoice-product-name-exclusions', brandId],
        (current) => {
          const next = current ? current.filter((item) => item.id !== saved.id) : []
          return [saved, ...next]
        },
      )
    },
  })

  useEffect(() => {
    onBlockingSaveCountChange?.(
      savingCount + failedCount + (excludeMutation.isPending ? 1 : 0),
    )
  }, [
    excludeMutation.isPending,
    failedCount,
    onBlockingSaveCountChange,
    savingCount,
  ])

  useEffect(
    () => () => {
      onBlockingSaveCountChange?.(0)
    },
    [onBlockingSaveCountChange],
  )

  const saveStatusByKey = useMemo(() => {
    const next = new Map<string, (typeof history)[number]['status']>()
    for (const entry of history) {
      if (!next.has(entry.comboKey)) next.set(entry.comboKey, entry.status)
    }
    return next
  }, [history])
  const excludeCombo = useCallback(
    (combo: UnresolvedProductNameCombo) => {
      if (!combo.mallName.trim()) return
      const impact = previewProductNameExclusion(transformation.rows, combo)
      const confirmed = window.confirm(
        [
          `${combo.mallName}의 품목명 "${combo.productName}", 내품명 "${combo.itemName}"만 상품 연결에서 예외 처리합니다.`,
          `이 파일에서 ${formatNumber(impact.matchCount)}행이 맞습니다.`,
          impact.excludedCount > 0
            ? `같은 주문에 본품이 확정된 행이 있어 ${formatNumber(impact.excludedCount)}행은 CJ에 원문과 자체품번코드만 남깁니다.`
            : '같은 주문에 본품이 확정된 행이 없으면 원문을 남기고 예외 보류로 표시합니다.',
          impact.guardedCount > 0 && impact.excludedCount > 0
            ? `단독 행 ${formatNumber(impact.guardedCount)}건은 예외 확정하지 않고 검토에 남깁니다.`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      if (!confirmed) return
      excludeMutation.mutate({
        mallName: combo.mallName,
        productName: combo.productName,
        itemName: combo.itemName,
      })
    },
    [excludeMutation, transformation.rows],
  )
  const bulk = useInvoiceProductNameBulkAiApply({
    brandId,
    combos: transformation.unresolvedCombos,
    enqueue,
    saveStatusByKey,
  })
  const autoCollectStartedRef = useRef(false)
  const lastAutoCollectKeyRef = useRef(autoCollectKey)
  if (lastAutoCollectKeyRef.current !== autoCollectKey) {
    lastAutoCollectKeyRef.current = autoCollectKey
    autoCollectStartedRef.current = false
  }

  useEffect(() => {
    if (!autoCollect) return
    onAutoCollectProgress?.({
      collecting: bulk.phase === 'collecting',
      done: bulk.progress.done,
      total: bulk.progress.total,
    })
  }, [
    autoCollect,
    bulk.phase,
    bulk.progress.done,
    bulk.progress.total,
    onAutoCollectProgress,
  ])

  useEffect(() => {
    if (!autoCollect || autoCollectStartedRef.current) return
    if (bulk.routeLoading) return
    autoCollectStartedRef.current = true
    if (!bulk.routeReady || bulk.targetCount === 0) {
      onAutoCollectSettled?.()
      return
    }
    void bulk.collect().catch(() => {
      onAutoCollectSettled?.()
    })
  }, [
    autoCollect,
    bulk.collect,
    bulk.routeLoading,
    bulk.routeReady,
    bulk.targetCount,
    onAutoCollectSettled,
  ])

  useEffect(() => {
    if (!autoCollect || !autoCollectStartedRef.current) return
    if (bulk.phase === 'review' || bulk.phase === 'applied') {
      onAutoCollectSettled?.()
    }
  }, [autoCollect, bulk.phase, onAutoCollectSettled])

  const fileTags = useMemo(
    () =>
      renderUi
        ? collectFileTagGroups(
            transformation.rows.map((row) => ({
              productName: row.source.productName,
              tags: row.tags,
            })),
          )
        : [],
    [renderUi, transformation.rows],
  )
  const optionTagGroups = useMemo(
    () =>
      renderUi
        ? collectFileOptionReservationTagGroups(
            transformation.rows.map((row) => ({
              itemName: row.source.itemName,
              itemTags: row.itemTags,
            })),
          )
        : [],
    [renderUi, transformation.rows],
  )
  const visibleTagGroups = useMemo(() => {
    const groups: Array<FileTagGroup | FileOptionReservationTagGroup> = []
    const seen = new Set<string>()
    for (const group of [...fileTags, ...optionTagGroups]) {
      if (seen.has(group.tag.key)) continue
      seen.add(group.tag.key)
      groups.push(group)
    }
    return groups
  }, [fileTags, optionTagGroups])
  const unknownTagCount = visibleTagGroups.filter(
    (group) => group.tag.role === 'unknown',
  ).length
  /** 저장 전 화면에서만 고른 역할. 키는 tag.key */
  const [draftRoles, setDraftRoles] = useState<
    Record<string, InvoiceProductNameTagRole>
  >({})
  const [tagSaveMessage, setTagSaveMessage] = useState('')
  const [tagSaveError, setTagSaveError] = useState('')
  const [tagSaveErrors, setTagSaveErrors] = useState<Record<string, string>>(
    {},
  )
  const [tagView, setTagView] = useState<'product' | 'option'>('product')
  const [unsetTagsOpen, setUnsetTagsOpen] = useState(true)
  const [setTagsOpen, setSetTagsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const baselineRoles = useMemo(() => {
    const map: Record<string, InvoiceProductNameTagRole> = {}
    for (const group of visibleTagGroups) {
      map[group.tag.key] = group.tag.role
    }
    return map
  }, [visibleTagGroups])

  const { unsetTags, setTags } = useMemo(() => {
    const unset: FileTagGroup[] = []
    const set: FileTagGroup[] = []
    for (const group of fileTags) {
      if ((baselineRoles[group.tag.key] ?? group.tag.role) === 'unknown') {
        unset.push(group)
      } else {
        set.push(group)
      }
    }
    return { unsetTags: unset, setTags: set }
  }, [baselineRoles, fileTags])

  const { unsetOptionTags, setOptionTags } = useMemo(() => {
    const unset: FileOptionReservationTagGroup[] = []
    const set: FileOptionReservationTagGroup[] = []
    for (const group of optionTagGroups) {
      if ((baselineRoles[group.tag.key] ?? group.tag.role) === 'unknown') {
        unset.push(group)
      } else {
        set.push(group)
      }
    }
    return { unsetOptionTags: unset, setOptionTags: set }
  }, [baselineRoles, optionTagGroups])

  const pendingTagChanges = useMemo(() => {
    const changes: {
      key: string
      tagText: string
      role: InvoiceProductNameTagRole
    }[] = []
    for (const group of visibleTagGroups) {
      const next = draftRoles[group.tag.key]
      if (next === undefined) continue
      if (next === baselineRoles[group.tag.key]) continue
      changes.push({
        key: group.tag.key,
        tagText: group.tag.raw,
        role: next,
      })
    }
    return changes
  }, [baselineRoles, draftRoles, visibleTagGroups])
  const showProductTags = fileTags.length > 0
  const showOptionTags = optionTagGroups.length > 0
  const activeTagView =
    showProductTags && showOptionTags
      ? tagView
      : showOptionTags
        ? 'option'
        : 'product'

  const tagSaveMutation = useMutation({
    mutationFn: async (
      changes: {
        key: string
        tagText: string
        role: InvoiceProductNameTagRole
      }[],
    ) => {
      const failures: { key: string; tagText: string; message: string }[] = []
      const succeeded: string[] = []
      await Promise.all(
        changes.map(async (change) => {
          try {
            await saveInvoiceProductNameTagRole(brandId, {
              tagText: change.tagText,
              role: change.role,
            })
            succeeded.push(change.key)
          } catch (error) {
            failures.push({
              key: change.key,
              tagText: change.tagText,
              message:
                error instanceof Error
                  ? error.message
                  : '저장하지 못했습니다.',
            })
          }
        }),
      )
      return { succeeded, failures }
    },
    onSuccess: async ({ succeeded, failures }) => {
      if (succeeded.length > 0) {
        setDraftRoles((current) => {
          const next = { ...current }
          for (const key of succeeded) delete next[key]
          return next
        })
        await queryClient.invalidateQueries({
          queryKey: ['invoice-product-name-tag-roles', brandId],
        })
        await queryClient.invalidateQueries({
          queryKey: ['ai-product-recommendation', brandId],
          refetchType: 'none',
        })
      }
      const nextErrors: Record<string, string> = {}
      for (const failure of failures) {
        nextErrors[failure.key] = failure.message
      }
      setTagSaveErrors(nextErrors)
      if (failures.length === 0) {
        setTagSaveError('')
        setTagSaveMessage(
          succeeded.length > 0
            ? `태그 ${formatNumber(succeeded.length)}개 역할을 저장했습니다.`
            : '',
        )
        return
      }
      setTagSaveMessage(
        succeeded.length > 0
          ? `태그 ${formatNumber(succeeded.length)}개는 저장됐고 ${formatNumber(failures.length)}개는 실패했습니다.`
          : '',
      )
      setTagSaveError(
        failures
          .map((failure) => `${failure.tagText}: ${failure.message}`)
          .join(' · '),
      )
    },
    onError: (error) => {
      setTagSaveMessage('')
      setTagSaveError(
        error instanceof Error ? error.message : '태그 역할을 저장하지 못했습니다.',
      )
    },
  })

  function changeTagRole(key: string, next: InvoiceProductNameTagRole) {
    setTagSaveMessage('')
    setTagSaveError('')
    setTagSaveErrors((current) => {
      if (!current[key]) return current
      const updated = { ...current }
      delete updated[key]
      return updated
    })
    setDraftRoles((current) => {
      const baseline = baselineRoles[key]!
      if (next === baseline) {
        if (!(key in current)) return current
        const updated = { ...current }
        delete updated[key]
        return updated
      }
      return { ...current, [key]: next }
    })
  }

  const rows = useMemo(() => {
    if (!renderUi || !previewOpen) return []
    const q = deferredQuery.trim().toLocaleLowerCase('ko-KR')
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
  }, [deferredQuery, previewOpen, renderUi, status, transformation.rows])
  const previewPage = useInvoiceTablePage(
    rows,
    `${deferredQuery}\u0001${status}`,
  )

  if (!renderUi) return null

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge variant="success">
          자동 완료 {formatNumber(transformation.mappedRowCount)}행
        </Badge>
        <Badge variant="outline">
          후보 {formatNumber(transformation.candidateRowCount)}행
        </Badge>
        <Badge variant="warning">
          M번호 발급 필요 {formatNumber(transformation.missingStyleRowCount)}행
        </Badge>
        <Badge variant="warning">
          충돌 {formatNumber(transformation.conflictRowCount)}행
        </Badge>
        <Badge variant="danger">
          검토 필요 {formatNumber(transformation.unresolvedRowCount)}행
        </Badge>
        <Badge variant="muted">
          상품 연결 예외 {formatNumber(transformation.excludedRowCount)}행
        </Badge>
        <Badge variant="warning">
          예외 보류 {formatNumber(transformation.exclusionGuardedRowCount)}행
        </Badge>
        {transformation.giftMappedRowCount > 0 ? (
          <Badge variant="success">
            사은품 변환 완료 {formatNumber(transformation.giftMappedRowCount)}행
          </Badge>
        ) : null}
      </div>

      {showProductTags || showOptionTags ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <div>
            <p className="text-sm font-medium">
              이 파일 태그 {formatNumber(visibleTagGroups.length)}개
              {unknownTagCount > 0
                ? ` · 미분류 ${formatNumber(unknownTagCount)}개`
                : ''}
              {pendingTagChanges.length > 0
                ? ` · 변경 ${formatNumber(pendingTagChanges.length)}개`
                : ''}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {activeTagView === 'option'
                ? '옵션 안의 날짜 예약배송만 비교에서 빼고, 원문 내품명은 유지합니다. 한 번 저장하면 날짜가 바뀌어도 같은 계열로 적용됩니다.'
                : '상품 구성 태그만 비교에 남기고, 행사·증정·상품 특징 태그는 비교에서 뺍니다.'}{' '}
              역할을 고른 뒤 아래 저장을 누르면 한 번에 반영됩니다. 저장 전에는
              아래 품목 목록이 바뀌지 않습니다.
            </p>
          </div>
          {showProductTags && showOptionTags ? (
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ['product', `품목명 앞 태그 ${formatNumber(fileTags.length)}`],
                  [
                    'option',
                    `옵션 예약배송 태그 ${formatNumber(optionTagGroups.length)}`,
                  ],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    activeTagView === value
                      ? 'border-foreground text-foreground'
                      : 'border-border text-muted-foreground'
                  }`}
                  onClick={() => setTagView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {activeTagView === 'product' ? (
            <>
              {unsetTags.length > 0 ? (
                <TagRoleSection
                  title={`미설정 ${formatNumber(unsetTags.length)}개`}
                  open={unsetTagsOpen}
                  onToggle={() => setUnsetTagsOpen((current) => !current)}
                >
                  {unsetTags.map((group) => (
                    <ProductNameTagRoleControl
                      key={group.tag.key}
                      tag={group.tag}
                      role={
                        draftRoles[group.tag.key] ??
                        baselineRoles[group.tag.key]!
                      }
                      disabled={tagSaveMutation.isPending}
                      count={group.productCount}
                      countLabel="개 상품"
                      variantCount={group.variantCount}
                      examples={group.examples}
                      error={tagSaveErrors[group.tag.key]}
                      onRoleChange={(next) =>
                        changeTagRole(group.tag.key, next)
                      }
                    />
                  ))}
                </TagRoleSection>
              ) : null}
              {setTags.length > 0 ? (
                <TagRoleSection
                  title={`설정됨 ${formatNumber(setTags.length)}개`}
                  open={setTagsOpen}
                  onToggle={() => setSetTagsOpen((current) => !current)}
                >
                  {setTags.map((group) => (
                    <ProductNameTagRoleControl
                      key={group.tag.key}
                      tag={group.tag}
                      role={
                        draftRoles[group.tag.key] ??
                        baselineRoles[group.tag.key]!
                      }
                      disabled={tagSaveMutation.isPending}
                      count={group.productCount}
                      countLabel="개 상품"
                      variantCount={group.variantCount}
                      examples={group.examples}
                      error={tagSaveErrors[group.tag.key]}
                      onRoleChange={(next) =>
                        changeTagRole(group.tag.key, next)
                      }
                    />
                  ))}
                </TagRoleSection>
              ) : null}
            </>
          ) : (
            <>
              {unsetOptionTags.length > 0 ? (
                <TagRoleSection
                  title={`미설정 ${formatNumber(unsetOptionTags.length)}개`}
                  open={unsetTagsOpen}
                  onToggle={() => setUnsetTagsOpen((current) => !current)}
                >
                  {unsetOptionTags.map((group) => (
                    <ProductNameTagRoleControl
                      key={`option-${group.tag.key}`}
                      tag={group.tag}
                      role={
                        draftRoles[group.tag.key] ??
                        baselineRoles[group.tag.key]!
                      }
                      disabled={tagSaveMutation.isPending}
                      count={group.itemCount}
                      countLabel="개 옵션"
                      variantCount={group.variantCount}
                      examples={group.examples}
                      previews={group.previews}
                      source="option"
                      error={tagSaveErrors[group.tag.key]}
                      onRoleChange={(next) =>
                        changeTagRole(group.tag.key, next)
                      }
                    />
                  ))}
                </TagRoleSection>
              ) : null}
              {setOptionTags.length > 0 ? (
                <TagRoleSection
                  title={`설정됨 ${formatNumber(setOptionTags.length)}개`}
                  open={setTagsOpen}
                  onToggle={() => setSetTagsOpen((current) => !current)}
                >
                  {setOptionTags.map((group) => (
                    <ProductNameTagRoleControl
                      key={`option-${group.tag.key}`}
                      tag={group.tag}
                      role={
                        draftRoles[group.tag.key] ??
                        baselineRoles[group.tag.key]!
                      }
                      disabled={tagSaveMutation.isPending}
                      count={group.itemCount}
                      countLabel="개 옵션"
                      variantCount={group.variantCount}
                      examples={group.examples}
                      previews={group.previews}
                      source="option"
                      error={tagSaveErrors[group.tag.key]}
                      onRoleChange={(next) =>
                        changeTagRole(group.tag.key, next)
                      }
                    />
                  ))}
                </TagRoleSection>
              ) : null}
            </>
          )}
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              {tagSaveMessage ? (
                <p className="text-xs text-success">{tagSaveMessage}</p>
              ) : null}
              {tagSaveError ? (
                <p className="text-xs text-danger">{tagSaveError}</p>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={
                pendingTagChanges.length === 0 || tagSaveMutation.isPending
              }
              onClick={() => {
                setTagSaveMessage('')
                setTagSaveError('')
                tagSaveMutation.mutate(pendingTagChanges)
              }}
            >
              {tagSaveMutation.isPending
                ? '저장 중...'
                : pendingTagChanges.length > 0
                  ? `저장 ${formatNumber(pendingTagChanges.length)}`
                  : '저장'}
            </Button>
          </div>
        </div>
      ) : null}

      <InvoiceProductNameRecentSavesPanel
        brandId={brandId}
        history={history}
        onCorrect={({ historyId, lookupKey, style, extras }) => {
          const entry = history.find((item) => item.id === historyId)
          if (!entry) return
          enqueue({
            historyId,
            comboKey: entry.comboKey,
            productName: entry.productName,
            itemName: entry.itemName,
            originalItemName: entry.originalItemName,
            mallName: entry.mallName,
            ownProductCode: entry.ownProductCode,
            lookupKey,
            style,
            extras,
            appliedRule: entry.appliedRule,
            feedback: {
              source: 'manual',
              cacheId: null,
              shownRank: null,
              provider: null,
              modelId: null,
              suggestedStyleId: entry.feedback.suggestedStyleId ?? null,
              outcome: decideProductNameFeedbackOutcome({
                suggestedStyleId: entry.feedback.suggestedStyleId,
                finalStyleId: style.styleId,
              }),
            },
            reviewReasons: entry.reviewReasons,
          })
        }}
        onUndo={undo}
      />

      {transformation.unresolvedCombos.length > 0 ||
      savingCount > 0 ||
      failedCount > 0 ? (
        <InvoiceProductNameAiApplyBar
          bulk={bulk}
          history={history}
          onExclude={excludeCombo}
          excludePending={excludeMutation.isPending}
          excludeError={
            excludeMutation.error instanceof Error
              ? excludeMutation.error.message
              : excludeMutation.error
                ? '상품 연결 예외 기준을 저장하지 못했습니다.'
                : null
          }
          giftGroups={giftGroups}
          onOpenGiftSetup={onOpenGiftSetup}
        />
      ) : (
        <p className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
          이 파일의 품목명은 모두 본품 기준으로 연결됐습니다.
        </p>
      )}

      <div className="space-y-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setPreviewOpen((open) => !open)}
        >
          {previewOpen
            ? '전체 행 미리보기 접기'
            : `전체 행 미리보기 ${formatNumber(rows.length)}`}
        </Button>
        {previewOpen ? (
          <>
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
                <option value="excluded">상품 연결 예외</option>
                <option value="exclusion_guarded">예외 보류</option>
                <option value="gift_pending">사은품 처리 필요</option>
                <option value="gift_mapped">사은품 변환 완료</option>
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
                  {previewPage.pageItems.map((row) => {
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
            <InvoiceTablePager
              page={previewPage.page}
              pageCount={previewPage.pageCount}
              total={rows.length}
              startIndex={previewPage.startIndex}
              pageItemCount={previewPage.pageItems.length}
              onPage={previewPage.setPage}
            />
          </>
        ) : null}
      </div>
    </div>
  )
})

function TagRoleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-medium">{title}</span>
        <span className="text-[11px] text-muted-foreground">
          {open ? '접기' : '펼치기'}
        </span>
      </button>
      {open ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {children}
        </div>
      ) : null}
    </div>
  )
}

function ProductNameTagRoleControl({
  tag,
  role,
  disabled = false,
  count,
  countLabel = '개 상품',
  variantCount = 1,
  examples = [],
  previews = [],
  source = 'product',
  error,
  onRoleChange,
}: {
  tag: ParsedProductNameTag
  role: InvoiceProductNameTagRole
  disabled?: boolean
  count: number
  countLabel?: string
  variantCount?: number
  examples?: string[]
  previews?: Array<{ raw: string; matching: string }>
  source?: 'product' | 'option'
  error?: string
  onRoleChange: (role: InvoiceProductNameTagRole) => void
}) {
  const showHint = role === 'unknown' && tag.suggestedRole !== 'unknown'

  return (
    <div className="flex h-full min-w-0 flex-col gap-2 rounded-md border border-border bg-background/80 p-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <Badge variant="outline" className="max-w-full truncate">
          {tag.raw}
        </Badge>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatNumber(count)}
          {countLabel}
          {variantCount > 1 ? ` · 날짜 ${formatNumber(variantCount)}` : ''}
        </span>
      </div>
      <Select
        value={role}
        disabled={disabled}
        className="h-8 w-full px-2 text-xs"
        onChange={(event) => {
          const next = event.target.value as InvoiceProductNameTagRole
          if (next === role) return
          onRoleChange(next)
        }}
      >
        {TAG_ROLES.map((option) => (
          <option key={option} value={option}>
            {INVOICE_PRODUCT_NAME_TAG_ROLE_LABEL[option]}
          </option>
        ))}
      </Select>
      <div className="mt-auto space-y-1">
        {examples.length > 0 ? (
          <p className="line-clamp-2 text-[11px] text-muted-foreground">
            예: {examples.join(', ')}
          </p>
        ) : null}
        {previews.length > 0 ? (
          <div className="space-y-1">
            {previews.map((preview) => (
              <p
                key={preview.raw}
                className="line-clamp-3 text-[11px] text-muted-foreground"
              >
                원문 {preview.raw}
                <br />
                비교 {preview.matching}
              </p>
            ))}
          </div>
        ) : null}
        {showHint ? (
          <p className="text-[11px] text-muted-foreground">
            추천: {INVOICE_PRODUCT_NAME_TAG_ROLE_LABEL[tag.suggestedRole]}
          </p>
        ) : null}
        {role === 'product_composition' ? (
          <p className="text-[11px] text-muted-foreground">
            비교 키에 남깁니다. 출고구성은 바꾸지 않습니다.
          </p>
        ) : null}
        {role === 'event_marketing' ||
        role === 'composition_gift' ||
        role === 'identity_condition' ? (
          <p className="text-[11px] text-muted-foreground">
            비교에서 제외합니다.{' '}
            {source === 'option'
              ? '원문 내품명은 유지합니다.'
              : '원문 품목명은 유지합니다.'}
          </p>
        ) : null}
        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      </div>
    </div>
  )
}
