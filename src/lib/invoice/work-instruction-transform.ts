import { shipmentKeyOf, orderKeyOf } from '@/lib/invoice/gift-assign'
import {
  normalizeInvoiceText,
  nowMoment,
  orderMomentOf,
} from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceGiftRequestStatus,
  InvoiceWorkInstruction,
  InvoiceWorkInstructionCountBasis,
  InvoiceWorkInstructionMatchMode,
  StyleRef,
} from '@/lib/types'

export type WorkInstructionMatch = {
  instructionId: string
  instructionTitle: string
  labelText: string
  itemId: string
}

export type WorkInstructionConflict = {
  productName: string
  rowCount: number
  candidates: { instructionId: string; instructionTitle: string }[]
}

export type WorkInstructionPlan = {
  matchByRowNumber: Map<number, WorkInstructionMatch>
  matchedRowCount: number
  unusedProductNames: {
    instructionId: string
    instructionTitle: string
    productName: string
  }[]
  conflicts: WorkInstructionConflict[]
  outOfPeriodRowCount: number
  undatedRowCount: number
  fileFirstMoment: string | null
  fileLastMoment: string | null
  periodMisses: {
    instructionId: string
    instructionTitle: string
    startsAt: string
    endsAt: string
    nameMatchedRowCount: number
  }[]
  materialTotals: {
    styleId: string
    styleNo: string
    name: string
    count: number
    instructionTitles: string[]
  }[]
}

type IndexedItem = {
  instruction: InvoiceWorkInstruction
  itemId: string
  itemKey: string
  productName: string
}

function productKey(value: string): string {
  return normalizeInvoiceText(value)
}

function matchModeOf(
  instruction: InvoiceWorkInstruction,
): InvoiceWorkInstructionMatchMode {
  return instruction.matchMode === 'prefix' ? 'prefix' : 'exact'
}

function hasPeriod(instruction: InvoiceWorkInstruction): boolean {
  return Boolean(instruction.startsAt && instruction.endsAt)
}

function instructionApplies(
  instruction: InvoiceWorkInstruction,
  orderMoment: string | null,
): boolean {
  if (!instruction.isActive) return false
  if (!hasPeriod(instruction)) return true
  if (!orderMoment) return false
  return (
    orderMoment >= instruction.startsAt! && orderMoment <= instruction.endsAt!
  )
}

function instructionOverlapsFile(
  instruction: InvoiceWorkInstruction,
  firstMoment: string | null,
  lastMoment: string | null,
): boolean {
  if (!instruction.isActive) return false
  if (!hasPeriod(instruction) || !firstMoment || !lastMoment) return true
  return !(
    instruction.endsAt! < firstMoment || instruction.startsAt! > lastMoment
  )
}

function pickHit(hits: IndexedItem[]): IndexedItem | null {
  if (hits.length === 0) return null
  if (hits.length === 1) return hits[0] ?? null
  const dated = hits.filter((hit) => hasPeriod(hit.instruction))
  if (dated.length === 1) return dated[0] ?? null
  return null
}

function pickLongestPrefix(hits: IndexedItem[]): IndexedItem | null {
  if (hits.length === 0) return null
  let maxLen = 0
  for (const hit of hits) {
    if (hit.itemKey.length > maxLen) maxLen = hit.itemKey.length
  }
  return pickHit(hits.filter((hit) => hit.itemKey.length === maxLen))
}

function prefixHitsFor(rowKey: string, prefixes: IndexedItem[]): IndexedItem[] {
  return prefixes.filter((hit) => rowKey.startsWith(hit.itemKey))
}

export function invoiceWorkInstructionStatus(
  instruction: InvoiceWorkInstruction,
  now = nowMoment(),
): InvoiceGiftRequestStatus {
  if (!instruction.isActive) return 'paused'
  if (!hasPeriod(instruction)) return 'running'
  if (now < instruction.startsAt!) return 'scheduled'
  if (now > instruction.endsAt!) return 'ended'
  return 'running'
}

function parseQuantity(value: string): number {
  const parsed = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return Math.floor(parsed)
}

function countMaterials(
  rows: SabangnetOrderRow[],
  countBasis: InvoiceWorkInstructionCountBasis,
): number {
  if (rows.length === 0) return 0
  if (countBasis === 'per_shipment') {
    return new Set(rows.map((row) => shipmentKeyOf(row))).size
  }
  if (countBasis === 'per_quantity') {
    return rows.reduce((sum, row) => sum + parseQuantity(row.quantity), 0)
  }
  if (countBasis === 'per_row') return rows.length
  return new Set(rows.map((row) => orderKeyOf(row))).size
}

