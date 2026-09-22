import type { SheetRow } from './SheetTable'

export type SheetSortDirection = 'asc' | 'desc'

export type SheetSort = {
  key: string
  direction: SheetSortDirection
}

export function isSheetCellBlank(row: SheetRow, key: string): boolean {
  return (row.values[key] ?? '').trim().length === 0
}

/** 빈 칸은 방향과 상관없이 뒤로 보내고, 숫자·한글이 섞여도 자연스럽게 비교한다. */
export function compareSheetRows(
  left: SheetRow,
  right: SheetRow,
  sort: SheetSort,
): number {
  const leftText = (left.values[sort.key] ?? '').trim()
  const rightText = (right.values[sort.key] ?? '').trim()
  const leftEmpty = leftText.length === 0
  const rightEmpty = rightText.length === 0
  if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1

  let result = leftText.localeCompare(rightText, 'ko', {
    numeric: true,
    sensitivity: 'base',
  })
  if (result === 0) {
    result = left.styleNo.localeCompare(right.styleNo, 'en', { numeric: true })
  }
  if (result === 0) result = left.id.localeCompare(right.id)
  return sort.direction === 'asc' ? result : -result
}

export function timeDataSheet<T>(name: string, fn: () => T): T {
  const start = performance.now()
  const result = fn()
  const elapsed = Math.round(performance.now() - start)
  const path = `${location.pathname}${location.search}`
  if (elapsed >= 1000) {
    console.warn('[data-sheet]', name, `${elapsed}ms`, { path })
  } else if (elapsed >= 200) {
    console.info('[data-sheet]', name, `${elapsed}ms`, { path })
  }
  return result
}
