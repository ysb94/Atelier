/** 공지가 붙는 화면 자리. 운영지원은 이 이름만 고르고, 코드 위치는 외우지 않는다. */
export const COMPANY_NOTICE_SLOTS = [
  {
    id: 'my-attendance',
    label: 'My home · 내 근태 상단',
    detail: '내 근태에서 접힌 안내로 보입니다.',
  },
  {
    id: 'company',
    label: 'My home · 회사 공지',
    detail: '회사 전체 공지 탭에 보입니다. 부서는 고르지 않습니다.',
  },
  {
    id: 'department',
    label: 'My home · 부서 공지',
    detail: '고른 부서 소속만 부서 공지 탭에서 봅니다.',
  },
] as const

export type CompanyNoticeSlotId = (typeof COMPANY_NOTICE_SLOTS)[number]['id']

export type CompanyNotice = {
  id: string
  slot: CompanyNoticeSlotId
  departmentId: string | null
  title: string
  body: string
  startsOn: string | null
  endsOn: string | null
  published: boolean
  updatedAt: string
}

export const DEFAULT_MY_ATTENDANCE_NOTICE = {
  title: '공지] 휴가 사용 제도 안내',
  body: `직원 여러분의 근무 편의성과 휴가 활용의 유연성을 높이기 위해
기존 휴가 제도에 반반차(¼차) 사용 방식을 추가 운영합니다.

■ 시행일
2026년 2월 24일 ~
■ 휴가 사용 단위
연차 : 1일
반차 : 0.5일
반반차 : 0.25일 (추가 도입)

■ 반반차 사용 기준
1회 사용 시 근무시간의 ¼ (약 2시간) 사용
당일 업무 인수인계 및 팀 일정에 지장이 없도록 사전 협의 필수
■ 사용 예시
병원 방문, 은행 업무 등 단시간 외출
등·하원, 가족 일정 등 개인 용무 처리
■ 신청 방법
기존 휴가 신청 방식과 동일
최소 2일 전 신청 원칙 (긴급 상황 시 팀장 협의)

직원 여러분이 보다 효율적으로 시간을 활용할 수 있도록 도입된 제도이니,
업무 공백이 발생하지 않도록 서로 배려하며 사용해 주시기 바랍니다.`,
}

const SLOT_IDS = new Set<string>(COMPANY_NOTICE_SLOTS.map((slot) => slot.id))

export function isCompanyNoticeSlot(value: string): value is CompanyNoticeSlotId {
  return SLOT_IDS.has(value)
}

export function companyNoticeSlotLabel(slot: string) {
  return COMPANY_NOTICE_SLOTS.find((item) => item.id === slot)?.label ?? '알 수 없는 위치'
}

export type CompanyNoticePhase = 'live' | 'scheduled' | 'ended' | 'hidden'

export function companyNoticePhase(
  notice: Pick<CompanyNotice, 'published' | 'startsOn' | 'endsOn'>,
  today: string,
): CompanyNoticePhase {
  if (!notice.published) return 'hidden'
  if (notice.startsOn && notice.startsOn > today) return 'scheduled'
  if (notice.endsOn && notice.endsOn < today) return 'ended'
  return 'live'
}

export function companyNoticePhaseLabel(phase: CompanyNoticePhase) {
  if (phase === 'live') return '게시 중'
  if (phase === 'scheduled') return '게시 예정'
  if (phase === 'ended') return '기간 종료'
  return '내림'
}

/** 회사 전체 공지를 먼저, 그다음 부서 공지를 최신 수정순으로 보여 준다. */
export function visibleCompanyNotices(
  notices: readonly CompanyNotice[],
  today: string,
  departmentId: string | null,
) {
  return notices
    .filter(
      (notice) =>
        companyNoticePhase(notice, today) === 'live' &&
        (notice.departmentId === null || notice.departmentId === departmentId),
    )
    .slice()
    .sort((left, right) => {
      const audience = Number(left.departmentId !== null) - Number(right.departmentId !== null)
      if (audience !== 0) return audience
      return right.updatedAt.localeCompare(left.updatedAt)
    })
}