function addMaterialTotals(
  totals: Map<
    string,
    {
      styleId: string
      styleNo: string
      name: string
      count: number
      instructionTitles: Set<string>
    }
  >,
  products: StyleRef[],
  count: number,
  instructionTitle: string,
) {
  if (count <= 0) return
  for (const ref of products) {
    const current = totals.get(ref.styleId) ?? {
      styleId: ref.styleId,
      styleNo: ref.styleNo,
      name: ref.name,
      count: 0,
      instructionTitles: new Set<string>(),
    }
    current.count += count
    current.instructionTitles.add(instructionTitle)
    totals.set(ref.styleId, current)
  }
}

function filePeriod(rows: SabangnetOrderRow[]): {
  first: string | null
  last: string | null
} {
  let first: string | null = null
  let last: string | null = null
  for (const row of rows) {
    const moment = orderMomentOf(row)
    if (!moment) continue
    if (!first || moment < first) first = moment
    if (!last || moment > last) last = moment
  }
  return { first, last }
}

/**
 * 활성 작업 지시를 원본 품목명으로 찾는다.
 * exact는 완전일치, prefix는 정규화한 뒤 등록 글자로 시작할 때만 맞춘다.
 * 완전일치가 시작어보다 앞선다. 시작어끼리는 더 긴 쪽이 이긴다.
 * 기간 있는 지시가 항상 지시보다 앞선다. 같은 순위가 둘 이상이면 충돌이다.
 */
