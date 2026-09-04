import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import {
  generateProductNameCandidates,
  isEmptyItemNameHint,
  resolveItemNameConsumption,
  type ProductNameCandidate,
} from '@/lib/invoice/product-name-patterns'
import {
  classifyInlineReservationShippingDateTags,
  classifyLeadingTags,
  matchingItemName,
  matchingProductName,
  type ParsedProductNameTag,
} from '@/lib/invoice/product-name-tags'
import {
  buildOrderFingerprint,
  orderKeyOf,
  shipmentKeyOf,
} from '@/lib/invoice/gift-assign'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceNameTransformation } from '@/lib/invoice/name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { GiftSourcePlan, GiftSourceReplacement } from '@/lib/invoice/gift-source-transform'
import type {
  InvoiceProductNameExclusion,
  InvoiceProductNameMap,
  InvoiceProductNameTagRoleEntry,
  StyleRef,
} from '@/lib/types'

export type InvoiceProductNameMatchStatus =
  | 'mapped'
  | 'candidate'
  | 'missing_style'
  | 'conflict'
  | 'unresolved'
  | 'excluded'
  | 'exclusion_guarded'
  | 'gift_pending'
  | 'gift_mapped'

export type InvoiceProductNameTransformRow = {
  source: SabangnetOrderRow
  status: InvoiceProductNameMatchStatus
  mapId: string | null
  style: StyleRef | null
  transformedProductName: string
  appliedRule: string | null
  /** 엔진이 실제로 맞춘 후보 원문. 같은 rule의 태그 전·후 후보를 구분한다. */
  appliedLookupKey: string | null
  itemNameConsumed: boolean
  /** 품목명 원장이 앞부분을 소비하면 suffix, 전체를 소비하면 빈 값, 아니면 원문 */
  effectiveItemName: string
  candidates: ProductNameCandidate[]
  candidateStyles: StyleRef[]
  tags: ParsedProductNameTag[]
  itemTags: ParsedProductNameTag[]
  giftSourceKey?: string | null
  giftReplacements?: GiftSourceReplacement[]
}

export type UnresolvedProductNameCombo = {
  key: string
  mallName: string
  productName: string
  itemName: string
  ownProductCode: string
  rowCount: number
  status: Exclude<
    InvoiceProductNameMatchStatus,
    'mapped' | 'excluded' | 'gift_pending' | 'gift_mapped'
  >
  appliedRule: string | null
  appliedLookupKey: string | null
  candidateStyles: StyleRef[]
  candidates: ProductNameCandidate[]
  tags: ParsedProductNameTag[]
  itemTags: ParsedProductNameTag[]
}

export type InvoiceProductNameTransformation = {
  rows: InvoiceProductNameTransformRow[]
  mappedRowCount: number
  candidateRowCount: number
  missingStyleRowCount: number
  conflictRowCount: number
  unresolvedRowCount: number
  excludedRowCount: number
  exclusionGuardedRowCount: number
  giftPendingRowCount: number
  giftMappedRowCount: number
  unresolvedCombos: UnresolvedProductNameCombo[]
}

export function productExclusionKey(
  mallName: string,
  productName: string,
  itemName: string,
) {
  return [
    normalizeInvoiceText(mallName),
    normalizeInvoiceText(productName),
    normalizeInvoiceText(itemName),
  ].join('\u0000')
}

export function isInvoiceProductRowExcluded(
  row: Pick<InvoiceProductNameTransformRow, 'status'> | undefined,
) {
  return row?.status === 'excluded'
}

export function isGiftSourceProductRow(
  row: Pick<InvoiceProductNameTransformRow, 'status'> | undefined,
) {
  return row?.status === 'gift_pending' || row?.status === 'gift_mapped'
}

/** 품목명 단계에서 실제로 맞춘 후보 텍스트. 규칙이 후보에 없으면 첫 후보. */
export function lookupKeyFromProductRow(
  row:
    | Pick<
        InvoiceProductNameTransformRow,
        'appliedRule' | 'appliedLookupKey' | 'candidates'
      >
    | undefined,
): { productLookupKey: string; productAppliedRule: string | null } {
  if (!row) return { productLookupKey: '', productAppliedRule: null }
  if (row.appliedLookupKey) {
    const exact = row.candidates.find(
      (candidate) => candidate.text === row.appliedLookupKey,
    )
    if (exact) {
      return {
        productLookupKey: exact.text,
        productAppliedRule: row.appliedRule,
      }
    }
  }
  const byRule = row.appliedRule
    ? row.candidates.find((candidate) => candidate.rule === row.appliedRule)
    : undefined
  return {
    productLookupKey: (byRule ?? row.candidates[0])?.text ?? '',
    productAppliedRule: row.appliedRule,
  }
}

