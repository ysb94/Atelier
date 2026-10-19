// Only resolved by browser-check.mjs's private Vite server; never the app build.
const params = new URLSearchParams(location.search)
const position = params.get('position') || '사원'
export const profile = {
  id: 'fixture-user', email: params.get('email') || 'fixture@example.invalid', displayName: '검증 직원',
  companyId: 'e0000000-0000-4000-8000-000000000001', departmentId: 'fixture-department', departmentName: params.get('department')??'운영지원팀',
  position, jobGrade: params.get('grade')??'사원', hireDate:params.get('hire')??null,status: params.get('status') || 'active', isAdmin: params.get('admin')==='true', capabilities: [], memberships: [],
  departmentPersonnelScope: 'company', nameConfirmedAt: '2026-01-01', requestedAt: '2026-01-01',
}
export function useAuth() { return { ready: true, profile, session: { user: { id: profile.id } }, email: profile.email } }
export function canAccessBrand() { return true }
export function isBrandLead() { return params.get('lead')==='true' }
// The navigation harness supplies its synthetic profile directly. It does not
// enable the live developer identity switcher or access a real session.
export function AuthDisplayProvider({children}: {children: import('react').ReactNode}) { return children }
