import { folderPath } from '../codes/outbound-folder'
import {
  compactOutboundPartnerKey,
  normalizeOutboundPartnerName,
} from '../codes/outbound-partner'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '../types'
import type { ProductOutboundPartnerTotal } from './product-outbound'

export const UNFILED_CHART_FOLDER_KEY = '__unfiled__'
export const CHART_GROUP_PREFIX = '__group__:'

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
>

export type PartnerChartUnit = {
  partnerId: string
  partnerName: string
  siteLabel: string
  quantity: number
}

export type PartnerChartCompany = {
  key: string
  label: string
  quantity: number
  folderKey: string
  folderLabel: string
  units: PartnerChartUnit[]
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
    const siteLabel =
      normalizeOutboundPartnerName(target?.siteName ?? '') || parsed.site
    const groupKey =
      target?.groupId ?? `name:${compactOutboundPartnerKey(groupLabel)}`
    const folder = topFolderOf(folders, target?.folderId)
    const current = companyMap.get(groupKey)
    const unit: PartnerChartUnit = {
      partnerId: partner.partnerId,
      partnerName: partner.partnerName,
      siteLabel,
      quantity: partner.quantity,
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
