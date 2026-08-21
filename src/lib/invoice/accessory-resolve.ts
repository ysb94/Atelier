import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceAccessoryRule, StyleRef } from '@/lib/types'

export type InvoiceAccessoryResolveOptions = {
  itemName: string
  productLookupKey: string
  mainStyle: StyleRef | null
  dictionary: InvoiceAccessoryRule[]
  styleByName: Map<string, StyleRef>
}

export type InvoiceAccessoryComponent = {
  style: StyleRef
  quantity: number
}

export type InvoiceAccessoryResolveResult = {
  components: InvoiceAccessoryComponent[]
  ignored: string[]
  unknown: string[]
  evidence: string[]
}

type KindHit = {
  kind: string
  namePrefix: string
}

const NONE = /^(선택안함|추가안함|없음|none|미선택|free)$/i
const SIZE_LIKE =
  /^(one\s*size(?:\s*\(.*\))?|free|f\+{0,3}|s|m|l|xl|xxl|2xl|3xl|\d+\s*(호|cm|ml|mm)?(?:\s*\(.*\))?)$/i
const PRICE_RE = /\(\+?[\d,]+\)/
const BUILTIN_IGNORE_LABEL =
  /^(color|colors|size|사이즈|색상|컬러|pouch|파우치|bag|top|shorts|bottom|type|타입|수량|본품)(\s|$|[_\-:])/i

function longestFirst<T extends { normalizedPattern: string }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      right.normalizedPattern.length - left.normalizedPattern.length,
  )
}

type AccessoryDictionaryIndex = {
  labels: InvoiceAccessoryRule[]
  colors: InvoiceAccessoryRule[]
  tokens: InvoiceAccessoryRule[]
  ignores: InvoiceAccessoryRule[]
  defaults: InvoiceAccessoryRule[]
}

/** 같은 사전 배열이면 type별 정렬 인덱스를 재사용한다. 행마다 재정렬하지 않는다. */
const dictionaryIndexCache = new WeakMap<
  InvoiceAccessoryRule[],
  AccessoryDictionaryIndex
>()

function dictionaryIndexOf(
  dictionary: InvoiceAccessoryRule[],
): AccessoryDictionaryIndex {
  const cached = dictionaryIndexCache.get(dictionary)
  if (cached) return cached
  const active = dictionary.filter((rule) => rule.isActive)
  const ofActiveType = (type: InvoiceAccessoryRule['ruleType']) =>
    active.filter((rule) => rule.ruleType === type)
  const index: AccessoryDictionaryIndex = {
    labels: longestFirst(ofActiveType('label')),
    colors: longestFirst(ofActiveType('color')),
    tokens: longestFirst(ofActiveType('token')),
    ignores: ofActiveType('ignore'),
    defaults: longestFirst(ofActiveType('default')),
  }
  dictionaryIndexCache.set(dictionary, index)
  return index
}

function compact(value: string) {
  return normalizeInvoiceText(value).replace(/\s+/g, '')
}

function cleanValue(value: string) {
  return value
    .replace(/\(\+?[\d,]+\)/g, '')
    .replace(/_strap$/i, '')
    .replace(/\s*추가$/u, '')
    .trim()
}

function hasPrice(value: string) {
  return PRICE_RE.test(value)
}

function isNone(value: string) {
  return !value || NONE.test(value.trim())
}

function isSizeLike(value: string) {
  return SIZE_LIKE.test(value.trim()) || SIZE_LIKE.test(compact(value))
}

function lookupContains(lookupKey: string, value: string) {
  const hay = compact(lookupKey)
  const needle = compact(value)
  return Boolean(hay && needle && hay.includes(needle))
}

