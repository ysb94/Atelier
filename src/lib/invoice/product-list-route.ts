import type { WarehouseZone } from '@/lib/types'
import {
  compareWarehouseLocationZones,
  UNSPECIFIED_LOCATION_ZONE,
  type InvoiceProductListWarehouseGroup,
} from '@/lib/invoice/product-list-warehouse'

export type InvoiceProductListRouteGroup = {
  id: string
  zonePrefixes: string[]
}

export type InvoiceProductListRouteSplitMode = 'grouped' | 'per_zone'

export const INVOICE_PRODUCT_LIST_ROUTE_SPLIT_MODES: {
  value: InvoiceProductListRouteSplitMode
  label: string
}[] = [
  { value: 'grouped', label: '한 카드' },
  { value: 'per_zone', label: '구역별 분해' },
]

export type InvoiceProductListPrintLayout = {
  zone: WarehouseZone
  splitMode?: InvoiceProductListRouteSplitMode
  routeGroups: InvoiceProductListRouteGroup[]
}

export type InvoiceProductListPrintLayoutByZone = Record<
  WarehouseZone,
  InvoiceProductListPrintLayout
>

export const INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID = 'unspecified'

export type InvoiceProductListPrintRouteSection = {
  id: string
  label: string
  locked: boolean
  groups: InvoiceProductListWarehouseGroup[]
}

let routeGroupSeq = 0

export function createInvoiceProductListRouteGroupId() {
  routeGroupSeq += 1
  return `route-${routeGroupSeq}`
}

export function invoiceProductListRouteSplitMode(
  layout: InvoiceProductListPrintLayout,
): InvoiceProductListRouteSplitMode {
  return layout.splitMode ?? 'grouped'
}

export function emptyInvoiceProductListPrintLayout(
  zone: WarehouseZone,
): InvoiceProductListPrintLayout {
  return { zone, splitMode: 'grouped', routeGroups: [] }
}

export function emptyInvoiceProductListPrintLayoutByZone(): InvoiceProductListPrintLayoutByZone {
  return {
    picking: emptyInvoiceProductListPrintLayout('picking'),
    box_storage: emptyInvoiceProductListPrintLayout('box_storage'),
  }
}

export function editableWarehouseZonePrefixes(
  groups: InvoiceProductListWarehouseGroup[],
) {
  return groups
    .map((group) => group.locationZonePrefix)
    .filter((prefix) => prefix !== UNSPECIFIED_LOCATION_ZONE)
}

export function formatInvoiceProductListRouteLabel(prefixes: string[]) {
  return prefixes.filter(Boolean).join('·')
}

function cloneLayout(
  layout: InvoiceProductListPrintLayout,
): InvoiceProductListPrintLayout {
  return {
    zone: layout.zone,
    splitMode: invoiceProductListRouteSplitMode(layout),
    routeGroups: layout.routeGroups.map((group) => ({
      id: group.id,
      zonePrefixes: [...group.zonePrefixes],
    })),
  }
}

function uniqueExistingPrefixes(
  prefixes: string[],
  available: Set<string>,
  seen: Set<string>,
) {
  const next: string[] = []
  for (const prefix of prefixes) {
    if (prefix === UNSPECIFIED_LOCATION_ZONE) continue
    if (!available.has(prefix) || seen.has(prefix)) continue
    seen.add(prefix)
    next.push(prefix)
  }
  return next
}

export function buildDefaultInvoiceProductListPrintLayout(
  groups: InvoiceProductListWarehouseGroup[],
  zone: WarehouseZone,
  splitMode: InvoiceProductListRouteSplitMode = 'grouped',
): InvoiceProductListPrintLayout {
  const prefixes = editableWarehouseZonePrefixes(groups)
  return {
    zone,
    splitMode,
    routeGroups:
      prefixes.length === 0
        ? []
        : splitMode === 'per_zone'
          ? prefixes.map((prefix) => ({
              id: createInvoiceProductListRouteGroupId(),
              zonePrefixes: [prefix],
            }))
          : [
              {
                id: createInvoiceProductListRouteGroupId(),
                zonePrefixes: prefixes,
              },
            ],
  }
}

export function applyInvoiceProductListRouteSplitMode(
  groups: InvoiceProductListWarehouseGroup[],
  layout: InvoiceProductListPrintLayout,
  splitMode: InvoiceProductListRouteSplitMode,
): InvoiceProductListPrintLayout {
  return buildDefaultInvoiceProductListPrintLayout(
    groups,
    layout.zone,
    splitMode,
  )
}

export function parseInvoiceProductListRoutePresetGroups(
  value: unknown,
): { zonePrefixes: string[] }[] {
  if (!Array.isArray(value)) return []
  const groups: { zonePrefixes: string[] }[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = (item as { zonePrefixes?: unknown }).zonePrefixes
    if (!Array.isArray(raw)) continue
    const zonePrefixes: string[] = []
    const seen = new Set<string>()
    for (const prefix of raw) {
      if (typeof prefix !== 'string') continue
      const next = prefix.trim()
      if (!next || next === UNSPECIFIED_LOCATION_ZONE || seen.has(next)) {
        continue
      }
      seen.add(next)
      zonePrefixes.push(next)
    }
    if (zonePrefixes.length === 0) continue
    groups.push({ zonePrefixes })
  }
  return groups
}

