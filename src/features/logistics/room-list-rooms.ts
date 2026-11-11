export type RoomGroup = { name: string; prefixes: string[] }

export function normalizeRoomPrefix(value: string) {
  return value.replace(/[a-z]/g, character => character.toUpperCase())
}

export function readRoomPrefixes(text: string) {
  return [...new Set(text.split(/[\s,]+/u).filter(Boolean).map(normalizeRoomPrefix))]
}

export function roomForLocation(location: string | undefined, groupsByPrefix: ReadonlyMap<string, RoomGroup>) {
  const [prefix] = normalizeRoomPrefix(location?.trim() ?? '')
  if (!prefix) return { key: 'missing', name: '위치 없음' }

  const group = groupsByPrefix.get(prefix)
  if (group) return { key: `group:${group.name}`, name: group.name }
  return { key: `prefix:${prefix}`, name: /^\d$/.test(prefix) ? `${prefix}번 방` : `${prefix} 방` }
}

export function loadRoomGroups(userId: string): RoomGroup[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(`atelier:room-list-groups:${userId}`) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored.filter((group): group is RoomGroup =>
      group && typeof group.name === 'string' && Array.isArray(group.prefixes)
      && group.prefixes.every((prefix: unknown) => typeof prefix === 'string'),
    )
  } catch {
    return [] // A blocked browser storage or invalid local preference does not prevent opening a room list.
  }
}

export function saveRoomGroups(userId: string, groups: RoomGroup[]) {
  try {
    localStorage.setItem(`atelier:room-list-groups:${userId}`, JSON.stringify(groups))
  } catch {
    return false
  }
  return true
}
