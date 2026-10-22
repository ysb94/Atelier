import { usesDeveloperDelegation } from './developer-delegate'
// 메뉴 표시용 힌트일 뿐이다. 실제 조회·수정 권한은 DB 지정과 RLS로 확인한다.
export function showAccessIpMenu(profile: { id?: string | null; email?: string | null; status?: string | null } | null) {
  return profile?.status === 'active' && profile.email !== 'ui-preview@example.invalid'
    && (profile.email?.toLowerCase() === 'dev@atelier.local' || usesDeveloperDelegation(profile))
}
export const IP_REVIEW_LABEL = { company: '회사 확인', external: '외부 확인', unconfirmed: '미확인' } as const
export type IpReviewStatus = keyof typeof IP_REVIEW_LABEL
