import type { Profile } from '../supabase/profiles'
import type { PreviewSettings } from './profile-preview'
import { isWorkRequestOwner, WORK_REQUEST_CONFIG } from '../../features/work-requests/work-request-form-config.ts'

export type PagePreviewCase = { id: string; label: string; settings: PreviewSettings }

/** 페이지의 실제 화면 분기를 등록한다. 새 분기를 만들 때 여기도 함께 갱신한다. */
export function pagePreviewCases(pathname: string, real: Profile): PagePreviewCase[] {
  const path = pathname.replace(/\/$/, '') || '/'
  const base: PreviewSettings = {
    departmentId: null, departmentName: null, departmentPersonnelScope: null,
    position: '사원', jobGrade: '사원', status: 'active', isAdmin: false,
    capabilities: [], memberships: [],
  }
  const item = (id: string, label: string, settings: Partial<PreviewSettings> = {}): PagePreviewCase => ({ id, label, settings: { ...base, ...settings } })
  const owner = /^\/work-requests\/([^/]+)$/.exec(path)?.[1]
  if (owner && isWorkRequestOwner(owner)) {
    const team = { departmentName: WORK_REQUEST_CONFIG[owner].teamName, capabilities: [owner] }
    return [
      item('manager', '팀장급 이상', { ...team, position: '팀장', jobGrade: '과장' }),
      item('employee', '사원급', team),
      item('requester', '다른 부서 요청자', { departmentName: owner === 'logistics' ? '기획팀' : '물류팀' }),
    ]
  }
  if (path === '/drafts') return [
    item('manager', '팀장급 이상', { position: '팀장' }), item('employee', '사원급'),
  ]
  if (path === '/operations-support') return [
    item('editor', '운영지원팀', { departmentName: '운영지원팀', departmentPersonnelScope: 'leaders' }),
    item('viewer', '다른 부서', { departmentName: '기획팀' }),
    item('reviewer', '대표이사 · 검수', { position: '대표이사', departmentName: '운영진' }),
  ]
  if (path === '/members') return [
    item('editor', '인사 관리 가능', { departmentName: '운영지원팀', departmentPersonnelScope: 'leaders', position: '팀장' }),
    item('viewer', '인사 관리 불가'),
    item('reviewer', '대표이사 · 검수', { position: '대표이사', departmentName: '운영진' }),
  ]
  if (path === '/meetings') return [item('admin', '관리자', { isAdmin: true }), item('employee', '일반 직원')]
  if (path === '/settings/ai') return [item('editor', '편집 가능', { isAdmin: true }), item('viewer', '조회 전용')]
  if (path === '/brands') return [
    item('admin', '관리자', { isAdmin: true }),
    item('lead', '브랜드 책임자', { memberships: real.memberships.map(member => ({ ...member, isLead: true })) }),
    item('employee', '일반 직원'),
  ]
  if (path === '/') return [
    item('manager', '팀장급 이상', { position: '팀장', capabilities: ['planning'] }),
    item('employee', '사원급', { capabilities: ['planning'] }),
    item('personnel', '인사 담당', { position: '팀장', departmentName: '운영지원팀', departmentPersonnelScope: 'leaders', capabilities: ['planning'] }),
  ]
  return []
}