export type ProductNameStyleCatalog = {
  byName: Map<string, StyleRef[]>
  byCompactName: Map<string, StyleRef[]>
}

function comboKey(mallName: string, productName: string, itemName: string) {
  return [
    normalizeInvoiceText(mallName),
    normalizeInvoiceText(productName),
    normalizeInvoiceText(itemName),
  ].join('\u0000')
}

export type ProductNameRowKeys = {
  exclusionKey: string
  orderFingerprint: string
  shipmentOrderKey: string
}

export type ProductNameRowKeyIndex = Map<number, ProductNameRowKeys>

export function buildProductNameRowKeyIndex(
  rows: readonly InvoiceProductNameTransformRow[],
): ProductNameRowKeyIndex {
  const index: ProductNameRowKeyIndex = new Map()
  for (const row of rows) {
    index.set(row.source.rowNumber, {
      exclusionKey: productExclusionKey(
        row.source.mallName,
        row.source.productName,
        row.source.itemName,
      ),
      orderFingerprint: buildOrderFingerprint(row.source),
      shipmentOrderKey: shipmentOrderKeyOf(row.source),
    })
  }
  return index
}

function keysOf(
  row: InvoiceProductNameTransformRow,
  keyIndex?: ProductNameRowKeyIndex,
): ProductNameRowKeys {
  return (
    keyIndex?.get(row.source.rowNumber) ?? {
      exclusionKey: productExclusionKey(
        row.source.mallName,
        row.source.productName,
        row.source.itemName,
      ),
      orderFingerprint: buildOrderFingerprint(row.source),
      shipmentOrderKey: shipmentOrderKeyOf(row.source),
    }
  )
}

export type ProductNameLookupIndex = {
  compact: Map<string, InvoiceProductNameMap[]>
}

type LookupMapIndex = ProductNameLookupIndex

function pushMap(
  target: Map<string, InvoiceProductNameMap[]>,
  key: string,
  map: InvoiceProductNameMap,
) {
  if (!key) return
  const list = target.get(key) ?? []
  list.push(map)
  target.set(key, list)
}

function mapLookupTexts(map: InvoiceProductNameMap): string[] {
  const texts: string[] = []
  const lookupKey = map.lookupKey.trim() || map.normalizedLookupKey
  if (lookupKey) {
    texts.push(lookupKey)
  } else {
    const itemContext = map.itemNameContext.trim()
    texts.push(
      itemContext && !isEmptyItemNameHint(itemContext)
        ? `${map.productName} ${itemContext}`
        : map.productName,
    )
  }
  return texts
}

/**
 * 조회 키 원장과 조합 원장을 같은 압축 키로 색인한다.
 * 저장된 태그 역할로 제외되는 선행 태그와 옵션 예약배송 토큰은 별칭으로도 넣는다.
 */
export function buildProductNameLookupIndex(
  maps: InvoiceProductNameMap[],
  tagRoles: InvoiceProductNameTagRoleEntry[],
): ProductNameLookupIndex {
  return indexLookupMaps(maps, tagRoles)
}

export type ProductNameMapSnapshotEntry = {
  version: string
  keys: string[]
}

export type ProductNameMapSnapshot = Map<string, ProductNameMapSnapshotEntry>

export type ProductNameCandidateRowIndex = Map<string, number[]>

function productNameMapVersion(map: InvoiceProductNameMap) {
  return `${map.updatedAt}:${map.isActive ? '1' : '0'}:${map.style.styleId}:${map.normalizedMallName}`
}

/**
 * 원장 id별 버전과 압축 별칭 키. 키 규칙은 indexLookupMaps와 같다.
 */
export function snapshotProductNameMaps(
  maps: readonly InvoiceProductNameMap[],
  tagRoles: InvoiceProductNameTagRoleEntry[],
): ProductNameMapSnapshot {
  const snapshot: ProductNameMapSnapshot = new Map()
  for (const map of maps) {
    snapshot.set(map.id, {
      version: productNameMapVersion(map),
      keys: [...indexLookupMaps([map], tagRoles).compact.keys()],
    })
  }
  return snapshot
}

export function buildProductNameCandidateRowIndex(
  rows: readonly InvoiceProductNameTransformRow[],
): ProductNameCandidateRowIndex {
  const index: ProductNameCandidateRowIndex = new Map()
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const seen = new Set<string>()
    for (const candidate of rows[rowIndex]!.candidates) {
      const compact = compactProductNameKey(candidate.text)
      if (!compact || seen.has(compact)) continue
      seen.add(compact)
      const list = index.get(compact)
      if (list) list.push(rowIndex)
      else index.set(compact, [rowIndex])
    }
  }
  return index
}

