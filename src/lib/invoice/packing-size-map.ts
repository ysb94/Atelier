import type {
  InvoicePackingSizeMap,
  InvoicePackingSizeSourceValue,
} from '@/lib/types'

export const PACKING_SIZE_SOURCE_FIELD_LABEL = '택배 포장 규격(단품)'

export type InvoicePackingSizeEditorRow = {
  normalizedSourceValue: string
  sourceValue: string
  styleCount: number
  displayValue: string
  savedDisplayValue: string
  mapId: string | null
  isCurrent: boolean
}

export type InvoicePackingSizeMapInput = {
  sourceValue: string
  displayValue: string
}

/** DB app.normalize_select_label과 같은 포장 규격 비교 키. */
export function normalizePackingSizeValue(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ko-KR')
}

export function packingSizeHasDisplayValue(value: string) {
  return Boolean(value.trim())
}

function compareSourceValue(
  left: InvoicePackingSizeEditorRow,
  right: InvoicePackingSizeEditorRow,
) {
  const leftMapped = packingSizeHasDisplayValue(left.savedDisplayValue)
  const rightMapped = packingSizeHasDisplayValue(right.savedDisplayValue)
  if (leftMapped !== rightMapped) return leftMapped ? 1 : -1
  if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1
  return left.sourceValue.localeCompare(right.sourceValue, 'ko-KR', {
    numeric: true,
    sensitivity: 'base',
  })
}

/**
 * 현재 데이터의 고유값과 저장된 과거 매핑을 합친다.
 * 데이터에서 사라진 원문도 사용 수 0으로 남겨 설정이 조용히 유실되지 않게 한다.
 */
export function mergeInvoicePackingSizeRows(
  sources: InvoicePackingSizeSourceValue[],
  maps: InvoicePackingSizeMap[],
): InvoicePackingSizeEditorRow[] {
  const mapByKey = new Map(
    maps.map((map) => [map.normalizedSourceValue, map]),
  )
  const rows = new Map<string, InvoicePackingSizeEditorRow>()

  for (const source of sources) {
    const key =
      source.normalizedSourceValue ||
      normalizePackingSizeValue(source.sourceValue)
    if (!key) continue
    const saved = mapByKey.get(key)
    rows.set(key, {
      normalizedSourceValue: key,
      sourceValue: source.sourceValue.trim(),
      styleCount: Math.max(0, source.styleCount),
      displayValue: saved?.displayValue ?? '',
      savedDisplayValue: saved?.displayValue ?? '',
      mapId: saved?.id ?? null,
      isCurrent: true,
    })
  }

  for (const map of maps) {
    const key =
      map.normalizedSourceValue || normalizePackingSizeValue(map.sourceValue)
    if (!key || rows.has(key)) continue
    rows.set(key, {
      normalizedSourceValue: key,
      sourceValue: map.sourceValue.trim(),
      styleCount: 0,
      displayValue: map.displayValue,
      savedDisplayValue: map.displayValue,
      mapId: map.id,
      isCurrent: false,
    })
  }

  return [...rows.values()].sort(compareSourceValue)
}

export function packingSizeMapChanges(
  rows: InvoicePackingSizeEditorRow[],
  drafts: Record<string, string>,
): InvoicePackingSizeMapInput[] {
  const changes: InvoicePackingSizeMapInput[] = []
  for (const row of rows) {
    const displayValue = (
      drafts[row.normalizedSourceValue] ?? row.displayValue
    ).trim()
    if (displayValue === row.savedDisplayValue.trim()) continue
    changes.push({
      sourceValue: row.sourceValue,
      displayValue,
    })
  }
  return changes
}
