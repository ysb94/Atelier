import type {
  CodeUsageTarget,
  OutboundChannelType,
  OutboundPartnerStatus,
  OutboundShippingMethod,
} from '@/lib/types'

/**
 * 업체명 비교용 압축 키.
 * NFKC로 전각을 접고 소문자화한 뒤 한글·영문·숫자만 남긴다.
 * 원문 표기는 바꾸지 않으며 중복 판정과 검색에만 쓴다.
 * DB 백필(`20260828015800_outbound_partner_aliases.sql`)과 같은 규칙이다.
 */
export function compactOutboundPartnerKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^0-9a-z가-힣]/g, '')
}

/** 표시용 원문 정리. 앞뒤·연속 공백만 접고 글자는 유지한다. */
export function normalizeOutboundPartnerName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export const OUTBOUND_CHANNEL_TYPES: readonly OutboundChannelType[] = [
  'unset',
  'online',
  'offline',
]

export const OUTBOUND_SHIPPING_METHODS: readonly OutboundShippingMethod[] = [
  'unset',
  'parcel',
  'fulfillment',
  'freight',
  'pickup',
]

export const OUTBOUND_CHANNEL_TYPE_LABEL: Record<OutboundChannelType, string> = {
  unset: '미지정',
  online: '온라인',
  offline: '오프라인',
}

export const OUTBOUND_SHIPPING_METHOD_LABEL: Record<
  OutboundShippingMethod,
  string
> = {
  unset: '미지정',
  parcel: '택배',
  fulfillment: '풀필먼트',
  freight: '용차',
  pickup: '직접수령',
}

export const OUTBOUND_PARTNER_STATUS_LABEL: Record<
  OutboundPartnerStatus,
  string
> = {
  ongoing: '거래중',
  one_time: '단발성',
  archived: '비활성',
}

export function isOutboundChannelType(
  value: string,
): value is OutboundChannelType {
  return (OUTBOUND_CHANNEL_TYPES as readonly string[]).includes(value)
}

export function isOutboundShippingMethod(
  value: string,
): value is OutboundShippingMethod {
  return (OUTBOUND_SHIPPING_METHODS as readonly string[]).includes(value)
}

/** 비활성이 거래중·단발성보다 앞선다. 한 업체는 한 상태만 가진다. */
export function outboundPartnerStatus(
  target: Pick<CodeUsageTarget, 'active' | 'isOneTime'>,
): OutboundPartnerStatus {
  if (!target.active) return 'archived'
  return target.isOneTime ? 'one_time' : 'ongoing'
}

/** 다시 켤 때 위치를 아직 고르지 않은 상태. null은 미분류를 고른 것이다. */
export type OutboundPartnerActivateDraft = {
  name: string
  folderId: string | null | undefined
  note: string
}

export function outboundPartnerActivateGaps(
  draft: OutboundPartnerActivateDraft,
): string[] {
  const gaps: string[] = []
  if (!normalizeOutboundPartnerName(draft.name)) gaps.push('업체명')
  if (draft.folderId === undefined) gaps.push('둘 위치')
  if (!draft.note.trim()) gaps.push('이 업체의 특징')
  return gaps
}

/** 비활성 업체를 다시 켜려면 이름·위치·특징을 모두 채워야 한다. */
export function canActivateOutboundPartner(
  draft: OutboundPartnerActivateDraft,
): boolean {
  return outboundPartnerActivateGaps(draft).length === 0
}

export function activateFolderSelectValue(
  folderId: string | null | undefined,
): string {
  if (folderId === undefined) return ''
  return folderId ?? '__unfiled'
}

export function parseActivateFolderValue(
  value: string,
): string | null | undefined {
  if (value === '') return undefined
  if (value === '__unfiled') return null
  return value
}

/** 분류를 아직 안 채운 업체. 목록에서 채우도록 표시한다. */
export function isOutboundPartnerIncomplete(
  target: Pick<CodeUsageTarget, 'channelType' | 'shippingMethod'>,
): boolean {
  return target.channelType === 'unset' || target.shippingMethod === 'unset'
}

export type ParsedOutboundPartnerLine = {
  lineNumber: number
  name: string
  normalizedName: string
  aliases: string[]
}

export type OutboundPartnerPasteIssue = {
  lineNumber: number
  text: string
  reason: 'duplicate_in_paste' | 'duplicate_existing' | 'empty_name'
}

export type OutboundPartnerPasteResult = {
  rows: ParsedOutboundPartnerLine[]
  issues: OutboundPartnerPasteIssue[]
}

/**
 * 한 줄 = 업체 하나.
 * `무신사` 또는 `무신사 / MSS, (주)무신사`처럼 첫 구분자 뒤를 별칭으로 읽는다.
 * 엑셀에서 복사한 탭 구분도 같은 방식으로 처리한다.
 */
export function parseOutboundPartnerPaste(
  text: string,
  existingKeys: readonly string[] = [],
): OutboundPartnerPasteResult {
  const taken = new Set(existingKeys)
  const seen = new Set<string>()
  const rows: ParsedOutboundPartnerLine[] = []
  const issues: OutboundPartnerPasteIssue[] = []

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (!line) return

    const separator = line.search(/[\t/|]/)
    const namePart = separator === -1 ? line : line.slice(0, separator)
    const aliasPart = separator === -1 ? '' : line.slice(separator + 1)

    const name = normalizeOutboundPartnerName(namePart)
    const normalizedName = compactOutboundPartnerKey(name)
    if (!normalizedName) {
      issues.push({ lineNumber, text: line, reason: 'empty_name' })
      return
    }
    if (taken.has(normalizedName)) {
      issues.push({ lineNumber, text: line, reason: 'duplicate_existing' })
      return
    }
    if (seen.has(normalizedName)) {
      issues.push({ lineNumber, text: line, reason: 'duplicate_in_paste' })
      return
    }
    seen.add(normalizedName)

    const aliasSeen = new Set<string>([normalizedName])
    const aliases: string[] = []
    aliasPart
      .split(/[,;\t|]/)
      .map((part) => normalizeOutboundPartnerName(part))
      .filter(Boolean)
      .forEach((alias) => {
        const key = compactOutboundPartnerKey(alias)
        if (!key || aliasSeen.has(key)) return
        aliasSeen.add(key)
        aliases.push(alias)
      })

    rows.push({ lineNumber, name, normalizedName, aliases })
  })

  return { rows, issues }
}

/** 검색어가 정식명 또는 별칭 압축 키에 걸리는지 본다. */
export function matchesOutboundPartnerSearch(
  keyword: string,
  target: Pick<CodeUsageTarget, 'name' | 'normalizedName'>,
  aliases: readonly string[],
): boolean {
  const key = compactOutboundPartnerKey(keyword)
  if (!key) return true
  const haystack = [
    target.normalizedName || compactOutboundPartnerKey(target.name),
    ...aliases.map(compactOutboundPartnerKey),
  ]
  return haystack.some((value) => value.includes(key))
}
