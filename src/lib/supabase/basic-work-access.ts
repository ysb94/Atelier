import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuth } from './auth'
import { getSupabase } from './client'
import type { BrandField, ProductDraft } from '../types'

export type BasicWorkDomain = 'planning' | 'design' | 'md' | 'logistics' | 'china' | 'operations'
export type BasicWorkAccess = { profileId: string; operator: boolean; legacyEdit: boolean; domains: BasicWorkDomain[]; brandDomains?: Record<string,BasicWorkDomain[]>; manageOwners: string[] }
export async function loadBasicWorkAccess(): Promise<BasicWorkAccess> {
  const { data, error } = await getSupabase().rpc('get_my_basic_work_access')
  if (error) { console.warn('[work-access] 기본 업무 권한 조회 실패', error); throw new Error('업무 권한을 확인하지 못했습니다. 다시 시도해 주세요.') }
  return data as BasicWorkAccess
}
export function useBasicWorkAccess() {
  const { profile, session, refreshProfile } = useAuth()
  const query = useQuery({ queryKey: ['basic-work-access', profile?.id, profile?.updatedAt], queryFn: loadBasicWorkAccess, enabled: profile?.status === 'active' && session?.user.id === profile.id, retry: false })
  // The authenticated session must match both the profile and the response, including during impersonation.
  const access = session?.user.id === profile?.id && query.data?.profileId === profile?.id ? query.data : undefined
  const actorId=profile?.id
  const reload=query.refetch
  useEffect(()=>{
    if(!actorId || session?.user.id!==actorId)return
    const channel=getSupabase().channel(`basic-work-profile:${actorId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'profiles',filter:`id=eq.${actorId}`},()=>{void reload();void refreshProfile()}).subscribe()
    return()=>{void getSupabase().removeChannel(channel)}
  },[actorId,session?.user.id,reload,refreshProfile])
  return { ...query, access }
}
export function canWriteDraft(access: BasicWorkAccess | undefined, draft?: Pick<ProductDraft, 'createdBy'> | null, brandId?: string | null) {
  return Boolean(access && (draft ? access.operator || draft.createdBy === access.profileId : access.domains.includes('planning') || (brandId ? access.brandDomains?.[brandId]?.includes('planning') : Object.values(access.brandDomains??{}).some(domains=>domains.includes('planning')))))
}
export function canWriteProductField(access: BasicWorkAccess | undefined, field: Pick<BrandField, 'owner'> & Partial<Pick<BrandField,'brandId'>>) {
  return Boolean(access && (access.operator || access.legacyEdit || (field.brandId ? access.brandDomains?.[field.brandId]?.includes(field.owner as BasicWorkDomain) : access.domains.includes(field.owner as BasicWorkDomain))))
}
