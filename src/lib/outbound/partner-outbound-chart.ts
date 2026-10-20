import { folderPath } from '../codes/outbound-folder'
import {
  compactOutboundPartnerKey,
  normalizeOutboundPartnerName,
  OUTBOUND_CHANNEL_TYPE_LABEL,
} from '../codes/outbound-partner'
import type {
  CodeUsageTarget,
  CodeUsageTargetFolder,
  OutboundChannelType,
} from '../types'
import type { ProductOutboundPartnerTotal } from './product-outbound'

export const UNFILED_CHART_FOLDER_KEY = '__unfiled__'
export const CHART_GROUP_PREFIX = '__group__:'
export const OTHER_COMPANY_KEY = '__other__'

export function chartGroupSeriesId(groupKey: string) {
  return `${CHART_GROUP_PREFIX}${groupKey}`
}

export function isChartGroupSeriesId(seriesId: string) {
  return seriesId.startsWith(CHART_GROUP_PREFIX)
}

export function parsePartnerChartLabel(name: string): {
  group: string
  site: string
} {
  const trimmed = normalizeOutboundPartnerName(name)
  const sep = ' · '
  const index = trimmed.indexOf(sep)
  if (index > 0) {
    return {
      group: trimmed.slice(0, index),
      site: trimmed.slice(index + sep.length),
    }
  }
  return { group: trimmed || '미분류', site: trimmed || '미분류' }
}

export type PartnerChartTarget = Pick<
  CodeUsageTarget,
  'id' | 'groupId' | 'groupName' | 'siteName' | 'folderId'
> & {
  /** 없으면 채널을 붙이지 않는다. `unset`은 온라인/오프라인으로 보지 않는다. */
  channelType?: OutboundChannelType
}

export type PartnerChartUnit = {
  partnerId: string
  partnerName: string
  siteLabel: string
  quantity: number
  channelType?: OutboundChannelType
}

export type PartnerChartCompany = {
  key: string
  label: string
  quantity: number
  folderKey: string
  folderLabel: string
  units: PartnerChartUnit[]
  /** `기타`로 묶인 실제 업체. 펼치면 각각 그래프 선으로 켤 수 있다. */
  members?: PartnerChartCompany[]
}

export type PartnerChartFolder = {
  key: string
  label: string
  quantity: number
  companies: PartnerChartCompany[]
}

function topFolderOf(
  folders: readonly CodeUsageTargetFolder[],
  folderId: string | null | undefined,
): { key: string; label: string } {
  const top = folderPath(folders, folderId)[0]
  if (!top) return { key: UNFILED_CHART_FOLDER_KEY, label: '미분류' }
  return { key: top.id, label: top.name }
}

function sortByQuantityThenName<T extends { quantity: number }>(
  items: T[],
  nameOf: (item: T) => string,
): T[] {
  return items.sort((left, right) => {
    if (right.quantity !== left.quantity) return right.quantity - left.quantity
    return nameOf(left).localeCompare(nameOf(right), 'ko-KR')
  })
}

/** 출고 추이 범례용. 상위 분류(폴더) → 업체 → 지점. */
export function groupPartnersForOutboundChart(
  partners: readonly ProductOutboundPartnerTotal[],
  targets: readonly PartnerChartTarget[],
  folders: readonly CodeUsageTargetFolder[] = [],
): { folders: PartnerChartFolder[]; companies: PartnerChartCompany[] } {
  const targetById = new Map(targets.map((target) => [target.id, target]))
  const companyMap = new Map<
    string,
    PartnerChartCompany & { unitMap: Map<string, PartnerChartUnit> }
  >()

  for (const partner of partners) {
    const target = targetById.get(partner.partnerId)
    const parsed = parsePartnerChartLabel(partner.partnerName)
    const groupLabel =
      normalizeOutboundPartnerName(target?.groupName ?? '') || parsed.group
    const namedSite = normalizeOutboundPartnerName(target?.siteName ?? '')
    // 등록된 지점명이 비어 있으면 출고명에서 지점을 추측하지 않는다.
    const siteLabel = target ? namedSite : parsed.site
    const channelType =
      target?.channelType === 'online' || target?.channelType === 'offline'
        ? target.channelType
        : undefined
    const groupKey =
      target?.groupId ?? `name:${compactOutboundPartnerKey(groupLabel)}`
    const folder = topFolderOf(folders, target?.folderId)
    const current = companyMap.get(groupKey)
    const unit: PartnerChartUnit = {
      partnerId: partner.partnerId,
      partnerName: partner.partnerName,
      siteLabel,
      quantity: partner.quantity,
      channelType,
    }
    if (current) {
      current.quantity += partner.quantity
      const existing = current.unitMap.get(partner.partnerId)
      if (existing) existing.quantity += partner.quantity
      else current.unitMap.set(partner.partnerId, unit)
    } else {
      companyMap.set(groupKey, {
        key: groupKey,
        label: groupLabel,
        quantity: partner.quantity,
        folderKey: folder.key,
        folderLabel: folder.label,
        units: [],
        unitMap: new Map([[partner.partnerId, unit]]),
      })
    }
  }

  const companies = sortByQuantityThenName(
    [...companyMap.values()].map((company) => {
      const units = sortByQuantityThenName(
        [...company.unitMap.values()],
        (unit) => unit.siteLabel,
      ).map((unit) => ({
        partnerId: unit.partnerId,
        partnerName: unit.partnerName,
        siteLabel: unit.siteLabel,
        quantity: unit.quantity,
        channelType: unit.channelType,
      }))
      return {
        key: company.key,
        label: company.label,
        quantity: company.quantity,
        folderKey: company.folderKey,
        folderLabel: company.folderLabel,
        units,
      }
    }),
    (company) => company.label,
  )

  const folderMap = new Map<string, PartnerChartFolder>()
  for (const company of companies) {
    const current = folderMap.get(company.folderKey)
    if (current) {
      current.quantity += company.quantity
      current.companies.push(company)
    } else {
      folderMap.set(company.folderKey, {
        key: company.folderKey,
        label: company.folderLabel,
        quantity: company.quantity,
        companies: [company],
      })
    }
  }

  const groupedFolders = [...folderMap.values()].sort((left, right) => {
    if (left.key === UNFILED_CHART_FOLDER_KEY) return 1
    if (right.key === UNFILED_CHART_FOLDER_KEY) return -1
    if (right.quantity !== left.quantity) return right.quantity - left.quantity
    return left.label.localeCompare(right.label, 'ko-KR')
  })

  return { folders: groupedFolders, companies }
}

