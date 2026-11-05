import type { InboxNotification } from '@/lib/inbox/types'
export type AttendanceStartReminder = { id:string; departmentId:string; department:string; month:string; version:string; issuedAt:string; readAt:string|null; total:number; missing:number; current:boolean; overdue:boolean }
export function attendanceStartReminderItems(rows: readonly AttendanceStartReminder[]): InboxNotification[] {
  return rows.map(row => ({ id:`attendance-start:${row.id}`,kind:'attendance_start_needed',
    title:`${row.month.slice(0,4)}년 ${Number(row.month.slice(5))}월 출근시간${row.overdue?'이 아직 미지정 상태입니다':'을 지정해 주세요'}`,
    body:`${row.department} ${row.total}명 중 ${row.missing}명 미지정\n${row.overdue?'해당 월이 시작됐습니다. 남은 직원의 출근시간을 지금 지정해 주세요.':'해당 월이 시작되기 전에 출근시간을 지정해 주세요.'}`,
    href:`/settings/profile?part=attendance&month=${row.month}`,createdAt:row.issuedAt,readAt:row.readAt,current:row.current,
    target:{source:'attendance-start',entityId:row.id,eventVersion:row.version,tab:'attendance',href:`/settings/profile?part=attendance&month=${row.month}`},
    action:row.current?{key:`attendance-start:${row.departmentId}:${row.month}`,label:'출근시간 지정 필요'}:null,
  }))
}
