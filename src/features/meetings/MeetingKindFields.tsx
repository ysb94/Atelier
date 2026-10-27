import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import type { MeetingSeries } from './meeting-schedule'
import { MEETING_KINDS, type MeetingKind, type MeetingKindInfo } from './meeting-kinds'

export function MeetingKindSelect({ kind, disabled, onChange }: { kind: MeetingKind; disabled: boolean; onChange: (kind: MeetingKind) => void }) {
  return <label className="w-44 space-y-1"><span className="text-xs font-medium">회의 성격</span><Select className="w-full" aria-label="회의 성격" value={kind} disabled={disabled} onChange={event => onChange(event.target.value as MeetingKind)}>{MEETING_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>
}

export function MeetingKindFields({ value, today, onChange }: { value: MeetingKindInfo; today: string; onChange: (info: MeetingKindInfo) => void }) {
  return <section className="space-y-2" aria-label="회의 성격별 항목">
    <p className="text-xs text-muted-foreground">{MEETING_KINDS.find(item => item.value === value.kind)!.hint}</p>
    {value.kind === 'meeting' && <label className="block max-w-56 space-y-1"><span className="text-xs font-medium">미팅 날짜</span><Input type="date" aria-label="미팅 날짜" max={today} value={value.date} onChange={event => onChange({ ...value, date: event.target.value })} /></label>}
    {value.kind === 'interview' && <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs font-medium">지원자 정보 · 호스트·면접관 전용</p><div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1 basis-48" aria-label="지원자 이름" placeholder="지원자 이름 · 검수용 예시만 입력" value={value.candidate.name} onChange={event => onChange({ ...value, candidate: { ...value.candidate, name: event.target.value } })} /><Input className="min-w-0 flex-1 basis-48" aria-label="지원자 연락처" placeholder="연락처" value={value.candidate.contact} onChange={event => onChange({ ...value, candidate: { ...value.candidate, contact: event.target.value } })} /></div><Textarea aria-label="면접 메모" rows={2} value={value.candidate.notes} placeholder="면접 메모" onChange={event => onChange({ ...value, candidate: { ...value.candidate, notes: event.target.value } })} /></div>}
  </section>
}

export function MeetingCandidateSummary({ info }: { info: MeetingKindInfo }) {
  return <section className="space-y-1 rounded-lg border border-border bg-muted/30 p-3" aria-label="비공개 지원자 정보"><h3 className="text-xs font-medium">지원자 정보 · 호스트·면접관 전용</h3><p className="text-sm">{info.candidate.name || '이름 미입력'}</p><p className="text-sm">{info.candidate.contact}</p><p className="whitespace-pre-wrap text-sm">{info.candidate.notes}</p></section>
}

export function MeetingRecordDialog({ series, date, onClose }: { series: MeetingSeries; date: string; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button type="button" aria-label="미팅 기록 닫기" className="absolute inset-0 bg-black/40" onClick={onClose} /><div role="dialog" aria-modal="true" aria-label="미팅 진행 기록" className="relative z-10 w-full max-w-3xl space-y-4 rounded-xl border border-border bg-card p-5 shadow-lg"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{series.title}</h2><Button type="button" size="sm" variant="outline" onClick={onClose}>닫기</Button></div><p className="text-sm">{date} · 미팅 진행 완료</p><p className="text-sm">참석자 · {[series.host, ...series.members].map(person => person.name).join(', ')}</p><p className="text-xs text-muted-foreground">진행 사실만 남기는 기록입니다. 실제 데이터에는 저장하지 않았습니다.</p></div></div>
}
