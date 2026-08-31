import { useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
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
import { productCompositionSearchText } from '@/lib/invoice/product-composition'
import {
  INVOICE_ITEM_NAME_RULE_SCOPE_LABEL,
  type InvoiceAccessoryRule,
  type InvoiceItemNameRule,
  type InvoiceItemNameRuleScope,
  type StyleRef,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import {
  downloadInvoiceItemNameReviewList,
  type InvoiceItemNameReviewEntry,
} from '@/lib/invoice/item-name-rule-import'
import {
  InvoiceItemNameLookupKeyTable,
  buildInvoiceItemNameLookupKeyRows,
} from './InvoiceItemNameLookupKeyTable'
import { InvoiceItemNameAiApplyBar } from './InvoiceItemNameAiApplyBar'
import { InvoiceAccessoryRuleForm } from './InvoiceAccessoryRuleTable'
import { InvoiceItemNameRuleForm } from './InvoiceItemNameRuleForm'
import { useInvoiceItemNameBulkAiApply } from './useInvoiceItemNameBulkAiApply'

type ItemNameEditorScope = Extract<
  InvoiceItemNameRuleScope,
  'global' | 'lookup_key'
>

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

function findGlobalItemNameRule(
  rules: InvoiceItemNameRule[],
  itemName: string,
) {
  const item = normalizeInvoiceText(itemName)
  return (
    rules.find(
      (rule) =>
        rule.isActive &&
        rule.scope === 'global' &&
        rule.normalizedItemName === item,
    ) ?? null
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
    combo.productLookupKey,
    combo.productStyle?.name,
    combo.productStyle?.styleNo,
    productCompositionSearchText(combo.productComponents ?? []),
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
  brandName,
  transformation,
  itemNameRules = [],
  accessoryRules = [],
  styles = [],
  renderUi = true,
  autoCollect = false,
  autoCollectKey = '',
  onAutoCollectProgress,
  onAutoCollectSettled,
}: {
  brandId: string
  brandName: string
  transformation: InvoiceItemNameTransformation
  itemNameRules?: InvoiceItemNameRule[]
  accessoryRules?: InvoiceAccessoryRule[]
  styles?: StyleRef[]
  renderUi?: boolean
  autoCollect?: boolean
  autoCollectKey?: string
  onAutoCollectProgress?: (progress: {
    collecting: boolean
    done: number
    total: number
  }) => void
  onAutoCollectSettled?: () => void
}) {
  const [query, setQuery] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [status, setStatus] = useState<'all' | InvoiceItemNameMatchStatus>(
    'all',
  )
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [selectedComboKey, setSelectedComboKey] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const previousGroupsRef = useRef<ItemReviewGroup[]>([])

  const combos = transformation.unresolvedCombos
  const itemNameBulk = useInvoiceItemNameBulkAiApply({
    brandId,
    combos,
    accessoryRules,
    itemNameRules,
    styles,
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
      collecting: itemNameBulk.phase === 'collecting',
      done: itemNameBulk.progress.done,
      total: itemNameBulk.progress.total,
    })
  }, [
    autoCollect,
    itemNameBulk.phase,
    itemNameBulk.progress.done,
    itemNameBulk.progress.total,
    onAutoCollectProgress,
  ])

  useEffect(() => {
    if (!autoCollect || autoCollectStartedRef.current) return
    if (itemNameBulk.routeLoading) return
    autoCollectStartedRef.current = true
    if (!itemNameBulk.routeReady || itemNameBulk.contextCount === 0) {
      onAutoCollectSettled?.()
      return
    }
    void itemNameBulk.collect().catch(() => {
      onAutoCollectSettled?.()
    })
  }, [
    autoCollect,
    itemNameBulk.collect,
    itemNameBulk.contextCount,
    itemNameBulk.routeLoading,
    itemNameBulk.routeReady,
    onAutoCollectSettled,
  ])

  useEffect(() => {
    if (!autoCollect || !autoCollectStartedRef.current) return
    if (itemNameBulk.phase === 'review' || itemNameBulk.phase === 'applied') {
      onAutoCollectSettled?.()
    }
  }, [autoCollect, itemNameBulk.phase, onAutoCollectSettled])
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

  /** 검색·필터에 걸린 모든 내품명의 조회 키 중 아직 규칙이 없는 건만 모은다. */
  const reviewEntries = useMemo<InvoiceItemNameReviewEntry[]>(() => {
    const entries: InvoiceItemNameReviewEntry[] = []
    for (const group of groups) {
      const lookupRows = buildInvoiceItemNameLookupKeyRows(
        group.combos,
        group.itemName,
        itemNameRules,
      )
      for (const row of lookupRows) {
        if (!row.selectable || row.existingRule) continue
        entries.push({
          itemName: group.itemName,
          productLookupKey: row.productLookupKey,
          styleNo: row.style?.styleNo ?? '',
          rowCount: row.rowCount,
        })
      }
    }
    return entries
  }, [groups, itemNameRules])

  function selectGroup(group: ItemReviewGroup) {
    setSelectedGroupKey(group.key)
    setSelectedComboKey(group.combos[0]?.key ?? null)
  }

  if (!renderUi) return null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge variant="success">
          내품명 기준 적용 {formatNumber(transformation.mappedRowCount)}행
        </Badge>
        <Badge variant="success">
          본품 식별 후 비움 {formatNumber(transformation.consumedRowCount)}행
        </Badge>
        <Badge variant="success">
          내품명 지움 {formatNumber(transformation.deletedRowCount)}행
        </Badge>
        <Badge variant="success">
          사전 구성품 {formatNumber(transformation.autoComponentsRowCount)}행
        </Badge>
        <Badge variant="success">
          사전 비움 {formatNumber(transformation.autoDeletedRowCount)}행
        </Badge>
        <Badge variant="danger">
          미설정·원문 유지 {formatNumber(transformation.passthroughRowCount)}행
        </Badge>
        <Badge variant="warning">
          충돌 {formatNumber(transformation.conflictRowCount)}행
        </Badge>
      </div>

      {reviewCount > 0 ? (
        <div className="space-y-3">
          <InvoiceItemNameAiApplyBar bulk={itemNameBulk} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                직접 지정 {formatNumber(groups.length)}개
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                AI가 결정하지 못한 항목만 필요할 때 직접 지정할 수 있습니다.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setManualOpen((open) => !open)}
            >
              {manualOpen ? '직접 지정 접기' : '직접 지정 펼치기'}
            </Button>
          </div>

          {manualOpen ? (
            <>
              <div>
                <p className="text-sm font-medium">
                  내품명 확인 {formatNumber(groups.length)}개
                  {groups.length !== combos.length
                    ? ` · 상품 조합 ${formatNumber(combos.length)}개`
                    : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  같은 내품명은 한 줄로 묶습니다. 공통 규칙은 품목명을 보지
                  않고, 조회 키 규칙은 체크한 조회 키와 그때의 확정 본품
                  조합에만 적용합니다. 처음부터 비어 있는 내품명과 품목명
                  단계에서 전부 소비된 내품명은 여기 나오지 않습니다. / 또는 ,
                  앞부분만 쓴 행은 남은 옵션만 남깁니다.
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
                      event.target.value as
                        | 'all'
                        | InvoiceItemNameMatchStatus,
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={downloading || reviewEntries.length === 0}
                  onClick={async () => {
                    setDownloading(true)
                    setDownloadError(null)
                    try {
                      await downloadInvoiceItemNameReviewList(
                        brandName,
                        reviewEntries,
                      )
                    } catch (err) {
                      setDownloadError(
                        err instanceof Error
                          ? err.message
                          : '검토 목록을 내려받지 못했습니다.',
                      )
                    } finally {
                      setDownloading(false)
                    }
                  }}
                >
                  <Download className="size-3.5" />
                  {downloading
                    ? '만드는 중...'
                    : `검토 목록 내려받기 ${formatNumber(reviewEntries.length)}`}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                내려받은 파일에서 지울 행은 `지우기`에 Y, 구성품을 넣을 행은
                `구성품 M번호`만 채워 기준정보 &gt; 내품명 규칙에서 올리면
                한 번에 등록됩니다. 구성품이 여러 개면 한 칸에
                `M1999,M1999,M2000`처럼 쉼표로 나열하고, 같은 M번호를 반복한
                횟수가 수량이 됩니다. 둘 다 비운 행은 건너뛰니 필요한 행만
                채우면 됩니다.
              </p>
              {downloadError ? (
                <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
                  {downloadError}
                </p>
              ) : null}

              {groups.length > 0 ? (
                <div className="space-y-4">
                  <div className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/10 p-2">
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {groups.map((group) => {
                        const selected = group.key === selectedGroupKey
                        const meta = STATUS_META[group.status]
                        return (
                          <button
                            key={group.key}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => selectGroup(group)}
                            className={`flex min-h-16 w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left ${
                              selected
                                ? 'border-primary/50 bg-primary/10'
                                : 'border-border bg-card hover:bg-muted/40'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium leading-5">
                                {group.itemName || '내품명 없음'}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                상품 {formatNumber(group.productCount)}개 ·{' '}
                                {formatNumber(group.rowCount)}행
                              </p>
                            </div>
                            <Badge
                              className="shrink-0"
                              variant={meta.variant}
                            >
                              {meta.label}
                            </Badge>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <section className="min-w-0 rounded-lg border border-border bg-card p-4">
                    {selectedGroup ? (
                      <ItemEditor
                        brandId={brandId}
                        group={selectedGroup}
                        rules={itemNameRules}
                        accessoryCount={accessoryRules.length}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        위에서 내품명을 고르면 여기서 규칙을 지정합니다.
                      </p>
                    )}
                  </section>
                </div>
              ) : (
                <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  검색·필터에 맞는 내품명이 없습니다.
                </p>
              )}
            </>
          ) : null}
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
                  <th className="px-3 py-2 font-medium">근거</th>
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
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          {row.resolvedBy === 'dictionary' ? (
                            <Badge variant="success">사전 자동</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-72 truncate px-3 py-2 text-muted-foreground">
                        {row.evidence.join(' · ') || '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length > 300 ? (
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                미리보기는 앞의 300행만 표시합니다. 변환과 다운로드에는 전체가
                들어갑니다.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ItemEditor({
  brandId,
  group,
  rules,
  accessoryCount,
}: {
  brandId: string
  group: ItemReviewGroup
  rules: InvoiceItemNameRule[]
  accessoryCount: number
}) {
  const [scope, setScope] = useState<ItemNameEditorScope>('global')
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const lookupRows = useMemo(
    () =>
      buildInvoiceItemNameLookupKeyRows(group.combos, group.itemName, rules),
    [group.combos, group.itemName, rules],
  )
  const existingRule =
    scope === 'global' ? findGlobalItemNameRule(rules, group.itemName) : null
  const selectedRows = lookupRows.filter(
    (row) => row.selectable && selectedKeys.includes(row.key),
  )
  const consumedCombo =
    group.combos.find(
      (combo) =>
        Boolean(combo.originalItemName) &&
        combo.originalItemName !== combo.itemName,
    ) ?? null
  const unknownPieces = [
    ...new Set(group.combos.flatMap((combo) => combo.unknownPieces)),
  ]
  const [registerPiece, setRegisterPiece] = useState(unknownPieces[0] ?? '')

  useEffect(() => {
    setSelectedKeys([])
    setRegisterPiece(unknownPieces[0] ?? '')
  }, [group.key])

  useEffect(() => {
    setSelectedKeys((current) =>
      current.filter((key) =>
        lookupRows.some((row) => row.selectable && row.key === key),
      ),
    )
  }, [lookupRows])

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
        {unknownPieces.length > 0 ? (
          <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium">사전에 없는 조각</p>
            <p className="text-xs text-muted-foreground">
              {accessoryCount === 0
                ? '부속품 사전이 비어 있습니다. 기준정보에서 권장 사전을 등록하면 같은 표기는 다음부터 자동으로 잡힙니다.'
                : '이 조각을 사전에 등록하면 같은 표기는 다음부터 자동으로 잡힙니다.'}
            </p>
            <div className="flex flex-wrap gap-1">
              {unknownPieces.map((piece) => (
                <button
                  key={piece}
                  type="button"
                  onClick={() => setRegisterPiece(piece)}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    registerPiece === piece
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-border bg-card'
                  }`}
                >
                  {piece}
                </button>
              ))}
            </div>
            {registerPiece ? (
              <InvoiceAccessoryRuleForm
                key={registerPiece}
                brandId={brandId}
                initialPattern={registerPiece}
                initialType="token"
              />
            ) : null}
          </div>
        ) : null}
        {consumedCombo ? (
          <p className="mt-1 break-words text-xs text-muted-foreground">
            <span className="line-through">{consumedCombo.originalItemName}</span>
            <span className="mx-1">→</span>
            <span className="font-medium text-foreground">
              {consumedCombo.itemName || '남은 내품명 없음'}
            </span>
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium">적용 범위</legend>
        <div className="grid grid-cols-2 gap-1">
          {(['global', 'lookup_key'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={scope === value ? 'default' : 'outline'}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              {INVOICE_ITEM_NAME_RULE_SCOPE_LABEL[value]}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {scope === 'global'
            ? '쇼핑몰과 품목명을 보지 않고 이 브랜드의 같은 내품명에 모두 적용합니다.'
            : '체크한 조회 키와 그때의 확정 본품 조합에만 적용합니다. 체크하지 않은 조회 키는 그대로 둡니다.'}
        </p>
      </fieldset>

      {scope === 'lookup_key' ? (
        <InvoiceItemNameLookupKeyTable
          rows={lookupRows}
          selectedKeys={selectedKeys}
          onChangeSelectedKeys={setSelectedKeys}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          이 내품명이 붙은 상품 {formatNumber(group.productCount)}개를 함께
          처리합니다.
        </p>
      )}

      <InvoiceItemNameRuleForm
        key={`${group.key}-${scope}`}
        brandId={brandId}
        itemName={group.itemName}
        scope={scope}
        existingRule={existingRule}
        selectedRows={scope === 'lookup_key' ? selectedRows : []}
      />
    </div>
  )
}
