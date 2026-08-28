import { normalizeStyleNo } from '@/lib/import/transform'
import type { FieldOwner, Style } from '@/lib/types'

const STORAGE_PREFIX = 'atelier:department-work-set'

export function departmentWorkSetKey(
  userId: string,
  brandId: string,
  owner: FieldOwner,
): string {
  return `${STORAGE_PREFIX}:${userId}:${brandId}:${owner}`
}

export function parseStyleNoList(text: string): string[] {
  const seen = new Set<string>()
  const values: string[] = []
  text.split(/[\n\r,;\t|]+/).forEach((part) => {
    const key = normalizeStyleNo(part)
    if (!key || seen.has(key)) return
    seen.add(key)
    values.push(key)
  })
  return values
}

export function findStylesByStyleNos(
  styles: readonly Style[],
  styleNos: readonly string[],
): { matched: Style[]; missing: string[] } {
  const byNo = new Map(
    styles.map((style) => [normalizeStyleNo(style.styleNo), style]),
  )
  const matched: Style[] = []
  const missing: string[] = []
  const seen = new Set<string>()

  styleNos.forEach((styleNo) => {
    const key = normalizeStyleNo(styleNo)
    if (!key || seen.has(key)) return
    seen.add(key)
    const style = byNo.get(key)
    if (style) matched.push(style)
    else missing.push(styleNo)
  })

  return { matched, missing }
}

export function mergeStyleIds(
  current: readonly string[],
  added: readonly string[],
): string[] {
  const seen = new Set(current)
  const next = [...current]
  added.forEach((id) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    next.push(id)
  })
  return next
}

function readIds(key: string): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string' && Boolean(id))
  } catch {
    return []
  }
}

function writeIds(key: string, ids: readonly string[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, JSON.stringify(ids))
}

export function loadDepartmentWorkSet(
  userId: string,
  brandId: string,
  owner: FieldOwner,
): string[] {
  return readIds(departmentWorkSetKey(userId, brandId, owner))
}

export function saveDepartmentWorkSet(
  userId: string,
  brandId: string,
  owner: FieldOwner,
  ids: readonly string[],
) {
  writeIds(departmentWorkSetKey(userId, brandId, owner), ids)
}
