/** 회의 성격은 아직 화면 미리보기에서만 사용한다. 서버의 회의 모델·권한에는 넣지 않는다. */
export const MEETING_KINDS = [
  { value: 'meeting', label: '미팅', hint: '미팅을 했다는 사실만 기록합니다. 회의록과 회의실 예약은 만들지 않습니다.' },
  { value: 'one_off', label: '1회성 회의', hint: '한 번의 회의에 내용과 결과를 기록합니다.' },
  { value: 'project', label: '프로젝트 회의', hint: '기존처럼 회차별로 준비하고 기록합니다.' },
  { value: 'routine', label: '루틴 회의', hint: '종료일 없이 이어갑니다. 필요할 때 다음 회차의 일정을 정합니다.' },
  { value: 'interview', label: '면접', hint: '공개 주제에는 지원자 이름을 넣지 않습니다. 지원자 정보는 호스트와 면접관만 봅니다.' },
] as const
export type MeetingKind = (typeof MEETING_KINDS)[number]['value']
export type MeetingKindInfo = { kind: MeetingKind; date: string; candidate: { name: string; contact: string; notes: string } }
export function emptyMeetingKindInfo(date: string): MeetingKindInfo {
  return { kind: 'project', date, candidate: { name: '', contact: '', notes: '' } }
}
export function meetingHasNextRound(kind: MeetingKind) { return kind === 'project' || kind === 'routine' }
export function meetingKindLabel(kind: MeetingKind) { return MEETING_KINDS.find(item => item.value === kind)!.label }
export function validMeetingRecordDate(date: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return false
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isFinite(parsed.getTime()) && `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}` === date
}
