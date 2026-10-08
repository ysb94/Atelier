import type { Department, Profile } from '../supabase/profiles'
import { ORG_ASSIGNMENT_EDITOR_EMAIL, isCompanyReviewer, inferCapabilityFromDepartment, type WorkCapability } from './capabilities.ts'

export type PreviewSettings = Pick<Profile,
  'departmentId' | 'departmentName' | 'departmentPersonnelScope' | 'position' |
  'jobGrade' | 'isAdmin' | 'status' | 'capabilities' | 'memberships'>

export function canPreviewProfile(profile: Profile | null, sessionEmail: string | null) {
  if (!profile || profile.status !== 'active' || !sessionEmail) return false
  const email = profile.email.trim().toLowerCase()
  return email === sessionEmail.trim().toLowerCase() &&
    (email === ORG_ASSIGNMENT_EDITOR_EMAIL || isCompanyReviewer(profile))
}

export function initialPreview(profile: Profile): PreviewSettings {
  return {
    departmentId: profile.departmentId,
    departmentName: profile.departmentName,
    departmentPersonnelScope: profile.departmentPersonnelScope,
    position: profile.position, jobGrade: profile.jobGrade, isAdmin: profile.isAdmin,
    status: profile.status, capabilities: [...profile.capabilities], memberships: [...profile.memberships],
  }
}

export function previewDepartment(department: Department | undefined): Partial<PreviewSettings> {
  const capability = inferCapabilityFromDepartment(department?.name)
  return {
    departmentId: department?.id ?? null,
    departmentName: department?.name ?? null,
    departmentPersonnelScope: department?.personnelScope ?? null,
    capabilities: capability ? [capability] : [],
  }
}

export function previewProfile(profile: Profile, settings: PreviewSettings): Profile {
  // 로그인 ID는 보존한다. 개발자 이메일 예외가 일반 직원 화면에 섞이지 않게 한다.
  return { ...profile, ...settings, email: 'ui-preview@example.invalid' }
}

export const PREVIEW_PRESETS: { label: string; settings: Partial<PreviewSettings> }[] = [
  { label: '일반 직원', settings: { position: '사원', isAdmin: false, status: 'active' } },
  { label: '팀장', settings: { position: '팀장', isAdmin: false, status: 'active' } },
  { label: '이사', settings: { position: '이사', isAdmin: false, status: 'active' } },
  { label: '관리자', settings: { position: '팀장', isAdmin: true, status: 'active' } },
  { label: '조회 전용', settings: { departmentId: null, departmentName: null, departmentPersonnelScope: null, position: '사원', isAdmin: false, status: 'active', capabilities: [] as WorkCapability[], memberships: [] } },
]