/** labels는 미리 길이순으로 정렬돼 있어야 한다. */
function findLabelKind(
  label: string,
  labels: InvoiceAccessoryRule[],
): KindHit | null {
  const key = normalizeInvoiceText(label)
  if (!key) return null
  for (const rule of labels) {
    if (key.includes(rule.normalizedPattern)) {
      return { kind: rule.accessoryKind, namePrefix: rule.namePrefix }
    }
  }
  return null
}

/** defaults는 미리 길이순으로 정렬돼 있어야 한다. */
function findDefaultKind(
  lookupKey: string,
  defaults: InvoiceAccessoryRule[],
): KindHit | null {
  const key = normalizeInvoiceText(lookupKey)
  if (!key) return null
  for (const rule of defaults) {
    if (key.includes(rule.normalizedPattern)) {
      return { kind: rule.accessoryKind, namePrefix: rule.namePrefix }
    }
  }
  return null
}

/** colors는 미리 길이순으로 정렬돼 있어야 한다. */
function findColor(value: string, colors: InvoiceAccessoryRule[]) {
  const key = normalizeInvoiceText(value)
  if (!key) return null
  for (const rule of colors) {
    if (key === rule.normalizedPattern || key === normalizeInvoiceText(rule.colorName)) {
      return rule.colorName
    }
  }
  return null
}

/** tokens는 미리 길이순으로 정렬돼 있어야 한다. */
function findToken(
  value: string,
  tokens: InvoiceAccessoryRule[],
): StyleRef | null {
  const key = normalizeInvoiceText(value)
  if (!key) return null
  for (const rule of tokens) {
    if (!rule.targetStyle) continue
    if (key.includes(rule.normalizedPattern)) return rule.targetStyle
  }
  return null
}

function isIgnored(
  value: string,
  ignores: InvoiceAccessoryRule[],
) {
  const key = normalizeInvoiceText(value)
  if (!key) return false
  return ignores.some(
    (rule) =>
      key === rule.normalizedPattern || key.includes(rule.normalizedPattern),
  )
}

function isIgnoreLabel(label: string, ignores: InvoiceAccessoryRule[]) {
  if (!label.trim()) return false
  if (BUILTIN_IGNORE_LABEL.test(label.trim())) return true
  return isIgnored(label, ignores)
}

function expandPieces(itemName: string): string[] {
  const extracted: string[] = []
  const rest = itemName.replace(
    /\[([^\]]+)\]([^,[]*)/g,
    (_all, rawLabel: string, rawValue: string) => {
      const labels = String(rawLabel)
        .split(':')
        .map((item) => item.trim())
        .filter(Boolean)
      const values = String(rawValue)
        .split(':')
        .map((item) => item.trim())
      if (labels.length > 1 && labels.length === values.length) {
        extracted.push(
          ...labels.map((label, index) => `${label}=${values[index] ?? ''}`),
        )
      } else {
        extracted.push(`${String(rawLabel).trim()}=${String(rawValue).trim()}`)
      }
      return ' '
    },
  )
  const leftover = rest
    .split(/,|(?:\s+\/\s+)/)
    .map((item) => item.trim())
    .filter(Boolean)
  return [...extracted, ...leftover]
}

function splitPiece(piece: string): { label: string; values: string[] } {
  const match = piece.match(/^(.*?)\s*[:=]\s*(.*)$/)
  if (!match) return { label: '', values: [piece.trim()] }
  return {
    label: match[1]!.trim(),
    values: [match[2]!.trim()],
  }
}

function styleNameOf(prefix: string, colorName: string) {
  return `${prefix}${colorName}`
}

/**
 * 옵션 문구를 조각으로 나눠 부속품 M번호를 찾는다.
 * 모르는 조각이 하나라도 있으면 unknown에 남기고, 호출 쪽에서 검토로 보낸다.
 */
