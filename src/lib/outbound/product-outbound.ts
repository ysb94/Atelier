import { formatNumber } from '@/lib/utils'

/** 상품 1건이 특정 출고업체로 나간 1회분. 개인정보는 두지 않는다. */
export type ProductOutboundShipment = {
  id: string
  brandId: string
  styleId: string
  styleNo: string
  styleName: string
  partnerId: string
  partnerName: string
  /** YYYY-MM-DD */
  shippedOn: string
  quantity: number
  source: 'invoice' | 'bulk' | 'manual'
  note?: string
}

export type ProductOutboundPartnerTotal = {
  partnerId: string
  partnerName: string
  quantity: number
  shipmentCount: number
  lastShippedOn: string
}

export type ProductOutboundSummary = {
  styleId: string
  styleNo: string
  styleName: string
  totalQuantity: number
  partnerCount: number
  shipmentCount: number
  lastShippedOn: string | null
  partners: ProductOutboundPartnerTotal[]
  shipments: ProductOutboundShipment[]
}

const STORAGE_PREFIX = 'atelier:product-outbound-shipments:'
const SEED_META_PREFIX = 'atelier:product-outbound-shipments-seed:'

function storageKey(brandId: string) {
  return `${STORAGE_PREFIX}${brandId}`
}

function seedMetaKey(brandId: string) {
  return `${SEED_META_PREFIX}${brandId}`
}

function isDemoOutboundShipment(row: ProductOutboundShipment) {
  return row.id.startsWith('demo-out-')
}

function isShipment(value: unknown): value is ProductOutboundShipment {
  if (!value || typeof value !== 'object') return false
  const row = value as ProductOutboundShipment
  return (
    typeof row.id === 'string' &&
    typeof row.brandId === 'string' &&
    typeof row.styleId === 'string' &&
    typeof row.styleNo === 'string' &&
    typeof row.styleName === 'string' &&
    typeof row.partnerId === 'string' &&
    typeof row.partnerName === 'string' &&
    typeof row.shippedOn === 'string' &&
    typeof row.quantity === 'number' &&
    Number.isFinite(row.quantity) &&
    (row.source === 'invoice' ||
      row.source === 'bulk' ||
      row.source === 'manual')
  )
}

export function readProductOutboundShipments(
  brandId: string,
): ProductOutboundShipment[] {
  try {
    const raw = localStorage.getItem(storageKey(brandId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isShipment)
      .filter((row) => row.brandId === brandId && row.quantity > 0)
  } catch {
    return []
  }
}

export function writeProductOutboundShipments(
  brandId: string,
  rows: ProductOutboundShipment[],
) {
  localStorage.setItem(storageKey(brandId), JSON.stringify(rows))
}

export const PRODUCT_OUTBOUND_UPDATED_EVENT = 'atelier:product-outbound-updated'

function notifyProductOutboundUpdated(brandId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(PRODUCT_OUTBOUND_UPDATED_EVENT, {
      detail: { brandId },
    }),
  )
}

/** 예전 브라우저 시드 출고를 제거한다. 업무 원본은 outbound_shipments다. */
export function purgeDemoProductOutboundShipments(
  brandId: string,
): ProductOutboundShipment[] {
  const kept = readProductOutboundShipments(brandId).filter(
    (row) => !isDemoOutboundShipment(row),
  )
  writeProductOutboundShipments(brandId, kept)
  try {
    localStorage.removeItem(seedMetaKey(brandId))
  } catch {
    // ignore
  }
  notifyProductOutboundUpdated(brandId)
  return kept
}

export const PRODUCT_OUTBOUND_SOURCE_LABEL: Record<
  ProductOutboundShipment['source'],
  string
> = {
  invoice: '송장작업',
  bulk: '바코드 출고',
  manual: '직접 기록',
}

function compareShippedOnDesc(left: string, right: string) {
  return right.localeCompare(left)
}

