import { getSupabase } from './client'
import type { PermissionCode, PermissionGrant, PermissionScope } from '../company/permissions'

export type PermissionEvent = { id: string; actor: string; person: string; permission: PermissionCode; scopeKind: PermissionScope; scopeId: string; enabled: boolean; createdAt: string }
export type PermissionDirectory = { activation?: 'pending' | 'active'; profiles: { id: string; name: string; department: string; position: string; status: string }[]; scopes: { kind: PermissionScope; id: string; name: string }[]; grants: PermissionGrant[]; events?: PermissionEvent[]; revision: string }
function fail(error: { message: string }) { console.warn('[permissions] 권한 요청 실패', error); return new Error(error.message) }
export async function listPermissionGrants(): Promise<PermissionGrant[]> {
  const { data, error } = await getSupabase().rpc('list_my_permission_grants')
  if (error) throw fail(error)
  return (data ?? []) as PermissionGrant[]
}
export async function getPermissionDirectory(): Promise<PermissionDirectory> {
  const { data, error } = await getSupabase().rpc('permission_directory')
  if (error) throw fail(error)
  return data as PermissionDirectory
}
export async function setPermissionGrant(input: { profileId: string; permission: PermissionCode; scopeKind: PermissionScope; scopeId: string; enabled: boolean; revision: string }) {
  const { error } = await getSupabase().rpc('set_permission_grant', { p_profile: input.profileId, p_permission: input.permission, p_scope_kind: input.scopeKind, p_scope: input.scopeId, p_enabled: input.enabled, p_revision: input.revision })
  if (error) throw fail(error)
}
