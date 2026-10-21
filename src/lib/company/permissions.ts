export const PERMISSION_CATALOG = [
  ['basic.use', '기본 직원 이용', '기본', 'company'],
  ['attendance.exempt', '출퇴근 기록 제외', '근태', 'company'],
  ['permissions.manage', '권한 지정 관리', '관리', 'company'],
  ['approvers.manage', '승인자·대체 승인자 지정', '관리', 'company'],
  ['work.manage', '업무 접수·배정·진행 관리', '업무', 'company,department'],
  ['drafts.read', '담당자별 기획안 조회', '업무', 'company'],
  ['data.planning', '기획 데이터 편집', '업무', 'company,brand'],
  ['data.design', '디자인 데이터 편집', '업무', 'company,brand'],
  ['data.md', 'MD 데이터 편집', '업무', 'company,brand'],
  ['data.logistics', '물류 데이터 편집', '업무', 'company,brand'],
  ['data.data', '공통 데이터 편집', '업무', 'company,brand'],
  ['attendance.manage', '출근시간 설정', '근태', 'company,department'],
  ['personnel.manage', '가입 승인·직원 계정 관리', '인사', 'company'],
  ['org.manage', '조직·직책·직급 관리', '인사', 'company'],
  ['notice.company.write', '회사 공지 작성·수정·게시', '공지', 'company'],
  ['notice.company.delete', '회사 공지 삭제', '공지', 'company'],
  ['notice.department.write', '부서 공지 작성·수정·게시', '공지', 'company,department'],
  ['notice.department.delete', '부서 공지 삭제', '공지', 'company,department'],
  ['partner.edit', '업체 헤더·전용 값 편집', '업체', 'company,brand,partner'],
  ['partner.manage', '업체 담당자 지정', '업체', 'company,brand'],
  ['brand.edit', '브랜드 정보 편집', '브랜드', 'company,brand'],
  ['brand.manage', '브랜드 생성·삭제', '브랜드', 'company'],
  ['ai.manage', 'AI 설정 관리', '브랜드', 'company,brand'],
  ['chat.moderate', '채팅 메시지 운영', '채팅', 'company,chat_room'],
  ['meeting.manage', '회의 운영', '업무', 'company'],
  ['company.review', '회사 현황·인사 자료 조회', '조회', 'company'],
  ['ideas.read', '공모전 접수함 조회', '조회', 'company'],
  ['preview.use', '화면 테스트', '관리', 'company'],
  ['system.manage', '시스템·저장소 운영', '관리', 'company'],
] as const

export type PermissionCode = typeof PERMISSION_CATALOG[number][0]
export type PermissionScope = 'company' | 'department' | 'brand' | 'partner' | 'chat_room'
export type PermissionGrant = { id?: string; profileId?: string; permission: PermissionCode; scopeKind: PermissionScope; scopeId: string; scopeName?: string; updatedAt?: string }
export type PermissionProfile = { status?: string | null; companyId?: string | null; permissionGrants?: readonly PermissionGrant[] }

/** 명시적인 지정 내역만 판정한다. 직책·직급·이메일·소속은 권한을 만들지 않는다. */
export function hasPermission(profile: PermissionProfile | null | undefined, permission: PermissionCode, scopeKind?: PermissionScope, scopeId?: string | null): boolean {
  if (profile?.status !== 'active') return false
  return Boolean(profile.permissionGrants?.some(grant => grant.permission === permission && (
    grant.scopeKind === 'company' ? grant.scopeId === profile.companyId
      : scopeKind ? grant.scopeKind === scopeKind && Boolean(scopeId) && grant.scopeId === scopeId
        : true
  )))
}

export function permissionLabel(code: string) { return PERMISSION_CATALOG.find(item => item[0] === code)?.[1] ?? code }
export function scopeLabel(kind: PermissionScope) { return ({ company: '회사', department: '부서', brand: '브랜드', partner: '업체', chat_room: '대화방' })[kind] }
export function permissionScopeIds(profile: PermissionProfile | null, permission: PermissionCode, kind: PermissionScope, candidates: readonly string[]) {
  return candidates.filter(id => hasPermission(profile, permission, kind, id))
}
