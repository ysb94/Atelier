import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/input'
import { listMeetingAvailability, listMeetingDirectory, setMeetingRoundPeople } from '@/lib/supabase/meetings'
import { emptyList } from '@/lib/utils'
import { roundMembers, type MeetingRoundMember, type MeetingRoundRole } from './meeting-round-members'
import type { MeetingRound, MeetingSeries } from './meeting-schedule'

export function MeetingRoundPeople({ series, round, actorId, revision, onSaved }: {
  series: MeetingSeries; round: MeetingRound; actorId: string; revision: number; onSaved: (revision: number) => Promise<void>
}) {
  const host = series.host.id === actorId
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<MeetingRoundMember[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [baseRevision, setBaseRevision] = useState(revision)
  const [selected, setSelected] = useState('')
  const directory = useQuery({ queryKey: ['meeting-directory'], queryFn: listMeetingDirectory, enabled: editing && host })
  const availability = useQuery({ queryKey: ['meeting-round-add-availability', series.id, round.id, round.startsAt, selected],
    queryFn: () => listMeetingAvailability(series.id, round.startsAt.slice(0, 10), [selected], round.id),
    enabled: editing && host && Boolean(selected && round.startsAt) })
  const start = round.startsAt.slice(11, 16)
  const startMinute = Number(start.slice(0, 2)) * 60 + Number(start.slice(3))
  const endMinute = startMinute + (round.durationMinutes ?? series.durationMinutes)
  const conflicts = availability.data?.filter(item => {
    const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3))
    return minutes(item.start) < endMinute && minutes(item.end) > startMinute
  })
  const members = roundMembers(series, round)
  const resultPeople = members.filter(p => p.role === 'result')
  async function save() {
    setBusy(true); setError(null)
    try {
      const revision = await setMeetingRoundPeople(round.id, baseRevision, draft.map(p => ({ id: p.person.id, role: p.role })))
      await onSaved(revision); setEditing(false)
    } catch (cause) {
      console.warn('[meetings] 회차 명단 저장 실패', { roundId: round.id, cause })
      setError(cause instanceof Error ? cause.message : '명단을 저장하지 못했습니다. 입력은 유지됩니다.')
    } finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-xl border border-border p-3" aria-label="회차별 멤버 관리">
    <p className="text-sm font-medium">참석 {1 + members.filter(p => p.role === 'attendee').length}명 · 결과 공유 {resultPeople.length}명</p>
    <div className="space-y-2" aria-label="이번 회차 참석자">
      <p className="text-sm font-medium">참석자</p>
      <div className="flex flex-wrap gap-2"><Badge variant="outline">{series.host.name} · 호스트</Badge>
        {members.filter(p => p.role === 'attendee').map(p => <Badge key={p.person.id} variant="outline">{p.person.name} · {round.manualConfirmation?.excludedIds.includes(p.person.id) ? '이번 차수 불참' : !round.confirmed ? '준비 중' : series.kind === 'meeting' ? '일정 공유' : ({ available: '참석', unavailable: '불참', pending: '응답 대기' }[round.responses?.find(r => r.profileId === p.person.id)?.status ?? 'pending'])}</Badge>)}
      </div>
    </div>
    {resultPeople.length > 0 && <div className="border-t border-border pt-3">
      <p className="flex items-center gap-1 text-sm font-medium"><FileText className="size-4" />결과 공유만 · {resultPeople.length}명</p>
      <p className="mt-1 text-sm">{resultPeople.map(p => p.person.name).join(' · ')}</p>
      <p className="mt-1 text-xs text-muted-foreground">이번 회의에 참석하지 않으며, 결과가 공유되면 알림을 받습니다.</p>
    </div>}
    {host && series.status === 'in_progress' && !editing && <Button type="button" size="sm" variant="outline" disabled={!series.roundMembershipReady} onClick={() => { setBaseRevision(revision); setDraft(members); setError(null); setEditing(true) }}>회차 멤버 관리</Button>}
    {host && !series.roundMembershipReady && <p className="text-xs text-muted-foreground">회차별 멤버 관리 서버 연결 대기</p>}
    {editing && <fieldset disabled={busy} className="space-y-3">
      <p className="text-xs text-muted-foreground">이 회차만 변경합니다. 이미 초대된 참석자를 빼면 참석 해제 안내가 전달됩니다. 다른 참석자의 응답은 유지됩니다.</p>
      {draft.filter(p => p.role !== 'excluded').map(row => <div key={row.person.id} className="flex items-center justify-between gap-2">
        <span className="text-sm">{row.person.name}</span>
        <Select aria-label={`${row.person.name} 회차 역할`} value={row.role} onChange={e => setDraft(current => current.map(p => p.person.id === row.person.id ? { ...p, role: e.target.value as MeetingRoundRole } : p))}>
          <option value="attendee">참석</option>{series.kind !== 'meeting' && <option value="result">결과만 공유</option>}<option value="excluded">명단에서 제외</option>
        </Select>
      </div>)}
      <div className="flex gap-2"><Select aria-label="추가할 회차 멤버" value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">직원 선택</option>{(directory.data ?? emptyList()).filter(p => p.id !== series.host.id && !draft.some(row => row.person.id === p.id && row.role !== 'excluded')).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select><Button type="button" variant="outline" disabled={!selected} onClick={() => { const person = directory.data?.find(p => p.id === selected); if (person) setDraft(current => [...current.filter(p => p.person.id !== person.id), { person, role: 'attendee' }]); setSelected('') }}>멤버 추가</Button></div>
      {selected && round.startsAt && <p className="text-xs text-muted-foreground" role="status">{availability.isPending ? '선택한 직원의 일정 확인 중' : availability.error ? '일정 충돌 여부를 확인하지 못했습니다.' : conflicts?.length ? `현재 회의 시간과 겹치는 일정 ${conflicts.length}건이 있습니다. 회의 시간은 유지됩니다.` : '현재 회의 시간과 겹치는 일정이 없습니다.'}</p>}
      {directory.error && <p role="alert" className="text-sm text-danger">직원 목록을 불러오지 못했습니다.</p>}
      <div className="flex gap-2"><Button type="button" onClick={() => void save()}>명단 저장</Button><Button type="button" variant="outline" onClick={() => setEditing(false)}>취소</Button></div>
    </fieldset>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>
}

export function MeetingSharedResults({ round }: { round: MeetingRound }) {
  return <section className="space-y-3" aria-label="공유된 회의 결과">
    <h3 className="text-sm font-medium">공유된 회의 결과</h3>
    {round.sharedResults?.length ? [...round.sharedResults].reverse().map(result => <article key={result.version} className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted-foreground">공유 {result.version} · {new Date(result.sharedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm">{result.body}</p>
    </article>) : <p className="text-sm text-muted-foreground">결과 등록 대기</p>}
  </section>
}