export type PeriodQuantity = {
  /** YYYY-MM-DD. 주 단위면 그 주의 월요일. */
  key: string
  quantity: number
}

function weekStartKey(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
  )
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${dayOfMonth}`
}

/** 일자(또는 월요일 기준 주)별 출고 합계. dates가 있으면 그 구간의 빈 칸도 0으로 둔다. */
export function bucketTotalsByPeriod(
  shipments: readonly { shippedOn: string; quantity: number }[],
  dates: readonly string[],
  unit: 'day' | 'week',
): PeriodQuantity[] {
  const totals = new Map<string, number>()
  const order: string[] = []
  function addKey(key: string) {
    if (totals.has(key)) return
    totals.set(key, 0)
    order.push(key)
  }
  const bucketKey = unit === 'week' ? weekStartKey : (date: string) => date
  if (dates.length > 0) {
    for (const date of dates) addKey(bucketKey(date))
  }
  for (const row of shipments) {
    if (!Number.isFinite(row.quantity)) continue
    const key = bucketKey(row.shippedOn)
    addKey(key)
    totals.set(key, (totals.get(key) ?? 0) + row.quantity)
  }
  if (dates.length === 0) order.sort()
  return order.map((key) => ({ key, quantity: totals.get(key) ?? 0 }))
}

/**
 * 수량 순 상위 limit개만 남긴다.
 * 나머지가 둘 이상이면 `기타` 한 줄로 묶고, 펼치면 남은 업체 이름이 나온다.
 */
export function limitCompaniesWithOther(
  companies: readonly PartnerChartCompany[],
  limit = 7,
): PartnerChartCompany[] {
  if (companies.length <= limit) return companies.slice()
  const head = companies.slice(0, limit)
  const rest = companies.slice(limit)
  if (rest.length === 1) return [...head, rest[0]!]
  const other: PartnerChartCompany = {
    key: OTHER_COMPANY_KEY,
    label: '기타',
    quantity: rest.reduce((sum, company) => sum + company.quantity, 0),
    folderKey: '',
    folderLabel: '',
    members: rest.slice(),
    units: rest.map((company) => ({
      partnerId: company.key,
      partnerName: company.label,
      siteLabel: company.label,
      quantity: company.quantity,
    })),
  }
  return [...head, other]
}

export function companySeriesId(companyKey: string) {
  return `company:${companyKey}`
}

export function siteSeriesId(partnerId: string) {
  return `site:${partnerId}`
}

export type ResolvedChartSeries = {
  id: string
  label: string
  partnerIds: string[]
  quantity: number
}

function partnerIdsOf(company: PartnerChartCompany) {
  if (company.members && company.members.length > 0) {
    return company.members.flatMap((member) =>
      member.units.map((unit) => unit.partnerId),
    )
  }
  return company.units.map((unit) => unit.partnerId)
}

function realCompanies(scope: {
  companies: readonly PartnerChartCompany[]
  other?: PartnerChartCompany | null
}) {
  const list = scope.companies.filter(
    (company) => company.key !== OTHER_COMPANY_KEY,
  )
  for (const member of scope.other?.members ?? []) {
    if (!list.some((company) => company.key === member.key)) list.push(member)
  }
  return list
}

function operationsChannelPhrase(
  channelType: OutboundChannelType | null | undefined,
): string {
  if (channelType !== 'online' && channelType !== 'offline') return ''
  return OUTBOUND_CHANNEL_TYPE_LABEL[channelType]
}

function sameOperationsName(left: string, right: string): boolean {
  const a = normalizeOutboundPartnerName(left)
  const b = normalizeOutboundPartnerName(right)
  if (!a || !b) return false
  if (a === b) return true
  const aKey = compactOutboundPartnerKey(a)
  const bKey = compactOutboundPartnerKey(b)
  return aKey.length > 0 && aKey === bKey
}

function labelHasChannelPhrase(value: string, phrase: string): boolean {
  if (!phrase) return false
  return normalizeOutboundPartnerName(value).includes(phrase)
}

/**
 * 운영 현황 전용 업체·지점·채널 표시.
 * 공통 출고처 이름은 채널을 떼므로 여기서만 붙인다.
 * 채널이 없거나 미지정이면 온라인/오프라인으로 추측하지 않는다.
 */
export function operationsOutboundUnitLabel(input: {
  companyLabel: string
  siteLabel?: string | null
  channelType?: OutboundChannelType | null
}): string {
  const company = normalizeOutboundPartnerName(input.companyLabel)
  const site = normalizeOutboundPartnerName(input.siteLabel ?? '')
  const channel = operationsChannelPhrase(input.channelType)
  const showSite = site.length > 0 && !sameOperationsName(company, site)
  const parts: string[] = []
  if (company) parts.push(company)
  if (showSite) parts.push(site)
  const channelHost = showSite ? site : company
  if (channel && !labelHasChannelPhrase(channelHost, channel)) {
    parts.push(channel)
  }
  return parts.join(' · ') || '미분류'
}

/** 지점이 하나면 첫 줄에 지점·채널을 붙인다. 여러 지점과 기타는 묶음 이름을 유지한다. */
export function operationsOutboundCompanyLabel(
  company: Pick<PartnerChartCompany, 'label' | 'units' | 'members'>,
): string {
  if ((company.members?.length ?? 0) > 0 || company.units.length !== 1) {
    return company.label
  }
  const unit = company.units[0]
  if (!unit) return company.label
  return operationsOutboundUnitLabel({
    companyLabel: company.label,
    siteLabel: unit.siteLabel,
    channelType: unit.channelType,
  })
}

/** 출고처 선택 목록. 그룹이 없으면 식별명에 채널만 더한다. */
export function operationsOutboundTargetLabel(
  target: Pick<CodeUsageTarget, 'name' | 'groupName' | 'siteName'> & {
    channelType?: OutboundChannelType | null
  },
): string {
  const groupName = normalizeOutboundPartnerName(target.groupName)
  return operationsOutboundUnitLabel({
    companyLabel: groupName || target.name,
    siteLabel: groupName ? target.siteName : '',
    channelType: target.channelType,
  })
}

/** 그래프 선 id를 업체·지점 수량으로 푼다. 현재 범위에 없으면 null. */
export function resolveChartSeries(
  id: string,
  scope: {
    companies: readonly PartnerChartCompany[]
    other?: PartnerChartCompany | null
  },
): ResolvedChartSeries | null {
  if (id.startsWith('company:')) {
    const key = id.slice('company:'.length)
    if (key === OTHER_COMPANY_KEY) {
      if (!scope.other) return null
      return {
        id,
        label: scope.other.label,
        partnerIds: partnerIdsOf(scope.other),
        quantity: scope.other.quantity,
      }
    }
    const company = realCompanies(scope).find((item) => item.key === key)
    if (!company) return null
    return {
      id,
      label: operationsOutboundCompanyLabel(company),
      partnerIds: partnerIdsOf(company),
      quantity: company.quantity,
    }
  }
  if (id.startsWith('site:')) {
    const partnerId = id.slice('site:'.length)
    for (const company of realCompanies(scope)) {
      const unit = company.units.find((item) => item.partnerId === partnerId)
      if (!unit) continue
      return {
        id,
        label: operationsOutboundUnitLabel({
          companyLabel: company.label,
          siteLabel: unit.siteLabel,
          channelType: unit.channelType,
        }),
        partnerIds: [unit.partnerId],
        quantity: unit.quantity,
      }
    }
  }
  return null
}

/** 1·2·5 단위로 올린 눈금. 378이면 0, 100, 200, 300, 400. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0 || count <= 0) return [0]
  const rough = max / count
  const exponent = Math.floor(Math.log10(Math.max(rough, 1)))
  const pow = 10 ** exponent
  const step = Math.max(
    1,
    [1, 2, 5, 10]
      .map((multiplier) => multiplier * pow)
      .find((value) => value >= rough) ?? pow * 10,
  )
  const ticks: number[] = []
  const last = Math.ceil(max / step) * step
  for (let value = 0; value <= last; value += step) ticks.push(value)
  return ticks
}
