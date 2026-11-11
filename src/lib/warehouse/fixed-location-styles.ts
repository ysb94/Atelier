import type { StyleRef } from '@/lib/types'

export type FixedLocationSheetRow = {
  sheetRow: number
  productName: string
  location: string
}

export type FixedLocationRow = FixedLocationSheetRow & {
  styleId?: string
  styleNo?: string
  ambiguousStyle?: true
}

export function warehouseProductNameKey(name: string) {
  return name.trim().normalize('NFC')
}

export function linkFixedLocationStyles(
  rows: readonly FixedLocationSheetRow[],
  styles: readonly StyleRef[],
): FixedLocationRow[] {
  const byName = new Map<string, StyleRef | null>()
  for (const style of styles) {
    const name = warehouseProductNameKey(style.name)
    if (name) byName.set(name, byName.has(name) ? null : style)
  }

  return rows.map(({ sheetRow, productName, location }) => {
    const row = { sheetRow, productName, location }
    const match = byName.get(warehouseProductNameKey(productName))
    if (match === null) return { ...row, ambiguousStyle: true }
    if (!match || !match.styleNo.trim()) return row
    return { ...row, styleId: match.styleId, styleNo: match.styleNo.trim() }
  })
}
