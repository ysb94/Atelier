import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { minuteOf } from './personal-requests'
import { durationLabel, endAfterMinutes, leaveTimePresets, leaveWorkMinutes, OVERTIME_DURATIONS, rangeMinutes } from './request-time-options'

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45'] as const

export function RequestTimeField({ label, value, onChange }: {
  label: string; value: string; onChange: (value: string) => void
}) {
  const [hour = '', minute = ''] = value.split(':')
  return <fieldset className="request-time-field min-w-0 border-0 p-0" aria-label={label}>
    <legend className="mb-2 text-xs text-muted-foreground">{label}</legend>
    <div className="request-time-control flex items-center gap-2">
      <Select aria-label={`${label} 시`} value={hour} onChange={event => onChange(`${event.target.value}:${minute}`)} className="min-w-0 flex-1">
        <option value="">선택</option>{HOURS.map(hour => <option key={hour} value={hour}>{hour}</option>)}
      </Select><span className="text-xs text-muted-foreground">시</span>
      <Input aria-label={`${label} 분`} type="text" inputMode="numeric" maxLength={2} placeholder="00" value={minute}
        onChange={event => { const next = event.target.value; if (next === '' || (/^\d{1,2}$/.test(next) && Number(next) < 60)) onChange(`${hour}:${next}`) }}
        onKeyDown={event => { if (event.key === 'Enter' && /^\d$/.test(minute)) { event.preventDefault(); event.currentTarget.blur() } }}
        onBlur={() => { if (/^\d$/.test(minute)) onChange(`${hour}:${minute.padStart(2, '0')}`) }} className="min-w-0 flex-1" />
      <span className="text-xs text-muted-foreground">분</span>
    </div>
    <div className="mt-2 grid grid-cols-4 gap-1" role="group" aria-label={`${label} 빠른 분 선택`}>
      {MINUTES.map(value => <Button key={value} type="button" size="sm" variant={minute === value ? 'default' : 'outline'}
        aria-label={`${label} ${value}분`} aria-pressed={minute === value} className="h-7 px-1 text-xs" onClick={() => onChange(`${hour}:${value}`)}>{value}분</Button>)}
    </div>
  </fieldset>
}

export function TimeRangeSummary({ start, end, leave = false, daily = false }: {
  start: string; end: string; leave?: boolean; daily?: boolean
}) {
  const minutes = leave ? leaveWorkMinutes(start, end) : rangeMinutes(start, end)
  return <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm" role="status" aria-live="polite">
    {minutes == null ? '시작·종료 시각을 선택해 주세요.' : `${daily ? '매일 ' : ''}${start}–${end} · ${leave ? '휴게시간 제외 ' : '총 '}${durationLabel(minutes)}`}
  </p>
}

export function QuarterLeaveTime({ start, end, onChange }: {
  start: string; end: string; onChange: (patch: { start: string; end: string }) => void
}) {
  const presets = leaveTimePresets('quarter')
  const [custom, setCustom] = useState(() => !presets.some(preset => preset.start === start && preset.end === end))
  return <>
    <div className="flex flex-wrap gap-2" role="group" aria-label="반반차 시간">
      {presets.map(preset => {
        const selected = !custom && start === preset.start && end === preset.end
        return <Button key={preset.label} type="button" size="sm" variant={selected ? 'default' : 'outline'} aria-pressed={selected}
          onClick={() => { setCustom(false); onChange({ start: preset.start, end: preset.end }) }}>{preset.label}</Button>
      })}
      <Button type="button" size="sm" variant={custom ? 'default' : 'outline'} aria-pressed={custom} onClick={() => setCustom(true)}>그 외</Button>
    </div>
    {custom && <>
      <div className="personal-request-fields request-time-fields">
        <RequestTimeField label="시작 시각" value={start} onChange={value => onChange({ start: value, end })} />
        <RequestTimeField label="종료 시각" value={end} onChange={value => onChange({ start, end: value })} />
      </div>
      <TimeRangeSummary start={start} end={end} leave />
    </>}
  </>
}

export function LeaveTimeShortcuts({ kind, start, end, onChange, compact = false }: {
  kind: 'half' | 'quarter'; start: string; end: string; onChange: (patch: { start: string; end: string }) => void; compact?: boolean
}) {
  return <div className="flex flex-wrap gap-2" role="group" aria-label="휴가 시간 빠른 선택">
    {leaveTimePresets(kind).map(preset => <Button key={preset.label} type="button" size="sm"
      variant={start === preset.start && end === preset.end ? 'default' : 'outline'}
      aria-pressed={start === preset.start && end === preset.end} onClick={() => onChange({ start: preset.start, end: preset.end })}>
      {compact ? preset.label : `${preset.label} · ${preset.start}–${preset.end}`}
    </Button>)}
  </div>
}

export function OvertimeTimeFields({ start, end, onChange }: {
  start: string; end: string; onChange: (patch: { start?: string; end?: string }) => void
}) {
  const [duration, setDuration] = useState<number | null>(() => rangeMinutes(start, end))
  const overflow = duration != null && minuteOf(start) != null && endAfterMinutes(start, duration) == null
  return <>
    <div>
      <p className="mb-2 text-xs text-muted-foreground">근무 시간 · 시작 시각을 바꾸면 종료 시각도 함께 계산됩니다.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="야근 근무 시간">
        {OVERTIME_DURATIONS.map(minutes => <Button key={minutes} type="button" size="sm" variant={duration === minutes ? 'default' : 'outline'}
          aria-pressed={duration === minutes} disabled={endAfterMinutes(start, minutes) == null}
          onClick={() => { setDuration(minutes); onChange({ end: endAfterMinutes(start, minutes)! }) }}>{durationLabel(minutes)}</Button>)}
        <Button type="button" size="sm" variant={duration == null ? 'default' : 'outline'} aria-pressed={duration == null} onClick={() => setDuration(null)}>직접 설정</Button>
      </div>
    </div>
    <div className="personal-request-fields request-time-fields">
      <RequestTimeField label="야근 시작 시각" value={start} onChange={value => onChange({ start: value, ...(duration != null ? { end: endAfterMinutes(value, duration) ?? '' } : {}) })} />
      <RequestTimeField label="야근 종료 시각" value={end} onChange={value => { setDuration(null); onChange({ end: value }) }} />
    </div>
    <TimeRangeSummary start={start} end={end} />
    {overflow && <p role="alert" className="text-sm text-danger">선택한 근무 시간이 자정을 넘습니다. 시간을 줄이거나 날짜별로 나눠 신청해 주세요.</p>}
    <p className="text-xs text-muted-foreground">분은 직접 입력할 수 있습니다. 종료 시각을 직접 바꾸면 자동 계산이 해제됩니다.</p>
  </>
}
