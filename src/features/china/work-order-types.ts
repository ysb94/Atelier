import type { ProductDraft } from '@/lib/types'

export type WorkOrderRow = {
  draft: ProductDraft
  rowId: string
  kind: 'sample' | 'color'
  sampleStage?: 'numbered' | 'final'
  stageLabel: string
  url: string | null
  fileName: string
  shipped: boolean
  shippedAt: string | null
  returnedAt: string | null
  receivedAt: string | null
  passed: boolean
  failReason: string
  focusReason: string
  colorName: string
  sortRound: number
  assigneeId: string | null
  assigneeName: string
  fileCheckedAt: string | null
  assigneeCheckedAt: string | null
}

export type WorkOrderGroup = { draft: ProductDraft; rows: WorkOrderRow[] }
