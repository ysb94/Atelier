import {
  buildOrderFingerprint,
  giftRecipientKey,
} from '@/lib/invoice/gift-assign'
import type { GiftDiversityClaim } from '@/lib/invoice/gift-diversity'
import { parseOrderQuantity } from '@/lib/invoice/option-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import { classifyLeadingTags } from '@/lib/invoice/product-name-tags'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceGiftSourceAllocation,
  InvoiceGiftSourceAssignmentMode,
  InvoiceGiftSourceMap,
  InvoiceProductNameTagRoleEntry,
  StyleRef,
} from '@/lib/types'

export type GiftSourceSessionRule = {
  assignmentMode: InvoiceGiftSourceAssignmentMode
  poolStyles: StyleRef[]
}

export type GiftSourceReplacement = {
  style: StyleRef
  quantity: number
}

export type GiftSourceGroupStatus = 'unset' | 'map_found' | 'assigned'

export type GiftSourceGroup = {
  key: string
  mallName: string
  productName: string
  rowCount: number
  quantitySum: number
  slotCount: number
  unassignedSlotCount: number
  recommendsBalancedRandom: boolean
  status: GiftSourceGroupStatus
  mapId: string | null
  assignmentMode: InvoiceGiftSourceAssignmentMode | null
  poolStyles: StyleRef[]
  assignedCounts: Array<{ style: StyleRef; count: number }>
  sourceRowNumbers: number[]
}

export type GiftSourceSlot = {
  allocationKey: string
  orderFingerprint: string
  quantitySlot: number
  occurrenceIndex: number
  source: SabangnetOrderRow
  groupKey: string
}

export type GiftSourceConfirmCandidate = {
  mapId: string
  styleId: string
  allocationKey: string
  orderFingerprint: string
  quantitySlot: number
  mallName: string
  customerOrderNo: string
  orderedAt: string
  isExisting: boolean
}

export type GiftSourcePlan = {
  groups: GiftSourceGroup[]
  slots: GiftSourceSlot[]
  replacementsByRow: Map<number, GiftSourceReplacement[]>
  pendingRowNumbers: Set<number>
  mappedRowNumbers: Set<number>
  candidateRowNumbers: Set<number>
  pendingGroupCount: number
  pendingRowCount: number
  mappedRowCount: number
  confirmCandidates: GiftSourceConfirmCandidate[]
}

const COLOR_RANDOM_RE = /컬러\s*랜덤|칼라\s*랜덤/

export function giftSourceGroupKey(mallName: string, productName: string) {
  return [
    normalizeInvoiceText(mallName),
    normalizeInvoiceText(productName),
  ].join('\u0000')
}

/** 활성 저장 매핑·세션 규칙·명시 적용 키를 합친 실제 적용 집합. */
export function effectiveGiftSourceAppliedKeys(options: {
  maps?: InvoiceGiftSourceMap[]
  sessionRules?: ReadonlyMap<string, GiftSourceSessionRule>
  appliedKeys?: ReadonlySet<string>
  ignoredKeys?: ReadonlySet<string>
}): Set<string> {
  const ignored = options.ignoredKeys
  const next = new Set<string>()
  for (const key of options.appliedKeys ?? []) {
    if (!ignored?.has(key)) next.add(key)
  }
  for (const key of options.sessionRules?.keys() ?? []) {
    if (!ignored?.has(key)) next.add(key)
  }
  for (const map of options.maps ?? []) {
    if (!map.isActive || map.poolStyles.length === 0) continue
    const key = giftSourceGroupKey(map.mallName, map.productName)
    if (ignored?.has(key)) continue
    next.add(key)
  }
  return next
}

export function recommendsGiftSourceBalancedRandom(productName: string) {
  return COLOR_RANDOM_RE.test(normalizeInvoiceText(productName))
}

