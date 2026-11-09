import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'
import type { DiagnosticContext } from '@/lib/diagnostics/workflow-trace'

export type AssignedChinaOrder = {
  draftId: string
  draftNo: string
  revision: string
  brandId: string | null
  nameKo: string
  nameEn: string
  imageUrl: string | null
  owner: string
  orderId: string
  kind: 'sample' | 'color'
  round: number
  sampleStage?: 'numbered' | 'final'
  fileName: string | null
  closed: boolean
  shippedAt?: string | null
  returnedAt: string | null
  receivedAt: string | null
  assigneeCheckedAt: string | null
}

export type ChinaAssigneeWorkload = {
  profileId: string
  sampleOpen: number
  sampleResting: number
  materialOpen: number
  materialResting: number
}

export function getMyChinaWorkOrders() {
  return diagnosticQuery<{
    role: 'manager' | 'worker' | 'denied'
    orders: AssignedChinaOrder[]
    revision?: string | null
    workloads?: ChinaAssigneeWorkload[]
  }>(
    'app', 'china_assigned_work_list', getSupabase().rpc('get_my_china_work_orders'),
  )
}

export async function getMyChinaWorkOrderFile(order: AssignedChinaOrder) {
  const url = await diagnosticQuery<string | null>('app', 'china_assigned_work_file', getSupabase().rpc('get_my_china_work_order_file', {
    p_draft: order.draftId, p_order: order.orderId, p_kind: order.kind,
  }))
  if (!url) throw new Error('현재 배정된 작업 지시서 파일을 찾지 못했습니다.')
  return url
}

export function checkMyChinaWorkOrder(order: AssignedChinaOrder, context?: DiagnosticContext) {
  return diagnosticQuery<void>('app', 'china_assigned_work_check', getSupabase().rpc('apply_china_work_order', {
    p_draft: order.draftId, p_order: order.orderId, p_kind: order.kind,
    p_action: 'check', p_assignee: null, p_revision: order.revision,
  }), context)
}

export function shipMyChinaWorkOrder(order: AssignedChinaOrder, context?: DiagnosticContext) {
  return diagnosticQuery<void>('app', 'china_work_ship', getSupabase().rpc('apply_china_work_order', {
    p_draft: order.draftId, p_order: order.orderId, p_kind: order.kind,
    p_action: 'ship', p_assignee: null, p_revision: order.revision,
  }), context)
}
