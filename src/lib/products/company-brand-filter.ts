export const NONE_BRANDS_PARAM = 'none'

export type ParsedBrandsParam = 'all' | 'none' | string[]

export type BrandSelection = {
  slugs: string[]
  isAll: boolean
  isNone: boolean
  canEdit: boolean
}

function uniqueSlugs(values: string[]) {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const slug = value.trim()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    next.push(slug)
  }
  return next
}

export function parseBrandsParam(raw: string | null | undefined): ParsedBrandsParam {
  if (raw == null || raw.trim() === '') return 'all'
  if (raw.trim().toLowerCase() === NONE_BRANDS_PARAM) return 'none'
  return uniqueSlugs(raw.split(','))
}

export function sameSlugSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((slug) => rightSet.has(slug))
}

export function resolveBrandSelection(
  raw: string | null | undefined,
  availableSlugs: string[],
): BrandSelection {
  const available = uniqueSlugs(availableSlugs)
  const parsed = parseBrandsParam(raw)

  if (parsed === 'all') {
    return {
      slugs: available,
      isAll: available.length > 0,
      isNone: available.length === 0,
      canEdit: available.length === 1,
    }
  }

  if (parsed === 'none') {
    return {
      slugs: [],
      isAll: false,
      isNone: true,
      canEdit: false,
    }
  }

  const allowed = new Set(available)
  const slugs = parsed.filter((slug) => allowed.has(slug))
  return {
    slugs,
    isAll: slugs.length > 0 && sameSlugSet(slugs, available),
    isNone: slugs.length === 0,
    canEdit: slugs.length === 1,
  }
}

export function serializeBrandSelection(
  slugs: string[],
  availableSlugs: string[],
): string | null {
  const available = uniqueSlugs(availableSlugs)
  const selected = uniqueSlugs(slugs).filter((slug) => available.includes(slug))
  if (selected.length === 0) return NONE_BRANDS_PARAM
  if (sameSlugSet(selected, available)) return null
  return selected.join(',')
}

export function toggleBrandSlug(current: string[], slug: string) {
  const selected = uniqueSlugs(current)
  return selected.includes(slug)
    ? selected.filter((item) => item !== slug)
    : [...selected, slug]
}
