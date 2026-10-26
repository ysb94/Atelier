import {
  filterSeriesForViewer,
  type MeetingPerson,
  type MeetingSeries,
} from './meeting-schedule'

export type MeetingParticipation = {
  count: number
  visibleMeetings: { id: string; title: string }[]
  hiddenCount: number
}

/** Preserve the member picker's active-series count; only copy authorized titles. */
export function buildOngoingMeetingParticipation(
  series: readonly MeetingSeries[],
  viewer: Pick<MeetingPerson, 'id'>,
  isAdmin: boolean,
): Map<string, MeetingParticipation> {
  const visibleIds = new Set(
    filterSeriesForViewer(series, viewer, isAdmin).map((item) => item.id),
  )
  const result = new Map<string, MeetingParticipation>()
  for (const item of series) {
    if (item.status !== 'in_progress') continue
    const participants = new Set([item.host.id, ...item.members.map((person) => person.id)])
    for (const id of participants) {
      const value: MeetingParticipation = result.get(id) ?? { count: 0, visibleMeetings: [], hiddenCount: 0 }
      value.count++
      if (visibleIds.has(item.id)) {
        value.visibleMeetings.push({ id: item.id, title: item.title.trim() || '제목 없는 회의' })
      } else {
        value.hiddenCount++
      }
      result.set(id, value)
    }
  }
  return result
}
