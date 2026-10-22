import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useAuth } from '@/lib/supabase/auth'
import { listMeetingAvailability, listMeetingCalendar } from '@/lib/supabase/meetings'
import { MeetingAvailabilityTable } from './MeetingAvailabilityTable'
import { availabilityConfirmationKey, overlapsAvailability, type MeetingAvailability } from './meeting-availability'
import { cn, emptyList } from '@/lib/utils'
import { type MeetingDraft, type MeetingPerson, type MeetingRoom, parseDateKey, toDateKey } from './meeting-schedule'
import { formatMeetingClockRange, isClockCoveredByMeeting, resolveStartTimeState, WORK_DAY_CLOCKS } from './meeting-slots'

export type MeetingScheduleChoice = { roomId:string; dateKey:string; clock:string }

/** 달력과 회의실별 시간표에서 선택한 값은 최종 확정 전까지 입력 상태로만 유지한다. */
export function MeetingSchedulePicker({rooms,value,onChange,durationMinutes,attendees,seriesId,roundId,error,onConfirm}:{
  rooms:readonly MeetingRoom[];value:MeetingScheduleChoice;onChange:(value:MeetingScheduleChoice)=>void
  durationMinutes:number|null;attendees:readonly MeetingPerson[];seriesId:string;roundId?:string;error:string|null|undefined;onConfirm:()=>Promise<unknown>
}) {
  const {profile}=useAuth(),preview=usePagePreview(),active=useWorkspaceTabActivity()
  const real=preview?.realProfile ?? profile,now=new Date(),today=toDateKey(now)
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(value.dateKey)
  const [viewMonth,setViewMonth]=useState(()=>(validDate?value.dateKey:today).slice(0,7))
  const [year,month]=viewMonth.split('-').map(Number)
  const firstWeekday=new Date(year,month-1,1).getDay(),daysInMonth=new Date(year,month,0).getDate()
  const years=[...new Set([...Array.from({length:6},(_,index)=>now.getFullYear()+index),year])].sort((a,b)=>a-b)
  const calendar=useQuery({
    queryKey:['meeting-calendar',real?.id,real?.companyId,value.dateKey,value.dateKey],
    queryFn:()=>listMeetingCalendar(value.dateKey,value.dateKey),
    enabled:active&&real?.status==='active'&&validDate,refetchInterval:active?15000:false,
  })
  const people=[...new Set(attendees.map(person=>person.id))].sort()
  const attendance=useQuery({queryKey:['meeting-availability',real?.id,seriesId,value.dateKey,people,roundId],
    queryFn:()=>listMeetingAvailability(seriesId,value.dateKey,people,roundId),enabled:active&&real?.status==='active'&&validDate&&people.length>0,
    refetchInterval:active?15000:false})
  const rows=attendance.data ?? emptyList<MeetingAvailability>()
  const conflicts=value.clock?rows.filter(row=>row.kind!=='remote'&&overlapsAvailability(row,value.clock,durationMinutes ?? 60)):[]
  const selection=[value,durationMinutes,people]
  const selectionKey=JSON.stringify(selection),currentSelection=useRef(selectionKey);currentSelection.current=selectionKey
  const acknowledgmentKey=availabilityConfirmationKey(selection,conflicts)
  const [acknowledged,setAcknowledged]=useState<string|null>(null),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState<string|null>(null)
  async function confirm(){
    if(checking)return
    const expected=selectionKey
    setChecking(true);setCheckError(null)
    try {
      const result=await attendance.refetch()
      if(result.isError||!result.data)throw result.error ?? new Error('멤버 일정 조회 결과가 없습니다.')
      if(expected!==currentSelection.current)return
      const latest=result.data.filter(row=>row.kind!=='remote'&&overlapsAvailability(row,value.clock,durationMinutes ?? 60))
      if(latest.length&&acknowledged!==availabilityConfirmationKey(selection,latest)){
        setAcknowledged(null);setCheckError('멤버 일정이 겹칩니다. 최신 내용을 확인하고 체크해 주세요.');return
      }
      await onConfirm()
    } catch(cause){console.warn('[meetings] 확정 전 멤버 일정 조회 실패',{error:cause});setCheckError('멤버 일정을 확인하지 못했습니다. 다시 조회해 주세요.')}
    finally{setChecking(false)}
  }
  const weekday=validDate?parseDateKey(value.dateKey).getDay():0
  const bookings=(calendar.data ?? emptyList<MeetingDraft>()).filter(item=>item.startsAt.slice(0,10)===value.dateKey&&item.id!==roundId)
  const available=(roomId:string,clock:string)=>resolveStartTimeState({
    composeReady:durationMinutes!==null,weekend:weekday===0||weekday===6,dateKey:value.dateKey,clock,
    durationMinutes:durationMinutes ?? 60,attendees,attendance:[],occupants:bookings.filter(item=>item.roomId===roomId),now,
  })
  const room=rooms.find(item=>item.id===value.roomId)
  const ready=Boolean(validDate&&room&&durationMinutes&&value.clock&&!calendar.isPending&&!calendar.isError&&!attendance.isPending&&!attendance.isError&&available(value.roomId,value.clock).available)
  const clocks=WORK_DAY_CLOCKS.filter(clock=>clock!=='19:00')
  function changeMonth(offset:number){setViewMonth(toDateKey(new Date(year,month-1+offset,1)).slice(0,7))}
  return <section aria-label="회의실 일정 선택" className="space-y-4 rounded-lg border border-border p-3">
    <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
      <section aria-label="회의 날짜 달력" className="space-y-2 rounded-lg border border-border p-2">
        <div className="flex items-center justify-between gap-1">
          <Button size="icon" variant="ghost" aria-label="이전 달" onClick={()=>changeMonth(-1)}><ChevronLeft size={16}/></Button>
          <div className="flex items-center gap-1">
            <Select aria-label="회의 연도" value={year} onChange={event=>setViewMonth(`${event.target.value}-${String(month).padStart(2,'0')}`)}>
              {years.map(item=><option key={item} value={item}>{item}년</option>)}
            </Select>
            <Select aria-label="회의 월" value={month} onChange={event=>setViewMonth(`${year}-${event.target.value.padStart(2,'0')}`)}>
              {Array.from({length:12},(_,index)=><option key={index} value={index+1}>{index+1}월</option>)}
            </Select>
          </div>
          <Button size="icon" variant="ghost" aria-label="다음 달" onClick={()=>changeMonth(1)}><ChevronRight size={16}/></Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {['일','월','화','수','목','금','토'].map(label=><span key={label} className="py-1 text-muted-foreground">{label}</span>)}
          {Array.from({length:Math.ceil((firstWeekday+daysInMonth)/7)*7},(_,index)=>{
            const day=index-firstWeekday+1
            if(day<1||day>daysInMonth)return <span key={index} aria-hidden/>
            const dateKey=`${viewMonth}-${String(day).padStart(2,'0')}`,weekend=index%7===0||index%7===6
            return <button key={index} type="button" aria-label={`${dateKey} 날짜 선택`} aria-pressed={value.dateKey===dateKey}
              disabled={dateKey<today||weekend} className={cn('h-8 rounded-md border border-transparent disabled:cursor-not-allowed disabled:opacity-30',value.dateKey===dateKey?'bg-sky-700 text-white':dateKey===today?'border-sky-400 hover:bg-muted':'hover:bg-muted')}
              onClick={()=>onChange({...value,dateKey,clock:''})}>{day}</button>
          })}
        </div>
      </section>
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">{value.dateKey} 예약 현황</h3>
        <p className="text-xs text-muted-foreground">달력에서 날짜를 고르고, 아래 시간표의 빈 시간을 누르세요. 회의실과 시작 시간이 함께 선택됩니다.</p>
        {!validDate?<p className="text-xs">회의 날짜를 선택하세요.</p>:calendar.isError?<p role="alert" className="text-xs text-danger">예약 일정을 불러오지 못했습니다. <button type="button" className="underline" onClick={()=>void calendar.refetch()}>다시 조회</button></p>:calendar.isPending?<p role="status" className="text-xs">예약 일정을 확인하는 중입니다.</p>:<div className="max-h-40 space-y-2 overflow-auto text-xs">
          {rooms.map(item=>{
            const booked=bookings.filter(booking=>booking.roomId===item.id).sort((a,b)=>a.startsAt.localeCompare(b.startsAt))
            return <div key={item.id}><p className="font-medium">{item.name}</p>{booked.length?<ul className="mt-1 space-y-1 text-muted-foreground">{booked.map(booking=><li key={booking.id}>{formatMeetingClockRange(booking.startsAt.slice(11,16),booking.durationMinutes)} · {booking.title}</li>)}</ul>:<p className="mt-1 text-muted-foreground">예약 없음</p>}</div>
          })}
        </div>}
      </div>
    </div>
    <div className="space-y-2">
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <p className="font-medium">회의실별 시간표 · 평일 09~19시, 30분 단위</p>
        <p className="flex gap-3"><span className="text-emerald-700">초록: 빈 시간</span><span className="text-red-700">빨강: 예약·일정 충돌</span><span className="text-amber-800">노랑: 승인 대기</span><span className="text-sky-700">파랑 테두리: 선택</span></p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[960px] table-fixed border-collapse text-center text-[10px]">
          <caption className="sr-only">회의실별 예약 시간과 빈 시간</caption>
          <thead><tr><th scope="col" className="w-24 bg-muted p-2 text-left">회의실</th>{clocks.map(clock=><th key={clock} scope="col" className="border-l border-border bg-muted py-2 font-normal tabular-nums">{clock}</th>)}</tr></thead>
          <tbody>{rooms.map(item=><tr key={item.id}>
            <th scope="row" className="border-t border-border p-2 text-left text-xs">{item.name}</th>
            {clocks.map(clock=>{
              const state=available(item.id,clock),enabled=Boolean(validDate&&durationMinutes&&!calendar.isPending&&!calendar.isError&&!attendance.isPending&&!attendance.isError&&state.available)
              const peopleBusy=rows.filter(row=>row.kind!=='remote'&&overlapsAvailability(row,clock,durationMinutes ?? 60))
              const peopleTone=peopleBusy.some(row=>row.status==='approved')?'conflict':peopleBusy.length?'warning':null
              const occupied=bookings.find(booking=>booking.roomId===item.id&&isClockCoveredByMeeting(clock,booking.startsAt.slice(11,16),booking.durationMinutes))
              const selected=item.id===value.roomId&&Boolean(value.clock)&&isClockCoveredByMeeting(clock,value.clock,durationMinutes ?? 60)
              const start=item.id===value.roomId&&value.clock===clock
              return <td key={clock} className="border-l border-t border-border p-0">
                <button type="button" aria-label={`${item.name} ${clock} 시작`} aria-pressed={start} disabled={!enabled}
                  title={occupied?`${formatMeetingClockRange(occupied.startsAt.slice(11,16),occupied.durationMinutes)} · ${occupied.title}`:durationMinutes===null?'회의 시간을 먼저 선택하세요.':state.reason||`${formatMeetingClockRange(clock,durationMinutes)} 선택`}
                  className={cn('h-11 w-full text-[10px] disabled:cursor-not-allowed',attendance.isPending||attendance.isError?'bg-muted text-muted-foreground':occupied||peopleTone==='conflict'?'bg-red-100 text-red-800':peopleTone==='warning'?'bg-amber-100 text-amber-900':selected?'bg-sky-200 text-sky-950':enabled?'bg-emerald-50 text-emerald-900 hover:bg-emerald-100':'bg-muted text-muted-foreground',selected&&'ring-1 ring-inset ring-sky-600')}
                  onClick={()=>onChange({...value,roomId:item.id,clock})}>{occupied?'예약':start?'시작':selected?'선택':peopleTone?'주의':''}</button>
              </td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    {attendance.isPending?<p role="status" className="text-xs">멤버 일정을 확인하는 중입니다.</p>:attendance.isError?<p role="alert" className="text-xs text-danger">멤버 일정을 불러오지 못했습니다. <button type="button" className="underline" onClick={()=>void attendance.refetch()}>다시 조회</button></p>:<MeetingAvailabilityTable attendees={attendees} rows={rows} clocks={clocks} clock={value.clock} duration={durationMinutes ?? 60} onChoose={clock=>onChange({...value,clock})}/>}
    {conflicts.length>0?<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acknowledged===acknowledgmentKey} onChange={event=>setAcknowledged(event.target.checked?acknowledgmentKey:null)}/>멤버의 겹치는 일정을 확인했으며 이 시간으로 진행합니다.</label>:null}
    {error||checkError?<p role="alert" className="text-xs text-danger">{error ?? checkError}</p>:null}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">{ready?`${room!.name} · ${value.dateKey} · ${formatMeetingClockRange(value.clock,durationMinutes!)}`:'회의 시간·날짜를 고르고 원하는 회의실의 빈 시간을 누르세요.'}</p>
      <Button type="button" disabled={!ready||checking||(conflicts.length>0&&acknowledged!==acknowledgmentKey)} onClick={()=>void confirm()}>{checking?'확인 중…':'일정 확정'}</Button>
    </div>
  </section>
}