/**
 * 추가·삭제·버전 변경된 원장의 이전·현재 압축 키 합집합.
 */
export function diffProductNameMapSnapshots(
  previous: ProductNameMapSnapshot,
  current: ProductNameMapSnapshot,
): Set<string> {
  const keys = new Set<string>()
  const addKeys = (entry: ProductNameMapSnapshotEntry | undefined) => {
    if (!entry) return
    for (const key of entry.keys) keys.add(key)
  }
  for (const [id, prev] of previous) {
    const next = current.get(id)
    if (next && next.version === prev.version) continue
    addKeys(prev)
    addKeys(next)
  }
  for (const [id, next] of current) {
    if (!previous.has(id)) addKeys(next)
  }
  return keys
}

function indexLookupMaps(
  maps: InvoiceProductNameMap[],
  tagRoles: InvoiceProductNameTagRoleEntry[],
): LookupMapIndex {
  const compact = new Map<string, InvoiceProductNameMap[]>()
  for (const map of maps) {
    for (const raw of mapLookupTexts(map)) {
      const aliases = [
        raw,
        matchingProductName(raw, tagRoles),
        matchingItemName(raw, tagRoles),
        matchingItemName(matchingProductName(raw, tagRoles), tagRoles),
      ]
      const seen = new Set<string>()
      for (const alias of aliases) {
        const next = compactProductNameKey(alias)
        if (!next || seen.has(next)) continue
        seen.add(next)
        pushMap(compact, next, map)
      }
    }
  }
  return { compact }
}

function preferMallMaps(
  maps: InvoiceProductNameMap[],
  mallName: string,
): InvoiceProductNameMap[] {
  const unique = uniqueMaps(maps)
  const mall = normalizeInvoiceText(mallName)
  const exactMall = unique.filter((map) => map.normalizedMallName === mall)
  if (exactMall.length > 0) return exactMall
  const anyMall = unique.filter((map) => !map.normalizedMallName)
  if (anyMall.length > 0) return anyMall
  return unique
}

function lookupStyles(
  catalog: ProductNameStyleCatalog,
  text: string,
): StyleRef[] {
  const strict = catalog.byName.get(normalizeInvoiceText(text)) ?? []
  if (strict.length > 0) return strict
  const compact = compactProductNameKey(text)
  if (!compact) return []
  return catalog.byCompactName.get(compact) ?? []
}

function uniqueStyles(styles: StyleRef[]) {
  const byId = new Map<string, StyleRef>()
  for (const style of styles) {
    if (!byId.has(style.styleId)) byId.set(style.styleId, style)
  }
  return [...byId.values()]
}

function uniqueMaps(maps: InvoiceProductNameMap[]) {
  const byId = new Map<string, InvoiceProductNameMap>()
  for (const map of maps) {
    if (!byId.has(map.id)) byId.set(map.id, map)
  }
  return [...byId.values()]
}

function itemNameOutcome(
  rule: string | null,
  itemName: string,
  consumeFromLedger: boolean,
) {
  if (!consumeFromLedger) {
    return { itemNameConsumed: false, effectiveItemName: itemName }
  }
  const consumption = resolveItemNameConsumption(rule, itemName)
  return {
    itemNameConsumed: consumption.kind === 'full',
    effectiveItemName: consumption.effectiveItemName,
  }
}

/**
 * 조회 키·조합 원장을 같은 압축 키와 후보 우선순위로 맞춘다.
 * 내품명 변환 결과는 포함하지 않는다. 후보가 하나여도 기준을 자동 저장하지 않는다.
 *
 * 제품군·색상 분해 매칭은 쓰지 않는다. 색상 토큰 하나만 걸려도 다른 상품을 확정해
 * 오탐이 잦았고, 그 자리는 AI 추천이 맡는다.
 */
function shipmentOrderKeyOf(row: SabangnetOrderRow) {
  return `${shipmentKeyOf(row)}\u0000${orderKeyOf(row)}`
}

function collectConfirmedExclusionSiblings(
  rows: InvoiceProductNameTransformRow[],
  skip: (row: InvoiceProductNameTransformRow) => boolean,
  keyIndex?: ProductNameRowKeyIndex,
) {
  const orderFingerprints = new Set<string>()
  const shipmentOrderKeys = new Set<string>()
  for (const row of rows) {
    if (skip(row)) continue
    if (row.status !== 'mapped' && row.status !== 'candidate') continue
    const keys = keysOf(row, keyIndex)
    orderFingerprints.add(keys.orderFingerprint)
    shipmentOrderKeys.add(keys.shipmentOrderKey)
  }
  return { orderFingerprints, shipmentOrderKeys }
}

