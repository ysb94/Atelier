/** 사용자가 동일인으로 확인한 계정. 이름·직책·사용자 메타데이터로 권한을 만들지 않는다. */
export const DEVELOPER_DELEGATE_ID = 'a5afdd00-4a61-44dc-a1a3-082fa8a1345d'

/** 기존 권한 전환 전에도 이 계정의 명시적 지정만 추가로 읽는다. 실제 허용 범위는 DB에 저장한다. */
export function usesDeveloperDelegation(profile: { id?: string | null; status?: string | null } | null) {
  return profile?.status === 'active' && profile.id === DEVELOPER_DELEGATE_ID
}