export function buildProductOutboundSummary(
  style: { id: string; styleNo: string; name: string },
  shipments: ProductOutboundShipment[],
): ProductOutboundSummary {
  const rows = shipments
    .filter((row) => row.styleId === style.id || row.styleNo === style.styleNo)
    .slice()
    .sort((left, right) => {
      const byDate = compareShippedOnDesc(left.shippedOn, right.shippedOn)
      if (byDate !== 0) return byDate
      return left.partnerName.localeCompare(right.partnerName, 'ko-KR')
    })

  const partnerMap = new Map<string, ProductOutboundPartnerTotal>()
  let totalQuantity = 0
  let lastShippedOn: string | null = null

  for (const row of rows) {
    totalQuantity += row.quantity
    if (!lastShippedOn || row.shippedOn > lastShippedOn) {
      lastShippedOn = row.shippedOn
    }
    const current = partnerMap.get(row.partnerId)
    if (current) {
      current.quantity += row.quantity
      current.shipmentCount += 1
      if (row.shippedOn > current.lastShippedOn) {
        current.lastShippedOn = row.shippedOn
      }
    } else {
      partnerMap.set(row.partnerId, {
        partnerId: row.partnerId,
        partnerName: row.partnerName,
        quantity: row.quantity,
        shipmentCount: 1,
        lastShippedOn: row.shippedOn,
      })
    }
  }

  const partners = [...partnerMap.values()].sort((left, right) => {
    if (right.quantity !== left.quantity) return right.quantity - left.quantity
    return left.partnerName.localeCompare(right.partnerName, 'ko-KR')
  })

  return {
    styleId: style.id,
    styleNo: style.styleNo,
    styleName: style.name,
    totalQuantity,
    partnerCount: partners.length,
    shipmentCount: rows.length,
    lastShippedOn,
    partners,
    shipments: rows,
  }
}

export function formatOutboundQuantity(value: number) {
  return formatNumber(value)
}

/** UI 테스트용 단가·원가·수수료. 실제 원장과 무관하다. */
export type OutboundDemoEconomics = {
  unitPrice: number
  unitCost: number
  /** 물류·플랫폼 수수료 등 개당 지출 */
  unitFee: number
}

function hashStyleNo(styleNo: string) {
  let hash = 0
  for (const char of styleNo) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash
}

export function demoEconomicsForStyle(styleNo: string): OutboundDemoEconomics {
  const hash = hashStyleNo(styleNo || 'x')
  const unitPrice = 18000 + (hash % 42) * 1000
  const unitCost = Math.round(unitPrice * (0.38 + (hash % 17) / 100))
  const unitFee = 900 + (hash % 12) * 120
  return { unitPrice, unitCost, unitFee }
}

export type OutboundFinanceTotals = {
  quantity: number
  shipmentCount: number
  styleCount: number
  partnerCount: number
  revenue: number
  cogs: number
  fees: number
  /** 매출 - 원가 - 수수료 */
  netProfit: number
  marginRate: number
  /** UI용 반품 가정(수량) */
  returnQuantity: number
  returnLoss: number
}

export function summarizeOutboundFinance(
  shipments: ProductOutboundShipment[],
): OutboundFinanceTotals {
  let quantity = 0
  let revenue = 0
  let cogs = 0
  let fees = 0
  const styles = new Set<string>()
  const partners = new Set<string>()

  for (const row of shipments) {
    const eco = demoEconomicsForStyle(row.styleNo)
    quantity += row.quantity
    revenue += row.quantity * eco.unitPrice
    cogs += row.quantity * eco.unitCost
    fees += row.quantity * eco.unitFee
    styles.add(row.styleId || row.styleNo)
    partners.add(row.partnerId)
  }

  const returnQuantity = Math.round(quantity * 0.028)
  const avgPrice = quantity > 0 ? revenue / quantity : 0
  const returnLoss = Math.round(returnQuantity * avgPrice * 0.55)
  const netProfit = revenue - cogs - fees - returnLoss
  const marginRate = revenue > 0 ? (netProfit / revenue) * 100 : 0

  return {
    quantity,
    shipmentCount: shipments.length,
    styleCount: styles.size,
    partnerCount: partners.size,
    revenue,
    cogs,
    fees,
    netProfit,
    marginRate,
    returnQuantity,
    returnLoss,
  }
}

export type OutboundPartnerFinanceRow = {
  partnerId: string
  partnerName: string
  quantity: number
  shipmentCount: number
  revenue: number
  fees: number
  netProfit: number
  lastShippedOn: string
}

