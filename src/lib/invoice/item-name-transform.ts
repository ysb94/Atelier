import {
  buildOutgoingComponentRows,
  type InvoiceOptionTransformRow,
  type InvoiceOutgoingComponentRow,
} from '@/lib/invoice/option-transform'
import {
  accessoryStyleNameIndex,
  resolveInvoiceAccessories,
} from '@/lib/invoice/accessory-resolve'
import {
  lookupKeyFromProductRow,
  type InvoiceProductNameTransformRow,
} from '@/lib/invoice/product-name-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import {
  productCompositionFromOptionMap,
  productCompositionFromStyle,
  richerProductComposition,
  type ProductCompositionItem,
} from '@/lib/invoice/product-composition'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceAccessoryRule,
  InvoiceItemNameRule,
  InvoiceItemNameRuleComponent,
  InvoiceOptionMap,
  InvoiceOptionMapComponent,
  StyleRef,
} from '@/lib/types'

export type InvoiceItemNameResolvedBy = 'rule' | 'map' | 'dictionary' | null

export type InvoiceItemNameMatchStatus =
  | 'mapped'
  | 'passthrough'
  | 'consumed'
  | 'deleted'
  | 'conflict'
  | 'unresolved'

export type InvoiceItemNameTransformRow = {
  source: SabangnetOrderRow
  status: InvoiceItemNameMatchStatus
  mapId: string | null
  ruleId: string | null
  productStyle: StyleRef | null
  /** 출고구성 XLSX·화면 구성 열. 내품명 규칙/사전과 실제 세트 구성을 합친다. */
  extras: InvoiceOptionMapComponent[]
  /** CJ 13열 행 확장 전용. 실제 invoice_option_maps 세트 구성만 담는다. */
  expandableExtras: InvoiceOptionMapComponent[]
  transformedItemName: string
  displayChanged: boolean
  resolvedBy: InvoiceItemNameResolvedBy
  evidence: string[]
}

export type UnresolvedItemNameCombo = {
  key: string
  mallName: string
  productName: string
  /** 내품명 기준으로 쓸 값. 앞부분 소비면 suffix */
  itemName: string
  /** 사방넷 원본 내품명 */
  originalItemName: string
  ownProductCode: string
  productStyle: StyleRef | null
  /** 품목명 단계에서 맞춘 본품+구성품. 옵션 기준이 없으면 대표 본품 1개 */
  productComponents?: ProductCompositionItem[]
  /** 품목명 단계에서 본품을 맞춘 조회 키 */
  productLookupKey: string
  productAppliedRule: string | null
  /** 품목명 본품 연결만 예외 처리되어 공통 내품명 규칙만 저장할 수 있는 조합 */
  productConnectionExcluded: boolean
  mapId: string | null
  rowCount: number
  status: 'unresolved' | 'conflict' | 'passthrough'
  unknownPieces: string[]
  evidence: string[]
}

export type InvoiceItemNameTransformation = {
  rows: InvoiceItemNameTransformRow[]
  mappedRowCount: number
  passthroughRowCount: number
  consumedRowCount: number
  deletedRowCount: number
  unresolvedRowCount: number
  conflictRowCount: number
  autoComponentsRowCount: number
  autoDeletedRowCount: number
  unresolvedCombos: UnresolvedItemNameCombo[]
}

function comboKey(mallName: string, productName: string, itemName: string) {
  return [
    normalizeInvoiceText(mallName),
    normalizeInvoiceText(productName),
    normalizeInvoiceText(itemName),
  ].join('\u0000')
}

function extrasOf(map: InvoiceOptionMap): InvoiceOptionMapComponent[] {
  return map.components.filter((item) => item.role !== 'main')
}

export function formatItemNameFromComponents(
  components: Array<Pick<InvoiceItemNameRuleComponent, 'style' | 'quantity'>>,
): string {
  return components
    .flatMap((item) =>
      Array.from(
        { length: Math.max(1, Math.floor(item.quantity || 1)) },
        () => item.style.name,
      ),
    )
    .join(', ')
}

