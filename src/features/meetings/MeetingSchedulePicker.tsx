import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useAuth } from '@/lib/supabase/auth'
import { listMeetingCalendar } from '@/lib/supabase/meetings'
import { cn, emptyList } from '@/lib/utils'
import { type MeetingDraft, type MeetingPerson, type MeetingRoom, parseDateKey, toDateKey } from './meeting-schedule'
import { formatMeetingClockRange, resolveStartTimeState, WORK_DAY_CLOCKS } from './meeting-slots'

export type MeetingScheduleChoice = { roomId:string; dateKey:string; clock:string }

/** 일정 선택은 입력 상태로 유지하고, 최종 확정에서만 기존 저장 함수를 호출한다. */
export function MeetingSchedulePicker({rooms,value,onChange,durationMinutes,attendees,roundId,error,onConfirm}:{
  rooms:readonly MeetingRoom[];value:MeetingScheduleChoice;onChange:(value:MeetingScheduleChoice)=>void
  durationMinutes:number|null;attendees:readonly MeetingPerson[];roundId?:string;error:string|null|undefined;onConfirm:()=>void
}) {
  const {profile}=useAuth(),preview=usePagePreview(),active=useWorkspaceTabActivity()
  const real=preview?.realProfile ?? profile
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(value.dateKey)
  const calendar=useQuery({
    queryKey:['meeting-calendar',real?.id,real?.companyId,value.dateKey,value.dateKey],
    queryFn:()=>listMeetingCalendar(value.dateKey,value.dateKey),
    enabled:active&&real?.status==='active'&&validDate,refetchInterval:active?15000:false,
  })
  const now=new Date(),weekday=validDate?parseDateKey(value.dateKey).getDay():0
  const booked=(calendar.data ?? emptyList<MeetingDraft>()).filter(item=>item.roomId===value.roomId&&item.startsAt.slice(0,10)===value.dateKey&&item.id!==roundId)
  const available=(clock:string)=>resolveStartTimeState({
    composeReady:durationMinutes!==null,weekend:weekday===0||weekday===6,dateKey:value.dateKey,clock,
    durationMinutes:durationMinutes ?? 60,attendees,attendance:[],occupants:booked,now,
  })
  const room=rooms.find(item=>item.id===value.roomId)
  const ready=Boolean(validDate&&room&&durationMinutes&&value.clock&&!calendar.isPending&&!calendar.isError&&available(value.clock).available)
  return <section aria-label="회의실 일정 선택" className="space-y-3 rounded-lg border border-border p-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs font-medium">회의실
        <Select aria-label="일정 회의실" className="w-full" value={value.roomId} onChange={event=>onChange({...value,roomId:event.target.value,clock:''})}>
          {rooms.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </label>
      <label className="space-y-1 text-xs font-medium">회의 날짜
        <Input type="date" aria-label="회의 날짜" min={toDateKey(now)} value={value.dateKey} onChange={event=>onChange({...value,dateKey:event.target.value,clock:''})}/>
      </label>
    </div>
    {!validDate?<p className="text-xs text-muted-foreground">회의 날짜를 선택하세요.</p>:calendar.isError?<p role="alert" className="text-xs text-danger">예약된 일정을 불러오지 못했습니다. <button type="button" className="underline" onClick={()=>void calendar.refetch()}>다시 조회</button></p>:calendar.isPending?<p role="status" className="text-xs text-muted-foreground">예약된 일정을 확인하는 중입니다.</p>:<div className="text-xs text-muted-foreground">
      <p className="font-medium">선택한 회의실의 예약 일정</p>
      {booked.length?<ul className="mt-1 max-h-20 space-y-1 overflow-auto">{booked.map(item=><li key={item.id}>{formatMeetingClockRange(item.startsAt.slice(11,16),item.durationMinutes)} · {item.title}</li>)}</ul>:<p className="mt-1">예약된 일정이 없습니다.</p>}
    </div>}
    <div role="group" aria-label="시작 시간" className="space-y-2">
      <p className="text-xs font-medium">시작 시간 <span className="font-normal text-muted-foreground">· 평일 09~19시, 30분 단위</span></p>
      <div className="grid grid-cols-5 gap-1.5 md:grid-cols-10">
        {WORK_DAY_CLOCKS.filter(clock=>clock!=='19:00').map(clock=>{
          const state=available(clock),enabled=Boolean(validDate&&room&&durationMinutes&&!calendar.isPending&&!calendar.isError&&state.available)
          return <button key={clock} type="button" aria-label={`${clock} 시작`} aria-pressed={value.clock===clock} disabled={!enabled}
            title={enabled?formatMeetingClockRange(clock,durationMinutes!):durationMinutes===null?'회의 시간을 먼저 선택하세요.':state.reason}
            className={cn('rounded-md border px-1 py-1.5 text-xs tabular-nums disabled:cursor-not-allowed disabled:opacity-35',value.clock===clock?'border-sky-600 bg-sky-100 text-sky-950':'border-border hover:border-sky-400')}
            onClick={()=>onChange({...value,clock})}>{clock}</button>
        })}
      </div>
    </div>
    {error?<p role="alert" className="text-xs text-danger">{error}</p>:null}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">{ready?`${room!.name} · ${value.dateKey} · ${formatMeetingClockRange(value.clock,durationMinutes!)}`:'회의 시간·회의실·날짜·시작 시간을 선택하세요.'}</p>
      <Button type="button" disabled={!ready} onClick={onConfirm}>일정 확정</Button>
    </div>
  </section>
}