export function summarizeOutboundFinanceByPartner(
  shipments: ProductOutboundShipment[],
): OutboundPartnerFinanceRow[] {
  const map = new Map<string, OutboundPartnerFinanceRow>()
  for (const row of shipments) {
    const eco = demoEconomicsForStyle(row.styleNo)
    const revenue = row.quantity * eco.unitPrice
    const cogs = row.quantity * eco.unitCost
    const fees = row.quantity * eco.unitFee
    const netProfit = revenue - cogs - fees
    const current = map.get(row.partnerId)
    if (current) {
      current.quantity += row.quantity
      current.shipmentCount += 1
      current.revenue += revenue
      current.fees += fees
      current.netProfit += netProfit
      if (row.shippedOn > current.lastShippedOn) {
        current.lastShippedOn = row.shippedOn
      }
    } else {
      map.set(row.partnerId, {
        partnerId: row.partnerId,
        partnerName: row.partnerName,
        quantity: row.quantity,
        shipmentCount: 1,
        revenue,
        fees,
        netProfit,
        lastShippedOn: row.shippedOn,
      })
    }
  }
  return [...map.values()].sort((left, right) => {
    if (right.revenue !== left.revenue) return right.revenue - left.revenue
    return left.partnerName.localeCompare(right.partnerName, 'ko-KR')
  })
}

export function filterShipmentsByRange(
  shipments: ProductOutboundShipment[],
  from: string,
  to: string,
  partnerId: string | null,
) {
  return shipments.filter((row) => {
    if (partnerId && row.partnerId !== partnerId) return false
    if (from && row.shippedOn < from) return false
    if (to && row.shippedOn > to) return false
    return true
  })
}

/** 기간 안 모든 날짜 헤더. 출고 없는 날도 빈 칸(·)으로 표시한다. */
export function listOutboundDateColumns(
  from: string,
  to: string,
  shipments: ProductOutboundShipment[],
): string[] {
  let rangeFrom = from
  let rangeTo = to

  if (!rangeFrom || !rangeTo) {
    for (const row of shipments) {
      if (from && row.shippedOn < from) continue
      if (to && row.shippedOn > to) continue
      if (!rangeFrom || row.shippedOn < rangeFrom) rangeFrom = row.shippedOn
      if (!rangeTo || row.shippedOn > rangeTo) rangeTo = row.shippedOn
    }
  }

  if (!rangeFrom || !rangeTo || rangeFrom > rangeTo) return []
  return enumerateIsoDateRange(rangeFrom, rangeTo)
}

function enumerateIsoDateRange(from: string, to: string): string[] {
  const start = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []

  const dayMs = 24 * 60 * 60 * 1000
  const dates: string[] = []
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += dayMs) {
    const date = new Date(cursor)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
  }
  return dates
}

export type OutboundStyleRow = {
  styleId: string
  styleNo: string
  styleName: string
}

/** 필터된 출고 이력에서 상품 행 목록을 만든다. */
export function listOutboundStyleRows(
  shipments: ProductOutboundShipment[],
): OutboundStyleRow[] {
  const map = new Map<string, OutboundStyleRow>()
  for (const row of shipments) {
    const styleNo = row.styleNo.trim()
    if (!styleNo) continue
    const styleId = (row.styleId || styleNo).trim() || styleNo
    const key = styleId
    const existing = map.get(key)
    if (existing) {
      if (!existing.styleName && row.styleName) {
        existing.styleName = row.styleName
      }
      continue
    }
    map.set(key, {
      styleId,
      styleNo,
      styleName: row.styleName,
    })
  }
  return [...map.values()].sort((left, right) =>
    left.styleNo.localeCompare(right.styleNo, 'ko-KR'),
  )
}

export function quantityByShippedOn(
  shipments: ProductOutboundShipment[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of shipments) {
    map.set(row.shippedOn, (map.get(row.shippedOn) ?? 0) + row.quantity)
  }
  return map
}

export function formatOutboundDateHeader(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  return `${Number(match[2])}/${Number(match[3])}`
}

export function formatWon(value: number) {
  const rounded = Math.round(value)
  const sign = rounded < 0 ? '-' : ''
  return `${sign}${formatNumber(Math.abs(rounded))}원`
}