/** normalizedItemName별 활성 규칙 목록. 변환 시작 시 한 번만 만든다. */
function indexItemNameRules(
  rules: InvoiceItemNameRule[],
): Map<string, InvoiceItemNameRule[]> {
  const byItemName = new Map<string, InvoiceItemNameRule[]>()
  for (const rule of rules) {
    if (!rule.isActive) continue
    const list = byItemName.get(rule.normalizedItemName)
    if (list) list.push(rule)
    else byItemName.set(rule.normalizedItemName, [rule])
  }
  return byItemName
}

function pickRuleFromCandidates(
  active: InvoiceItemNameRule[],
  mainStyleId: string | null,
  normalizedLookup: string,
): InvoiceItemNameRule | null {
  if (mainStyleId && normalizedLookup) {
    const exact = active.find(
      (rule) =>
        rule.scope === 'lookup_key' &&
        rule.mainStyle?.styleId === mainStyleId &&
        rule.normalizedProductLookupKey === normalizedLookup,
    )
    if (exact) return exact
  }
  if (mainStyleId) {
    const main = active.find(
      (rule) =>
        rule.scope === 'main_style' && rule.mainStyle?.styleId === mainStyleId,
    )
    if (main) return main
  }
  return active.find((rule) => rule.scope === 'global') ?? null
}

export function pickInvoiceItemNameRule(
  rules: InvoiceItemNameRule[],
  itemName: string,
  mainStyleId: string | null,
  productLookupKey: string | null = null,
): InvoiceItemNameRule | null {
  const item = normalizeInvoiceText(itemName)
  if (!item) return null
  const active = rules.filter(
    (rule) => rule.isActive && rule.normalizedItemName === item,
  )
  return pickRuleFromCandidates(
    active,
    mainStyleId,
    normalizeInvoiceText(productLookupKey ?? ''),
  )
}

function extrasFromRule(rule: InvoiceItemNameRule): InvoiceOptionMapComponent[] {
  return rule.components.map((item, index) => ({
    id: item.id,
    mapId: rule.id,
    style: item.style,
    role: item.role,
    quantity: item.quantity,
    sortOrder: item.sortOrder ?? index,
  }))
}

function extrasFromDictionary(
  components: Array<{ style: StyleRef; quantity: number }>,
): InvoiceOptionMapComponent[] {
  return components.map((item, index) => ({
    id: `dict-${item.style.styleId}`,
    mapId: '',
    style: item.style,
    role: 'included',
    quantity: item.quantity,
    sortOrder: index,
  }))
}

function mergeExtras(
  primary: InvoiceOptionMapComponent[],
  secondary: InvoiceOptionMapComponent[],
): InvoiceOptionMapComponent[] {
  const seen = new Set(primary.map((item) => item.style.styleId))
  const merged = [...primary]
  for (const extra of secondary) {
    if (seen.has(extra.style.styleId)) continue
    seen.add(extra.style.styleId)
    merged.push(extra)
  }
  return merged
}

function expandableExtrasOf(
  extras: InvoiceOptionMapComponent[],
  mapExtras: InvoiceOptionMapComponent[],
) {
  if (mapExtras.length === 0) return []
  const allowed = new Set(mapExtras.map((item) => item.style.styleId))
  return extras.filter((item) => allowed.has(item.style.styleId))
}

type OptionMapIndex = {
  /** `mall\u0000product\u0000item` exact 조합 */
  exact: Map<string, InvoiceOptionMap[]>
  /** 쇼핑몰을 비운 기준의 `product\u0000item` 조합 */
  noMall: Map<string, InvoiceOptionMap[]>
}

/** 활성 옵션맵을 조합 키로 인덱싱한다. 변환 시작 시 한 번만 만든다. */
function indexOptionMaps(maps: InvoiceOptionMap[]): OptionMapIndex {
  const exact = new Map<string, InvoiceOptionMap[]>()
  const noMall = new Map<string, InvoiceOptionMap[]>()
  for (const map of maps) {
    const combo = `${map.normalizedProductName}\u0000${map.normalizedItemName}`
    const exactKey = `${map.normalizedMallName}\u0000${combo}`
    const exactList = exact.get(exactKey)
    if (exactList) exactList.push(map)
    else exact.set(exactKey, [map])
    if (!map.normalizedMallName) {
      const noMallList = noMall.get(combo)
      if (noMallList) noMallList.push(map)
      else noMall.set(combo, [map])
    }
  }
  return { exact, noMall }
}

