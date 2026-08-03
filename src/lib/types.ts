export type Brand = {
  id: string
  slug: string
  name: string
  nameKo: string
  description: string
  color: string
  styleCount: number
  seasonLabel: string
}

export type Season = {
  id: string
  brandId: string
  code: string
  name: string
  year: number
  status: 'planning' | 'in_production' | 'selling' | 'closed'
}

export type StyleStatus =
  | 'draft'
  | 'design'
  | 'sampling'
  | 'confirmed'
  | 'ordered'
  | 'received'

export type Style = {
  id: string
  brandId: string
  seasonId: string
  styleNo: string
  name: string
  category: string
  gender: 'W' | 'M' | 'U'
  colors: string[]
  targetCost: number
  plannedQty: number
  retailPrice: number
  status: StyleStatus
  designer?: string
  planner?: string
  thumbnailColor: string
  description?: string
}

export type DesignSpec = {
  styleId: string
  fabric: string
  lining?: string
  trimNotes: string
  sizeRange: string
  sampleRound: number
  sampleStatus: 'pending' | 'in_review' | 'approved' | 'rejected'
  workOrderNotes: string
  measurements: { part: string; size: string; value: string }[]
}

export type MdSummary = {
  styleId: string
  orderQty: number
  soldQty: number
  sellThrough: number
  marginRate: number
  reorderFlag: boolean
  channel: string
}

export type InventoryItem = {
  id: string
  styleId: string
  warehouse: string
  onHand: number
  reserved: number
  available: number
}

export type StockMovement = {
  id: string
  styleId: string
  date: string
  type: 'in' | 'out' | 'transfer' | 'return'
  qty: number
  warehouse: string
  note: string
}

export const STYLE_STATUS_LABEL: Record<StyleStatus, string> = {
  draft: '기획중',
  design: '디자인',
  sampling: '샘플링',
  confirmed: '확정',
  ordered: '발주',
  received: '입고',
}

export const SEASON_STATUS_LABEL: Record<Season['status'], string> = {
  planning: '기획',
  in_production: '생산',
  selling: '판매',
  closed: '종료',
}

export const MOVEMENT_TYPE_LABEL: Record<StockMovement['type'], string> = {
  in: '입고',
  out: '출고',
  transfer: '이동',
  return: '반품',
}
