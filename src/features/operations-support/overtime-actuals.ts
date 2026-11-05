export type OvertimeActual = {
  requestId: string; startAt: string; endAt: string; breakMinutes: number; revision: number; savedAt: string; offsiteMinutes?: Record<string,number>; clockLinked?: boolean; checkoutAt?: string | null
}
export type OvertimeRequest = {
  id: string; employeeId: string; kind: string; status: string; from: string; to: string
  start: string; end: string; endNextDay?: boolean
}

export function overtimeInstant(date: string, time: string, nextDay = false) {
  const stamp = Date.parse(`${date}T${time.slice(0, 5)}:00+09:00`)
  return stamp + (nextDay ? 86_400_000 : 0)
}

/** Approved overtime uses its linked actual checkout; legacy reports keep their stored values. */
export function registeredOvertime(requests: readonly OvertimeRequest[], actuals: readonly OvertimeActual[], month: string, today: string) {
  const latest = new Map<string, OvertimeActual>()
  const seen = new Set<string>()
  for (const row of actuals) if (!latest.has(row.requestId) || latest.get(row.requestId)!.revision < row.revision) latest.set(row.requestId, row)
  return requests.flatMap(request => {
    if (seen.has(request.id)) return []
    seen.add(request.id)
    const actual = latest.get(request.id)
    if (request.kind === 'offsite' && request.status === 'approved' && actual?.offsiteMinutes) {
      const values = Object.entries(actual.offsiteMinutes).filter(([date])=>date.slice(0,7)===month && date<=today)
      if (values.some(([,minutes])=>!Number.isInteger(minutes)||minutes<0||minutes>1440)) return []
      const minutes=values.reduce((sum,[,value])=>sum+value,0)
      return minutes>0 ? [{request,actual,minutes,approvedMinutes:minutes}] : []
    }
    if (request.kind !== 'overtime' || request.status !== 'approved' || request.from !== request.to || request.from.slice(0, 7) !== month || request.from > today) return []
    if (!actual) return []
    const start = Date.parse(actual.startAt), end = Date.parse(actual.endAt)
    const approvedStart = overtimeInstant(request.from, request.start), approvedEnd = overtimeInstant(request.to, request.end, request.endNextDay)
    const elapsed = Math.floor((end - start) / 60_000)
    if (![start, end, approvedStart, approvedEnd].every(Number.isFinite) || (!actual.clockLinked && end <= start) || !Number.isInteger(actual.breakMinutes) || actual.breakMinutes < 0 || actual.breakMinutes > Math.max(0,elapsed)) return []
    return [{ request, actual, minutes: Math.max(0,elapsed) - actual.breakMinutes, approvedMinutes: Math.floor((approvedEnd - approvedStart) / 60_000) }]
  })
}
