// 메뉴 표시용 힌트일 뿐이다. 실제 조회·수정 권한은 DB의 1인 지정과 RLS로 확인한다.
export function showAccessIpMenu(profile: { email?: string | null; status?: string | null } | null) {
  return profile?.status === 'active' && profile.email?.toLowerCase() === 'dev@atelier.local'
}
export const IP_REVIEW_LABEL = { company: '회사 확인', external: '외부 확인', unconfirmed: '미확인' } as const
export type IpReviewStatus = keyof typeof IP_REVIEW_LABEL