export function serializeInvoiceProductListRouteGroups(
  layout: InvoiceProductListPrintLayout,
): { zonePrefixes: string[] }[] {
  return parseInvoiceProductListRoutePresetGroups(layout.routeGroups)
}

export function applyInvoiceProductListRoutePreset(
  groups: InvoiceProductListWarehouseGroup[],
  zone: WarehouseZone,
  routeGroups: { zonePrefixes: string[] }[],
): InvoiceProductListPrintLayout {
  const available = new Set(editableWarehouseZonePrefixes(groups))
  const seen = new Set<string>()
  const next: InvoiceProductListRouteGroup[] = []
  for (const group of parseInvoiceProductListRoutePresetGroups(routeGroups)) {
    const zonePrefixes = uniqueExistingPrefixes(
      group.zonePrefixes,
      available,
      seen,
    )
    if (zonePrefixes.length === 0) continue
    next.push({
      id: createInvoiceProductListRouteGroupId(),
      zonePrefixes,
    })
  }
  for (const prefix of editableWarehouseZonePrefixes(groups)) {
    if (seen.has(prefix)) continue
    next.push({
      id: createInvoiceProductListRouteGroupId(),
      zonePrefixes: [prefix],
    })
  }
  return { zone, splitMode: 'grouped', routeGroups: next }
}

export function reconcileInvoiceProductListPrintLayout(
  groups: InvoiceProductListWarehouseGroup[],
  layout: InvoiceProductListPrintLayout,
): InvoiceProductListPrintLayout {
  const splitMode = invoiceProductListRouteSplitMode(layout)
  if (layout.routeGroups.length === 0) {
    return buildDefaultInvoiceProductListPrintLayout(
      groups,
      layout.zone,
      splitMode,
    )
  }
  const available = new Set(editableWarehouseZonePrefixes(groups))
  const seen = new Set<string>()
  const routeGroups: InvoiceProductListRouteGroup[] = []
  for (const group of layout.routeGroups) {
    const zonePrefixes = uniqueExistingPrefixes(
      group.zonePrefixes,
      available,
      seen,
    )
    routeGroups.push({ id: group.id, zonePrefixes })
  }
  for (const prefix of editableWarehouseZonePrefixes(groups)) {
    if (seen.has(prefix)) continue
    routeGroups.push({
      id: createInvoiceProductListRouteGroupId(),
      zonePrefixes: [prefix],
    })
  }
  return { zone: layout.zone, splitMode, routeGroups }
}

export function orderWarehouseGroupsForPrint(
  groups: InvoiceProductListWarehouseGroup[],
  layout: InvoiceProductListPrintLayout,
): InvoiceProductListWarehouseGroup[] {
  const byPrefix = new Map(
    groups.map((group) => [group.locationZonePrefix, group]),
  )
  const ordered: InvoiceProductListWarehouseGroup[] = []
  const seen = new Set<string>()
  for (const route of layout.routeGroups) {
    for (const prefix of route.zonePrefixes) {
      if (prefix === UNSPECIFIED_LOCATION_ZONE || seen.has(prefix)) continue
      const group = byPrefix.get(prefix)
      if (!group) continue
      ordered.push(group)
      seen.add(prefix)
    }
  }
  const leftovers = groups
    .filter(
      (group) =>
        group.locationZonePrefix !== UNSPECIFIED_LOCATION_ZONE &&
        !seen.has(group.locationZonePrefix),
    )
    .sort((left, right) =>
      compareWarehouseLocationZones(
        left.locationZonePrefix,
        right.locationZonePrefix,
      ),
    )
  ordered.push(...leftovers)
  const unspecified = byPrefix.get(UNSPECIFIED_LOCATION_ZONE)
  if (unspecified) ordered.push(unspecified)
  return ordered
}

export function buildInvoiceProductListPrintRouteSections(
  groups: InvoiceProductListWarehouseGroup[],
  layout: InvoiceProductListPrintLayout,
): InvoiceProductListPrintRouteSection[] {
  const byPrefix = new Map(
    groups.map((group) => [group.locationZonePrefix, group]),
  )
  const seen = new Set<string>()
  const sections: InvoiceProductListPrintRouteSection[] = []
  for (const route of layout.routeGroups) {
    const routeGroups = route.zonePrefixes.flatMap((prefix) => {
      if (prefix === UNSPECIFIED_LOCATION_ZONE || seen.has(prefix)) return []
      const group = byPrefix.get(prefix)
      if (!group || group.lines.length === 0) return []
      seen.add(prefix)
      return [group]
    })
    if (routeGroups.length === 0) continue
    sections.push({
      id: route.id,
      label: formatInvoiceProductListRouteLabel(
        routeGroups.map((group) => group.locationZonePrefix),
      ),
      locked: false,
      groups: routeGroups,
    })
  }
  const leftovers = groups
    .filter(
      (group) =>
        group.locationZonePrefix !== UNSPECIFIED_LOCATION_ZONE &&
        !seen.has(group.locationZonePrefix) &&
        group.lines.length > 0,
    )
    .sort((left, right) =>
      compareWarehouseLocationZones(
        left.locationZonePrefix,
        right.locationZonePrefix,
      ),
    )
  for (const group of leftovers) {
    sections.push({
      id: `leftover-${group.locationZonePrefix}`,
      label: group.locationZonePrefix,
      locked: false,
      groups: [group],
    })
  }
  const unspecified = byPrefix.get(UNSPECIFIED_LOCATION_ZONE)
  if (unspecified && unspecified.lines.length > 0) {
    sections.push({
      id: INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID,
      label: UNSPECIFIED_LOCATION_ZONE,
      locked: true,
      groups: [unspecified],
    })
  }
  return sections
}

