import {
  compactOutboundPartnerKey,
  outboundPartnerDisplayName,
} from '@/lib/codes/outbound-partner'
import type { CodeUsageTarget, CodeUsageTargetAlias } from '@/lib/types'

type NamedPartner = Pick<
  CodeUsageTarget,
  'id' | 'brandId' | 'name' | 'normalizedName' | 'groupName' | 'siteName'
>
type PartnerAlias = Pick<CodeUsageTargetAlias, 'targetId' | 'alias'>

/** 새로 도입하는 이름만 검사하여 기존 중복 행의 연락처 수정은 막지 않는다. */
export function outboundPartnerSaveConflict(
  previous: readonly NamedPartner[],
  proposed: readonly NamedPartner[],
  aliases: readonly PartnerAlias[],
  aliasTargetId: string,
  savedAliases: readonly string[],
): string | null {
  const beforeById = new Map(previous.map((target) => [target.id, target]))
  const names = new Map<string, Map<string, NamedPartner>>()
  const aliasesByKey = new Map<string, PartnerAlias[]>()
  proposed.forEach((target) => outboundPartnerNameKeys(target).forEach((key) => addCandidate(names, key, target)))
  aliases.forEach((alias) => {
    const key = compactOutboundPartnerKey(alias.alias)
    const owners = aliasesByKey.get(key)
    if (owners) owners.push(alias)
    else aliasesByKey.set(key, [alias])
  })
  for (const target of proposed) {
    const before = beforeById.get(target.id)
    const previousKeys = new Set(before ? outboundPartnerNameKeys(before) : [])
    for (const key of outboundPartnerNameKeys(target)) {
      if (previousKeys.has(key)) continue
      const other = [...names.get(key)?.values() ?? []].find((candidate) => candidate.id !== target.id)
      const alias = aliasesByKey.get(key)?.find((candidate) => candidate.targetId !== target.id)
      if (other || alias) {
        const owner = other ?? proposed.find((candidate) => candidate.id === alias?.targetId)
        return `"${outboundPartnerDisplayName(target)}" 이름이 "${owner ? outboundPartnerDisplayName(owner) : alias?.alias}"의 이름 또는 별칭과 겹칩니다.`
      }
    }
  }
  for (const alias of savedAliases) {
    const key = compactOutboundPartnerKey(alias)
    const other = [...names.get(key)?.values() ?? []].find((target) => target.id !== aliasTargetId)
    const otherAlias = aliasesByKey.get(key)?.find((candidate) => candidate.targetId !== aliasTargetId)
    if (other || otherAlias) return `"${alias}"은(는) 다른 출고업체의 이름 또는 별칭입니다.`
  }
  return null
}

/** 등록된 업체·지점 전체 이름과 기존 저장 이름을 함께 인식한다. 분류는 키가 아니다. */
export function outboundPartnerNameKeys(target: NamedPartner): string[] {
  return [...new Set([
    outboundPartnerDisplayName(target),
    target.name,
    target.normalizedName,
  ].map(compactOutboundPartnerKey).filter(Boolean))]
}

function addCandidate<T extends NamedPartner>(
  candidates: Map<string, Map<string, T>>,
  key: string,
  target: T,
) {
  if (!key) return
  const owners = candidates.get(key)
  if (owners) owners.set(target.id, target)
  else candidates.set(key, new Map([[target.id, target]]))
}

/**
 * 송장·엑셀 출고 입력의 공통 연결 기준.
 * 정식명을 별칭보다 우선하고, 같은 이름이 여러 업체를 가리키면 임의로 고르지 않는다.
 * 지점만 적은 입력은 선택한 업체 안에서만 includeShortSiteNames로 허용한다.
 */
export function buildOutboundPartnerNameIndex<T extends NamedPartner>(
  targets: readonly T[],
  aliases: readonly PartnerAlias[],
  options: { includeShortSiteNames?: boolean } = {},
): Map<string, T> {
  const byId = new Map(targets.map((target) => [target.id, target]))
  const names = new Map<string, Map<string, T>>()
  const aliasNames = new Map<string, Map<string, T>>()
  const sites = new Map<string, Map<string, T>>()

  targets.forEach((target) => {
    outboundPartnerNameKeys(target).forEach((key) => addCandidate(names, key, target))
    if (options.includeShortSiteNames) {
      addCandidate(sites, compactOutboundPartnerKey(target.siteName), target)
    }
  })
  aliases.forEach((alias) => {
    const target = byId.get(alias.targetId)
    if (target) addCandidate(aliasNames, compactOutboundPartnerKey(alias.alias), target)
  })

  const index = new Map<string, T>()
  const keys = new Set([...names.keys(), ...aliasNames.keys(), ...sites.keys()])
  keys.forEach((key) => {
    const official = names.get(key)
    const alias = aliasNames.get(key)
    if (official?.size === 1) {
      index.set(key, official.values().next().value!)
    } else if (official) {
      // 기존 중복 이름은 명시적으로 등록한 별칭이 한 후보를 지정할 때만 연결한다.
      const chosen = alias?.size === 1 ? alias.values().next().value : undefined
      if (chosen && official.has(chosen.id)) index.set(key, chosen)
    } else {
      const candidates = alias ?? sites.get(key)
      if (candidates?.size === 1) index.set(key, candidates.values().next().value!)
    }
  })
  return index
}
