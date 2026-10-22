export type MeetingAvailability = {
  id: string; personId: string
  kind: 'meeting' | 'annual' | 'half' | 'quarter' | 'offsite' | 'remote'
  status: 'approved' | 'pending'; start: string; end: string
}
export const AVAILABILITY_LABEL = { meeting: '다른 회의', annual: '연차', half: '반차', quarter: '반반차', offsite: '외근', remote: '재택' }
export function availabilityMinutes(clock: string) {
  const [hour, minute] = clock.split(':').map(Number)
  return hour * 60 + minute
}
export function overlapsAvailability(entry: MeetingAvailability, clock: string, duration: number) {
  const start = availabilityMinutes(clock)
  return start < availabilityMinutes(entry.end) && start + duration > availabilityMinutes(entry.start)
}
export function availabilityTone(entry: MeetingAvailability) {
  return entry.kind === 'remote' ? 'info' : entry.status === 'pending' ? 'warning' : 'conflict'
}
export function availabilityConfirmationKey(selection: unknown, rows: readonly MeetingAvailability[]) {
  return JSON.stringify([selection, rows.filter(row => row.kind !== 'remote').map(row => [row.id, row.personId, row.kind, row.status, row.start, row.end]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))])
}
