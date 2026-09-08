import type { DraftOptionRow, ProductDraftStatus } from '@/lib/types'

export const UNASSIGNED_DRAFT_BRAND = 'unassigned' as const

export type DraftBrandScope = 'all' | typeof UNASSIGNED_DRAFT_BRAND | string

export function parseDraftNo(value: string) {
  const match = /^PL-(\d+)$/.exec(value.trim().toUpperCase())
  return match ? Number(match[1]) : 0
}

export function formatDraftNo(value: number) {
  return `PL-${String(value).padStart(4, '0')}`
}

export function nextCompanyDraftNo(existing: readonly string[]) {
  const max = existing.reduce((current, value) => {
    return Math.max(current, parseDraftNo(value))
  }, 0)
  return formatDraftNo(max + 1)
}

export function canChangeDraftBrand(status: ProductDraftStatus) {
  return status === 'open'
}

export function requiresDraftBrand(status: ProductDraftStatus) {
  return status === 'confirmed'
}

export function normalizeDraftBrandId(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

export function matchesDraftBrandScope(
  brandId: string | null | undefined,
  scope: DraftBrandScope,
  brandIdBySlug: ReadonlyMap<string, string>,
) {
  if (scope === 'all') return true
  if (scope === UNASSIGNED_DRAFT_BRAND) return !brandId
  return brandId === brandIdBySlug.get(scope)
}

export const UNASSIGNED_DRAFT_OWNER = 'unassigned' as const

export type DraftOwnerScope = 'all' | typeof UNASSIGNED_DRAFT_OWNER | string

export function matchesDraftOwnerScope(
  owner: string | null | undefined,
  scope: DraftOwnerScope,
) {
  const name = owner?.trim() ?? ''
  if (scope === 'all') return true
  if (scope === UNASSIGNED_DRAFT_OWNER) return !name
  return name === scope
}

export function collectDraftOwnerNames(
  drafts: readonly { owner?: string | null }[],
  memberNames: readonly string[] = [],
) {
  const names = new Set<string>()
  for (const name of memberNames) {
    const trimmed = name.trim()
    if (trimmed) names.add(trimmed)
  }
  for (const draft of drafts) {
    const trimmed = draft.owner?.trim() ?? ''
    if (trimmed) names.add(trimmed)
  }
  return [...names].sort((left, right) => left.localeCompare(right, 'ko'))
}

export type DraftBrandChangeInput = {
  nextBrandId: string | null
  seasonId: string | null
  seasonBrandId?: string | null
  options: DraftOptionRow[]
  styleBrandById: ReadonlyMap<string, string>
}

export type DraftBrandChangeResult = {
  brandId: string | null
  seasonId: string | null
  options: DraftOptionRow[]
  clearedSeason: boolean
  clearedStyleIds: string[]
  needsConfirm: boolean
}

export function applyDraftBrandChange(
  input: DraftBrandChangeInput,
): DraftBrandChangeResult {
  const brandId = normalizeDraftBrandId(input.nextBrandId)
  let seasonId = input.seasonId
  let clearedSeason = false
  if (seasonId && (!brandId || input.seasonBrandId !== brandId)) {
    seasonId = null
    clearedSeason = true
  }

  const clearedStyleIds: string[] = []
  const options = input.options.map((row) => {
    if (!row.styleId) return row
    const styleBrandId = input.styleBrandById.get(row.styleId)
    if (!brandId || styleBrandId !== brandId) {
      clearedStyleIds.push(row.styleId)
      return { ...row, styleId: '' }
    }
    return row
  })

  return {
    brandId,
    seasonId,
    options,
    clearedSeason,
    clearedStyleIds,
    needsConfirm: clearedSeason || clearedStyleIds.length > 0,
  }
}

export function hasSampleWorkOrder(url: string | null | undefined) {
  return Boolean(url?.trim())
}

export function draftBrandChangeMessage(result: DraftBrandChangeResult) {
  const parts: string[] = []
  if (result.clearedSeason) parts.push('출시 기획')
  if (result.clearedStyleIds.length > 0) {
    parts.push(`연결 상품 ${result.clearedStyleIds.length}개`)
  }
  if (parts.length === 0) return ''
  return `${parts.join('·')}이 새 브랜드와 맞지 않아 해제됩니다. 이름·가격 등 기획 내용은 그대로 둡니다. 계속할까요?`
}
