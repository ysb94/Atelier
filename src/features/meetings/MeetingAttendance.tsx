import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MeetingPerson, MeetingRound, MeetingSeries } from './meeting-schedule'

export function MeetingAttendance({series,round,actorId,simulating,onChat,onGroup,onRespond,compact=false}:{
  series:MeetingSeries;round?:MeetingRound;actorId:string;simulating:boolean;compact?:boolean
  onChat:(person:MeetingPerson)=>void;onGroup:()=>void;onRespond?:(status:'available'|'unavailable')=>void
}) {
  const published=series.phase!=='preparing',confirmed=published && Boolean(round?.confirmed ?? round?.startsAt)
  const participant=series.host.id===actorId || series.members.some(person=>person.id===actorId)
  const myStatus=round?.responses?.find(response=>response.profileId===actorId)?.status ?? 'pending'
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-1">
      {[series.host,...series.members].map(person=>{
        const isHost=person.id===series.host.id
        const status=round?.responses?.find(response=>response.profileId===person.id)?.status ?? 'pending'
        const label=isHost?'호스트':!confirmed?'준비 중':status==='available'?'참석 가능':status==='unavailable'?'참석 불가':'응답 대기'
        return <button key={person.id} type="button" disabled={!published||!participant||simulating||person.id===actorId}
          title={`${person.name} · ${label}${person.id!==actorId&&published?' · 1:1 대화':''}`}
          aria-label={`${person.name} · ${label}`} onClick={()=>onChat(person)}
          className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs disabled:cursor-default',isHost?'bg-sky-100 text-sky-950':'bg-muted text-muted-foreground',published&&participant&&!simulating&&person.id!==actorId&&'hover:ring-1 hover:ring-foreground/30')}>
          <span aria-hidden className={cn('size-1.5 rounded-full',isHost?'bg-sky-600':confirmed&&status==='available'?'bg-emerald-600':confirmed&&status==='unavailable'?'bg-red-500':'bg-muted-foreground/40')}/>
          {person.name}{!compact?` · ${label}`:''}
        </button>
      })}
    </div>
    {!compact&&published&&participant ? <Button size="sm" variant="outline" disabled={simulating} onClick={onGroup}>전체 멤버와 대화</Button> : null}
    {!compact&&confirmed&&series.members.some(person=>person.id===actorId)&&onRespond ? <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-xs">확정된 일정에 참석할 수 있나요? · {myStatus==='available'?'참석 가능':myStatus==='unavailable'?'참석 불가':'응답 대기'}</p>
      <div className="flex gap-2"><Button size="sm" variant={myStatus==='available'?'default':'outline'} onClick={()=>onRespond('available')}>참석 가능</Button><Button size="sm" variant={myStatus==='unavailable'?'default':'outline'} onClick={()=>onRespond('unavailable')}>참석 불가</Button></div>
    </div>:null}
  </div>
}
