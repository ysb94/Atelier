import { cn } from '@/lib/utils'
import type { MeetingPerson } from './meeting-schedule'
import { AVAILABILITY_LABEL, availabilityMinutes, availabilityTone, overlapsAvailability, type MeetingAvailability } from './meeting-availability'

export function MeetingAvailabilityTable({attendees,rows,clocks,clock,duration,onChoose,canChoose}:{
  attendees:readonly MeetingPerson[];rows:readonly MeetingAvailability[];clocks:readonly string[]
  clock:string;duration:number;onChoose:(clock:string)=>void;canChoose?:(clock:string)=>boolean
}) {
  const selected = clock ? rows.filter(row => overlapsAvailability(row,clock,duration)) : []
  return <section aria-label="멤버별 일정" className="space-y-2">
    <h3 className="text-sm font-medium">호스트·멤버 일정</h3>
    <p className="text-xs text-muted-foreground">빨강: 확정 일정 · 노랑: 승인 대기 · 파랑: 재택 참고. 사람의 일정이 겹쳐도 확인 후 선택할 수 있습니다.</p>
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[960px] table-fixed border-collapse text-center text-[10px]">
        <caption className="sr-only">참석자별 사전 등록 일정</caption>
        <thead><tr><th className="w-24 bg-muted p-2 text-left">멤버</th>{clocks.map(time=><th key={time} className="border-l border-border bg-muted py-2 font-normal">{time}</th>)}</tr></thead>
        <tbody>{attendees.map(person=><tr key={person.id}><th scope="row" className="border-t border-border p-2 text-left text-xs">{person.name}</th>
          {clocks.map(time=>{
            const entries=rows.filter(row=>row.personId===person.id&&overlapsAvailability(row,time,30))
            const tone=entries.some(row=>availabilityTone(row)==='conflict')?'conflict':entries.some(row=>availabilityTone(row)==='warning')?'warning':entries.length?'info':'free'
            const selectedTime=clock&&availabilityMinutes(time)>=availabilityMinutes(clock)&&availabilityMinutes(time)<availabilityMinutes(clock)+duration
            const enabled=canChoose ? canChoose(time) : true
            return <td key={time} className="border-l border-t border-border p-0"><button type="button" aria-label={`${person.name} ${time} 일정`} disabled={!enabled}
              title={!enabled?'회의실 표에서 선택 가능한 시간을 골라주세요.':entries.length?entries.map(row=>`${AVAILABILITY_LABEL[row.kind]} ${row.start}–${row.end}${row.status==='pending'?' · 승인 대기':''}`).join('\n'):'등록된 일정 없음'}
              className={cn('h-10 w-full disabled:cursor-not-allowed',!enabled?'bg-muted text-muted-foreground':tone==='conflict'?'bg-red-100 text-red-800':tone==='warning'?'bg-amber-100 text-amber-900':tone==='info'?'bg-sky-100 text-sky-900':'bg-emerald-50',selectedTime&&'ring-1 ring-inset ring-sky-600')}
              onClick={()=>onChoose(time)}>{entries.length?AVAILABILITY_LABEL[entries[0].kind]:''}</button></td>
          })}</tr>)}</tbody>
      </table>
    </div>
    {clock?<div aria-label="선택 시간의 멤버 일정" className="space-y-1 text-xs">
      {selected.length?selected.map(row=><p key={`${row.personId}:${row.id}`} className={availabilityTone(row)==='conflict'?'text-red-700':availabilityTone(row)==='warning'?'text-amber-800':'text-sky-700'}>
        {attendees.find(person=>person.id===row.personId)?.name} · {AVAILABILITY_LABEL[row.kind]} · {row.start}–{row.end}{row.status==='pending'?' · 승인 대기':''}
      </p>):<p className="text-emerald-700">선택한 시간에 등록된 충돌 일정이 없습니다.</p>}
    </div>:null}
  </section>
}