function pickMaps(
  index: OptionMapIndex,
  normalizedMall: string,
  normalizedProduct: string,
  itemName: string,
): InvoiceOptionMap[] {
  const combo = `${normalizedProduct}\u0000${normalizeInvoiceText(itemName)}`
  const exact = index.exact.get(`${normalizedMall}\u0000${combo}`)
  if (exact && exact.length > 0) return exact
  return index.noMall.get(combo) ?? []
}

function pickMapsPreferring(
  index: OptionMapIndex,
  mallName: string,
  productName: string,
  preferredItemName: string,
  fallbackItemName: string,
) {
  const mall = normalizeInvoiceText(mallName)
  const product = normalizeInvoiceText(productName)
  const preferred = pickMaps(index, mall, product, preferredItemName)
  if (preferred.length > 0) return preferred
  if (preferredItemName !== fallbackItemName) {
    return pickMaps(index, mall, product, fallbackItemName)
  }
  return []
}

/**
 * 확정된 본품과 유효 내품명으로 표시 내품명·물리 구성만 계산한다.
 * 우선순위는 조회 키 exact → 기존 본품 전체 → 공통 → 기존 invoice_option_maps →
 * 부속품 사전 → 원문 유지다.
 * 공통 규칙은 쇼핑몰·원본 품목명을 보지 않는다. 본품 미확정 행에는 본품별·조회 키 규칙을 쓰지 않는다.
 * 조회 키가 다른 행은 독립 규칙이다. 같은 조회 키가 다른 본품으로 재연결되면 적용하지 않는다.
 * 원본·유효 내품명이 모두 비어 있으면 빈칸으로 통과하고 검토 목록에서 뺀다.
 * 품목명 원장이 내품명 전체 단독으로 본품을 확정한 행은 내품명을 비우고 검토 목록에서 뺀다.
 * 앞부분만 소비한 행은 남은 suffix로 내품명 기준을 찾고, 없으면 원문 조합 원장을 본다.
 * 구성만 저장된 기준은 세트 행 확장에 쓰되, 소비되지 않은 내품명은 유효 값을 유지한다.
 * 내품명 규칙·부속품 사전의 M번호는 공식 내품명과 출고구성에만 쓰고 CJ 행은 늘리지 않는다.
 * CJ 13열 행 확장은 invoice_option_maps에 등록된 실제 세트 구성만 사용한다.
 * 상품 연결 예외 행도 내품명은 같은 규칙으로 처리하되 option map으로 본품을 다시 연결하지 않는다.
 */
