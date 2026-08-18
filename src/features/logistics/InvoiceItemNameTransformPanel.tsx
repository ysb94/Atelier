import { useEffect, useMemo, useRef, useState } from 'react'
import { formatStyleRef } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type {
  InvoiceItemNameMatchStatus,
  InvoiceItemNameTransformation,
  UnresolvedItemNameCombo,
} from '@/lib/invoice/item-name-transform'
import { formatOptionItemName } from '@/lib/invoice/option-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type {
  InvoiceItemNameRule,
  InvoiceItemNameRuleScope,
  StyleRef,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { InvoiceItemNameRuleForm } from './InvoiceItemNameRuleForm'

const STATUS_META: Record<
  InvoiceItemNameMatchStatus,
  { label: string; variant: 'success' | 'default' | 'warning' | 'danger' }
> = {
  mapped: { label: '내품명 기준 적용', variant: 'success' },
  consumed: { label: '본품 식별 후 비움', variant: 'success' },
  deleted: { label: '내품명 지움', variant: 'success' },
  passthrough: { label: '미설정·원문 유지', variant: 'danger' },
  unresolved: { label: '검토 필요', variant: 'danger' },
  conflict: { label: '충돌', variant: 'warning' },
}

type ItemReviewGroup = {
  key: string
  itemName: string
  combos: UnresolvedItemNameCombo[]
  productCount: number
  rowCount: number
  status: 'passthrough' | 'conflict'
}

type MainBucket = {
  key: string
  style: StyleRef | null
  combos: UnresolvedItemNameCombo[]
  rowCount: number
}

function bucketKeyOf(combo: UnresolvedItemNameCombo) {
  return combo.productStyle?.styleId ?? '__none__'
}

function groupBuckets(combos: UnresolvedItemNameCombo[]): MainBucket[] {
  const byStyle = new Map<string, UnresolvedItemNameCombo[]>()
  for (const combo of combos) {
    const key = bucketKeyOf(combo)
    const list = byStyle.get(key) ?? []
    list.push(combo)
    byStyle.set(key, list)
  }
  return [...byStyle.entries()]
    .map(([key, items]) => ({
      key,
      style: items.find((item) => item.productStyle)?.productStyle ?? null,
      combos: items,
      rowCount: items.reduce((sum, item) => sum + item.rowCount, 0),
    }))
    .sort((left, right) => {
      if (left.key === '__none__') return 1
      if (right.key === '__none__') return -1
      return (
        right.rowCount - left.rowCount ||
        (left.style?.styleNo ?? '').localeCompare(right.style?.styleNo ?? '', 'ko-KR')
      )
    })
}

function findItemNameRule(
  rules: InvoiceItemNameRule[],
  itemName: string,
  scope: InvoiceItemNameRuleScope,
  mainStyleId: string | null,
) {
  const item = normalizeInvoiceText(itemName)
  return (
    rules.find((rule) => {
      if (!rule.isActive || rule.scope !== scope) return false
      if (rule.normalizedItemName !== item) return false
      if (scope === 'global') return true
      return Boolean(mainStyleId) && rule.mainStyle?.styleId === mainStyleId
    }) ?? null
  )
}

function groupKeyOf(combo: UnresolvedItemNameCombo) {
  return normalizeInvoiceText(combo.itemName) || '__empty__'
}

function summarizeGroup(combos: UnresolvedItemNameCombo[]): Omit<
  ItemReviewGroup,
  'key' | 'itemName'
> {
  return {
    combos,
    productCount: new Set(
      combos.map((combo) => normalizeInvoiceText(combo.productName)),
    ).size,
    rowCount: combos.reduce((sum, combo) => sum + combo.rowCount, 0),
    status: combos.some((combo) => combo.status === 'conflict')
      ? 'conflict'
      : 'passthrough',
  }
}

function groupCombos(combos: UnresolvedItemNameCombo[]): ItemReviewGroup[] {
  const byItem = new Map<string, UnresolvedItemNameCombo[]>()
  for (const combo of combos) {
    const key = groupKeyOf(combo)
    const list = byItem.get(key) ?? []
    list.push(combo)
    byItem.set(key, list)
  }
  return [...byItem.entries()]
    .map(([key, items]) => ({
      key,
      itemName: items[0]!.itemName,
      ...summarizeGroup(items),
    }))
    .sort(
      (left, right) =>
        right.rowCount - left.rowCount ||
        left.itemName.localeCompare(right.itemName, 'ko-KR'),
    )
}

