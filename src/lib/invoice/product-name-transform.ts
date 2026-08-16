import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import {
  generateProductNameCandidates,
  productNameRuleConsumesItemName,
  type ProductNameCandidate,
} from '@/lib/invoice/product-name-patterns'
import {
  classifyLeadingTags,
  matchingProductName,
  type ParsedProductNameTag,
} from '@/lib/invoice/product-name-tags'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceNameTransformation } from '@/lib/invoice/name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
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

export type InvoiceProductNameTransformRow = {
  source: SabangnetOrderRow
  status: InvoiceProductNameMatchStatus
  mapId: string | null
  style: StyleRef | null
  transformedProductName: string
  appliedRule: string | null
  /** 내품명 단독 조회 키가 원장과 exact 매칭되어 최종 내품명을 비울지 여부 */
  itemNameConsumed: boolean
  candidates: ProductNameCandidate[]
  candidateStyles: StyleRef[]
  tags: ParsedProductNameTag[]
}

export type UnresolvedProductNameCombo = {
  key: string
  mallName: string
  productName: string
  itemName: string
  ownProductCode: string
  rowCount: number
  status: Exclude<InvoiceProductNameMatchStatus, 'mapped'>
  appliedRule: string | null
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
  unresolvedCombos: UnresolvedProductNameCombo[]
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

function comboIndexKey(mall: string, product: string, item: string) {
  return [mall, product, item].join('\u0000')
}

type ComboMapIndex = {
  exact: Map<string, InvoiceProductNameMap[]>
  anyMall: Map<string, InvoiceProductNameMap[]>
}

type LookupMapIndex = {
  strict: Map<string, InvoiceProductNameMap[]>
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

function indexComboMaps(maps: InvoiceProductNameMap[]): ComboMapIndex {
  const exact = new Map<string, InvoiceProductNameMap[]>()
  const anyMall = new Map<string, InvoiceProductNameMap[]>()
  for (const map of maps) {
    if (map.normalizedLookupKey) continue
    const exactKey = comboIndexKey(
      map.normalizedMallName,
      map.normalizedProductName,
      map.normalizedItemNameContext,
    )
    const exactList = exact.get(exactKey) ?? []
    exactList.push(map)
    exact.set(exactKey, exactList)
    if (!map.normalizedMallName) {
      const anyKey = comboIndexKey(
        '',
        map.normalizedProductName,
        map.normalizedItemNameContext,
      )
      const anyList = anyMall.get(anyKey) ?? []
      anyList.push(map)
      anyMall.set(anyKey, anyList)
    }
  }
  return { exact, anyMall }
}

/**
 * 조회 키 원장 색인.
 * 엄격 키를 먼저 쓰고, 없을 때만 압축 키를 본다.
 * 저장된 태그 역할로 제외되는 선행 태그는 별칭으로도 넣는다.
 */
function indexLookupMaps(
  maps: InvoiceProductNameMap[],
  tagRoles: InvoiceProductNameTagRoleEntry[],
): LookupMapIndex {
  const strict = new Map<string, InvoiceProductNameMap[]>()
  const compact = new Map<string, InvoiceProductNameMap[]>()
  for (const map of maps) {
    if (!map.normalizedLookupKey) continue
    const raw = map.lookupKey.trim() || map.normalizedLookupKey
    pushMap(strict, map.normalizedLookupKey, map)
    pushMap(compact, compactProductNameKey(raw), map)

    const stripped = matchingProductName(raw, tagRoles)
    const strippedNorm = normalizeInvoiceText(stripped)
    if (strippedNorm && strippedNorm !== map.normalizedLookupKey) {
      pushMap(strict, strippedNorm, map)
    }
    const strippedCompact = compactProductNameKey(stripped)
    const rawCompact = compactProductNameKey(raw)
    if (strippedCompact && strippedCompact !== rawCompact) {
      pushMap(compact, strippedCompact, map)
    }
  }
  return { strict, compact }
}

function pickMaps(
  index: ComboMapIndex,
  mallName: string,
  productName: string,
  itemName: string,
): InvoiceProductNameMap[] {
  const mall = normalizeInvoiceText(mallName)
  const product = normalizeInvoiceText(productName)
  const item = normalizeInvoiceText(itemName)
  const exact = index.exact.get(comboIndexKey(mall, product, item)) ?? []
  if (exact.length > 0) return exact
  return index.anyMall.get(comboIndexKey('', product, item)) ?? []
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

/**
 * 품목명 exact 기준을 최우선으로 쓰고, 없을 때만 후보 파서로 styles.name을 찾는다.
 * 내품명 변환 결과는 포함하지 않는다. 후보가 하나여도 기준을 자동 저장하지 않는다.
 */
export function transformInvoiceProductNames(
  sourceRows: SabangnetOrderRow[],
  maps: InvoiceProductNameMap[],
  catalog: ProductNameStyleCatalog,
  tagRoles: InvoiceProductNameTagRoleEntry[] = [],
): InvoiceProductNameTransformation {
  const activeMaps = maps.filter((map) => map.isActive)
  const comboIndex = indexComboMaps(activeMaps)
  const lookupIndex = indexLookupMaps(activeMaps, tagRoles)
  const unresolvedByKey = new Map<string, UnresolvedProductNameCombo>()
  let mappedRowCount = 0
  let candidateRowCount = 0
  let missingStyleRowCount = 0
  let conflictRowCount = 0
  let unresolvedRowCount = 0

  function remember(row: InvoiceProductNameTransformRow) {
    if (row.status === 'mapped') return
    const key = comboKey(
      row.source.mallName,
      row.source.productName,
      row.source.itemName,
    )
    const current = unresolvedByKey.get(key)
    if (current) {
      current.rowCount += 1
      if (row.status === 'conflict') current.status = 'conflict'
      return
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
      candidateStyles: row.candidateStyles,
      candidates: row.candidates,
      tags: row.tags,
    })
  }

  function matchLookupMaps(
    candidate: ProductNameCandidate,
  ): { maps: InvoiceProductNameMap[]; viaCompact: boolean } | null {
    const strictHits = uniqueMaps(
      lookupIndex.strict.get(normalizeInvoiceText(candidate.text)) ?? [],
    )
    if (strictHits.length > 0) return { maps: strictHits, viaCompact: false }
    const compact = compactProductNameKey(candidate.text)
    if (!compact) return null
    const compactHits = uniqueMaps(lookupIndex.compact.get(compact) ?? [])
    if (compactHits.length === 0) return null
    return { maps: compactHits, viaCompact: true }
  }

  const rows = sourceRows.map((source): InvoiceProductNameTransformRow => {
    const tags = classifyLeadingTags(source.productName, tagRoles)
    const matches = pickMaps(
      comboIndex,
      source.mallName,
      source.productName,
      source.itemName,
    )
    if (matches.length === 1) {
      const map = matches[0]!
      mappedRowCount += 1
      return {
        source,
        status: 'mapped',
        mapId: map.id,
        style: map.style,
        transformedProductName: map.style.name,
        appliedRule: 'exact',
        itemNameConsumed: false,
        candidates: [],
        candidateStyles: [map.style],
        tags,
      }
    }
    if (matches.length > 1) {
      conflictRowCount += 1
      const styles = uniqueStyles(matches.map((map) => map.style))
      const row: InvoiceProductNameTransformRow = {
        source,
        status: 'conflict',
        mapId: null,
        style: null,
        transformedProductName: source.productName,
        appliedRule: 'exact',
        itemNameConsumed: false,
        candidates: [],
        candidateStyles: styles,
        tags,
      }
      remember(row)
      return row
    }

    const candidates = generateProductNameCandidates({
      productName: source.productName,
      itemName: source.itemName,
      mallName: source.mallName,
      ownProductCode: source.ownProductCode,
      matchingProductName: matchingProductName(source.productName, tagRoles),
    })
    // 기존 원장은 후보 순서대로 훑고 먼저 맞는 조회 키가 정답이다.
    // 엄격 키가 없으면 같은 후보의 압축 키로 이어 본다.
    for (const candidate of candidates) {
      const hit = matchLookupMaps(candidate)
      if (!hit) continue
      const styles = uniqueStyles(hit.maps.map((map) => map.style))
      const appliedRule = hit.viaCompact ? 'compact' : candidate.rule
      if (styles.length > 1) {
        conflictRowCount += 1
        const row: InvoiceProductNameTransformRow = {
          source,
          status: 'conflict',
          mapId: null,
          style: null,
          transformedProductName: source.productName,
          appliedRule,
          itemNameConsumed: false,
          candidates,
          candidateStyles: styles,
          tags,
        }
        remember(row)
        return row
      }
      mappedRowCount += 1
      return {
        source,
        status: 'mapped',
        mapId: hit.maps[0]!.id,
        style: styles[0]!,
        transformedProductName: styles[0]!.name,
        appliedRule,
        itemNameConsumed: productNameRuleConsumesItemName(candidate.rule),
        candidates,
        candidateStyles: styles,
        tags,
      }
    }

    const matched: { candidate: ProductNameCandidate; styles: StyleRef[] }[] =
      []
    for (const candidate of candidates) {
      const styles = lookupStyles(catalog, candidate.text)
      if (styles.length > 0) matched.push({ candidate, styles })
    }
    const allStyles = uniqueStyles(matched.flatMap((item) => item.styles))

    if (allStyles.length === 1) {
      const hit = matched.find((item) =>
        item.styles.some((style) => style.styleId === allStyles[0]?.styleId),
      )
      const viaCompact =
        hit !== undefined &&
        (catalog.byName.get(normalizeInvoiceText(hit.candidate.text)) ?? [])
          .length === 0
      candidateRowCount += 1
      const row: InvoiceProductNameTransformRow = {
        source,
        status: 'candidate',
        mapId: null,
        style: allStyles[0]!,
        transformedProductName: allStyles[0]!.name,
        appliedRule: viaCompact
          ? 'compact'
          : (hit?.candidate.rule ?? 'candidate'),
        itemNameConsumed: false,
        candidates,
        candidateStyles: allStyles,
        tags,
      }
      remember(row)
      return row
    }
    if (allStyles.length > 1) {
      conflictRowCount += 1
      const row: InvoiceProductNameTransformRow = {
        source,
        status: 'conflict',
        mapId: null,
        style: null,
        transformedProductName: source.productName,
        appliedRule: matched[0]?.candidate.rule ?? null,
        itemNameConsumed: false,
        candidates,
        candidateStyles: allStyles,
        tags,
      }
      remember(row)
      return row
    }
    if (candidates.length > 0) {
      missingStyleRowCount += 1
      const row: InvoiceProductNameTransformRow = {
        source,
        status: 'missing_style',
        mapId: null,
        style: null,
        transformedProductName: source.productName,
        appliedRule: candidates[0]?.rule ?? null,
        itemNameConsumed: false,
        candidates,
        candidateStyles: [],
        tags,
      }
      remember(row)
      return row
    }

    unresolvedRowCount += 1
    const row: InvoiceProductNameTransformRow = {
      source,
      status: 'unresolved',
      mapId: null,
      style: null,
      transformedProductName: source.productName,
      appliedRule: null,
      itemNameConsumed: false,
      candidates,
      candidateStyles: [],
      tags,
    }
    remember(row)
    return row
  })

  return {
    rows,
    mappedRowCount,
    candidateRowCount,
    missingStyleRowCount,
    conflictRowCount,
    unresolvedRowCount,
    unresolvedCombos: [...unresolvedByKey.values()].sort(
      (left, right) =>
        left.productName.localeCompare(right.productName, 'ko-KR') ||
        left.itemName.localeCompare(right.itemName, 'ko-KR') ||
        right.rowCount - left.rowCount,
    ),
  }
}

export function catalogFromStyles(styles: StyleRef[]): ProductNameStyleCatalog {
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
    exceptionRowCount: 0,
    unmappedCodeRowCount:
      transformation.unresolvedRowCount +
      transformation.conflictRowCount +
      transformation.missingStyleRowCount,
    missingCodeRowCount: transformation.rows.filter(
      (row) =>
        row.status !== 'mapped' &&
        row.status !== 'candidate' &&
        !row.source.ownProductCode.trim(),
    ).length,
    unresolvedCodes: [],
  }
}
