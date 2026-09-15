import { normalizeStyleNo } from '@/lib/import/transform'

export type UnloadStowKind = 'A' | 'B' | 'C'

export type UnloadStowInput = {
  key: string
  styleNo: string
  boxSum: number
  incomingBoxes: number
}

/** 9~16 A, 5~8 C, 그 이하 B */
export function classifyUnloadStowKind(boxSum: number): UnloadStowKind {
  if (boxSum >= 9) return 'A'
  if (boxSum >= 5) return 'C'
  return 'B'
}

export function compareUnloadStyleNo(left: string, right: string) {
  const a = normalizeStyleNo(left)
  const b = normalizeStyleNo(right)
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b, 'ko-KR', { numeric: true })
}

type StowSortKey = {
  kind: number
  pallet: number
  slot: number
}

/** A → C → B, 번호 오름차순. 빈 값은 맨 아래. */
function parseUnloadStowSortKey(label: string): StowSortKey | null {
  const value = label.trim()
  if (!value) return null
  const aOrC = value.match(/^([AC])(\d+)$/i)
  if (aOrC) {
    return {
      kind: aOrC[1].toUpperCase() === 'A' ? 0 : 1,
      pallet: Number(aOrC[2]),
      slot: 0,
    }
  }
  const b = value.match(/^(\d+)B(\d+)$/i)
  if (b) {
    return { kind: 2, pallet: Number(b[1]), slot: Number(b[2]) }
  }
  return { kind: 3, pallet: 0, slot: 0 }
}

export function compareUnloadStowLabel(left: string, right: string) {
  const a = parseUnloadStowSortKey(left)
  const b = parseUnloadStowSortKey(right)
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  if (a.kind !== b.kind) return a.kind - b.kind
  if (a.pallet !== b.pallet) return a.pallet - b.pallet
  return a.slot - b.slot
}

/**
 * A는 파렛트당 1종류(A1, A2).
 * C는 합이 비슷한 것끼리 2종류(C1 C1, C2 C2). 짝이 없으면 B.
 * B는 파렛트당 4종류(1B1~1B4, 2B1…).
 */
export function assignUnloadStowLabels(
  rows: UnloadStowInput[],
): Map<string, string> {
  const labels = new Map<string, string>()
  const aRows: UnloadStowInput[] = []
  const cRows: UnloadStowInput[] = []
  const bRows: UnloadStowInput[] = []

  for (const row of rows) {
    // 박스수가 없으면 다른 박스에 섞여 온 것이라 여기서 적재방식을 정하지 않는다.
    if (row.incomingBoxes <= 0) continue
    const kind = classifyUnloadStowKind(row.boxSum)
    if (kind === 'A') aRows.push(row)
    else if (kind === 'C') cRows.push(row)
    else bRows.push(row)
  }

  aRows.sort((left, right) => compareUnloadStyleNo(left.styleNo, right.styleNo))
  aRows.forEach((row, index) => {
    labels.set(row.key, `A${index + 1}`)
  })

  cRows.sort((left, right) => {
    if (left.boxSum !== right.boxSum) return left.boxSum - right.boxSum
    return compareUnloadStyleNo(left.styleNo, right.styleNo)
  })
  let cPallet = 1
  for (let index = 0; index < cRows.length; ) {
    const first = cRows[index]
    const second = cRows[index + 1]
    if (first && second) {
      labels.set(first.key, `C${cPallet}`)
      labels.set(second.key, `C${cPallet}`)
      cPallet += 1
      index += 2
      continue
    }
    if (first) bRows.push(first)
    break
  }

  bRows.sort((left, right) => compareUnloadStyleNo(left.styleNo, right.styleNo))
  bRows.forEach((row, index) => {
    const pallet = Math.floor(index / 4) + 1
    const slot = (index % 4) + 1
    labels.set(row.key, `${pallet}B${slot}`)
  })

  return labels
}
