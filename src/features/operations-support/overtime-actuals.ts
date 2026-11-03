export type OvertimeActual = {
  requestId: string; startAt: string; endAt: string; breakMinutes: number; revision: number; savedAt: string
}
export type OvertimeRequest = {
  id: string; employeeId: string; kind: string; status: string; from: string; to: string
  start: string; end: string; endNextDay?: boolean
}

export function overtimeInstant(date: string, time: string, nextDay = false) {
  const stamp = Date.parse(`${date}T${time.slice(0, 5)}:00+09:00`)
  return stamp + (nextDay ? 86_400_000 : 0)
}

/** Explicit employee reports only; clock-out timestamps never create payable overtime. */
export function registeredOvertime(requests: readonly OvertimeRequest[], actuals: readonly OvertimeActual[], month: string, today: string) {
  const latest = new Map<string, OvertimeActual>()
  const seen = new Set<string>()
  for (const row of actuals) if (!latest.has(row.requestId) || latest.get(row.requestId)!.revision < row.revision) latest.set(row.requestId, row)
  return requests.flatMap(request => {
    if (seen.has(request.id)) return []
    seen.add(request.id)
    if (request.kind !== 'overtime' || request.status !== 'approved' || request.from !== request.to || request.from.slice(0, 7) !== month || request.from > today) return []
    const actual = latest.get(request.id)
    if (!actual) return []
    const start = Date.parse(actual.startAt), end = Date.parse(actual.endAt)
    const approvedStart = overtimeInstant(request.from, request.start), approvedEnd = overtimeInstant(request.to, request.end, request.endNextDay)
    const elapsed = Math.floor((end - start) / 60_000)
    if (![start, end, approvedStart, approvedEnd].every(Number.isFinite) || end <= start || start < approvedStart || end > approvedEnd || !Number.isInteger(actual.breakMinutes) || actual.breakMinutes < 0 || actual.breakMinutes > elapsed) return []
    return [{ request, actual, minutes: elapsed - actual.breakMinutes, approvedMinutes: Math.floor((approvedEnd - approvedStart) / 60_000) }]
  })
}
