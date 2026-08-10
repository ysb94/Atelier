import {
  LEGACY_SEASON_STATUS_MAP,
  type Season,
  type SeasonStatus,
} from '@/lib/types'

/** 출시 예정 문구에서 연도를 찾는다. 26.03 → 2026, 2026년 → 2026 */
export function extractYearFromTiming(
  timing: string,
  fallback = new Date().getFullYear(),
): number {
  const text = timing.trim()
  const full = text.match(/(20\d{2})/)
  if (full) return Number(full[1])
  const short = text.match(/(?:^|[^\d])(\d{2})(?:[.\-/]|\s|$)/)
  if (short) {
    const yy = Number(short[1])
    if (Number.isFinite(yy)) return 2000 + yy
  }
  return fallback
}

/**
 * URL·가져오기 호환용 짧은 코드.
 * 사용자가 직접 정하지 않으며, 같은 브랜드 안에서만 유일하면 된다.
 */
export function buildSeasonCode(name: string, releaseTiming: string): string {
  const timing = releaseTiming.trim()
  const label = name.trim()
  const year = extractYearFromTiming(timing)
  const yy = String(year).slice(-2)

  const slug = [timing, label]
    .filter(Boolean)
    .join('-')
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z가-힣._-]/g, '')
    .slice(0, 24)

  if (slug) {
    const asciiOnly = /^[0-9A-Za-z._-]+$/.test(slug)
    return asciiOnly ? slug.toUpperCase() : slug
  }

  return `PG-${yy}${Date.now().toString(36).slice(-4).toUpperCase()}`
}

export function ensureUniqueSeasonCode(
  desired: string,
  siblings: Season[],
  excludeId?: string,
): string {
  const taken = new Set(
    siblings
      .filter((s) => s.id !== excludeId)
      .map((s) => s.code.toUpperCase()),
  )
  if (!taken.has(desired.toUpperCase())) return desired

  let n = 2
  while (taken.has(`${desired}-${n}`.toUpperCase())) n += 1
  return `${desired}-${n}`
}

export function normalizeSeasonStatus(status?: string | null): SeasonStatus {
  return LEGACY_SEASON_STATUS_MAP[status ?? ''] ?? 'active'
}