export function transformInvoiceItemNames(
  sourceRows: SabangnetOrderRow[],
  maps: InvoiceOptionMap[],
  productRows: InvoiceProductNameTransformRow[] = [],
  rules: InvoiceItemNameRule[] = [],
  accessoryRules: InvoiceAccessoryRule[] = [],
  styles: StyleRef[] = [],
): InvoiceItemNameTransformation {
  const activeMaps = maps.filter((map) => map.isActive)
  const activeRules = rules.filter((rule) => rule.isActive)
  const optionMapIndex = indexOptionMaps(activeMaps)
  const rulesByItemName = indexItemNameRules(activeRules)
  const productByRow = new Map(
    productRows.map((row) => [row.source.rowNumber, row]),
  )
  const unresolvedByKey = new Map<string, UnresolvedItemNameCombo>()
  const styleByName = accessoryStyleNameIndex(styles)
  const activeAccessoryRules = accessoryRules.filter((rule) => rule.isActive)
  let mappedRowCount = 0
  let passthroughRowCount = 0
  let consumedRowCount = 0
  let deletedRowCount = 0
  let unresolvedRowCount = 0
  let conflictRowCount = 0
  let autoComponentsRowCount = 0
  let autoDeletedRowCount = 0

  function remember(
    source: SabangnetOrderRow,
    itemName: string,
    status: 'unresolved' | 'conflict' | 'passthrough',
    productStyle: StyleRef | null,
    mapId: string | null = null,
    extra: {
      unknownPieces?: string[]
      evidence?: string[]
      productComponents?: ProductCompositionItem[]
    } = {},
  ) {
    const key = comboKey(source.mallName, source.productName, itemName)
    const product = productByRow.get(source.rowNumber)
    const lookup = lookupKeyFromProductRow(product)
    const productConnectionExcluded = product?.status === 'excluded'
    const productComponents =
      extra.productComponents ?? productCompositionFromStyle(productStyle)
    const current = unresolvedByKey.get(key)
    if (current) {
      current.rowCount += 1
      if (status === 'conflict') current.status = 'conflict'
      if (!current.mapId && mapId) current.mapId = mapId
      if (!current.productLookupKey && lookup.productLookupKey) {
        current.productLookupKey = lookup.productLookupKey
        current.productAppliedRule = lookup.productAppliedRule
      }
      current.productConnectionExcluded =
        current.productConnectionExcluded || productConnectionExcluded
      current.productComponents = richerProductComposition(
        current.productComponents ?? [],
        productComponents,
      )
      if (extra.unknownPieces?.length) {
        current.unknownPieces = [
          ...new Set([...current.unknownPieces, ...extra.unknownPieces]),
        ]
      }
      if (extra.evidence?.length && current.evidence.length === 0) {
        current.evidence = extra.evidence
      }
      return
    }
    unresolvedByKey.set(key, {
      key,
      mallName: source.mallName,
      productName: source.productName,
      itemName,
      originalItemName: source.itemName,
      ownProductCode: source.ownProductCode,
      productStyle,
      productComponents,
      productLookupKey: lookup.productLookupKey,
      productAppliedRule: lookup.productAppliedRule,
      productConnectionExcluded,
      mapId,
      rowCount: 1,
      status,
      unknownPieces: extra.unknownPieces ?? [],
      evidence: extra.evidence ?? [],
    })
  }

  const rows = sourceRows.map((source): InvoiceItemNameTransformRow => {
    const product = productByRow.get(source.rowNumber)
    const productExcluded = product?.status === 'excluded'
    const productStyle = product?.style ?? null
    const effectiveItemName = product?.effectiveItemName ?? source.itemName
    // 상품 연결 예외는 option map으로 본품을 다시 연결하지 않는다.
    // 내품명 자체는 일반 행과 같이 전역 규칙·부속품 사전을 적용한다.
    const matches = productExcluded
      ? []
      : pickMapsPreferring(
          optionMapIndex,
          source.mallName,
          source.productName,
          effectiveItemName,
          source.itemName,
        )
    const mapExtras = matches.length === 1 ? extrasOf(matches[0]!) : []
    const consumed = Boolean(product?.itemNameConsumed)
    const blankItem =
      !effectiveItemName.trim() && !source.itemName.trim()
    const productLookupKey = lookupKeyFromProductRow(product).productLookupKey
    const normalizedEffectiveItemName = normalizeInvoiceText(effectiveItemName)
    const rule =
      consumed || !normalizedEffectiveItemName
        ? null
        : pickRuleFromCandidates(
            rulesByItemName.get(normalizedEffectiveItemName) ?? [],
            productStyle?.styleId ?? null,
            normalizeInvoiceText(productLookupKey),
          )

    if (matches.length > 1 && !rule) {
      conflictRowCount += 1
      remember(source, effectiveItemName, 'conflict', productStyle)
      return {
        source,
        status: 'conflict',
        mapId: null,
        ruleId: null,
        productStyle,
        extras: [],
        expandableExtras: [],
        transformedItemName: consumed ? '' : effectiveItemName,
        displayChanged: consumed || effectiveItemName !== source.itemName,
        resolvedBy: null,
        evidence: [],
      }
    }

    const map = matches.length === 1 ? (matches[0] ?? null) : null
    const resolvedStyle =
      map?.components.find((item) => item.role === 'main')?.style ??
      productStyle

    if (consumed) {
      consumedRowCount += 1
      return {
        source,
        status: 'consumed',
        mapId: map?.id ?? null,
        ruleId: null,
        productStyle: resolvedStyle,
        extras: mapExtras,
        expandableExtras: mapExtras,
        transformedItemName: '',
        displayChanged: Boolean(source.itemName),
        resolvedBy: null,
        evidence: [],
      }
    }

    if (rule?.action === 'delete') {
      deletedRowCount += 1
      return {
        source,
        status: 'deleted',
        mapId: map?.id ?? null,
        ruleId: rule.id,
        productStyle: resolvedStyle,
        extras: mapExtras,
        expandableExtras: mapExtras,
        transformedItemName: '',
        displayChanged: Boolean(source.itemName) || Boolean(effectiveItemName),
        resolvedBy: 'rule',
        evidence: [],
      }
    }

    if (rule?.action === 'components') {
      mappedRowCount += 1
      const extras = mergeExtras(extrasFromRule(rule), mapExtras)
      const display = formatItemNameFromComponents(rule.components)
      return {
        source,
        status: 'mapped',
        mapId: map?.id ?? null,
        ruleId: rule.id,
        productStyle: resolvedStyle,
        extras,
        expandableExtras: expandableExtrasOf(extras, mapExtras),
        transformedItemName: display,
        displayChanged: display !== source.itemName,
        resolvedBy: 'rule',
        evidence: [],
      }
    }

    if (map) {
      const display = map.displayItemName.trim()
      if (display) {
        mappedRowCount += 1
        return {
          source,
          status: 'mapped',
          mapId: map.id,
          ruleId: null,
          productStyle: resolvedStyle,
          extras: mapExtras,
          expandableExtras: mapExtras,
          transformedItemName: display,
          displayChanged: display !== source.itemName,
          resolvedBy: 'map',
          evidence: [],
        }
      }
      if (blankItem) {
        consumedRowCount += 1
        return {
          source,
          status: 'consumed',
          mapId: map.id,
          ruleId: null,
          productStyle: resolvedStyle,
          extras: mapExtras,
          expandableExtras: mapExtras,
          transformedItemName: '',
          displayChanged: false,
          resolvedBy: 'map',
          evidence: [],
        }
      }
      unresolvedRowCount += 1
      passthroughRowCount += 1
      remember(source, effectiveItemName, 'passthrough', resolvedStyle, map.id, {
        productComponents: productCompositionFromOptionMap(map, resolvedStyle),
      })
      return {
        source,
        status: 'passthrough',
        mapId: map.id,
        ruleId: null,
        productStyle: resolvedStyle,
        extras: mapExtras,
        expandableExtras: mapExtras,
        transformedItemName: effectiveItemName,
        displayChanged: effectiveItemName !== source.itemName,
        resolvedBy: 'map',
        evidence: [],
      }
    }

    if (blankItem) {
      consumedRowCount += 1
      return {
        source,
        status: 'consumed',
        mapId: null,
        ruleId: null,
        productStyle: resolvedStyle,
        extras: [],
        expandableExtras: [],
        transformedItemName: '',
        displayChanged: false,
        resolvedBy: null,
        evidence: [],
      }
    }

    // 빈 사전도 해석기에 넘긴다. 그래야 첫 파일에서 미인식 조각을 수집해
    // AI가 사전의 첫 규칙부터 제안할 수 있고, 본품 속성만 있는 행은 자동으로 비운다.
    const resolved = resolveInvoiceAccessories({
      itemName: effectiveItemName,
      productLookupKey,
      mainStyle: resolvedStyle,
      dictionary: activeAccessoryRules,
      styleByName,
    })
    if (activeAccessoryRules.length === 0) {
      unresolvedRowCount += 1
      passthroughRowCount += 1
      remember(source, effectiveItemName, 'passthrough', productStyle, null, {
        unknownPieces: resolved.unknown,
        evidence: resolved.evidence,
      })
      return {
        source,
        status: 'passthrough',
        mapId: null,
        ruleId: null,
        productStyle,
        extras: [],
        expandableExtras: [],
        transformedItemName: effectiveItemName,
        displayChanged: effectiveItemName !== source.itemName,
        resolvedBy: 'dictionary',
        evidence: resolved.evidence,
      }
    }
    if (resolved.unknown.length === 0 && resolved.components.length > 0) {
      mappedRowCount += 1
      autoComponentsRowCount += 1
      const extras = extrasFromDictionary(resolved.components)
      const display = formatItemNameFromComponents(resolved.components)
      return {
        source,
        status: 'mapped',
        mapId: null,
        ruleId: null,
        productStyle: resolvedStyle,
        extras,
        expandableExtras: [],
        transformedItemName: display,
        displayChanged: display !== source.itemName,
        resolvedBy: 'dictionary',
        evidence: resolved.evidence,
      }
    }
    if (resolved.unknown.length === 0) {
      deletedRowCount += 1
      autoDeletedRowCount += 1
      return {
        source,
        status: 'deleted',
        mapId: null,
        ruleId: null,
        productStyle: resolvedStyle,
        extras: [],
        expandableExtras: [],
        transformedItemName: '',
        displayChanged: Boolean(source.itemName) || Boolean(effectiveItemName),
        resolvedBy: 'dictionary',
        evidence: resolved.evidence,
      }
    }
    unresolvedRowCount += 1
    passthroughRowCount += 1
    remember(source, effectiveItemName, 'passthrough', productStyle, null, {
      unknownPieces: resolved.unknown,
      evidence: resolved.evidence,
    })
    return {
      source,
      status: 'passthrough',
      mapId: null,
      ruleId: null,
      productStyle,
      extras: [],
      expandableExtras: [],
      transformedItemName: effectiveItemName,
      displayChanged: effectiveItemName !== source.itemName,
      resolvedBy: 'dictionary',
      evidence: resolved.evidence,
    }
  })

  return {
    rows,
    mappedRowCount,
    passthroughRowCount,
    consumedRowCount,
    deletedRowCount,
    unresolvedRowCount,
    conflictRowCount,
    autoComponentsRowCount,
    autoDeletedRowCount,
    unresolvedCombos: [...unresolvedByKey.values()].sort(
      (left, right) =>
        right.rowCount - left.rowCount ||
        left.productName.localeCompare(right.productName, 'ko-KR'),
    ),
  }
}

