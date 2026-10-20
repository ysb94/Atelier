import type { MeetingPerson, MeetingSeries } from '../../features/meetings/meeting-schedule'
import type { PreviewFacts } from './page-preview-coverage'

/** 회의 화면은 현재 로컬 시안이다. 표시용 관계만 바꾸고 Auth 프로필/세션 ID는 바꾸지 않는다. */
export function previewMeetingActor(real: MeetingPerson, series: readonly MeetingSeries[], mode?: PreviewFacts['meetingRole']): MeetingPerson {
  if (!mode) return real
  if (mode === 'host') return series[0]?.host ?? real
  if (mode === 'participant') return series[0]?.members[0] ?? real
  if (mode === 'uploader') return series.flatMap(item => item.rounds.flatMap(round => round.prepMaterials))[0]?.uploadedBy ?? real
  return { ...real, id: 'ui-preview:meeting-outsider', name: '비참여자 · 화면 테스트' }
}

export function previewRequestIsSelf(actual: boolean, mode?: PreviewFacts['requestOwner']) {
  return mode ? mode === 'self' : actual
}
