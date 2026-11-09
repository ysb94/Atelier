import type { DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'

export type DraftPriceColor = { id: string; name: string; hasPhoto: boolean }
export type DraftPriceRequest = {
  id: string
  draftId: string
  draftNo: string
  round: number
  requestedAt: string
  answeredAt: string | null
  colors: DraftPriceColor[]
  amounts: Record<string, number> | null
}

export type DraftPriceScope = 'planning' | 'china'
export type DraftPriceChange =
  | { action: 'request'; draftId: string; revision: string; previousId: string | null }
  | { action: 'reply'; requestId: string; amounts: Record<string, number> }

export function listDraftPriceRequests(scope: DraftPriceScope, signal: AbortSignal) {
  return diagnosticQuery<DraftPriceRequest[]>('app', 'draft_price_list',
    getSupabase().rpc('list_draft_price_requests', { p_scope: scope }).abortSignal(signal))
}

export function changeDraftPrice(input: DraftPriceChange, context: DiagnosticContext) {
  const request = input.action === 'request'
    ? getSupabase().rpc('request_draft_price', { p_draft: input.draftId, p_revision: input.revision, p_previous: input.previousId })
    : getSupabase().rpc('reply_draft_price', { p_request: input.requestId, p_amounts: input.amounts })
  return diagnosticQuery<DraftPriceRequest>('app', `draft_price_${input.action}`, request, context)
}

export function getDraftPricePhoto(requestId: string, colorId: string, signal: AbortSignal) {
  return diagnosticQuery<string | null>('app', 'draft_price_photo',
    getSupabase().rpc('get_draft_price_photo', { p_request: requestId, p_color: colorId }).abortSignal(signal))
}

export function draftPriceErrorCode(error: unknown) {
  return error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined
}

export function draftPriceError(error: unknown, fallback: string) {
  const code = draftPriceErrorCode(error)
  if (code === 'PGRST202' || code === '42883') return '단가요청 기능이 아직 서버에 연결되지 않았습니다.'
  if (code === '40001') return '기획안 또는 단가요청이 변경되었습니다. 최신 내용을 확인해 주세요.'
  if (code === '42501') return '이 단가요청을 조회하거나 처리할 권한이 없습니다.'
  if (code === '22023' && error instanceof Error) return error.message
  return fallback
}
