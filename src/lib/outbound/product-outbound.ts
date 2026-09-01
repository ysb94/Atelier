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
/** localStorage 테스트 시드 버전. 올리면 브라우저에 다시 심는다. */
const DEMO_SEED_VERSION = '2'

function storageKey(brandId: string) {
  return `${STORAGE_PREFIX}${brandId}`
}

function seedMetaKey(brandId: string) {
  return `${SEED_META_PREFIX}${brandId}`
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

function todayIsoDate() {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function bulkBackupNote(jobId: string) {
  return `bulk-backup:${jobId}`
}

/**
 * 대량출고 임시 백업을 운영 현황(출고) localStorage에 반영한다. DB에는 쓰지 않는다.
 * 같은 jobId로 다시 누르면 이전 반영분을 교체한다.
 */
export function applyBulkOutboundBackupToOperations(input: {
  brandId: string
  jobId: string
  partnerId: string
  partnerName: string
  shippedOn?: string
  entries: Array<{
    styleId?: string
    styleNo: string
    styleName: string
    quantity: number
  }>
}): ProductOutboundShipment[] {
  const shippedOn = input.shippedOn || todayIsoDate()
  const note = bulkBackupNote(input.jobId)
  const existing = readProductOutboundShipments(input.brandId).filter(
    (row) => row.note !== note,
  )
  const added: ProductOutboundShipment[] = []
  for (const entry of input.entries) {
    if (entry.quantity <= 0) continue
    const styleNo = entry.styleNo.trim()
    if (!styleNo) continue
    added.push({
      id: `bulk-${input.jobId}-${styleNo}`,
      brandId: input.brandId,
      styleId: (entry.styleId || styleNo).trim() || styleNo,
      styleNo,
      styleName: entry.styleName.trim() || styleNo,
      partnerId: input.partnerId,
      partnerName: input.partnerName,
      shippedOn,
      quantity: entry.quantity,
      source: 'bulk',
      note,
    })
  }
  const next = [...existing, ...added]
  writeProductOutboundShipments(input.brandId, next)
  try {
    localStorage.setItem(seedMetaKey(input.brandId), DEMO_SEED_VERSION)
  } catch {
    // ignore
  }
  notifyProductOutboundUpdated(input.brandId)
  return next
}

function daysAgoIso(days: number) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

type SeedStyle = { id: string; styleNo: string; name: string }
type SeedPartner = { id: string; name: string }

/**
 * DB에 쓰지 않고 localStorage에만 테스트 출고 이력을 심는다.
 * 같은 시드 버전이면 기존 값을 유지한다.
 */
export function ensureDemoProductOutboundShipments(
  brandId: string,
  styles: SeedStyle[],
  partners: SeedPartner[],
): ProductOutboundShipment[] {
  const existing = readProductOutboundShipments(brandId)
  try {
    if (
      localStorage.getItem(seedMetaKey(brandId)) === DEMO_SEED_VERSION &&
      existing.length > 0
    ) {
      return existing
    }
  } catch {
    // ignore
  }

  // 대량출고 백업 등 수동 반영분이 있으면 시드로 덮지 않는다.
  if (existing.some((row) => row.source === 'bulk')) {
    try {
      localStorage.setItem(seedMetaKey(brandId), DEMO_SEED_VERSION)
    } catch {
      // ignore
    }
    return existing
  }

  if (styles.length === 0) return existing

  const partnerPool =
    partners.length > 0
      ? partners.slice(0, 6)
      : [
          { id: 'demo-partner-coupang', name: '쿠팡 풀필먼트' },
          { id: 'demo-partner-ir', name: '아이라벨' },
          { id: 'demo-partner-smart', name: '스마트스토어' },
          { id: 'demo-partner-cafe', name: '카카오톡스토어' },
        ]

  const sources: ProductOutboundShipment['source'][] = [
    'invoice',
    'bulk',
    'invoice',
    'manual',
  ]
  const dayOffsets = [1, 3, 5, 8, 12, 18, 25, 32]
  const stylePool = styles.slice(0, Math.min(24, styles.length))
  const rows: ProductOutboundShipment[] = []
  let seq = 0

  for (let index = 0; index < stylePool.length; index += 1) {
    const style = stylePool[index]!
    const partnerCount = 1 + (index % Math.min(3, partnerPool.length))
    for (let p = 0; p < partnerCount; p += 1) {
      const partner = partnerPool[(index + p) % partnerPool.length]!
      const hitCount = 1 + ((index + p) % 3)
      for (let h = 0; h < hitCount; h += 1) {
        seq += 1
        const qtyBase = 8 + ((index * 7 + p * 5 + h * 3) % 40)
        rows.push({
          id: `demo-out-${brandId.slice(0, 8)}-${seq}`,
          brandId,
          styleId: style.id,
          styleNo: style.styleNo,
          styleName: style.name || style.styleNo,
          partnerId: partner.id,
          partnerName: partner.name,
          shippedOn: daysAgoIso(
            dayOffsets[(index + p + h) % dayOffsets.length]!,
          ),
          quantity: qtyBase * (h === 0 ? 3 : 1),
          source: sources[(index + p + h) % sources.length]!,
        })
      }
    }
  }

  writeProductOutboundShipments(brandId, rows)
  try {
    localStorage.setItem(seedMetaKey(brandId), DEMO_SEED_VERSION)
  } catch {
    // ignore
  }
  return rows
}

export const PRODUCT_OUTBOUND_SOURCE_LABEL: Record<
  ProductOutboundShipment['source'],
  string
> = {
  invoice: '송장작업',
  bulk: '대량출고',
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

/** 기간 안의 날짜 헤더. 범위가 너무 길면 출고가 있는 날만. */
export function listOutboundDateColumns(
  from: string,
  to: string,
  shipments: ProductOutboundShipment[],
  maxDays = 62,
): string[] {
  const withActivity = () => {
    const set = new Set<string>()
    for (const row of shipments) {
      if (from && row.shippedOn < from) continue
      if (to && row.shippedOn > to) continue
      set.add(row.shippedOn)
    }
    return [...set].sort()
  }

  if (!from || !to) return withActivity()
  if (from > to) return []

  const start = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return withActivity()
  }

  const dayMs = 24 * 60 * 60 * 1000
  const span = Math.floor((end.getTime() - start.getTime()) / dayMs) + 1
  if (span > maxDays) return withActivity()

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