export function fnv1a32Utf8(value: string): number {
  const bytes = new TextEncoder().encode(value)
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function isGiftSourceCandidate(
  row: Pick<SabangnetOrderRow, 'mallName' | 'productName'>,
  tagRoles: InvoiceProductNameTagRoleEntry[] = [],
  ignoredKeys?: ReadonlySet<string>,
) {
  const key = giftSourceGroupKey(row.mallName, row.productName)
  if (ignoredKeys?.has(key)) return false
  const tags = classifyLeadingTags(row.productName, tagRoles)
  if (tags.some((tag) => tag.role === 'composition_gift')) return true
  return tags.some((tag) => {
    const inner = tag.normalized.replace(/^[[\uFF3B]|[\uFF3D\]]$/g, '')
    return inner === '사은품' || inner === '증정'
  })
}

export function buildGiftSourceAllocationKey(options: {
  orderFingerprint: string
  mallName: string
  productName: string
  occurrenceIndex: number
  quantitySlot: number
}) {
  return [
    options.orderFingerprint,
    normalizeInvoiceText(options.mallName),
    normalizeInvoiceText(options.productName),
    String(options.occurrenceIndex),
    String(options.quantitySlot),
  ].join('\u001f')
}

export function giftSourceUniquenessGroup(row: SabangnetOrderRow) {
  return giftRecipientKey(row)
}

export function pickBalancedGiftSourceStyle(
  allocationKey: string,
  pool: StyleRef[],
  counts: Map<string, number>,
  excludeStyleIds?: ReadonlySet<string>,
) {
  const preferred =
    excludeStyleIds && excludeStyleIds.size > 0
      ? pool.filter((style) => !excludeStyleIds.has(style.styleId))
      : pool
  const usable = preferred.length > 0 ? preferred : pool
  let min = Number.POSITIVE_INFINITY
  const candidates: StyleRef[] = []
  for (const style of usable) {
    const count = counts.get(style.styleId) ?? 0
    if (count < min) {
      min = count
      candidates.length = 0
      candidates.push(style)
    } else if (count === min) {
      candidates.push(style)
    }
  }
  const sorted = [...candidates].sort((left, right) =>
    left.styleId.localeCompare(right.styleId),
  )
  const index = fnv1a32Utf8(allocationKey) % sorted.length
  return sorted[index]!
}

export function assignGiftSourceSlots(options: {
  slots: GiftSourceSlot[]
  assignmentMode: InvoiceGiftSourceAssignmentMode
  poolStyles: StyleRef[]
  existingByKey: ReadonlyMap<string, StyleRef>
  priorCounts?: ReadonlyMap<string, number>
}): Map<string, StyleRef> {
  const pool = uniqueStyles(options.poolStyles)
  if (pool.length === 0) return new Map()
  const counts = new Map<string, number>(options.priorCounts ?? [])
  for (const style of options.existingByKey.values()) {
    if (!counts.has(style.styleId)) counts.set(style.styleId, 0)
  }
  const usedByRecipient = new Map<string, Set<string>>()
  function usedOf(slot: GiftSourceSlot) {
    const key = giftRecipientKey(slot.source)
    const current = usedByRecipient.get(key) ?? new Set<string>()
    usedByRecipient.set(key, current)
    return current
  }
  for (const slot of options.slots) {
    const existing = options.existingByKey.get(slot.allocationKey)
    if (existing) usedOf(slot).add(existing.styleId)
  }
  const assigned = new Map<string, StyleRef>()
  const ordered = [...options.slots].sort((left, right) =>
    left.allocationKey.localeCompare(right.allocationKey),
  )
  for (const slot of ordered) {
    const existing = options.existingByKey.get(slot.allocationKey)
    if (existing) {
      assigned.set(slot.allocationKey, existing)
      continue
    }
    const used = usedOf(slot)
    const style =
      options.assignmentMode === 'fixed'
        ? pool[0]!
        : pickBalancedGiftSourceStyle(slot.allocationKey, pool, counts, used)
    assigned.set(slot.allocationKey, style)
    counts.set(style.styleId, (counts.get(style.styleId) ?? 0) + 1)
    used.add(style.styleId)
  }
  return assigned
}

function uniqueStyles(styles: StyleRef[]) {
  const byId = new Map<string, StyleRef>()
  for (const style of styles) {
    if (!byId.has(style.styleId)) byId.set(style.styleId, style)
  }
  return [...byId.values()]
}

function styleFromAllocation(
  allocation: InvoiceGiftSourceAllocation,
  pool: StyleRef[],
): StyleRef {
  return (
    pool.find((item) => item.styleId === allocation.styleId) ?? {
      styleId: allocation.styleId,
      styleNo: allocation.styleNo,
      name: allocation.styleName,
    }
  )
}

function rowsAreSortedByNumber(rows: SabangnetOrderRow[]) {
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index]!.rowNumber < rows[index - 1]!.rowNumber) return false
  }
  return true
}