export function itemNamePreviewLabel(row: InvoiceItemNameTransformRow) {
  if (row.displayChanged) return row.transformedItemName
  return row.source.itemName
}

export function buildOutgoingComponentRowsFromStages(options: {
  productRows: InvoiceProductNameTransformRow[]
  itemRows: InvoiceItemNameTransformRow[]
  giftRowsBySource: Map<number, SabangnetOrderRow[]>
  packingMaterials?: {
    styleNo: string
    name: string
    count: number
  }[]
}): InvoiceOutgoingComponentRow[] {
  const itemByRow = new Map(
    options.itemRows.map((row) => [row.source.rowNumber, row]),
  )
  const optionRows: InvoiceOptionTransformRow[] = options.productRows
    .filter((product) => product.status !== 'excluded')
    .map((product) => {
      const item = itemByRow.get(product.source.rowNumber)
      const mapped =
        product.status === 'mapped' || product.status === 'candidate'
      return {
        source: product.source,
        status: mapped ? 'mapped' : product.status === 'conflict' ? 'conflict' : 'unresolved',
        mapId: item?.mapId ?? product.mapId,
        main: product.style,
        extras: item?.extras ?? [],
        transformedName: product.transformedProductName,
        transformedItemName:
          item?.transformedItemName ??
          product.effectiveItemName ??
          product.source.itemName,
        codeHintName: null,
      }
    })
  return buildOutgoingComponentRows({
    optionRows,
    giftRowsBySource: options.giftRowsBySource,
    packingMaterials: options.packingMaterials,
  })
}
