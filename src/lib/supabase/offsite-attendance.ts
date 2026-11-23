import { getSupabase } from './client'
import { diagnosticOperation, tracedQuery, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
export type OffsiteState = {
  state: 'inactive' | 'scheduled' | 'offsite' | 'returned' | 'clocked_out'
  workDate: string | null; scheduledStartAt: string | null; scheduledEndAt: string | null; serverNow: string
  overnightSupported?: boolean; continuousSupported?: boolean
}

export function readMyOffsiteClockTimes(userId: string, workDate: string, signal: AbortSignal) {
  return diagnosticOperation('offsite', 'read_offsite_clock_times', async trace => {
    const { data, error } = await trace.run('read_clock', context => tracedQuery(getSupabase()
      .from('attendance_clock_ins').select('offsite_returned_at,clock_out_at,auto_closed_at')
      .eq('employee_id', userId).eq('work_date', workDate).abortSignal(signal).maybeSingle(), context))
    if (error) throw new Error(error.message)
    return data as { offsite_returned_at: string | null; clock_out_at: string | null; auto_closed_at: string | null } | null
  })
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