function comboMatchesQuery(combo: UnresolvedItemNameCombo, query: string) {
  if (!query) return true
  return [
    combo.itemName,
    combo.productName,
    combo.originalItemName,
    combo.mallName,
    combo.ownProductCode,
    combo.productStyle?.name,
    combo.productStyle?.styleNo,
  ]
    .join(' ')
    .toLocaleLowerCase('ko-KR')
    .includes(query)
}

function comboMatchesStatus(
  combo: UnresolvedItemNameCombo,
  status: 'all' | InvoiceItemNameMatchStatus,
) {
  if (status === 'all') return true
  if (status === 'conflict') return combo.status === 'conflict'
  if (status === 'passthrough' || status === 'unresolved') {
    return combo.status !== 'conflict'
  }
  return false
}

function pickNextSelection(
  groups: ItemReviewGroup[],
  previousGroups: ItemReviewGroup[],
  selectedGroupKey: string | null,
  selectedComboKey: string | null,
): { groupKey: string | null; comboKey: string | null } {
  if (groups.length === 0) return { groupKey: null, comboKey: null }

  const currentGroup = groups.find((group) => group.key === selectedGroupKey)
  if (currentGroup) {
    if (
      selectedComboKey &&
      currentGroup.combos.some((combo) => combo.key === selectedComboKey)
    ) {
      return { groupKey: currentGroup.key, comboKey: selectedComboKey }
    }
    const previousCombos =
      previousGroups.find((group) => group.key === selectedGroupKey)?.combos.map(
        (combo) => combo.key,
      ) ?? []
    const remaining = currentGroup.combos.map((combo) => combo.key)
    const oldIndex = selectedComboKey
      ? previousCombos.indexOf(selectedComboKey)
      : -1
    const nextInGroup =
      oldIndex >= 0
        ? (previousCombos
            .slice(oldIndex + 1)
            .find((key) => remaining.includes(key)) ?? remaining[0])
        : remaining[0]
    return {
      groupKey: currentGroup.key,
      comboKey: nextInGroup ?? currentGroup.combos[0]!.key,
    }
  }

  const previousIndex = previousGroups.findIndex(
    (group) => group.key === selectedGroupKey,
  )
  const nextPrevious =
    previousIndex >= 0
      ? previousGroups
          .slice(previousIndex + 1)
          .find((group) => groups.some((item) => item.key === group.key))
      : null
  const nextGroup =
    groups.find((group) => group.key === nextPrevious?.key) ?? groups[0]!
  return {
    groupKey: nextGroup.key,
    comboKey: nextGroup.combos[0]!.key,
  }
}

