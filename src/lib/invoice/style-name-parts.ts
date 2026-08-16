import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import type { StyleRef } from '@/lib/types'

const SIZE_TOKENS = new Set([
  'S',
  'M',
  'L',
  'F',
  'XL',
  'XS',
  'FREE',
  '2XL',
  'ONE',
])

export type StyleNameParts = {
  familyKey: string
  colorKey: string
  size: string | null
  familyRaw: string
  colorRaw: string
}

export type StylePartsIndex = {
  /** familyKey|colorKey|size(or '') -> styles */
  byFamilyColorSize: Map<string, StyleRef[]>
  /** compact color key -> display raw (가장 흔한 표기) */
  colorVocab: Map<string, string>
  /** familyKey set for quick membership */
  familyKeys: Set<string>
  /** styleId -> parts */
  byStyleId: Map<string, StyleNameParts>
}

function tokenizeName(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function isSizeToken(token: string) {
  return SIZE_TOKENS.has(token.toUpperCase())
}

/**
 * 1패스: 사이즈를 떼고 마지막 토큰을 색상 후보로 모은다.
 * 2패스: 빈도 사전으로 뒤에서 최대 2개 색상 토큰을 흡수한다.
 */
export function parseStyleName(
  name: string,
  colorVocab?: Set<string>,
): StyleNameParts | null {
  const tokens = tokenizeName(name)
  if (tokens.length === 0) return null

  let size: string | null = null
  let body = tokens
  const last = tokens[tokens.length - 1]!
  if (isSizeToken(last)) {
    size = last.toUpperCase()
    body = tokens.slice(0, -1)
  }
  if (body.length === 0) return null

  let colorTokens: string[]
  let familyTokens: string[]

  if (colorVocab && colorVocab.size > 0) {
    colorTokens = []
    familyTokens = [...body]
    while (familyTokens.length > 0 && colorTokens.length < 2) {
      const candidate = familyTokens[familyTokens.length - 1]!
      const key = compactProductNameKey(candidate)
      if (!key || !colorVocab.has(key)) break
      colorTokens.unshift(familyTokens.pop()!)
    }
    // 어휘에 없어도 마지막 한 토큰은 색상으로 본다 (신상품 색상)
    if (colorTokens.length === 0 && familyTokens.length > 0) {
      colorTokens = [familyTokens.pop()!]
    }
  } else {
    colorTokens = [body[body.length - 1]!]
    familyTokens = body.slice(0, -1)
  }

  if (colorTokens.length === 0) return null
  const colorRaw = colorTokens.join(' ')
  const colorKey = compactProductNameKey(colorRaw)
  if (!colorKey) return null

  const familyRaw = familyTokens.join(' ')
  const familyKey = compactProductNameKey(familyRaw || colorRaw)
  // 제품군이 비면 색상만 있는 이름 — familyKey를 색상으로 두지 말고 빈 키로
  const resolvedFamilyKey = familyTokens.length > 0 ? familyKey : ''

  return {
    familyKey: resolvedFamilyKey,
    colorKey,
    size,
    familyRaw,
    colorRaw,
  }
}

export function stylePartsLookupKey(
  familyKey: string,
  colorKey: string,
  size: string | null,
) {
  return `${familyKey}|${colorKey}|${size ?? ''}`
}

export function buildStylePartsIndex(styles: StyleRef[]): StylePartsIndex {
  const colorCounts = new Map<string, { raw: string; count: number }>()
  for (const style of styles) {
    const rough = parseStyleName(style.name)
    if (!rough) continue
    const key = rough.colorKey
    const current = colorCounts.get(key)
    if (current) {
      current.count += 1
    } else {
      colorCounts.set(key, { raw: rough.colorRaw, count: 1 })
    }
  }

  // 1번만 나온 토큰도 어휘에 넣는다. 신색상이어도 2패스에서 쓸 수 있어야 한다.
  // 다만 너무 짧은 영문 1글자는 사이즈와 겹치므로 제외(이미 사이즈 처리됨).
  const colorVocab = new Set(colorCounts.keys())

  const byFamilyColorSize = new Map<string, StyleRef[]>()
  const byStyleId = new Map<string, StyleNameParts>()
  const familyKeys = new Set<string>()

  for (const style of styles) {
    const parts = parseStyleName(style.name, colorVocab)
    if (!parts) continue
    byStyleId.set(style.styleId, parts)
    if (parts.familyKey) familyKeys.add(parts.familyKey)
    const key = stylePartsLookupKey(
      parts.familyKey,
      parts.colorKey,
      parts.size,
    )
    const list = byFamilyColorSize.get(key) ?? []
    list.push(style)
    byFamilyColorSize.set(key, list)
  }

  const colorVocabMap = new Map<string, string>()
  for (const [key, value] of colorCounts) {
    colorVocabMap.set(key, value.raw)
  }

  return {
    byFamilyColorSize,
    colorVocab: colorVocabMap,
    familyKeys,
    byStyleId,
  }
}

/** 주문 텍스트에서 사이즈 토큰을 경계 있게 찾는다. */
export function detectSizeInText(text: string): string | null {
  const compact = compactProductNameKey(text)
  if (!compact) return null
  const upper = text.toUpperCase()

  // ONE SIZE (F) / ONESIZE(F) → F
  if (/ONE\s*SIZE\s*\(\s*F\s*\)/.test(upper) || /ONESIZE.*\bF\b/.test(compact)) {
    return 'F'
  }
  if (/\bonesize\b/i.test(compact) || /onesize/.test(compact)) {
    return 'F'
  }

  // 긴 것부터 (2XL before XL before L). ONE은 ONE SIZE 처리 후라 단독 ONE만.
  const ordered = ['2XL', 'XL', 'XS', 'FREE', 'S', 'M', 'L', 'F']
  for (const size of ordered) {
    const pattern = new RegExp(
      `(^|[^0-9A-Z가-힣])${size}(?:\\s*\\([^)]*\\))?(?=$|[^0-9A-Z가-힣])`,
      'i',
    )
    if (pattern.test(upper)) return size
  }
  return null
}
