import { normalizeStyleNo } from '@/lib/import/transform'
import { normalizePackingSizeValue } from '@/lib/invoice/packing-size-map'
import { getStyleFieldDisplay } from '@/lib/products/style-fields'
import type {
  BrandField,
  InvoicePackingSizeMap,
  Style,
  WarehouseStockPosition,
  WarehouseZone,
} from '@/lib/types'
import { summarizeWarehouseStockByStyle } from '@/lib/warehouse/stock'

/** 송장 품목명에 붙일 창고 자리·포장 코드 조회표. */
export type InvoiceShipmentLabelLookups = {
  locationByStyleNo: ReadonlyMap<string, string>
  packingCodeByStyleNo: ReadonlyMap<string, string>
}

export const INVOICE_SHIPMENT_LOCATION_ZONE_MODES: {
  value: WarehouseZone
  label: string
}[] = [
  { value: 'box_storage', label: '박스창고' },
  { value: 'picking', label: '출고창고' },
]

export const DEFAULT_INVOICE_SHIPMENT_LOCATION_ZONE: WarehouseZone =
  'box_storage'

/**
 * M번호가 연결된 상품명을 `[자리] [포장] // 상품명 //` 형태로 만든다.
 * 사은품 접두 `사은품(n) :` 은 유지하고 본문만 감싼다.
 */
export function formatInvoiceShipmentProductName(options: {
  productName: string
  locationLabel?: string | null
  packingCode?: string | null
  linkedStyle: boolean
}): string {
  const name = options.productName.trim()
  if (!options.linkedStyle || !name) return name

  const giftMatch = name.match(/^(사은품\(\d+\)\s*:\s*)([\s\S]*)$/)
  const giftPrefix = giftMatch?.[1] ?? ''
  const core = (giftMatch?.[2] ?? name).trim()
  if (!core) return name

  const parts: string[] = []
  const location = options.locationLabel?.trim()
  const packing = options.packingCode?.trim()
  if (location) parts.push(`[${location}]`)
  if (packing) parts.push(`[${packing}]`)
  parts.push(`// ${core} //`)
  return `${giftPrefix}${parts.join(' ')}`.trim()
}

/**
 * 선택한 창고 FIFO 1순위 자리를 쓰고, 없으면 반대 창고 1순위를 쓴다.
 * 기본값은 박스창고다.
 */
export function buildInvoiceShipmentLocationByStyleNo(
  positions: WarehouseStockPosition[],
  preferredZone: WarehouseZone = DEFAULT_INVOICE_SHIPMENT_LOCATION_ZONE,
): Map<string, string> {
  const summaries = summarizeWarehouseStockByStyle(positions)
  const next = new Map<string, string>()
  for (const [styleNo, summary] of summaries) {
    const primary =
      preferredZone === 'picking'
        ? summary.pickingLocation
        : summary.boxLocation
    const fallback =
      preferredZone === 'picking'
        ? summary.boxLocation
        : summary.pickingLocation
    const location = primary || fallback
    if (location) next.set(styleNo, location)
  }
  return next
}

/** 스타일 포장 규격 원문 → 기준정보 간단 표시값(P2 등). */
export function buildInvoiceShipmentPackingCodeByStyleNo(options: {
  styles: Style[]
  field: BrandField | null | undefined
  maps: InvoicePackingSizeMap[]
}): Map<string, string> {
  const next = new Map<string, string>()
  if (!options.field) return next
  const displayBySource = new Map(
    options.maps.map((map) => [
      map.normalizedSourceValue || normalizePackingSizeValue(map.sourceValue),
      map.displayValue.trim(),
    ]),
  )
  for (const style of options.styles) {
    const styleNo = normalizeStyleNo(style.styleNo)
    if (!styleNo) continue
    const raw = getStyleFieldDisplay(style, options.field).trim()
    if (!raw || raw === '—') continue
    const code = displayBySource.get(normalizePackingSizeValue(raw))?.trim()
    if (code) next.set(styleNo, code)
  }
  return next
}

export function lookupInvoiceShipmentLabels(
  styleNo: string | null | undefined,
  lookups: InvoiceShipmentLabelLookups,
): { locationLabel: string; packingCode: string } {
  const key = normalizeStyleNo(styleNo ?? '')
  if (!key) return { locationLabel: '', packingCode: '' }
  return {
    locationLabel: lookups.locationByStyleNo.get(key) ?? '',
    packingCode: lookups.packingCodeByStyleNo.get(key) ?? '',
  }
}
