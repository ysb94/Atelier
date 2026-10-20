// Offline-only auth context: the private verification server aliases this file.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Profile } from '@/lib/supabase/profiles'
const params = new URLSearchParams(location.search)
const profile = {
  id: 'fixture-user', email: params.get('identity') === 'employee' ? 'staff@example.invalid' : params.get('identity') === 'ceo' ? 'ceo@example.invalid' : 'dev@atelier.local',
  displayName: '화면 검수', status: 'active', isAdmin: !params.has('reader') && !params.has('identity'), position: params.get('identity') === 'ceo' ? '대표이사' : '사원', jobGrade: '사원',
  departmentId: null, departmentName: null, departmentPersonnelScope: null, capabilities: [], memberships: [],
} as unknown as Profile
const context = createContext(profile)
export function useAuth() {
  return { profile: useContext(context), session: { user: { id: profile.id, email: profile.email } }, email: profile.email, ready: true }
}
export function AuthDisplayProvider({ profile, children }: { profile: Profile; children: ReactNode }) {
  const value = useMemo(() => profile, [profile])
  return <context.Provider value={value}>{children}</context.Provider>
}
export function isBrandLead(profile: Profile | null, brandId: string) {
  return Boolean(profile?.status === 'active' && (profile.isAdmin || profile.memberships.some(item => item.brandId === brandId && item.isLead)))
}
export function canAccessBrand(profile: Profile | null) { return profile?.status === 'active' }
