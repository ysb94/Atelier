import { HireDateScrollField } from '@/features/org/HireDateScrollField'
import { RequestTimeField } from './RequestTimeFields'
import { durationLabel } from './request-time-options'
import type { RequestForm } from './personal-requests'
import { offsiteSubmission } from './offsite-form'

export function OffsiteDateTimeFields({ form, maxDate, onChange }: {
  form: RequestForm; maxDate: string; onChange: (patch: Partial<RequestForm>) => void
}) {
  const range = offsiteSubmission(form)
  return <section className="space-y-3" aria-label="외근 시작·종료">
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3">
        <label className="block text-sm">시작 날짜<HireDateScrollField label="외근 시작 날짜" className="mt-[7px] w-full" value={form.from} min="1950-01-01" max={maxDate} clearable={false} onChange={value => { if (value) onChange({ from: value, ...(form.to < value ? { to: value } : {}) }) }} /></label>
        <RequestTimeField label="시작 시각" value={form.start} onChange={start => onChange({ start })} />
      </div>
      <div className="space-y-3">
        <label className="block text-sm">종료 날짜<HireDateScrollField label="외근 종료 날짜" className="mt-[7px] w-full" value={form.to} min={form.from || '1950-01-01'} max={maxDate} clearable={false} onChange={to => { if (to) onChange({ to }) }} /></label>
        <RequestTimeField label="종료 시각" value={form.end} onChange={end => onChange({ end })} />
      </div>
    </div>
    {range.request && range.minutes != null ? <p className="personal-request-helper" role="status">{form.from.replaceAll('-', '.')} {form.start} → {form.to.replaceAll('-', '.')} {form.end} · 외근 구간 {durationLabel(range.minutes)}</p> : <p className="personal-request-helper" role="status">{range.error}</p>}
    <p className="personal-request-helper">실제 시작·종료 날짜와 시각을 입력하세요. 날짜가 바뀌면 자동으로 다음 날 종료로 처리합니다. 한 건은 24시간 이내입니다.</p>
  </section>
}