export function resolveInvoiceAccessories(
  options: InvoiceAccessoryResolveOptions,
): InvoiceAccessoryResolveResult {
  const { labels, colors, tokens, ignores, defaults } = dictionaryIndexOf(
    options.dictionary,
  )
  const fallback = findDefaultKind(options.productLookupKey, defaults)

  const ignored: string[] = []
  const unknown: string[] = []
  const evidence: string[] = []
  const quantityById = new Map<string, { style: StyleRef; quantity: number }>()

  function addStyle(style: StyleRef, paid: boolean, source: string) {
    if (
      options.mainStyle &&
      style.styleId === options.mainStyle.styleId &&
      !paid
    ) {
      ignored.push(`${source} → 본품 되풀이 ${style.styleNo}`)
      evidence.push(`${source} → 본품과 같아 버림`)
      return
    }
    const current = quantityById.get(style.styleId)
    if (current) current.quantity += 1
    else quantityById.set(style.styleId, { style, quantity: 1 })
    evidence.push(`${source} → ${style.styleNo} ${style.name}`)
  }

  function resolveValue(
    raw: string,
    kind: KindHit | null,
    source: string,
  ) {
    const paid = hasPrice(raw)
    const value = cleanValue(raw)
    if (isNone(value)) {
      ignored.push(source)
      return
    }
    if (isIgnored(value, ignores) || isSizeLike(value)) {
      ignored.push(source)
      return
    }
    if (!kind && lookupContains(options.productLookupKey, value)) {
      ignored.push(`${source} → 품목명에 있음`)
      return
    }

    const token = findToken(value, tokens)
    if (token) {
      addStyle(token, paid, source)
      return
    }

    const byName = options.styleByName.get(normalizeInvoiceText(value))
    if (byName) {
      addStyle(byName, paid, source)
      return
    }

    const colorName = findColor(value, colors)
    if (kind && colorName) {
      const style =
        options.styleByName.get(
          normalizeInvoiceText(styleNameOf(kind.namePrefix, colorName)),
        ) ?? null
      if (style) {
        addStyle(style, paid, source)
        return
      }
      unknown.push(`${source} (${kind.kind} ${colorName} 상품 없음)`)
      return
    }

    if (colorName && !kind) {
      unknown.push(`${source} (종류를 모름)`)
      return
    }

    unknown.push(source)
  }

  for (const piece of expandPieces(options.itemName)) {
    if (!piece) continue
    const { label, values } = splitPiece(piece)
    const labelKind = label ? findLabelKind(label, labels) : null

    if (labelKind) {
      for (const value of values) {
        if (isNone(value)) {
          ignored.push(piece)
          continue
        }
        resolveValue(value, labelKind, piece)
      }
      continue
    }

    if (label && isIgnoreLabel(label, ignores)) {
      ignored.push(piece)
      for (const value of values) {
        for (const part of value.split(/\+/)) {
          const paid = hasPrice(part)
          const cleaned = cleanValue(part)
          if (isNone(cleaned)) continue
          const token =
            findToken(cleaned, tokens) ??
            options.styleByName.get(normalizeInvoiceText(cleaned))
          if (token) addStyle(token, paid, `${piece} → ${cleaned}`)
        }
      }
      continue
    }

    if (label && isNone(label)) {
      for (const value of values) resolveValue(value, fallback, piece)
      continue
    }

    const labelIsValue = Boolean(
      label &&
        (findColor(cleanValue(label), colors) ||
          findToken(cleanValue(label), tokens) ||
          options.styleByName.get(normalizeInvoiceText(cleanValue(label)))),
    )
    const candidates = labelIsValue && label ? [label, ...values] : values
    for (const value of candidates) {
      resolveValue(value, fallback, piece)
    }
  }

  return {
    components: [...quantityById.values()],
    ignored,
    unknown,
    evidence,
  }
}

export function accessoryStyleNameIndex(
  styles: StyleRef[],
): Map<string, StyleRef> {
  const map = new Map<string, StyleRef>()
  for (const style of styles) {
    const key = normalizeInvoiceText(style.name)
    if (key && !map.has(key)) map.set(key, style)
  }
  return map
}
