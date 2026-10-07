// New selections use folder IDs. Legacy season links still use a season code.
export function matchesDraftFolder(groupId: string | null | undefined, filter: string, legacyCode?: string) {
  if (filter === 'all') return true
  if (filter === 'unassigned') return !groupId
  return groupId === filter || (legacyCode !== undefined && legacyCode.toUpperCase() === filter.toUpperCase())
}
