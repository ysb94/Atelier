import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import {
  generateProductNameCandidates,
  isEmptyItemNameHint,
  resolveItemNameConsumption,
  type ProductNameCandidate,
} from '@/lib/invoice/product-name-patterns'
import {
  classifyLeadingTags,
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

type LookupMapIndex = {
  compact: Map<string, InvoiceProductNameMap[]>
}

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
 * 저장된 태그 역할로 제외되는 선행 태그는 별칭으로도 넣는다.
 */
function indexLookupMaps(
  maps: InvoiceProductNameMap[],
  tagRoles: InvoiceProductNameTagRoleEntry[],
): LookupMapIndex {
  const compact = new Map<string, InvoiceProductNameMap[]>()
  for (const map of maps) {
    for (const raw of mapLookupTexts(map)) {
      const rawCompact = compactProductNameKey(raw)
      pushMap(compact, rawCompact, map)
      const stripped = matchingProductName(raw, tagRoles)
      const strippedCompact = compactProductNameKey(stripped)
      if (strippedCompact && strippedCompact !== rawCompact) {
        pushMap(compact, strippedCompact, map)
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
) {
  const orderFingerprints = new Set<string>()
  const shipmentOrderKeys = new Set<string>()
  for (const row of rows) {
    if (skip(row)) continue
    if (row.status !== 'mapped' && row.status !== 'candidate') continue
    orderFingerprints.add(buildOrderFingerprint(row.source))
    shipmentOrderKeys.add(shipmentOrderKeyOf(row.source))
  }
  return { orderFingerprints, shipmentOrderKeys }
}

function hasConfirmedExclusionSibling(
  source: SabangnetOrderRow,
  confirmed: ReturnType<typeof collectConfirmedExclusionSiblings>,
) {
  return (
    confirmed.orderFingerprints.has(buildOrderFingerprint(source)) ||
    confirmed.shipmentOrderKeys.has(shipmentOrderKeyOf(source))
  )
}

function applyProductNameExclusions(
  rows: InvoiceProductNameTransformRow[],
  exclusions: InvoiceProductNameExclusion[],
): InvoiceProductNameTransformRow[] {
  const activeKeys = new Set(
    exclusions
      .filter((item) => item.isActive)
      .map((item) =>
        productExclusionKey(item.mallName, item.productName, item.itemName),
      ),
  )
  if (activeKeys.size === 0) return rows

  const confirmed = collectConfirmedExclusionSiblings(rows, (row) =>
    activeKeys.has(
      productExclusionKey(
        row.source.mallName,
        row.source.productName,
        row.source.itemName,
      ),
    ),
  )

  return rows.map((row) => {
    const key = productExclusionKey(
      row.source.mallName,
      row.source.productName,
      row.source.itemName,
    )
    if (!activeKeys.has(key)) return row
    const excluded = hasConfirmedExclusionSibling(row.source, confirmed)
    return {
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
  })
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

export function transformInvoiceProductNames(
  sourceRows: SabangnetOrderRow[],
  maps: InvoiceProductNameMap[],
  catalog: ProductNameStyleCatalog,
  tagRoles: InvoiceProductNameTagRoleEntry[] = [],
  exclusions: InvoiceProductNameExclusion[] = [],
): InvoiceProductNameTransformation {
  const activeMaps = maps.filter((map) => map.isActive)
  const lookupIndex = indexLookupMaps(activeMaps, tagRoles)

  function matchLookupMaps(candidate: ProductNameCandidate, mallName: string) {
    const compact = compactProductNameKey(candidate.text)
    if (!compact) return []
    return preferMallMaps(lookupIndex.compact.get(compact) ?? [], mallName)
  }

  const matchedRows = sourceRows.map((source): InvoiceProductNameTransformRow => {
    const tags = classifyLeadingTags(source.productName, tagRoles)
    const candidates = generateProductNameCandidates({
      productName: source.productName,
      itemName: source.itemName,
      mallName: source.mallName,
      matchingProductName: matchingProductName(source.productName, tagRoles),
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
    }
  })

  const rows = applyProductNameExclusions(matchedRows, exclusions)
  return {
    rows,
    ...summarizeProductNameRows(rows),
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
  const rows = transformation.rows.map((row) => {
    const rowNumber = row.source.rowNumber
    if (plan.mappedRowNumbers.has(rowNumber)) {
      const replacements = plan.replacementsByRow.get(rowNumber) ?? []
      const first = replacements[0]?.style ?? null
      return {
        ...row,
        status: 'gift_mapped' as const,
        style: first,
        transformedProductName: first?.name ?? row.source.productName,
        giftSourceKey: groupByRow.get(rowNumber) ?? null,
        giftReplacements: replacements,
      }
    }
    if (plan.pendingRowNumbers.has(rowNumber)) {
      return {
        ...row,
        status: 'gift_pending' as const,
        giftSourceKey: groupByRow.get(rowNumber) ?? null,
        giftReplacements: [],
      }
    }
    return row
  })
  return {
    rows,
    ...summarizeProductNameRows(rows),
  }
}

export function previewProductNameExclusion(
  rows: InvoiceProductNameTransformRow[],
  combo: { mallName: string; productName: string; itemName: string },
) {
  const targetKey = productExclusionKey(
    combo.mallName,
    combo.productName,
    combo.itemName,
  )
  const confirmed = collectConfirmedExclusionSiblings(
    rows,
    (row) =>
      productExclusionKey(
        row.source.mallName,
        row.source.productName,
        row.source.itemName,
      ) === targetKey,
  )

  let matchCount = 0
  let excludedCount = 0
  let guardedCount = 0
  for (const row of rows) {
    const key = productExclusionKey(
      row.source.mallName,
      row.source.productName,
      row.source.itemName,
    )
    if (key !== targetKey) continue
    matchCount += 1
    if (hasConfirmedExclusionSibling(row.source, confirmed)) {
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