function hasConfirmedExclusionSibling(
  source: SabangnetOrderRow,
  confirmed: ReturnType<typeof collectConfirmedExclusionSiblings>,
  keys?: ProductNameRowKeys,
) {
  return (
    confirmed.orderFingerprints.has(
      keys?.orderFingerprint ?? buildOrderFingerprint(source),
    ) ||
    confirmed.shipmentOrderKeys.has(
      keys?.shipmentOrderKey ?? shipmentOrderKeyOf(source),
    )
  )
}

export type ExclusionGuardedSibling = {
  key: string
  mallName: string
  productName: string
  itemName: string
  status: InvoiceProductNameMatchStatus
  rowCount: number
}

export type ExclusionGuardedContext = {
  comboKey: string
  orderCount: number
  ordersWithoutSibling: number
  siblings: ExclusionGuardedSibling[]
}

export type ExclusionGuardedReviewContext = ExclusionGuardedContext & {
  exclusionId: string | null
}

/**
 * 예외 보류 조합마다 같은 주문의 다른 품목 조합을 모은다.
 * 형제 판정은 제외 확정과 같이 주문 지문 또는 합포장+주문시각을 쓴다.
 */
export function collectExclusionGuardedContexts(
  rows: readonly InvoiceProductNameTransformRow[],
  keyIndex?: ProductNameRowKeyIndex,
): Map<string, ExclusionGuardedContext> {
  const guarded = rows.filter((row) => row.status === 'exclusion_guarded')
  if (guarded.length === 0) return new Map()

  const index = keyIndex ?? buildProductNameRowKeyIndex(rows)
  const byCombo = new Map<string, InvoiceProductNameTransformRow[]>()
  for (const row of guarded) {
    const key = keysOf(row, index).exclusionKey
    const group = byCombo.get(key) ?? []
    group.push(row)
    byCombo.set(key, group)
  }

  const byFingerprint = new Map<string, InvoiceProductNameTransformRow[]>()
  const byShipmentKey = new Map<string, InvoiceProductNameTransformRow[]>()
  for (const row of rows) {
    const keys = keysOf(row, index)
    const fingerprintGroup = byFingerprint.get(keys.orderFingerprint) ?? []
    fingerprintGroup.push(row)
    byFingerprint.set(keys.orderFingerprint, fingerprintGroup)
    const shipmentGroup = byShipmentKey.get(keys.shipmentOrderKey) ?? []
    shipmentGroup.push(row)
    byShipmentKey.set(keys.shipmentOrderKey, shipmentGroup)
  }

  const result = new Map<string, ExclusionGuardedContext>()
  for (const [guardedKey, comboRows] of byCombo) {
    const orders = new Map<string, InvoiceProductNameTransformRow>()
    for (const row of comboRows) {
      const keys = keysOf(row, index)
      const id = `${keys.orderFingerprint}\u0001${keys.shipmentOrderKey}`
      if (!orders.has(id)) orders.set(id, row)
    }

    const siblings = new Map<string, ExclusionGuardedSibling>()
    let ordersWithoutSibling = 0
    for (const anchor of orders.values()) {
      const keys = keysOf(anchor, index)
      const relatedByNumber = new Map<number, InvoiceProductNameTransformRow>()
      for (const row of byFingerprint.get(keys.orderFingerprint) ?? []) {
        relatedByNumber.set(row.source.rowNumber, row)
      }
      for (const row of byShipmentKey.get(keys.shipmentOrderKey) ?? []) {
        relatedByNumber.set(row.source.rowNumber, row)
      }
      let relatedCount = 0
      for (const row of relatedByNumber.values()) {
        const rowKeys = keysOf(row, index)
        if (rowKeys.exclusionKey === guardedKey) continue
        relatedCount += 1
        const current = siblings.get(rowKeys.exclusionKey)
        if (current) {
          current.rowCount += 1
          if (
            current.status === 'mapped' ||
            current.status === 'candidate' ||
            current.status === 'excluded'
          ) {
            current.status = row.status
          }
          continue
        }
        siblings.set(rowKeys.exclusionKey, {
          key: rowKeys.exclusionKey,
          mallName: row.source.mallName,
          productName: row.source.productName,
          itemName: row.source.itemName,
          status: row.status,
          rowCount: 1,
        })
      }
      if (relatedCount === 0) ordersWithoutSibling += 1
    }

    result.set(guardedKey, {
      comboKey: guardedKey,
      orderCount: orders.size,
      ordersWithoutSibling,
      siblings: [...siblings.values()].sort(
        (left, right) =>
          left.productName.localeCompare(right.productName, 'ko-KR') ||
          left.itemName.localeCompare(right.itemName, 'ko-KR'),
      ),
    })
  }
  return result
}

