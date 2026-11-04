import type { MeetingPerson, MeetingRound, MeetingSeries } from './meeting-schedule'

export type MeetingRoundRole = 'attendee' | 'result' | 'excluded'
export type MeetingRoundMember = { person: MeetingPerson; role: MeetingRoundRole }
export type MeetingSharedResult = { version: number; body: string; sharedAt: string }

/** Missing membership means legacy data; an explicit empty list never restores removed people. */
export function roundMembers(series: Pick<MeetingSeries, 'host' | 'members'>, round?: MeetingRound): MeetingRoundMember[] {
  const members = round?.membership ?? series.members.map(person => ({ person, role: 'attendee' as const }))
  return [...new Map(members.filter(row => row.person.id !== series.host.id).map(row => [row.person.id, row])).values()]
}

export function roundAttendees(series: Pick<MeetingSeries, 'host' | 'members'>, round?: MeetingRound): MeetingPerson[] {
  return roundMembers(series, round).filter(row => row.role === 'attendee').map(row => row.person)
}

export function roundRole(series: Pick<MeetingSeries, 'host' | 'members'>, round: MeetingRound, personId: string): MeetingRoundRole {
  return series.host.id === personId ? 'attendee' : roundMembers(series, round).find(row => row.person.id === personId)?.role ?? 'excluded'
}

export function inheritRoundMembers(series: MeetingSeries): MeetingRoundMember[] {
  const previous = [...series.rounds].sort((a, b) => b.round - a.round)[0]
  return roundMembers(series, previous).filter(row => row.role !== 'excluded').map(row => ({ ...row }))
}
