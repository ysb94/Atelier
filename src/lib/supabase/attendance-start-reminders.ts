import { getSupabase } from './client'
import { diagnosticOperation, tracedQuery } from '@/lib/diagnostics/workflow-trace'
import type { AttendanceStartReminder } from '@/features/settings/attendance-start-reminders'
export async function listAttendanceStartReminders() {
  return diagnosticOperation('notification','attendance_start_list',async trace=>{
    const {data,error}=await trace.run('db_request',context=>tracedQuery(getSupabase().rpc('list_my_attendance_start_reminders'),context))
    if(error?.code==='PGRST202'){trace.block('schema_not_ready');return{ready:false,rows:[] as AttendanceStartReminder[]}}
    if(error)throw new Error('출근시간 지정 알림을 불러오지 못했습니다.',{cause:error})
    return{ready:true,rows:(data??[]) as AttendanceStartReminder[]}
  })
}
export async function readAttendanceStartReminder(id:string,version:string) {
  return diagnosticOperation('notification','attendance_start_read',async trace=>{
    const {error}=await trace.run('db_request',context=>tracedQuery(getSupabase().rpc('read_attendance_start_reminder',{p_id:id,p_version:version}),context))
    if(error)throw new Error('출근시간 알림 읽음 저장에 실패했습니다.',{cause:error})
  })
}