function applyProductNameExclusionsInPlace(
  rows: InvoiceProductNameTransformRow[],
  exclusions: InvoiceProductNameExclusion[],
  keyIndex?: ProductNameRowKeyIndex,
) {
  const activeKeys = new Set(
    exclusions
      .filter((item) => item.isActive)
      .map((item) =>
        productExclusionKey(item.mallName, item.productName, item.itemName),
      ),
  )
  if (activeKeys.size === 0) return

  const confirmed = collectConfirmedExclusionSiblings(
    rows,
    (row) => activeKeys.has(keysOf(row, keyIndex).exclusionKey),
    keyIndex,
  )

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const keys = keysOf(row, keyIndex)
    if (!activeKeys.has(keys.exclusionKey)) continue
    const excluded = hasConfirmedExclusionSibling(row.source, confirmed, keys)
    rows[index] = {
      ...row,
      status: excluded ? 'excluded' : 'exclusion_guarded',
      mapId: null,
      style: null,
      transformedProductName: row.source.productName,
      appliedRule: 'exclusion',
      itemNameConsumed: false,
      effectiveItemName: row.source.itemName,
      candidateStyles: [],
    }
  }
}

export function applyProductNameExclusions(
  base: InvoiceProductNameTransformation,
  exclusions: InvoiceProductNameExclusion[],
  keyIndex?: ProductNameRowKeyIndex,
): InvoiceProductNameTransformation {
  if (!exclusions.some((item) => item.isActive)) return base
  const rows = base.rows.slice()
  applyProductNameExclusionsInPlace(rows, exclusions, keyIndex)
  return {
    rows,
    ...summarizeProductNameRows(rows),
  }
}

function summarizeProductNameRows(rows: InvoiceProductNameTransformRow[]) {
  const unresolvedByKey = new Map<string, UnresolvedProductNameCombo>()
  let mappedRowCount = 0
  let candidateRowCount = 0
  let missingStyleRowCount = 0
  let conflictRowCount = 0
  let unresolvedRowCount = 0
  let excludedRowCount = 0
  let exclusionGuardedRowCount = 0
  let giftPendingRowCount = 0
  let giftMappedRowCount = 0

  for (const row of rows) {
    if (row.status === 'mapped') {
      mappedRowCount += 1
      continue
    }
    if (row.status === 'excluded') {
      excludedRowCount += 1
      continue
    }
    if (row.status === 'gift_pending') {
      giftPendingRowCount += 1
      continue
    }
    if (row.status === 'gift_mapped') {
      giftMappedRowCount += 1
      continue
    }
    if (row.status === 'candidate') candidateRowCount += 1
    else if (row.status === 'missing_style') missingStyleRowCount += 1
    else if (row.status === 'conflict') conflictRowCount += 1
    else if (row.status === 'exclusion_guarded') exclusionGuardedRowCount += 1
    else unresolvedRowCount += 1

    const key = comboKey(
      row.source.mallName,
      row.source.productName,
      row.source.itemName,
    )
    const current = unresolvedByKey.get(key)
    if (current) {
      current.rowCount += 1
      if (row.status === 'conflict') current.status = 'conflict'
      if (row.status === 'exclusion_guarded') current.status = 'exclusion_guarded'
      continue
    }
    unresolvedByKey.set(key, {
      key,
      mallName: row.source.mallName,
      productName: row.source.productName,
      itemName: row.source.itemName,
      ownProductCode: row.source.ownProductCode,
      rowCount: 1,
      status: row.status,
      appliedRule: row.appliedRule,
      appliedLookupKey: row.appliedLookupKey,
      candidateStyles: row.candidateStyles,
      candidates: row.candidates,
      tags: row.tags,
      itemTags: row.itemTags,
    })
  }

  return {
    mappedRowCount,
    candidateRowCount,
    missingStyleRowCount,
    conflictRowCount,
    unresolvedRowCount,
    excludedRowCount,
    exclusionGuardedRowCount,
    giftPendingRowCount,
    giftMappedRowCount,
    unresolvedCombos: [...unresolvedByKey.values()].sort(
      (left, right) =>
        left.productName.localeCompare(right.productName, 'ko-KR') ||
        left.itemName.localeCompare(right.itemName, 'ko-KR') ||
        right.rowCount - left.rowCount,
    ),
  }
}

