import { PERMISSION_CATALOG, scopeLabel, type PermissionGrant } from '@/lib/company/permissions'
import type { PermissionDirectory } from '@/lib/supabase/permission-grants'

export type PermissionMatrixRow = {
  id: string
  label: string
  scope?: string
  memberIds: readonly string[]
  pending?: boolean
}

export type PermissionMatrixSection = {
  id: string
  label: string
  status?: 'loading' | 'unavailable' | 'error'
  rows: PermissionMatrixRow[]
  retry?: () => void
}

export function buildPermissionGrantRows(directory: PermissionDirectory): PermissionMatrixRow[] {
  const scopes = new Map(directory.scopes.map(scope => [`${scope.kind}:${scope.id}`, scope.name]))
  const assignments = new Map<string, Map<string, PermissionGrant[]>>()

  for (const grant of directory.grants) {
    if (!grant.profileId) continue
    const scopeKey = `${grant.scopeKind}:${grant.scopeId}`
    const byScope = assignments.get(grant.permission) ?? new Map<string, PermissionGrant[]>()
    const group = byScope.get(scopeKey) ?? []
    group.push(grant)
    byScope.set(scopeKey, group)
    assignments.set(grant.permission, byScope)
  }

  return PERMISSION_CATALOG.flatMap<PermissionMatrixRow>(([permission, label, group]) => {
    const entries = assignments.get(permission)
    const title = `${group} · ${label}`
    if (!entries) return [{ id: permission, label: title, memberIds: [] }]

    return [...entries].map(([scopeKey, grants]) => ({
      id: `${permission}:${scopeKey}`,
      label: title,
      scope: scopes.get(scopeKey) ?? grants[0].scopeName ?? scopeLabel(grants[0].scopeKind),
      memberIds: grants.flatMap(grant => grant.profileId ? [grant.profileId] : []),
      pending: directory.activation === 'pending',
    })).sort((left, right) => left.scope.localeCompare(right.scope, 'ko'))
  })
}
