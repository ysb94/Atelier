import { getSupabase } from './client'
import { diagnosticOperation, tracedQuery, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
export type OffsiteState = {
  state: 'inactive' | 'scheduled' | 'offsite' | 'returned' | 'clocked_out'
  workDate: string | null; scheduledStartAt: string | null; scheduledEndAt: string | null; serverNow: string
  overnightSupported?: boolean; continuousSupported?: boolean
}
export async function offsiteAction(action: 'my_offsite_attendance' | 'return_from_offsite', context?: DiagnosticContext): Promise<OffsiteState> {
  return diagnosticOperation('offsite', action === 'return_from_offsite' ? 'return_to_office' : 'sync_attendance', async trace => {
  const { data, error } = await trace.run('db_request', current => tracedQuery(getSupabase().rpc(action), current))
  if (error) {
    trace.fail(error)
    throw new Error(error.code === 'PGRST202' ? '외근 자동 처리 연결 대기' : error.message)
  }
  trace.step('state_received', { state: (data as OffsiteState | null)?.state ?? 'missing' })
  return data as OffsiteState
  }, context)
}
