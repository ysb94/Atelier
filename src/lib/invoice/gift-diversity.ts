import type { StyleRef } from '@/lib/types'

function fnv1a32Utf8(value: string): number {
  const bytes = new TextEncoder().encode(value)
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export type GiftDiversityQuotaMode = 'per_style' | 'shared_total'

export type GiftDiversityClaim = {
  id: string
  recipientKey: string
  sortKey: string
  candidates: StyleRef[]
  lockedStyle?: StyleRef
  isExisting?: boolean
  groupId: string
  /** 한도 소진 집계. 고정 세트는 group 1회, 랜덤은 claim 1회. */
  skipUnit?: 'claim' | 'group'
  quota?: {
    requestId: string
    mode: GiftDiversityQuotaMode
    sharedCost?: number
  }
}

export type GiftDiversityAssignment = {
  claimId: string
  style: StyleRef
  isExisting: boolean
  isUnavoidableDuplicate: boolean
}

export type GiftDiversityResult = {
  byClaimId: Map<string, GiftDiversityAssignment>
  skippedClaimIds: Set<string>
  exhaustedSkipCount: number
  unavoidableDuplicateCount: number
}

function uniqueStyles(styles: StyleRef[]) {
  const byId = new Map<string, StyleRef>()
  for (const style of styles) {
    if (!byId.has(style.styleId)) byId.set(style.styleId, style)
  }
  return [...byId.values()]
}

function styleKey(requestId: string, styleId: string) {
  return `${requestId}\u0000${styleId}`
}

function remainingOf(
  remaining: Map<string, number> | undefined,
  key: string,
) {
  return remaining?.get(key) ?? 0
}

function candidatesForClaim(
  claim: GiftDiversityClaim,
  remainingStyle: Map<string, number> | undefined,
): StyleRef[] {
  const pool = uniqueStyles(claim.candidates)
  if (!claim.quota || claim.quota.mode !== 'per_style') return pool
  return pool.filter(
    (style) => remainingOf(remainingStyle, styleKey(claim.quota!.requestId, style.styleId)) > 0,
  )
}

function canAffordGroup(
  group: GiftDiversityClaim[],
  remainingStyle: Map<string, number> | undefined,
  remainingShared: Map<string, number> | undefined,
) {
  const first = group[0]
  if (!first) return false
  if (first.isExisting || !first.quota) return true
  if (first.quota.mode === 'shared_total') {
    const cost = first.quota.sharedCost ?? group.length
    return remainingOf(remainingShared, first.quota.requestId) >= cost
  }
  if (group.every((claim) => claim.lockedStyle)) {
    return group.every(
      (claim) =>
        remainingOf(
          remainingStyle,
          styleKey(claim.quota!.requestId, claim.lockedStyle!.styleId),
        ) > 0,
    )
  }
  return group.some((claim) => candidatesForClaim(claim, remainingStyle).length > 0)
}

function consumeAssignment(
  claim: GiftDiversityClaim,
  style: StyleRef,
  remainingStyle: Map<string, number> | undefined,
  remainingShared: Map<string, number> | undefined,
  sharedConsumed: Set<string>,
) {
  if (claim.isExisting || !claim.quota) return
  if (claim.quota.mode === 'shared_total') {
    if (sharedConsumed.has(claim.groupId)) return
    sharedConsumed.add(claim.groupId)
    const cost = claim.quota.sharedCost ?? 1
    remainingShared?.set(
      claim.quota.requestId,
      Math.max(0, remainingOf(remainingShared, claim.quota.requestId) - cost),
    )
    return
  }
  const key = styleKey(claim.quota.requestId, style.styleId)
  remainingStyle?.set(key, Math.max(0, remainingOf(remainingStyle, key) - 1))
}

function compareClaim(left: GiftDiversityClaim, right: GiftDiversityClaim) {
  if (left.sortKey !== right.sortKey) return left.sortKey.localeCompare(right.sortKey)
  return left.id.localeCompare(right.id)
}

function pickTiedStyle(
  claim: GiftDiversityClaim,
  tied: StyleRef[],
  seed: number,
) {
  const sorted = [...tied].sort((left, right) => left.styleId.localeCompare(right.styleId))
  const index = fnv1a32Utf8(`${seed}\u001f${claim.id}`) % sorted.length
  return sorted[index]!
}

function scoreStyle(
  claim: GiftDiversityClaim,
  style: StyleRef,
  counts: Map<string, number>,
  remainingStyle: Map<string, number> | undefined,
) {
  const count = counts.get(style.styleId) ?? 0
  const remaining =
    claim.quota?.mode === 'per_style'
      ? remainingOf(remainingStyle, styleKey(claim.quota.requestId, style.styleId))
      : Number.POSITIVE_INFINITY
  return { count, remaining }
}

function chooseStyle(
  claim: GiftDiversityClaim,
  pool: StyleRef[],
  counts: Map<string, number>,
  remainingStyle: Map<string, number> | undefined,
  used: ReadonlySet<string>,
  seed: number,
) {
  if (pool.length === 0) return null
  const unused = pool.filter((style) => !used.has(style.styleId))
  const preferred = unused.length > 0 ? unused : pool
  let bestCount = Number.POSITIVE_INFINITY
  let bestRemaining = Number.NEGATIVE_INFINITY
  const tied: StyleRef[] = []
  for (const style of preferred) {
    const score = scoreStyle(claim, style, counts, remainingStyle)
    if (
      score.count < bestCount ||
      (score.count === bestCount && score.remaining > bestRemaining)
    ) {
      bestCount = score.count
      bestRemaining = score.remaining
      tied.length = 0
      tied.push(style)
    } else if (score.count === bestCount && score.remaining === bestRemaining) {
      tied.push(style)
    }
  }
  return pickTiedStyle(claim, tied, seed)
}

function maximumMatching(
  claims: GiftDiversityClaim[],
  unusedStyleIds: ReadonlySet<string>,
  remainingStyle: Map<string, number> | undefined,
) {
  const usable = claims
    .map((claim) => ({
      claim,
      styles: candidatesForClaim(claim, remainingStyle).filter((style) =>
        unusedStyleIds.has(style.styleId),
      ),
    }))
    .filter((item) => item.styles.length > 0)
    .sort((left, right) => {
      if (left.styles.length !== right.styles.length) {
        return left.styles.length - right.styles.length
      }
      return compareClaim(left.claim, right.claim)
    })

  const claimById = new Map(usable.map((item) => [item.claim.id, item]))
  const styleToClaim = new Map<string, string>()

  function dfs(claimId: string, seen: Set<string>): boolean {
    const item = claimById.get(claimId)
    if (!item) return false
    for (const style of item.styles) {
      if (seen.has(style.styleId)) continue
      seen.add(style.styleId)
      const current = styleToClaim.get(style.styleId)
      if (!current || dfs(current, seen)) {
        styleToClaim.set(style.styleId, claimId)
        return true
      }
    }
    return false
  }

  for (const item of usable) {
    dfs(item.claim.id, new Set())
  }

  const byClaim = new Map<string, string>()
  for (const [styleId, claimId] of styleToClaim) {
    byClaim.set(claimId, styleId)
  }
  return byClaim
}

/**
 * 현재 파일의 사은품 권리를 받는분 단위로 묶어 서로 다른 M번호를 최대화한다.
 * 기존 확정·고정은 잠그고, 랜덤만 후보가 적은 건을 보호하는 최대 매칭으로 고른다.
 */
export function resolveGiftDiversity(options: {
  claims: GiftDiversityClaim[]
  seed: number
  priorCounts?: ReadonlyMap<string, number>
  remainingByRequestStyle?: Map<string, number>
  remainingByRequest?: Map<string, number>
}): GiftDiversityResult {
  const remainingStyle = options.remainingByRequestStyle
    ? new Map(options.remainingByRequestStyle)
    : undefined
  const remainingShared = options.remainingByRequest
    ? new Map(options.remainingByRequest)
    : undefined
  const counts = new Map(options.priorCounts ?? [])
  const byClaimId = new Map<string, GiftDiversityAssignment>()
  const skippedClaimIds = new Set<string>()
  const usedByRecipient = new Map<string, Set<string>>()
  const sharedConsumed = new Set<string>()
  let exhaustedSkipCount = 0

  function usedOf(recipientKey: string) {
    const current = usedByRecipient.get(recipientKey) ?? new Set<string>()
    usedByRecipient.set(recipientKey, current)
    return current
  }

  function skipGroup(group: GiftDiversityClaim[], exhausted: boolean) {
    const unit = group[0]?.skipUnit ?? 'claim'
    if (exhausted) {
      exhaustedSkipCount += unit === 'group' ? 1 : group.length
    }
    for (const claim of group) skippedClaimIds.add(claim.id)
  }

  function assign(
    claim: GiftDiversityClaim,
    style: StyleRef,
  ) {
    const used = usedOf(claim.recipientKey)
    const isUnavoidableDuplicate = used.has(style.styleId)
    used.add(style.styleId)
    if (!claim.isExisting) {
      counts.set(style.styleId, (counts.get(style.styleId) ?? 0) + 1)
      consumeAssignment(claim, style, remainingStyle, remainingShared, sharedConsumed)
    }
    byClaimId.set(claim.id, {
      claimId: claim.id,
      style,
      isExisting: Boolean(claim.isExisting),
      isUnavoidableDuplicate,
    })
  }

  const groups = new Map<string, GiftDiversityClaim[]>()
  for (const claim of options.claims) {
    const list = groups.get(claim.groupId) ?? []
    list.push(claim)
    groups.set(claim.groupId, list)
  }
  const orderedGroups = [...groups.values()]
    .map((group) => [...group].sort(compareClaim))
    .sort((left, right) => compareClaim(left[0]!, right[0]!))

  const pendingRandom: GiftDiversityClaim[] = []

  for (const group of orderedGroups) {
    const locked = group.every((claim) => claim.lockedStyle)
    if (!locked) {
      pendingRandom.push(...group)
      continue
    }
    if (!canAffordGroup(group, remainingStyle, remainingShared)) {
      skipGroup(group, !group[0]?.isExisting)
      continue
    }
    for (const claim of group) assign(claim, claim.lockedStyle!)
  }

  const randomByRecipient = new Map<string, GiftDiversityClaim[]>()
  for (const claim of pendingRandom) {
    const list = randomByRecipient.get(claim.recipientKey) ?? []
    list.push(claim)
    randomByRecipient.set(claim.recipientKey, list)
  }
  const recipientKeys = [...randomByRecipient.entries()].sort((left, right) => {
    const leftFirst = [...left[1]].sort(compareClaim)[0]!
    const rightFirst = [...right[1]].sort(compareClaim)[0]!
    return compareClaim(leftFirst, rightFirst)
  })

  for (const [recipientKey, recipientClaims] of recipientKeys) {
    const used = usedOf(recipientKey)
    const affordable: GiftDiversityClaim[] = []
    for (const claim of [...recipientClaims].sort(compareClaim)) {
      if (!canAffordGroup([claim], remainingStyle, remainingShared)) {
        skipGroup([claim], Boolean(claim.quota))
        continue
      }
      if (candidatesForClaim(claim, remainingStyle).length === 0) {
        skipGroup([claim], Boolean(claim.quota))
        continue
      }
      affordable.push(claim)
    }
    const unused = new Set<string>()
    for (const claim of affordable) {
      for (const style of candidatesForClaim(claim, remainingStyle)) {
        if (!used.has(style.styleId)) unused.add(style.styleId)
      }
    }
    const matched = maximumMatching(affordable, unused, remainingStyle)
    const leftovers: GiftDiversityClaim[] = []
    for (const claim of affordable) {
      const styleId = matched.get(claim.id)
      const pool = candidatesForClaim(claim, remainingStyle)
      const matchedStyle = styleId
        ? pool.find((style) => style.styleId === styleId)
        : null
      if (matchedStyle) {
        assign(claim, matchedStyle)
        continue
      }
      leftovers.push(claim)
    }
    for (const claim of leftovers) {
      const pool = candidatesForClaim(claim, remainingStyle)
      const picked = chooseStyle(
        claim,
        pool,
        counts,
        remainingStyle,
        usedOf(recipientKey),
        options.seed,
      )
      if (!picked) {
        skipGroup([claim], Boolean(claim.quota))
        continue
      }
      assign(claim, picked)
    }
  }

  let unavoidableDuplicateCount = 0
  for (const assignment of byClaimId.values()) {
    if (assignment.isUnavoidableDuplicate) unavoidableDuplicateCount += 1
  }

  return {
    byClaimId,
    skippedClaimIds,
    exhaustedSkipCount,
    unavoidableDuplicateCount,
  }
}
