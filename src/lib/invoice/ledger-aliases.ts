import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import { matchingProductName } from '@/lib/invoice/product-name-tags'
import type { StylePartsIndex } from '@/lib/invoice/style-name-parts'
import type {
  InvoiceProductNameMap,
  InvoiceProductNameTagRoleEntry,
} from '@/lib/types'

export type LedgerAliases = {
  /** compact 주문 몸통 -> familyKey */
  bodyToFamily: Map<string, string>
  /** compact 주문 색상 -> colorKey */
  colorAliases: Map<string, string>
}

type Vote = {
  target: string
  count: number
  families: Set<string>
}

function rememberVote(
  bucket: Map<string, Map<string, Vote>>,
  alias: string,
  target: string,
  familyKey: string,
) {
  if (!alias || !target || alias === target) return
  let byTarget = bucket.get(alias)
  if (!byTarget) {
    byTarget = new Map()
    bucket.set(alias, byTarget)
  }
  const current = byTarget.get(target)
  if (current) {
    current.count += 1
    if (familyKey) current.families.add(familyKey)
  } else {
    byTarget.set(target, {
      target,
      count: 1,
      families: new Set(familyKey ? [familyKey] : []),
    })
  }
}

/**
 * 별칭이 서로 다른 값 여러 개에 대응하면 버린다.
 * 색상은 제품군 minFamilies 이상에서 확인된 것만.
 * 몸통은 같은 제품군에 여러 번 찍혀도 되므로 minCount로 본다.
 */
function resolveVotes(
  bucket: Map<string, Map<string, Vote>>,
  options: { minFamilies?: number; minCount?: number },
): Map<string, string> {
  const minFamilies = options.minFamilies ?? 1
  const minCount = options.minCount ?? 1
  const resolved = new Map<string, string>()
  for (const [alias, byTarget] of bucket) {
    if (byTarget.size !== 1) continue
    const only = [...byTarget.values()][0]!
    if (only.families.size < minFamilies) continue
    if (only.count < minCount) continue
    resolved.set(alias, only.target)
  }
  return resolved
}

/**
 * 조회 키에서 색상 꼬리를 추정한다.
 * 공식 색상이 이미 들어있으면 그 앞을 몸통으로 본다.
 * 없으면 Color=/Color: 라벨 또는 마지막 구분자(= : _) 뒤를 색상 후보로 본다.
 */
export function splitLookupBodyAndColor(
  lookupKey: string,
  officialColorKey: string,
): { body: string; orderColor: string | null; colorDirect: boolean } {
  const compact = compactProductNameKey(lookupKey)
  if (!compact) return { body: '', orderColor: null, colorDirect: false }

  if (officialColorKey && compact.includes(officialColorKey)) {
    const idx = compact.lastIndexOf(officialColorKey)
    const body = compact.slice(0, idx)
    return {
      body,
      orderColor: officialColorKey,
      colorDirect: true,
    }
  }

  // Color= / Color: / 컬러= 라벨
  const labelMatch = lookupKey.match(
    /^(.*?)(?:\s+|_)(?:color|컬러)\s*[=:]\s*(.+)$/i,
  )
  if (labelMatch) {
    const body = compactProductNameKey(labelMatch[1] ?? '')
    const orderColor = compactProductNameKey(labelMatch[2] ?? '')
    if (orderColor) {
      return { body, orderColor, colorDirect: false }
    }
  }

  // 원문 기준으로 마지막 구분자 뒤 꼬리
  const match = lookupKey.match(/[=:_]([^=:_]*)$/)
  if (match) {
    const orderColor = compactProductNameKey(match[1] ?? '')
    const bodyRaw = lookupKey.slice(0, match.index ?? 0)
    // 꼬리 앞의 Color/컬러 라벨 잔여 제거
    const cleanedBody = bodyRaw.replace(/(?:\s+|_)(?:color|컬러)\s*$/i, '')
    const body = compactProductNameKey(cleanedBody)
    if (orderColor) {
      return { body, orderColor, colorDirect: false }
    }
  }

  return { body: compact, orderColor: null, colorDirect: false }
}

export function learnLedgerAliases(
  maps: InvoiceProductNameMap[],
  index: StylePartsIndex,
  options?: {
    minFamilies?: number
    tagRoles?: InvoiceProductNameTagRoleEntry[]
  },
): LedgerAliases {
  const minFamilies = options?.minFamilies ?? 2
  const tagRoles = options?.tagRoles ?? []
  const bodyVotes = new Map<string, Map<string, Vote>>()
  const colorVotes = new Map<string, Map<string, Vote>>()

  for (const map of maps) {
    if (!map.isActive) continue
    const parts = index.byStyleId.get(map.style.styleId)
    if (!parts?.colorKey) continue

    const rawKey = (map.lookupKey || map.productName || '').trim()
    if (!rawKey) continue
    const stripped = matchingProductName(rawKey, tagRoles)
    const { body, orderColor, colorDirect } = splitLookupBodyAndColor(
      stripped,
      parts.colorKey,
    )

    if (body && parts.familyKey) {
      rememberVote(bodyVotes, body, parts.familyKey, parts.familyKey)
    }

    if (!colorDirect && orderColor) {
      rememberVote(colorVotes, orderColor, parts.colorKey, parts.familyKey)
    }
  }

  return {
    // 몸통→제품군은 한 제품군에만 찍히는 게 정상. 2회 이상이면 채택.
    bodyToFamily: resolveVotes(bodyVotes, { minCount: 2, minFamilies: 1 }),
    // 색상 별칭은 서로 다른 제품군에서 확인된 것만.
    colorAliases: resolveVotes(colorVotes, { minFamilies, minCount: 1 }),
  }
}
