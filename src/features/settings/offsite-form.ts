import type { RequestForm } from './personal-requests.ts'

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const stamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
}

/** UI dates are actual endpoints. Only the submitted copy uses the existing workday encoding. */
export function offsiteSubmission(form: RequestForm): { request: RequestForm | null; error: string; minutes: number | null } {
  if (form.kind !== 'offsite') return { request: form, error: '', minutes: null }
  if (!validDate(form.from) || !validDate(form.to) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.end)) {
    return { request: null, error: '외근 시작 날짜·시간과 종료 날짜·시간을 입력해 주세요.', minutes: null }
  }
  const minutes = (Date.parse(`${form.to}T${form.end}:00+09:00`) - Date.parse(`${form.from}T${form.start}:00+09:00`)) / 60_000
  if (minutes <= 0) return { request: null, error: '종료 날짜·시간은 시작 날짜·시간보다 늦어야 합니다.', minutes: null }
  if (minutes > 1440) return { request: { ...form, endNextDay: false, offsiteContinuous: true }, error: '', minutes }
  return { request: { ...form, to: form.from, endNextDay: form.to !== form.from, offsiteContinuous: false }, error: '', minutes }
}