export function invoiceProductListSelectableRouteGroupIds(
  layout: InvoiceProductListPrintLayout,
  groups: InvoiceProductListWarehouseGroup[],
) {
  const ids = layout.routeGroups.map((group) => group.id)
  if (
    groups.some(
      (group) => group.locationZonePrefix === UNSPECIFIED_LOCATION_ZONE,
    )
  ) {
    ids.push(INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID)
  }
  return ids
}

export function addInvoiceProductListRouteGroup(
  layout: InvoiceProductListPrintLayout,
): InvoiceProductListPrintLayout {
  const next = cloneLayout(layout)
  next.routeGroups.push({
    id: createInvoiceProductListRouteGroupId(),
    zonePrefixes: [],
  })
  return next
}

export function removeInvoiceProductListRouteGroup(
  layout: InvoiceProductListPrintLayout,
  groupId: string,
): InvoiceProductListPrintLayout {
  const next = cloneLayout(layout)
  const index = next.routeGroups.findIndex((group) => group.id === groupId)
  if (index < 0) return next
  const [removed] = next.routeGroups.splice(index, 1)
  const leftovers = (removed?.zonePrefixes ?? []).map((prefix) => ({
    id: createInvoiceProductListRouteGroupId(),
    zonePrefixes: [prefix],
  }))
  next.routeGroups.splice(index, 0, ...leftovers)
  return next
}

export function moveInvoiceProductListRouteGroup(
  layout: InvoiceProductListPrintLayout,
  fromIndex: number,
  toIndex: number,
): InvoiceProductListPrintLayout {
  const next = cloneLayout(layout)
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= next.routeGroups.length ||
    toIndex >= next.routeGroups.length ||
    fromIndex === toIndex
  ) {
    return next
  }
  const [moved] = next.routeGroups.splice(fromIndex, 1)
  if (!moved) return next
  next.routeGroups.splice(toIndex, 0, moved)
  return next
}

export function moveInvoiceProductListZonePrefix(
  layout: InvoiceProductListPrintLayout,
  prefix: string,
  toGroupId: string,
  toIndex?: number,
): InvoiceProductListPrintLayout {
  if (prefix === UNSPECIFIED_LOCATION_ZONE) return layout
  const next = cloneLayout(layout)
  for (const group of next.routeGroups) {
    group.zonePrefixes = group.zonePrefixes.filter((item) => item !== prefix)
  }
  const target = next.routeGroups.find((group) => group.id === toGroupId)
  if (!target) {
    next.routeGroups = next.routeGroups.filter(
      (group) => group.zonePrefixes.length > 0,
    )
    return next
  }
  const insertAt = Math.max(
    0,
    Math.min(toIndex ?? target.zonePrefixes.length, target.zonePrefixes.length),
  )
  target.zonePrefixes.splice(insertAt, 0, prefix)
  next.routeGroups = next.routeGroups.filter(
    (group) => group.zonePrefixes.length > 0 || group.id === toGroupId,
  )
  return next
}

export function moveInvoiceProductListZoneToNeighbor(
  layout: InvoiceProductListPrintLayout,
  prefix: string,
  direction: -1 | 1,
): InvoiceProductListPrintLayout {
  if (prefix === UNSPECIFIED_LOCATION_ZONE) return layout
  const fromIndex = layout.routeGroups.findIndex((group) =>
    group.zonePrefixes.includes(prefix),
  )
  if (fromIndex < 0) return layout
  const targetIndex = fromIndex + direction
  const next = cloneLayout(layout)
  if (targetIndex < 0) {
    next.routeGroups.unshift({
      id: createInvoiceProductListRouteGroupId(),
      zonePrefixes: [],
    })
    return moveInvoiceProductListZonePrefix(next, prefix, next.routeGroups[0]!.id)
  }
  if (targetIndex >= next.routeGroups.length) {
    next.routeGroups.push({
      id: createInvoiceProductListRouteGroupId(),
      zonePrefixes: [],
    })
  }
  const target = next.routeGroups[Math.max(0, targetIndex)]
  if (!target) return layout
  return moveInvoiceProductListZonePrefix(
    next,
    prefix,
    target.id,
    direction > 0 ? 0 : target.zonePrefixes.length,
  )
}