export function collectGiftSourceSlots(
  rows: SabangnetOrderRow[],
  tagRoles: InvoiceProductNameTagRoleEntry[] = [],
  ignoredKeys?: ReadonlySet<string>,
  includeKeys?: ReadonlySet<string>,
): GiftSourceSlot[] {
  const occurrence = new Map<string, number>()
  const slots: GiftSourceSlot[] = []
  const ordered = rowsAreSortedByNumber(rows)
    ? rows
    : [...rows].sort((left, right) => left.rowNumber - right.rowNumber)
  for (const source of ordered) {
    const groupKey = giftSourceGroupKey(source.mallName, source.productName)
    const forced = includeKeys?.has(groupKey) ?? false
    if (!forced && !isGiftSourceCandidate(source, tagRoles, ignoredKeys)) {
      continue
    }
    const fingerprint = buildOrderFingerprint(source)
    const occurrenceKey = `${fingerprint}\u001f${groupKey}`
    const occurrenceIndex = (occurrence.get(occurrenceKey) ?? 0) + 1
    occurrence.set(occurrenceKey, occurrenceIndex)
    const quantity = parseOrderQuantity(source.quantity)
    for (let quantitySlot = 1; quantitySlot <= quantity; quantitySlot += 1) {
      slots.push({
        allocationKey: buildGiftSourceAllocationKey({
          orderFingerprint: fingerprint,
          mallName: source.mallName,
          productName: source.productName,
          occurrenceIndex,
          quantitySlot,
        }),
        orderFingerprint: fingerprint,
        quantitySlot,
        occurrenceIndex,
        source,
        groupKey,
      })
    }
  }
  return slots
}

function replacementsFromSlots(
  slots: GiftSourceSlot[],
  assigned: ReadonlyMap<string, StyleRef>,
) {
  const byRow = new Map<number, GiftSourceReplacement[]>()
  for (const slot of slots) {
    const style = assigned.get(slot.allocationKey)
    if (!style) continue
    const current = byRow.get(slot.source.rowNumber) ?? []
    const last = current[current.length - 1]
    if (last && last.style.styleId === style.styleId) {
      last.quantity += 1
    } else {
      current.push({ style, quantity: 1 })
    }
    byRow.set(slot.source.rowNumber, current)
  }
  return byRow
}

export type SourceGiftCollectResult = {
  claims: GiftDiversityClaim[]
  priorCounts: Map<string, number>
}

export function collectSourceGiftClaims(options: {
  rows: SabangnetOrderRow[]
  tagRoles?: InvoiceProductNameTagRoleEntry[]
  maps?: InvoiceGiftSourceMap[]
  allocations?: InvoiceGiftSourceAllocation[]
  sessionRules?: ReadonlyMap<string, GiftSourceSessionRule>
  sessionAllocations?: ReadonlyMap<string, StyleRef>
  ignoredKeys?: ReadonlySet<string>
  appliedKeys?: ReadonlySet<string>
  slots?: GiftSourceSlot[]
}): SourceGiftCollectResult {
  const tagRoles = options.tagRoles ?? []
  const ignoredKeys = options.ignoredKeys
  const appliedKeys = effectiveGiftSourceAppliedKeys({
    maps: options.maps,
    sessionRules: options.sessionRules,
    appliedKeys: options.appliedKeys,
    ignoredKeys,
  })
  const slots =
    options.slots ??
    collectGiftSourceSlots(
      options.rows,
      tagRoles,
      ignoredKeys,
      appliedKeys,
    )
  const maps = (options.maps ?? []).filter((map) => map.isActive)
  const mapByKey = new Map(
    maps.map((map) => [
      giftSourceGroupKey(map.mallName, map.productName),
      map,
    ]),
  )
  const allocationsByMap = new Map<string, InvoiceGiftSourceAllocation[]>()
  for (const allocation of options.allocations ?? []) {
    const list = allocationsByMap.get(allocation.mapId) ?? []
    list.push(allocation)
    allocationsByMap.set(allocation.mapId, list)
  }
  const priorCounts = new Map<string, number>()
  for (const allocation of options.allocations ?? []) {
    priorCounts.set(
      allocation.styleId,
      (priorCounts.get(allocation.styleId) ?? 0) + 1,
    )
  }
  const claims: GiftDiversityClaim[] = []
  const slotsByGroup = new Map<string, GiftSourceSlot[]>()
  for (const slot of slots) {
    const list = slotsByGroup.get(slot.groupKey) ?? []
    list.push(slot)
    slotsByGroup.set(slot.groupKey, list)
  }
  for (const [key, groupSlots] of slotsByGroup) {
    if (!appliedKeys.has(key)) continue
    const sessionRule = options.sessionRules?.get(key)
    const storedMap = mapByKey.get(key) ?? null
    const rule = sessionRule ??
      (storedMap
        ? {
            assignmentMode: storedMap.assignmentMode,
            poolStyles: storedMap.poolStyles,
          }
        : null)
    if (!rule || rule.poolStyles.length === 0) continue
    const existing = new Map<string, StyleRef>()
    if (sessionRule) {
      for (const slot of groupSlots) {
        const style = options.sessionAllocations?.get(slot.allocationKey)
        if (style) existing.set(slot.allocationKey, style)
      }
    } else if (storedMap) {
      for (const allocation of allocationsByMap.get(storedMap.id) ?? []) {
        existing.set(
          allocation.allocationKey,
          styleFromAllocation(allocation, storedMap.poolStyles),
        )
      }
    }
    const pool = uniqueStyles(rule.poolStyles)
    for (const slot of groupSlots) {
      const locked = existing.get(slot.allocationKey)
      const isFixed = rule.assignmentMode === 'fixed'
      const style = locked ?? (isFixed ? pool[0] : undefined)
      claims.push({
        id: `source:${slot.allocationKey}`,
        recipientKey: giftRecipientKey(slot.source),
        sortKey: slot.allocationKey,
        candidates: style ? [style] : pool,
        lockedStyle: style,
        isExisting: Boolean(locked),
        groupId: `source:${slot.allocationKey}`,
        skipUnit: 'claim',
      })
    }
  }
  return { claims, priorCounts }
}