export function matchInvoiceProductNameRows(
  sourceRows: SabangnetOrderRow[],
  maps: InvoiceProductNameMap[],
  catalog: ProductNameStyleCatalog,
  tagRoles: InvoiceProductNameTagRoleEntry[],
  lookupIndexInput?: ProductNameLookupIndex,
): InvoiceProductNameTransformRow[] {
  const activeMaps = maps.filter((map) => map.isActive)
  const lookupIndex =
    lookupIndexInput ?? indexLookupMaps(activeMaps, tagRoles)

  function matchLookupMaps(candidate: ProductNameCandidate, mallName: string) {
    const compact = compactProductNameKey(candidate.text)
    if (!compact) return []
    return preferMallMaps(lookupIndex.compact.get(compact) ?? [], mallName)
  }

  return sourceRows.map((source): InvoiceProductNameTransformRow => {
    const tags = classifyLeadingTags(source.productName, tagRoles)
    const itemTags = classifyInlineReservationShippingDateTags(
      source.itemName,
      tagRoles,
    )
    const candidates = generateProductNameCandidates({
      productName: source.productName,
      itemName: source.itemName,
      mallName: source.mallName,
      matchingProductName: matchingProductName(source.productName, tagRoles),
      matchingItemName: matchingItemName(source.itemName, tagRoles),
    })

    for (const candidate of candidates) {
      const hitMaps = matchLookupMaps(candidate, source.mallName)
      if (hitMaps.length === 0) continue
      const styles = uniqueStyles(hitMaps.map((map) => map.style))
      if (styles.length > 1) {
        return {
          source,
          status: 'conflict',
          mapId: null,
          style: null,
          transformedProductName: source.productName,
          appliedRule: candidate.rule,
          appliedLookupKey: candidate.text,
          ...itemNameOutcome(candidate.rule, source.itemName, false),
          candidates,
          candidateStyles: styles,
          tags,
          itemTags,
        }
      }
      return {
        source,
        status: 'mapped',
        mapId: hitMaps[0]!.id,
        style: styles[0]!,
        transformedProductName: styles[0]!.name,
        appliedRule: candidate.rule,
        appliedLookupKey: candidate.text,
        ...itemNameOutcome(candidate.rule, source.itemName, true),
        candidates,
        candidateStyles: styles,
        tags,
        itemTags,
      }
    }

    for (const candidate of candidates) {
      const styles = uniqueStyles(lookupStyles(catalog, candidate.text))
      if (styles.length === 0) continue
      if (styles.length > 1) {
        return {
          source,
          status: 'conflict',
          mapId: null,
          style: null,
          transformedProductName: source.productName,
          appliedRule: candidate.rule,
          appliedLookupKey: candidate.text,
          ...itemNameOutcome(candidate.rule, source.itemName, false),
          candidates,
          candidateStyles: styles,
          tags,
          itemTags,
        }
      }
      const viaCompact =
        (catalog.byName.get(normalizeInvoiceText(candidate.text)) ?? [])
          .length === 0
      return {
        source,
        status: 'candidate',
        mapId: null,
        style: styles[0]!,
        transformedProductName: styles[0]!.name,
        appliedRule: viaCompact ? 'compact' : candidate.rule,
        appliedLookupKey: candidate.text,
        ...itemNameOutcome(candidate.rule, source.itemName, false),
        candidates,
        candidateStyles: styles,
        tags,
        itemTags,
      }
    }

    if (candidates.length > 0) {
      return {
        source,
        status: 'missing_style',
        mapId: null,
        style: null,
        transformedProductName: source.productName,
        appliedRule: candidates[0]?.rule ?? null,
        appliedLookupKey: candidates[0]?.text ?? null,
        ...itemNameOutcome(candidates[0]?.rule ?? null, source.itemName, false),
        candidates,
        candidateStyles: [],
        tags,
        itemTags,
      }
    }

    return {
      source,
      status: 'unresolved',
      mapId: null,
      style: null,
      transformedProductName: source.productName,
      appliedRule: null,
      appliedLookupKey: null,
      ...itemNameOutcome(null, source.itemName, false),
      candidates,
      candidateStyles: [],
      tags,
      itemTags,
    }
  })
}

export function transformInvoiceProductNames(
  sourceRows: SabangnetOrderRow[],
  maps: InvoiceProductNameMap[],
  catalog: ProductNameStyleCatalog,
  tagRoles: InvoiceProductNameTagRoleEntry[] = [],
  exclusions: InvoiceProductNameExclusion[] = [],
  lookupIndexInput?: ProductNameLookupIndex,
): InvoiceProductNameTransformation {
  const matchedRows = matchInvoiceProductNameRows(
    sourceRows,
    maps,
    catalog,
    tagRoles,
    lookupIndexInput,
  )
  const base = {
    rows: matchedRows,
    ...summarizeProductNameRows(matchedRows),
  }
  return applyProductNameExclusions(base, exclusions)
}

