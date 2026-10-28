import { Select } from '@/components/ui/input'
import { CREATABLE_MEETING_KINDS, MEETING_KINDS, type MeetingKind } from './meeting-kinds'

export function MeetingKindSelect({ kind, disabled, onChange }: { kind: MeetingKind; disabled: boolean; onChange: (kind: MeetingKind) => void }) {
  const options = CREATABLE_MEETING_KINDS.some(item => item.value === kind) ? CREATABLE_MEETING_KINDS : MEETING_KINDS.filter(item => item.value === kind)
  return <label className="w-44 space-y-1"><span className="text-xs font-medium">회의 성격</span><Select className="w-full" aria-label="회의 성격" value={kind} disabled={disabled} onChange={event => onChange(event.target.value as MeetingKind)}>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>
}

export function MeetingKindFields({ kind }: { kind: MeetingKind }) {
  return <p className="text-xs text-muted-foreground">{MEETING_KINDS.find(item => item.value === kind)!.hint}</p>
}
