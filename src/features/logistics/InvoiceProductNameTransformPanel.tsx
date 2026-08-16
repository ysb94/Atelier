import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  saveInvoiceProductNameTagRole,
  searchInvoiceProductCandidates,
} from '@/lib/api'
import type {
  InvoiceProductNameMatchStatus,
  InvoiceProductNameTransformation,
  UnresolvedProductNameCombo,
} from '@/lib/invoice/product-name-transform'
import {
  collectFileTagGroups,
  type FileTagGroup,
  type ParsedProductNameTag,
} from '@/lib/invoice/product-name-tags'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type {
  AiProductRecommendation,
  InvoiceProductNameMap,
  InvoiceProductNameTagRole,
  StyleRef,
} from '@/lib/types'
import { INVOICE_PRODUCT_NAME_TAG_ROLE_LABEL } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { InvoiceProductNameRecentSavesPanel } from './InvoiceProductNameRecentSavesPanel'
import {
  useInvoiceProductNameSaveQueue,
  type ProductMapEnqueueInput,
  type ProductMapSaveDraft,
  type ProductMapSaveFeedback,
} from './useInvoiceProductNameSaveQueue'

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
  compact: '기호·공백 정리',
  style_parts: '제품군·색상 조합',
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

function buildReviewReasons(input: {
  combo: UnresolvedProductNameCombo
  lookupKey: string
  style: StyleRef
  selectedRule: string | null
  feedback: ProductMapSaveFeedback
  previousMap: InvoiceProductNameMap | null
  variantCount: number
}): string[] {
  const reasons: string[] = []
  if (input.combo.status === 'conflict') reasons.push('충돌')
  if (input.selectedRule === 'compact') reasons.push('기호·공백 매칭')
  if (
    input.previousMap &&
    input.previousMap.style.styleId !== input.style.styleId
  ) {
    reasons.push('기존 M번호 변경')
  }
  if (input.feedback.source === 'ai') reasons.push('AI 추천')
  const productOnly =
    input.selectedRule === 'product' ||
    normalizeInvoiceText(input.lookupKey) ===
      normalizeInvoiceText(input.combo.productName)
  if (productOnly && input.variantCount > 1) {
    reasons.push('품목명 단독·여러 변형')
  }
  return reasons
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

const TAG_ROLES: InvoiceProductNameTagRole[] = [
  'event_marketing',
  'composition_gift',
  'identity_condition',
  'unknown',
]


export function InvoiceProductNameTransformPanel({
  brandId,
  transformation,
}: {
  brandId: string
  transformation: InvoiceProductNameTransformation
}) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | InvoiceProductNameMatchStatus>(
    'all',
  )
  const {
    history,
    activeComboKeys,
    failedDrafts,
    savingCount,
    failedCount,
    enqueue,
    undo,
  } = useInvoiceProductNameSaveQueue(brandId)

  const visibleCombos = useMemo(
    () =>
      transformation.unresolvedCombos.filter((combo) => {
        if (failedDrafts[combo.key]) return true
        return !activeComboKeys.has(combo.key)
      }),
    [activeComboKeys, failedDrafts, transformation.unresolvedCombos],
  )
  const groups = useMemo(() => groupCombos(visibleCombos), [visibleCombos])
  const [openProductName, setOpenProductName] = useState<string | null>(
    groups[0]?.productName ?? null,
  )

  useEffect(() => {
    if (openProductName) {
      const stillOpen = groups.some(
        (group) => group.productName === openProductName,
      )
      if (stillOpen) return
    }
    setOpenProductName(groups[0]?.productName ?? null)
  }, [groups, openProductName])

  const fileTags = useMemo(
    () =>
      collectFileTagGroups(
        transformation.rows.map((row) => ({
          productName: row.source.productName,
          tags: row.tags,
        })),
      ),
    [transformation.rows],
  )
  const unknownTagCount = fileTags.filter((tag) => tag.tag.role === 'unknown')
    .length
  /** 저장 전 화면에서만 고른 역할. 키는 tag.key */
  const [draftRoles, setDraftRoles] = useState<
    Record<string, InvoiceProductNameTagRole>
  >({})
  const [tagSaveMessage, setTagSaveMessage] = useState('')
  const [tagSaveError, setTagSaveError] = useState('')
  const [tagSaveErrors, setTagSaveErrors] = useState<Record<string, string>>(
    {},
  )
  const [unsetTagsOpen, setUnsetTagsOpen] = useState(true)
  const [setTagsOpen, setSetTagsOpen] = useState(false)

  const baselineRoles = useMemo(() => {
    const map: Record<string, InvoiceProductNameTagRole> = {}
    for (const group of fileTags) {
      map[group.tag.key] = group.tag.role
    }
    return map
  }, [fileTags])

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

  const pendingTagChanges = useMemo(() => {
    const changes: {
      key: string
      tagText: string
      role: InvoiceProductNameTagRole
    }[] = []
    for (const group of fileTags) {
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
  }, [baselineRoles, draftRoles, fileTags])

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

      {fileTags.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <div>
            <p className="text-sm font-medium">
              이 파일 태그 {formatNumber(fileTags.length)}개
              {unknownTagCount > 0
                ? ` · 미분류 ${formatNumber(unknownTagCount)}개`
                : ''}
              {pendingTagChanges.length > 0
                ? ` · 변경 ${formatNumber(pendingTagChanges.length)}개`
                : ''}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              역할을 고른 뒤 아래 저장을 누르면 한 번에 반영됩니다. 저장
              전에는 아래 품목 목록이 바뀌지 않습니다.
            </p>
          </div>
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
                  role={draftRoles[group.tag.key] ?? baselineRoles[group.tag.key]!}
                  disabled={tagSaveMutation.isPending}
                  productCount={group.productCount}
                  variantCount={group.variantCount}
                  examples={group.examples}
                  error={tagSaveErrors[group.tag.key]}
                  onRoleChange={(next) => changeTagRole(group.tag.key, next)}
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
                  role={draftRoles[group.tag.key] ?? baselineRoles[group.tag.key]!}
                  disabled={tagSaveMutation.isPending}
                  productCount={group.productCount}
                  variantCount={group.variantCount}
                  examples={group.examples}
                  error={tagSaveErrors[group.tag.key]}
                  onRoleChange={(next) => changeTagRole(group.tag.key, next)}
                />
              ))}
            </TagRoleSection>
          ) : null}
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
        onCorrect={({ historyId, lookupKey, style }) => {
          const entry = history.find((item) => item.id === historyId)
          if (!entry) return
          enqueue({
            historyId,
            comboKey: entry.comboKey,
            productName: entry.productName,
            itemName: entry.itemName,
            mallName: entry.mallName,
            lookupKey,
            style,
            appliedRule: entry.appliedRule,
            feedback: {
              source: 'manual',
              cacheId: null,
              shownRank: null,
              provider: null,
              modelId: null,
            },
            reviewReasons: entry.reviewReasons,
          })
        }}
        onUndo={undo}
      />

      {groups.length > 0 || savingCount > 0 || failedCount > 0 ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              본품 확인 {formatNumber(groups.length)}개 품목 · 내품명{' '}
              {formatNumber(visibleCombos.length)}개
              {savingCount > 0
                ? ` · 저장 중 ${formatNumber(savingCount)}개`
                : ''}
              {failedCount > 0
                ? ` · 실패 ${formatNumber(failedCount)}개`
                : ''}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              등록을 누르면 바로 다음 항목으로 넘어가고, 저장은 뒤에서
              이어집니다. 실패한 항목만 다시 나타납니다.
            </p>
            {failedCount > 0 ? (
              <p className="mt-1 text-xs text-danger">
                {Object.values(failedDrafts)
                  .slice(0, 3)
                  .map((draft) => draft.error)
                  .join(' · ')}
                {failedCount > 3
                  ? ` 외 ${formatNumber(failedCount - 3)}건`
                  : ''}
              </p>
            ) : null}
          </div>
          {groups.length > 0 ? (
            <div className="space-y-2">
              {groups.map((group) => (
                <ProductReviewGroupCard
                  key={group.productName}
                  brandId={brandId}
                  group={group}
                  open={openProductName === group.productName}
                  drafts={Object.fromEntries(
                    group.combos.flatMap((combo) => {
                      const draft = failedDrafts[combo.key]
                      if (!draft) return []
                      return [[combo.key, draft]]
                    }),
                  )}
                  onEnqueue={enqueue}
                  onToggle={() =>
                    setOpenProductName((current) =>
                      current === group.productName ? null : group.productName,
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              선택하신 항목을 저장하는 중입니다.
            </p>
          )}
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
  productCount,
  variantCount = 1,
  examples = [],
  error,
  onRoleChange,
}: {
  tag: ParsedProductNameTag
  role: InvoiceProductNameTagRole
  disabled?: boolean
  productCount: number
  variantCount?: number
  examples?: string[]
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
          {formatNumber(productCount)}개 상품
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
        {showHint ? (
          <p className="text-[11px] text-muted-foreground">
            추천: {INVOICE_PRODUCT_NAME_TAG_ROLE_LABEL[tag.suggestedRole]}
          </p>
        ) : null}
        {role === 'composition_gift' ? (
          <p className="text-[11px] text-muted-foreground">
            상품 인식에만 반영하며 출고구성은 바꾸지 않습니다.
          </p>
        ) : null}
        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      </div>
    </div>
  )
}

function ProductReviewGroupCard({
  brandId,
  group,
  open,
  drafts,
  onEnqueue,
  onToggle,
}: {
  brandId: string
  group: ProductReviewGroup
  open: boolean
  drafts: Record<string, ProductMapSaveDraft>
  onEnqueue: (job: ProductMapEnqueueInput) => void
  onToggle: () => void
}) {
  const variantCount = group.combos.length
  const tags = group.combos[0]?.tags ?? []

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
          {tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge key={`${tag.key}:${tag.raw}`} variant="outline">
                  {tag.raw} · {INVOICE_PRODUCT_NAME_TAG_ROLE_LABEL[tag.role]}
                </Badge>
              ))}
            </div>
          ) : null}
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
                key={
                  drafts[combo.key]
                    ? `${combo.key}:fail:${drafts[combo.key]!.error}`
                    : combo.key
                }
                brandId={brandId}
                combo={combo}
                draft={drafts[combo.key] ?? null}
                variantCount={variantCount}
                onEnqueue={onEnqueue}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 엔진이 실제로 맞춘 규칙의 후보를 기본 조회 키로 둔다.
 * 분해 매칭처럼 후보 규칙 밖에서 맞은 경우는 시트 열 우선순위 첫 후보를 쓴다.
 */
function pickDefaultLookupKey(combo: UnresolvedProductNameCombo): string {
  if (combo.candidates.length === 0) return ''
  const byRule = combo.appliedRule
    ? combo.candidates.find((candidate) => candidate.rule === combo.appliedRule)
    : undefined
  return (byRule ?? combo.candidates[0]!).text
}

function VariantAssignRow({
  brandId,
  combo,
  draft,
  variantCount,
  onEnqueue,
}: {
  brandId: string
  combo: UnresolvedProductNameCombo
  draft: ProductMapSaveDraft | null
  variantCount: number
  onEnqueue: (job: ProductMapEnqueueInput) => void
}) {
  const queryClient = useQueryClient()
  // 후보가 여럿인 충돌 행은 임의로 고르지 않는다. 사람이 반드시 지목해야 한다.
  const autoStyle =
    combo.candidateStyles.length === 1 ? combo.candidateStyles[0]! : null
  const [selectedLookupKey, setSelectedLookupKey] = useState(
    () => draft?.lookupKey ?? pickDefaultLookupKey(combo),
  )
  const [style, setStyle] = useState<StyleRef | null>(
    () => draft?.style ?? autoStyle,
  )
  const [lookupTouched, setLookupTouched] = useState(Boolean(draft?.lookupKey))
  const [styleTouched, setStyleTouched] = useState(Boolean(draft?.style))
  const [pickedRecommendation, setPickedRecommendation] =
    useState<AiProductRecommendation | null>(null)
  const [localError, setLocalError] = useState<string | null>(draft?.error ?? null)
  const meta = STATUS_META[combo.status]

  function clearDraftMessage() {
    setLocalError(null)
    setPickedRecommendation(null)
  }

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
                      title={`${candidate.text} · ${ruleLabel(candidate.rule)}`}
                      className={`w-full truncate rounded px-1 text-left ${
                        selected
                          ? 'bg-primary/10 font-medium'
                          : 'hover:bg-muted/40'
                      }`}
                      onClick={() => {
                        setSelectedLookupKey(candidate.text)
                        setLookupTouched(true)
                        clearDraftMessage()
                      }}
                    >
                      <span
                        className={selected ? 'text-primary' : 'text-foreground'}
                      >
                        {selected ? '✓ ' : ''}
                        {candidate.text}
                      </span>{' '}
                      · {ruleLabel(candidate.rule)}
                      {selected && !lookupTouched ? (
                        <span className="ml-1 text-primary/70">· 자동 선택</span>
                      ) : null}
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
                onChange={(next) => {
                  setStyle(next)
                  setStyleTouched(true)
                  clearDraftMessage()
                }}
                placeholder="본품 1개만 고르세요"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!selectedLookupKey || !style}
              onClick={() => {
                if (!selectedLookupKey || !style) return
                const shownRank = pickedRecommendation?.products.findIndex(
                  (product) => product.styleId === style.styleId,
                )
                const usedRecommendation =
                  pickedRecommendation &&
                  pickedRecommendation.lookupKey === selectedLookupKey &&
                  shownRank !== undefined &&
                  shownRank >= 0
                const feedback: ProductMapSaveFeedback = {
                  source: usedRecommendation
                    ? pickedRecommendation.source === 'local'
                      ? 'local'
                      : 'ai'
                    : 'manual',
                  cacheId: usedRecommendation
                    ? pickedRecommendation.cacheId
                    : null,
                  shownRank: usedRecommendation ? shownRank + 1 : null,
                  provider: usedRecommendation
                    ? pickedRecommendation.provider
                    : null,
                  modelId: usedRecommendation
                    ? pickedRecommendation.modelId
                    : null,
                }
                const selectedRule =
                  combo.candidates.find(
                    (candidate) => candidate.text === selectedLookupKey,
                  )?.rule ?? combo.appliedRule
                const maps =
                  queryClient.getQueryData<InvoiceProductNameMap[]>([
                    'invoice-product-name-maps',
                    brandId,
                  ]) ?? []
                const lookupNorm = normalizeInvoiceText(selectedLookupKey)
                const previousMap =
                  maps.find(
                    (map) => map.normalizedLookupKey === lookupNorm,
                  ) ?? null
                onEnqueue({
                  comboKey: combo.key,
                  productName: combo.productName,
                  itemName: combo.itemName,
                  mallName: combo.mallName,
                  lookupKey: selectedLookupKey,
                  style,
                  appliedRule: selectedRule,
                  feedback,
                  reviewReasons: buildReviewReasons({
                    combo,
                    lookupKey: selectedLookupKey,
                    style,
                    selectedRule,
                    feedback,
                    previousMap,
                    variantCount,
                  }),
                })
              }}
            >
              등록
            </Button>
          </div>
          {localError ? (
            <p className="mt-1 text-xs text-danger">{localError}</p>
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
          disabled={false}
          onPick={({ lookupKey, nextStyle, recommendation }) => {
            setSelectedLookupKey(lookupKey)
            setLookupTouched(true)
            if (nextStyle) {
              setStyle(nextStyle)
              setStyleTouched(true)
            }
            setPickedRecommendation(recommendation)
            setLocalError(null)
          }}
          onAutoFill={({ lookupKey, nextStyle, recommendation }) => {
            // 사람이 이미 고른 칸은 절대 덮지 않는다.
            let filled = false
            if (!lookupTouched && lookupKey) {
              setSelectedLookupKey(lookupKey)
              filled = true
            }
            if (!styleTouched && !style && nextStyle) {
              setStyle(nextStyle)
              filled = true
            }
            if (filled) setPickedRecommendation(recommendation)
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
  onAutoFill,
}: {
  brandId: string
  combo: UnresolvedProductNameCombo
  disabled: boolean
  onPick: (next: {
    lookupKey: string
    nextStyle?: StyleRef
    recommendation: AiProductRecommendation
  }) => void
  onAutoFill?: (next: {
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

  const autoFillRef = useRef(onAutoFill)
  autoFillRef.current = onAutoFill
  useEffect(() => {
    if (!recommendation) return
    const first = recommendation.products[0]
    autoFillRef.current?.({
      lookupKey: recommendation.lookupKey,
      recommendation,
      nextStyle: first
        ? { styleId: first.styleId, styleNo: first.styleNo, name: first.name }
        : undefined,
    })
  }, [recommendation])

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