/**
 * 베이스 스냅샷과 현재 원장의 차이 키에 걸린 행만 다시 맞춘다.
 * 영향 행이 없으면 같은 transformation 참조를 반환한다.
 */
export function applyProductNameMapDelta(input: {
  base: InvoiceProductNameTransformation
  baseSnapshot: ProductNameMapSnapshot
  candidateRowIndex: ProductNameCandidateRowIndex
  maps: InvoiceProductNameMap[]
  tagRoles: InvoiceProductNameTagRoleEntry[]
  catalog: ProductNameStyleCatalog
  lookupIndex?: ProductNameLookupIndex
}): {
  transformation: InvoiceProductNameTransformation
  affectedRowCount: number
} {
  const currentSnapshot = snapshotProductNameMaps(input.maps, input.tagRoles)
  const changedKeys = diffProductNameMapSnapshots(
    input.baseSnapshot,
    currentSnapshot,
  )
  if (changedKeys.size === 0) {
    return { transformation: input.base, affectedRowCount: 0 }
  }

  const affected = new Set<number>()
  for (const key of changedKeys) {
    const positions = input.candidateRowIndex.get(key)
    if (!positions) continue
    for (const rowIndex of positions) affected.add(rowIndex)
  }
  if (affected.size === 0) {
    return { transformation: input.base, affectedRowCount: 0 }
  }

  const positions = [...affected].sort((left, right) => left - right)
  const rematched = matchInvoiceProductNameRows(
    positions.map((rowIndex) => input.base.rows[rowIndex]!.source),
    [],
    input.catalog,
    input.tagRoles,
    input.lookupIndex ??
      indexLookupMaps(
        input.maps.filter((map) => map.isActive),
        input.tagRoles,
      ),
  )
  const rows = input.base.rows.slice()
  for (let index = 0; index < positions.length; index += 1) {
    rows[positions[index]!] = rematched[index]!
  }
  return {
    transformation: {
      rows,
      ...summarizeProductNameRows(rows),
    },
    affectedRowCount: positions.length,
  }
}

/**
 * 일반 품목명 변환 뒤에만, 사용자가 명시적으로 적용한 사은품 계획을 덮어쓴다.
 * 행 객체와 조합 키는 유지하고, 적용된 사은품 조합만 AI 미해결 목록에서 뺀다.
 */
export function overlayGiftSourceOnProductNames(
  transformation: InvoiceProductNameTransformation,
  plan: GiftSourcePlan,
): InvoiceProductNameTransformation {
  if (plan.candidateRowNumbers.size === 0) return transformation
  const groupByRow = new Map<number, string>()
  for (const group of plan.groups) {
    for (const rowNumber of group.sourceRowNumbers) {
      groupByRow.set(rowNumber, group.key)
    }
  }
  let changed = false
  const rows = transformation.rows.slice()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const rowNumber = row.source.rowNumber
    if (plan.mappedRowNumbers.has(rowNumber)) {
      const replacements = plan.replacementsByRow.get(rowNumber) ?? []
      const first = replacements[0]?.style ?? null
      rows[index] = {
        ...row,
        status: 'gift_mapped',
        style: first,
        transformedProductName: first?.name ?? row.source.productName,
        giftSourceKey: groupByRow.get(rowNumber) ?? null,
        giftReplacements: replacements,
      }
      changed = true
      continue
    }
    if (plan.pendingRowNumbers.has(rowNumber)) {
      rows[index] = {
        ...row,
        status: 'gift_pending',
        giftSourceKey: groupByRow.get(rowNumber) ?? null,
        giftReplacements: [],
      }
      changed = true
    }
  }
  if (!changed) return transformation
  return {
    rows,
    ...summarizeProductNameRows(rows),
  }
}

export function previewProductNameExclusion(
  rows: InvoiceProductNameTransformRow[],
  combo: { mallName: string; productName: string; itemName: string },
  keyIndex?: ProductNameRowKeyIndex,
) {
  const index = keyIndex ?? buildProductNameRowKeyIndex(rows)
  const targetKey = productExclusionKey(
    combo.mallName,
    combo.productName,
    combo.itemName,
  )
  const confirmed = collectConfirmedExclusionSiblings(
    rows,
    (row) => keysOf(row, index).exclusionKey === targetKey,
    index,
  )

  let matchCount = 0
  let excludedCount = 0
  let guardedCount = 0
  for (const row of rows) {
    const keys = keysOf(row, index)
    if (keys.exclusionKey !== targetKey) continue
    matchCount += 1
    if (hasConfirmedExclusionSibling(row.source, confirmed, keys)) {
      excludedCount += 1
    } else {
      guardedCount += 1
    }
  }
  return { matchCount, excludedCount, guardedCount }
}