export function planGiftSourceTransform(options: {
  rows: SabangnetOrderRow[]
  tagRoles?: InvoiceProductNameTagRoleEntry[]
  maps?: InvoiceGiftSourceMap[]
  allocations?: InvoiceGiftSourceAllocation[]
  sessionRules?: ReadonlyMap<string, GiftSourceSessionRule>
  sessionAllocations?: ReadonlyMap<string, StyleRef>
  ignoredKeys?: ReadonlySet<string>
  appliedKeys?: ReadonlySet<string>
  resolvedByAllocationKey?: ReadonlyMap<string, StyleRef>
  slots?: GiftSourceSlot[]
}): GiftSourcePlan {
  const tagRoles = options.tagRoles ?? []
  const ignoredKeys = options.ignoredKeys
  const appliedKeys = effectiveGiftSourceAppliedKeys({
    maps: options.maps,
    sessionRules: options.sessionRules,
    appliedKeys: options.appliedKeys,
    ignoredKeys,
  })
  const slots =
    options.slots ??
    collectGiftSourceSlots(
      options.rows,
      tagRoles,
      ignoredKeys,
      appliedKeys,
    )
  const slotsByGroup = new Map<string, GiftSourceSlot[]>()
  for (const slot of slots) {
    const list = slotsByGroup.get(slot.groupKey) ?? []
    list.push(slot)
    slotsByGroup.set(slot.groupKey, list)
  }

  const maps = (options.maps ?? []).filter((map) => map.isActive)
  const mapByKey = new Map(
    maps.map((map) => [
      giftSourceGroupKey(map.mallName, map.productName),
      map,
    ]),
  )
  const allocationsByMap = new Map<string, InvoiceGiftSourceAllocation[]>()
  for (const allocation of options.allocations ?? []) {
    const list = allocationsByMap.get(allocation.mapId) ?? []
    list.push(allocation)
    allocationsByMap.set(allocation.mapId, list)
  }

  const assigned = new Map<string, StyleRef>()
  const groups: GiftSourceGroup[] = []

  for (const [key, groupSlots] of [...slotsByGroup.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    const first = groupSlots[0]!
    const sessionRule = options.sessionRules?.get(key)
    const storedMap = mapByKey.get(key) ?? null
    const rule = sessionRule ??
      (storedMap
        ? {
            assignmentMode: storedMap.assignmentMode,
            poolStyles: storedMap.poolStyles,
          }
        : null)
    const existing = new Map<string, StyleRef>()
    if (sessionRule) {
      for (const slot of groupSlots) {
        const style = options.sessionAllocations?.get(slot.allocationKey)
        if (style) existing.set(slot.allocationKey, style)
      }
    } else if (storedMap) {
      const pool = storedMap.poolStyles
      for (const allocation of allocationsByMap.get(storedMap.id) ?? []) {
        existing.set(allocation.allocationKey, styleFromAllocation(allocation, pool))
      }
    }

    const shouldAssign = appliedKeys.has(key) && Boolean(rule)
    if (shouldAssign && rule) {
      if (options.resolvedByAllocationKey) {
        for (const slot of groupSlots) {
          const style =
            options.resolvedByAllocationKey.get(slot.allocationKey) ??
            existing.get(slot.allocationKey)
          if (style) assigned.set(slot.allocationKey, style)
        }
      } else {
        const priorCounts = new Map<string, number>()
        if (!sessionRule && storedMap) {
          for (const allocation of allocationsByMap.get(storedMap.id) ?? []) {
            priorCounts.set(
              allocation.styleId,
              (priorCounts.get(allocation.styleId) ?? 0) + 1,
            )
          }
        }
        const next = assignGiftSourceSlots({
          slots: groupSlots,
          assignmentMode: rule.assignmentMode,
          poolStyles: rule.poolStyles,
          existingByKey: existing,
          priorCounts,
        })
        for (const [allocationKey, style] of next) {
          assigned.set(allocationKey, style)
        }
      }
    }

    const assignedCounts = new Map<string, GiftSourceReplacement>()
    let assignedSlotCount = 0
    for (const slot of groupSlots) {
      const style = assigned.get(slot.allocationKey)
      if (!style) continue
      assignedSlotCount += 1
      const current = assignedCounts.get(style.styleId)
      if (current) current.quantity += 1
      else assignedCounts.set(style.styleId, { style, quantity: 1 })
    }

    const sourceRowNumbers = [
      ...new Set(groupSlots.map((slot) => slot.source.rowNumber)),
    ].sort((left, right) => left - right)
    const fullyAssigned =
      appliedKeys.has(key) &&
      assignedSlotCount === groupSlots.length &&
      groupSlots.length > 0
    const status: GiftSourceGroupStatus = fullyAssigned
      ? 'assigned'
      : storedMap && !sessionRule
        ? 'map_found'
        : 'unset'

    groups.push({
      key,
      mallName: first.source.mallName,
      productName: first.source.productName,
      rowCount: sourceRowNumbers.length,
      quantitySum: groupSlots.reduce(
        (sum, slot) => (slot.quantitySlot === 1 ? sum + parseOrderQuantity(slot.source.quantity) : sum),
        0,
      ),
      slotCount: groupSlots.length,
      unassignedSlotCount: groupSlots.length - assignedSlotCount,
      recommendsBalancedRandom: recommendsGiftSourceBalancedRandom(
        first.source.productName,
      ),
      status,
      mapId: storedMap?.id ?? null,
      assignmentMode: rule?.assignmentMode ?? storedMap?.assignmentMode ?? null,
      poolStyles: rule?.poolStyles ?? storedMap?.poolStyles ?? [],
      assignedCounts: [...assignedCounts.values()].map((item) => ({
        style: item.style,
        count: item.quantity,
      })),
      sourceRowNumbers,
    })
  }

  const replacementsByRow = replacementsFromSlots(slots, assigned)
  const appliedSlots = slots.filter((slot) => appliedKeys.has(slot.groupKey))
  const candidateRowNumbers = new Set(
    appliedSlots.map((slot) => slot.source.rowNumber),
  )
  const mappedRowNumbers = new Set(
    [...replacementsByRow.keys()].filter((rowNumber) => {
      const groupSlots = appliedSlots.filter(
        (slot) => slot.source.rowNumber === rowNumber,
      )
      return (
        groupSlots.length > 0 &&
        groupSlots.every((slot) => assigned.has(slot.allocationKey))
      )
    }),
  )
  const pendingRowNumbers = new Set(
    [...candidateRowNumbers].filter((rowNumber) => !mappedRowNumbers.has(rowNumber)),
  )

  const confirmCandidates: GiftSourceConfirmCandidate[] = []
  for (const slot of appliedSlots) {
    const style = assigned.get(slot.allocationKey)
    const storedMap = mapByKey.get(slot.groupKey)
    if (!style || !storedMap) continue
    const existing = (allocationsByMap.get(storedMap.id) ?? []).some(
      (allocation) => allocation.allocationKey === slot.allocationKey,
    )
    confirmCandidates.push({
      mapId: storedMap.id,
      styleId: style.styleId,
      allocationKey: slot.allocationKey,
      orderFingerprint: slot.orderFingerprint,
      quantitySlot: slot.quantitySlot,
      mallName: slot.source.mallName,
      customerOrderNo: slot.source.customerOrderNo,
      orderedAt: slot.source.orderedAt.trim(),
      isExisting: existing,
    })
  }

  return {
    groups,
    slots,
    replacementsByRow,
    pendingRowNumbers,
    mappedRowNumbers,
    candidateRowNumbers,
    pendingGroupCount: groups.filter(
      (group) => appliedKeys.has(group.key) && group.status !== 'assigned',
    ).length,
    pendingRowCount: pendingRowNumbers.size,
    mappedRowCount: mappedRowNumbers.size,
    confirmCandidates,
  }
}

export function collectGiftSourceSlotsForGroup(
  rows: SabangnetOrderRow[],
  mallName: string,
  productName: string,
) {
  const key = giftSourceGroupKey(mallName, productName)
  return collectGiftSourceSlots(rows, [], undefined, new Set([key])).filter(
    (slot) => slot.groupKey === key,
  )
}

export function inspectGiftSourceGroup(options: {
  rows: SabangnetOrderRow[]
  mallName: string
  productName: string
  tagRoles?: InvoiceProductNameTagRoleEntry[]
  maps?: InvoiceGiftSourceMap[]
  allocations?: InvoiceGiftSourceAllocation[]
  sessionRules?: ReadonlyMap<string, GiftSourceSessionRule>
  sessionAllocations?: ReadonlyMap<string, StyleRef>
  ignoredKeys?: ReadonlySet<string>
  appliedKeys?: ReadonlySet<string>
}): GiftSourceGroup {
  const key = giftSourceGroupKey(options.mallName, options.productName)
  const plan = planGiftSourceTransform({
    rows: options.rows,
    tagRoles: options.tagRoles,
    maps: options.maps,
    allocations: options.allocations,
    sessionRules: options.sessionRules,
    sessionAllocations: options.sessionAllocations,
    ignoredKeys: options.ignoredKeys,
    appliedKeys: options.appliedKeys,
  })
  const found = plan.groups.find((group) => group.key === key)
  if (found) return found

  const groupSlots = collectGiftSourceSlotsForGroup(
    options.rows,
    options.mallName,
    options.productName,
  )
  const storedMap =
    (options.maps ?? []).find(
      (map) =>
        map.isActive && giftSourceGroupKey(map.mallName, map.productName) === key,
    ) ?? null
  const sessionRule = options.sessionRules?.get(key) ?? null
  const sourceRowNumbers = [
    ...new Set(groupSlots.map((slot) => slot.source.rowNumber)),
  ].sort((left, right) => left - right)
  return {
    key,
    mallName: options.mallName,
    productName: options.productName,
    rowCount: sourceRowNumbers.length,
    quantitySum: groupSlots.reduce(
      (sum, slot) =>
        slot.quantitySlot === 1
          ? sum + parseOrderQuantity(slot.source.quantity)
          : sum,
      0,
    ),
    slotCount: groupSlots.length,
    unassignedSlotCount: groupSlots.length,
    recommendsBalancedRandom: recommendsGiftSourceBalancedRandom(
      options.productName,
    ),
    status: storedMap && !sessionRule ? 'map_found' : 'unset',
    mapId: storedMap?.id ?? null,
    assignmentMode:
      sessionRule?.assignmentMode ?? storedMap?.assignmentMode ?? null,
    poolStyles: sessionRule?.poolStyles ?? storedMap?.poolStyles ?? [],
    assignedCounts: [],
    sourceRowNumbers,
  }
}

export function emptyGiftSourcePlan(): GiftSourcePlan {
  return {
    groups: [],
    slots: [],
    replacementsByRow: new Map(),
    pendingRowNumbers: new Set(),
    mappedRowNumbers: new Set(),
    candidateRowNumbers: new Set(),
    pendingGroupCount: 0,
    pendingRowCount: 0,
    mappedRowCount: 0,
    confirmCandidates: [],
  }
}
