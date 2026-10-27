/** 회의 성격은 아직 화면 미리보기에서만 사용한다. 서버의 회의 모델·권한에는 넣지 않는다. */
export const MEETING_KINDS = [
  { value: 'meeting', label: '미팅', hint: '바로 날짜·시간·회의실을 선택해 확정합니다. 참석 수락 절차와 내용·회의록 작성은 생략합니다.' },
  { value: 'one_off', label: '1회성 회의', hint: '한 번의 회의에 내용과 결과를 기록합니다.' },
  { value: 'project', label: '프로젝트 회의', hint: '기존처럼 회차별로 준비하고 기록합니다.' },
  { value: 'routine', label: '루틴 회의', hint: '종료일 없이 이어갑니다. 필요할 때 다음 회차의 일정을 정합니다.' },
  { value: 'interview', label: '면접', hint: '면접 주제·담당 멤버·일정을 정하고 필요한 회의 기록을 남깁니다.' },
] as const
export type MeetingKind = (typeof MEETING_KINDS)[number]['value']
export type MeetingKindInfo = { kind: MeetingKind }
export function emptyMeetingKindInfo(): MeetingKindInfo {
  return { kind: 'project' }
}
export function meetingHasNextRound(kind: MeetingKind) { return kind === 'project' || kind === 'routine' }
export function meetingKindLabel(kind: MeetingKind) { return MEETING_KINDS.find(item => item.value === kind)!.label }
