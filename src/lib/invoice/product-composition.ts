import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import { generateProductNameCandidates } from '@/lib/invoice/product-name-patterns'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type {
  InvoiceOptionMap,
  InvoiceOptionMapComponent,
  InvoiceProductNameMap,
  StyleRef,
} from '@/lib/types'

export type ProductCompositionItem = {
  style: StyleRef
  quantity: number
}

export function formatProductCompositionLine(item: ProductCompositionItem) {
  return item.quantity > 1
    ? `${item.style.styleNo} · ${item.style.name} × ${item.quantity}`
    : `${item.style.styleNo} · ${item.style.name}`
}

export function formatProductCompositionLines(
  items: ProductCompositionItem[],
): string[] {
  return items.map(formatProductCompositionLine)
}

export function productCompositionSearchText(items: ProductCompositionItem[]) {
  return items
    .flatMap((item) => [item.style.styleNo, item.style.name])
    .join(' ')
}

export function productCompositionFromStyle(
  style: StyleRef | null | undefined,
): ProductCompositionItem[] {
  return style ? [{ style, quantity: 1 }] : []
}

export function productCompositionFromOptionMap(
  map: Pick<InvoiceOptionMap, 'components'> | null | undefined,
  fallback: StyleRef | null = null,
): ProductCompositionItem[] {
  if (!map?.components.length) return productCompositionFromStyle(fallback)
  return [...map.components]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((item) => ({
      style: item.style,
      quantity: item.quantity,
    }))
}

export function richerProductComposition(
  current: ProductCompositionItem[],
  next: ProductCompositionItem[],
) {
  return next.length > current.length ? next : current
}

function optionMapLookupTexts(map: InvoiceOptionMap): string[] {
  const texts = [map.productName]
  for (const candidate of generateProductNameCandidates({
    productName: map.productName,
    itemName: map.itemName,
  })) {
    texts.push(candidate.text)
  }
  return texts
}

function optionMapMatchesProductNameMap(
  map: InvoiceOptionMap,
  productMap: InvoiceProductNameMap,
) {
  const main = map.components.find((item) => item.role === 'main')
  if (main?.style.styleId !== productMap.style.styleId) return false
  const lookupCompact = compactProductNameKey(
    productMap.lookupKey || productMap.productName,
  )
  const productCompact = compactProductNameKey(productMap.productName)
  return optionMapLookupTexts(map).some((text) => {
    const compact = compactProductNameKey(text)
    return (
      compact === lookupCompact ||
      compact === productCompact ||
      normalizeInvoiceText(text) === productMap.normalizedLookupKey ||
      normalizeInvoiceText(text) === productMap.normalizedProductName
    )
  })
}

/**
 * 대표 본품과 조회 키 후보가 함께 맞는 활성 옵션 기준만 연결한다.
 * 같은 품목명의 내품명 변형은 각각 유지한다.
 */
export function findOptionMapsForProductNameMap(
  optionMaps: InvoiceOptionMap[],
  productMap: InvoiceProductNameMap,
): InvoiceOptionMap[] {
  return optionMaps
    .filter((map) => map.isActive && optionMapMatchesProductNameMap(map, productMap))
    .sort(
      (left, right) =>
        left.itemName.localeCompare(right.itemName, 'ko-KR') ||
        left.mallName.localeCompare(right.mallName, 'ko-KR') ||
        left.id.localeCompare(right.id),
    )
}

export function productCompositionVariantsForMap(
  optionMaps: InvoiceOptionMap[],
  productMap: InvoiceProductNameMap,
): Array<{
  key: string
  itemName: string
  mallName: string
  items: ProductCompositionItem[]
}> {
  const matched = findOptionMapsForProductNameMap(optionMaps, productMap)
  if (matched.length === 0) {
    return [
      {
        key: productMap.id,
        itemName: '',
        mallName: '',
        items: productCompositionFromStyle(productMap.style),
      },
    ]
  }
  const seen = new Set<string>()
  const variants: Array<{
    key: string
    itemName: string
    mallName: string
    items: ProductCompositionItem[]
  }> = []
  for (const map of matched) {
    const items = productCompositionFromOptionMap(map, productMap.style)
    const signature = [
      normalizeInvoiceText(map.itemName),
      normalizeInvoiceText(map.mallName),
      items.map((item) => `${item.style.styleId}:${item.quantity}`).join('|'),
    ].join('\u0000')
    if (seen.has(signature)) continue
    seen.add(signature)
    variants.push({
      key: map.id,
      itemName: map.itemName,
      mallName: map.mallName,
      items,
    })
  }
  return variants
}

export function optionMapComponentsSearchText(components: InvoiceOptionMapComponent[]) {
  return productCompositionSearchText(
    components.map((item) => ({
      style: item.style,
      quantity: item.quantity,
    })),
  )
}
