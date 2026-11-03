import { getSupabase } from './client'
export type OffsiteState = {
  state: 'inactive' | 'scheduled' | 'offsite' | 'returned' | 'clocked_out'
  workDate: string | null; scheduledStartAt: string | null; scheduledEndAt: string | null; serverNow: string
  overnightSupported?: boolean; continuousSupported?: boolean
}
export async function offsiteAction(action: 'my_offsite_attendance' | 'return_from_offsite'): Promise<OffsiteState> {
  const { data, error } = await getSupabase().rpc(action)
  if (error) {
    console.warn('[offsite-attendance] 외근 상태 요청 실패', { action, error })
    throw new Error(error.code === 'PGRST202' ? '외근 자동 처리 연결 대기' : error.message)
  }
  return data as OffsiteState
}