export function InvoiceItemNameTransformPanel({
  brandId,
  transformation,
  itemNameRules = [],
}: {
  brandId: string
  transformation: InvoiceItemNameTransformation
  itemNameRules?: InvoiceItemNameRule[]
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | InvoiceItemNameMatchStatus>(
    'all',
  )
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [selectedComboKey, setSelectedComboKey] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const previousGroupsRef = useRef<ItemReviewGroup[]>([])

  const combos = transformation.unresolvedCombos
  const reviewCount =
    transformation.unresolvedRowCount + transformation.conflictRowCount

  const groups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ko-KR')
    return groupCombos(combos)
      .map((group) => {
        const nextCombos = group.combos.filter(
          (combo) =>
            comboMatchesStatus(combo, status) && comboMatchesQuery(combo, q),
        )
        if (nextCombos.length === 0) return null
        return {
          ...group,
          itemName: nextCombos[0]!.itemName,
          ...summarizeGroup(nextCombos),
        }
      })
      .filter((group): group is ItemReviewGroup => Boolean(group))
  }, [combos, query, status])

  useEffect(() => {
    const next = pickNextSelection(
      groups,
      previousGroupsRef.current,
      selectedGroupKey,
      selectedComboKey,
    )
    previousGroupsRef.current = groups
    if (
      next.groupKey !== selectedGroupKey ||
      next.comboKey !== selectedComboKey
    ) {
      setSelectedGroupKey(next.groupKey)
      setSelectedComboKey(next.comboKey)
    }
  }, [groups, selectedComboKey, selectedGroupKey])

  const selectedGroup =
    groups.find((group) => group.key === selectedGroupKey) ?? null

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ko-KR')
    return transformation.rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false
      if (!q) return true
      return [
        row.source.productName,
        row.source.itemName,
        row.transformedItemName,
        row.productStyle?.name,
        row.productStyle?.styleNo,
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(q)
    })
  }, [query, status, transformation.rows])

  function selectGroup(group: ItemReviewGroup) {
    setSelectedGroupKey(group.key)
    setSelectedComboKey(group.combos[0]?.key ?? null)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge variant="success">
          내품명 기준 적용 {formatNumber(transformation.mappedRowCount)}
        </Badge>
        <Badge variant="success">
          본품 식별 후 비움 {formatNumber(transformation.consumedRowCount)}
        </Badge>
        <Badge variant="success">
          내품명 지움 {formatNumber(transformation.deletedRowCount)}
        </Badge>
        <Badge variant="danger">
          미설정·원문 유지 {formatNumber(transformation.passthroughRowCount)}
        </Badge>
        <Badge variant="warning">
          충돌 {formatNumber(transformation.conflictRowCount)}
        </Badge>
      </div>

      {reviewCount > 0 ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              내품명 확인 {formatNumber(groups.length)}개
              {groups.length !== combos.length
                ? ` · 상품 조합 ${formatNumber(combos.length)}개`
                : ''}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              같은 내품명은 한 줄로 묶습니다. 공통 규칙은 품목명을 보지 않고,
              본품별 규칙은 확정된 본품 M번호마다 따로 저장합니다.
              처음부터 비어 있는 내품명과 품목명 단계에서 전부 소비된 내품명은
              여기 나오지 않습니다. / 또는 , 앞부분만 쓴 행은 남은 옵션만 남깁니다.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="내품명·품목명 검색"
              className="max-w-xs"
              aria-label="내품명 검색"
            />
            <Select
              value={status}
              onChange={(event) =>
                setStatus(
                  event.target.value as 'all' | InvoiceItemNameMatchStatus,
                )
              }
              className="w-44"
              aria-label="내품명 상태 필터"
            >
              <option value="all">상태 전체</option>
              <option value="mapped">내품명 기준 적용</option>
              <option value="consumed">본품 식별 후 비움</option>
              <option value="deleted">내품명 지움</option>
              <option value="passthrough">미설정·원문 유지</option>
              <option value="conflict">충돌</option>
            </Select>
          </div>

          {groups.length > 0 ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
                <div className="max-h-[36rem] overflow-auto">
                  {groups.map((group) => {
                    const selected = group.key === selectedGroupKey
                    const meta = STATUS_META[group.status]
                    return (
                      <button
                        key={group.key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => selectGroup(group)}
                        className={`flex w-full items-start justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 ${
                          selected
                            ? 'bg-primary/5'
                            : 'hover:bg-muted/40'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {group.itemName || '내품명 없음'}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            상품 {formatNumber(group.productCount)}개 ·{' '}
                            {formatNumber(group.rowCount)}행
                          </p>
                        </div>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </button>
                    )
                  })}
                </div>
              </div>

              <aside className="min-w-0 rounded-lg border border-border bg-card p-3 lg:sticky lg:top-4 lg:w-[26rem] lg:shrink-0">
                {selectedGroup ? (
                  <ItemEditor
                    brandId={brandId}
                    group={selectedGroup}
                    selectedComboKey={selectedComboKey}
                    rules={itemNameRules}
                    onSelectCombo={setSelectedComboKey}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    왼쪽에서 내품명을 고르면 여기서 규칙을 지정합니다.
                  </p>
                )}
              </aside>
            </div>
          ) : (
            <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              검색·필터에 맞는 내품명이 없습니다.
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
          이 파일의 내품명 조합은 모두 변환 기준으로 연결됐습니다.
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
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[960px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-3 py-2 font-medium">행</th>
                  <th className="px-3 py-2 font-medium">원본 내품명</th>
                  <th className="px-3 py-2 font-medium">변환 내품명</th>
                  <th className="px-3 py-2 font-medium">구성</th>
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
                        {row.source.itemName || '(빈 값)'}
                      </td>
                      <td className="max-w-48 truncate px-3 py-2">
                        {row.transformedItemName || '(빈 값)'}
                      </td>
                      <td className="max-w-56 truncate px-3 py-2 text-muted-foreground">
                        {row.extras.length > 0
                          ? formatOptionItemName(row.extras)
                          : '-'}
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
        ) : null}
      </div>
    </div>
  )
}

function ItemEditor({
  brandId,
  group,
  selectedComboKey,
  rules,
  onSelectCombo,
}: {
  brandId: string
  group: ItemReviewGroup
  selectedComboKey: string | null
  rules: InvoiceItemNameRule[]
  onSelectCombo: (key: string) => void
}) {
  const [scope, setScope] = useState<InvoiceItemNameRuleScope>('global')
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null)
  const buckets = useMemo(() => groupBuckets(group.combos), [group.combos])
  const selectedBucket =
    buckets.find((bucket) => bucket.key === selectedBucketKey) ??
    buckets[0] ??
    null
  const selectedCombo =
    selectedBucket?.combos.find((combo) => combo.key === selectedComboKey) ??
    selectedBucket?.combos[0] ??
    group.combos[0] ??
    null
  const existingRule = findItemNameRule(
    rules,
    group.itemName,
    scope,
    scope === 'main_style' ? (selectedBucket?.style?.styleId ?? null) : null,
  )
  const consumed =
    Boolean(selectedCombo?.originalItemName) &&
    selectedCombo?.originalItemName !== selectedCombo.itemName

  useEffect(() => {
    if (scope !== 'main_style') return
    const current = buckets.find((bucket) => bucket.key === selectedBucketKey)
    if (current && current.key !== '__none__') return
    const nextUnsaved =
      buckets.find(
        (bucket) =>
          bucket.key !== '__none__' &&
          !findItemNameRule(
            rules,
            group.itemName,
            'main_style',
            bucket.style?.styleId ?? null,
          ),
      ) ??
      buckets.find((bucket) => bucket.key !== '__none__') ??
      buckets[0] ??
      null
    if (nextUnsaved && nextUnsaved.key !== selectedBucketKey) {
      setSelectedBucketKey(nextUnsaved.key)
      onSelectCombo(nextUnsaved.combos[0]?.key ?? '')
    }
  }, [
    buckets,
    group.itemName,
    onSelectCombo,
    rules,
    scope,
    selectedBucketKey,
  ])

  function selectBucket(bucket: MainBucket) {
    setSelectedBucketKey(bucket.key)
    onSelectCombo(bucket.combos[0]?.key ?? '')
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">
          {group.itemName || '내품명 없음'}
        </p>
        <p className="text-xs text-muted-foreground">
          상품 {formatNumber(group.productCount)}개 ·{' '}
          {formatNumber(group.rowCount)}행
        </p>
        {consumed && selectedCombo ? (
          <p className="mt-1 break-words text-xs text-muted-foreground">
            <span className="line-through">{selectedCombo.originalItemName}</span>
            <span className="mx-1">→</span>
            <span className="font-medium text-foreground">
              {selectedCombo.itemName || '남은 내품명 없음'}
            </span>
          </p>
        ) : null}
      </div>

      {scope === 'main_style' && buckets.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">확정 본품</p>
          <div className="max-h-40 overflow-auto rounded-md border border-border">
            {buckets.map((bucket) => {
              const selected = bucket.key === selectedBucket?.key
              const saved = Boolean(
                bucket.style &&
                  findItemNameRule(
                    rules,
                    group.itemName,
                    'main_style',
                    bucket.style.styleId,
                  ),
              )
              return (
                <button
                  key={bucket.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectBucket(bucket)}
                  className={`flex w-full items-start justify-between gap-2 border-b border-border px-2 py-1.5 text-left last:border-b-0 ${
                    selected ? 'bg-primary/10' : 'hover:bg-muted/40'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">
                      {bucket.style
                        ? formatStyleRef(bucket.style)
                        : '본품 미확정'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatNumber(bucket.rowCount)}행
                      {saved ? ' · 규칙 있음' : ''}
                      {!bucket.style ? ' · 본품별 규칙 불가' : ''}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          이 내품명이 붙은 상품 {formatNumber(group.productCount)}개를 함께
          처리합니다.
        </p>
      )}

      <InvoiceItemNameRuleForm
        key={`${group.key}-${scope}-${selectedBucket?.key ?? 'none'}`}
        brandId={brandId}
        itemName={group.itemName}
        scope={scope}
        onScopeChange={setScope}
        mainStyle={scope === 'main_style' ? (selectedBucket?.style ?? null) : null}
        existingRule={existingRule}
      />
    </div>
  )
}