export type ProductNameComboOrderSoloReason =
  | 'no_order_no'
  | 'no_confirmed_sibling'

export type ProductNameComboOrder = {
  source: SabangnetOrderRow
  soloReason: ProductNameComboOrderSoloReason | null
}

export type ProductNameComboOrderTarget =
  | { productName: string }
  | { mallName: string; productName: string; itemName: string }

function isExactComboTarget(
  target: ProductNameComboOrderTarget,
): target is { mallName: string; productName: string; itemName: string } {
  return 'itemName' in target
}

function matchesProductNameComboTarget(
  row: InvoiceProductNameTransformRow,
  target: ProductNameComboOrderTarget,
) {
  if (isExactComboTarget(target)) {
    return (
      productExclusionKey(
        row.source.mallName,
        row.source.productName,
        row.source.itemName,
      ) ===
      productExclusionKey(target.mallName, target.productName, target.itemName)
    )
  }
  return (
    normalizeInvoiceText(row.source.productName) ===
    normalizeInvoiceText(target.productName)
  )
}

export function collectProductNameComboOrders(
  rows: InvoiceProductNameTransformRow[],
  target: ProductNameComboOrderTarget,
): { orders: ProductNameComboOrder[]; soloCount: number } {
  const confirmed = collectConfirmedExclusionSiblings(rows, (row) =>
    matchesProductNameComboTarget(row, target),
  )

  const orders: ProductNameComboOrder[] = []
  for (const row of rows) {
    if (!matchesProductNameComboTarget(row, target)) continue
    const hasOrderNo = Boolean(row.source.customerOrderNo.trim())
    const soloReason: ProductNameComboOrder['soloReason'] =
      hasConfirmedExclusionSibling(row.source, confirmed)
        ? null
        : !hasOrderNo
          ? 'no_order_no'
          : 'no_confirmed_sibling'
    orders.push({ source: row.source, soloReason })
  }

  const soloRank = {
    no_order_no: 0,
    no_confirmed_sibling: 1,
  } as const
  orders.sort((left, right) => {
    const leftRank = left.soloReason ? soloRank[left.soloReason] : 2
    const rightRank = right.soloReason ? soloRank[right.soloReason] : 2
    if (leftRank !== rightRank) return leftRank - rightRank
    return left.source.rowNumber - right.source.rowNumber
  })

  return {
    orders,
    soloCount: orders.filter((item) => item.soloReason).length,
  }
}

export function catalogFromStyles(
  styles: StyleRef[],
): ProductNameStyleCatalog {
  const byName = new Map<string, StyleRef[]>()
  const byCompactName = new Map<string, StyleRef[]>()
  for (const style of styles) {
    const key = normalizeInvoiceText(style.name)
    const nameList = byName.get(key) ?? []
    nameList.push(style)
    byName.set(key, nameList)

    const compact = compactProductNameKey(style.name)
    if (!compact) continue
    const compactList = byCompactName.get(compact) ?? []
    compactList.push(style)
    byCompactName.set(compact, compactList)
  }
  return { byName, byCompactName }
}

export function productNameTransformationToName(
  transformation: InvoiceProductNameTransformation,
): InvoiceNameTransformation {
  const rows = transformation.rows.map((row) => ({
    source: row.source,
    transformedName: row.transformedProductName,
    status:
      row.status === 'mapped' || row.status === 'candidate'
        ? ('renamed' as const)
        : row.status === 'excluded'
          ? ('exception' as const)
          : row.status === 'conflict'
            ? ('unmapped_code' as const)
            : row.source.ownProductCode.trim()
              ? ('unmapped_code' as const)
              : ('missing_code' as const),
    matchedRuleId: row.mapId,
  }))
  return {
    rows,
    renamedRowCount:
      transformation.mappedRowCount + transformation.candidateRowCount,
    exceptionRowCount: transformation.excludedRowCount,
    unmappedCodeRowCount:
      transformation.unresolvedRowCount +
      transformation.conflictRowCount +
      transformation.missingStyleRowCount +
      transformation.exclusionGuardedRowCount,
    missingCodeRowCount: transformation.rows.filter(
      (row) =>
        row.status !== 'mapped' &&
        row.status !== 'candidate' &&
        row.status !== 'excluded' &&
        !row.source.ownProductCode.trim(),
    ).length,
    unresolvedCodes: [],
  }
}