export function planWorkInstructions(
  rows: SabangnetOrderRow[],
  instructions: InvoiceWorkInstruction[],
): WorkInstructionPlan {
  const { first, last } = filePeriod(rows)
  const active = instructions.filter((item) => item.isActive)
  const exactByProduct = new Map<string, IndexedItem[]>()
  const prefixItems: IndexedItem[] = []

  for (const instruction of active) {
    const mode = matchModeOf(instruction)
    for (const item of instruction.items) {
      const key = productKey(item.productName)
      if (!key) continue
      const indexed: IndexedItem = {
        instruction,
        itemId: item.id,
        itemKey: key,
        productName: item.productName,
      }
      if (mode === 'prefix') {
        prefixItems.push(indexed)
        continue
      }
      const list = exactByProduct.get(key) ?? []
      list.push(indexed)
      exactByProduct.set(key, list)
    }
  }

  const matchByRowNumber = new Map<number, WorkInstructionMatch>()
  const usedKeys = new Set<string>()
  const conflictByKey = new Map<string, WorkInstructionConflict>()
  const nameMatchedByInstruction = new Map<string, number>()
  let outOfPeriodRowCount = 0
  let undatedRowCount = 0

  function recordMatch(rowNumber: number, chosen: IndexedItem) {
    usedKeys.add(`${chosen.instruction.id}\u0000${chosen.itemKey}`)
    matchByRowNumber.set(rowNumber, {
      instructionId: chosen.instruction.id,
      instructionTitle: chosen.instruction.title,
      labelText: chosen.instruction.labelText,
      itemId: chosen.itemId,
    })
  }

  function recordConflict(rowKey: string, productName: string, hits: IndexedItem[]) {
    const existing = conflictByKey.get(rowKey)
    if (existing) {
      existing.rowCount += 1
      return
    }
    const unique = new Map<string, string>()
    for (const hit of hits) {
      unique.set(hit.instruction.id, hit.instruction.title)
    }
    conflictByKey.set(rowKey, {
      productName,
      rowCount: 1,
      candidates: [...unique].map(([instructionId, instructionTitle]) => ({
        instructionId,
        instructionTitle,
      })),
    })
  }

  function chooseHits(hits: IndexedItem[], preferLongest: boolean) {
    return preferLongest ? pickLongestPrefix(hits) : pickHit(hits)
  }

  for (const row of rows) {
    const key = productKey(row.productName)
    if (!key) continue
    const exact = exactByProduct.get(key) ?? []
    const prefixes = prefixHitsFor(key, prefixItems)
    if (exact.length === 0 && prefixes.length === 0) continue

    const orderMoment = orderMomentOf(row)
    const counted = new Set<string>()
    for (const hit of [...exact, ...prefixes]) {
      if (counted.has(hit.instruction.id)) continue
      counted.add(hit.instruction.id)
      nameMatchedByInstruction.set(
        hit.instruction.id,
        (nameMatchedByInstruction.get(hit.instruction.id) ?? 0) + 1,
      )
    }

    if (!orderMoment) {
      const needsDate =
        exact.some((hit) => hasPeriod(hit.instruction)) ||
        prefixes.some((hit) => hasPeriod(hit.instruction))
      if (needsDate) undatedRowCount += 1
      const exactAlways = exact.filter((hit) => !hasPeriod(hit.instruction))
      if (exactAlways.length > 0) {
        const chosen = chooseHits(exactAlways, false)
        if (chosen) recordMatch(row.rowNumber, chosen)
        else recordConflict(key, row.productName, exactAlways)
        continue
      }
      const prefixAlways = prefixes.filter((hit) => !hasPeriod(hit.instruction))
      if (prefixAlways.length === 0) continue
      const chosen = chooseHits(prefixAlways, true)
      if (chosen) recordMatch(row.rowNumber, chosen)
      else recordConflict(key, row.productName, prefixAlways)
      continue
    }

    const exactHits = exact.filter((hit) =>
      instructionApplies(hit.instruction, orderMoment),
    )
    if (exactHits.length > 0) {
      const chosen = chooseHits(exactHits, false)
      if (chosen) recordMatch(row.rowNumber, chosen)
      else recordConflict(key, row.productName, exactHits)
      continue
    }

    const prefixHits = prefixes.filter((hit) =>
      instructionApplies(hit.instruction, orderMoment),
    )
    if (prefixHits.length > 0) {
      const chosen = chooseHits(prefixHits, true)
      if (chosen) recordMatch(row.rowNumber, chosen)
      else recordConflict(key, row.productName, prefixHits)
      continue
    }

    outOfPeriodRowCount += 1
  }

  const unusedProductNames: WorkInstructionPlan['unusedProductNames'] = []
  const periodMisses: WorkInstructionPlan['periodMisses'] = []
  for (const instruction of active) {
    const overlaps = instructionOverlapsFile(instruction, first, last)
    if (!overlaps && hasPeriod(instruction)) {
      periodMisses.push({
        instructionId: instruction.id,
        instructionTitle: instruction.title,
        startsAt: instruction.startsAt!,
        endsAt: instruction.endsAt!,
        nameMatchedRowCount: nameMatchedByInstruction.get(instruction.id) ?? 0,
      })
      continue
    }
    for (const item of instruction.items) {
      const key = productKey(item.productName)
      if (!key) continue
      if (usedKeys.has(`${instruction.id}\u0000${key}`)) continue
      unusedProductNames.push({
        instructionId: instruction.id,
        instructionTitle: instruction.title,
        productName: item.productName,
      })
    }
  }

  unusedProductNames.sort((left, right) =>
    left.productName.localeCompare(right.productName, 'ko-KR'),
  )

  const matchedRowsByInstruction = new Map<string, SabangnetOrderRow[]>()
  for (const row of rows) {
    const match = matchByRowNumber.get(row.rowNumber)
    if (!match) continue
    const list = matchedRowsByInstruction.get(match.instructionId) ?? []
    list.push(row)
    matchedRowsByInstruction.set(match.instructionId, list)
  }

  const materialMap = new Map<
    string,
    {
      styleId: string
      styleNo: string
      name: string
      count: number
      instructionTitles: Set<string>
    }
  >()
  for (const instruction of active) {
    const matched = matchedRowsByInstruction.get(instruction.id) ?? []
    const count = countMaterials(
      matched,
      instruction.countBasis ?? 'per_shipment',
    )
    addMaterialTotals(
      materialMap,
      instruction.outgoingProducts ?? [],
      count,
      instruction.title,
    )
  }

  const materialTotals = [...materialMap.values()]
    .map((item) => ({
      styleId: item.styleId,
      styleNo: item.styleNo,
      name: item.name,
      count: item.count,
      instructionTitles: [...item.instructionTitles],
    }))
    .sort((left, right) => left.styleNo.localeCompare(right.styleNo, 'ko-KR'))

  return {
    matchByRowNumber,
    matchedRowCount: matchByRowNumber.size,
    unusedProductNames,
    conflicts: [...conflictByKey.values()],
    outOfPeriodRowCount,
    undatedRowCount,
    fileFirstMoment: first,
    fileLastMoment: last,
    periodMisses,
    materialTotals,
  }
}

/** 표시 문구를 최종 품목명 앞에 붙인다. 이미 붙어 있으면 중복하지 않는다. */
export function applyWorkInstructionLabel(
  labelText: string,
  productName: string,
): string {
  const label = labelText.trim()
  const name = productName.trim()
  if (!label) return name
  if (!name) return label
  if (name.startsWith(label)) return name
  return `${label} ${name}`.replace(/\s+/g, ' ').trim()
}
