/** 회의 성격은 아직 화면 미리보기에서만 사용한다. 서버의 회의 모델·권한에는 넣지 않는다. */
export const MEETING_KINDS = [
  { value: 'meeting', label: '미팅', hint: '바로 날짜·시간·회의실을 선택해 확정합니다. 참석 수락 절차와 내용·회의록 작성은 생략합니다.' },
  { value: 'one_off', label: '1회성 회의', hint: '한 번의 회의에 내용과 결과를 기록합니다.' },
  { value: 'project', label: '프로젝트 회의', hint: '기존처럼 회차별로 준비하고 기록합니다.' },
  { value: 'routine', label: '루틴 회의', hint: '종료일 없이 이어갑니다. 필요할 때 다음 회차의 일정을 정합니다.' },
  { value: 'interview', label: '면접', hint: '생성 후 바로 날짜·시간·회의실을 정합니다. 일정 확정 후 내부 멤버의 참석 가능·불가 응답을 받습니다.' },
] as const
export type MeetingKind = (typeof MEETING_KINDS)[number]['value']
export type MeetingKindInfo = { kind: MeetingKind }
/** 성격 구분용 색상. 참석 가능·불가 등 응답 상태 색상과 별개다. */
export const MEETING_KIND_TONES: Record<MeetingKind, string> = {
  meeting: 'border-blue-500/30 bg-blue-50 text-blue-800',
  one_off: 'border-warning/30 bg-warning/10 text-warning',
  project: 'border-primary/30 bg-primary/10 text-primary',
  routine: 'border-success/30 bg-success/10 text-success',
  interview: 'border-violet-500/30 bg-violet-50 text-violet-800',
}
export function emptyMeetingKindInfo(): MeetingKindInfo {
  return { kind: 'project' }
}
export function meetingHasNextRound(kind: MeetingKind) { return kind === 'project' || kind === 'routine' }
export function meetingKindLabel(kind: MeetingKind) { return MEETING_KINDS.find(item => item.value === kind)!.label }
