import { useCallback, useMemo, useSyncExternalStore } from 'react'

export const DRAFT_SHEET_COLUMNS = {
  brand: { label: 'BRAND', width: 210 },
  sample: { label: 'SAMPLE', width: 350 },
  price: { label: 'PRICE', width: 100 },
  color: { label: 'COLOR', width: 160 },
  information: { label: 'INFORMATION', width: 300 },
  visual: { label: 'VISUAL TEAM', width: 290 },
  amd: { label: 'AMD', width: 255 },
  md: { label: 'MD TEAM', width: 585 },
  ect: { label: 'e.c.t', width: 265 },
} as const

export type DraftSheetColumnId = keyof typeof DRAFT_SHEET_COLUMNS
export type DraftSheetLayout = readonly { id: DraftSheetColumnId; visible: boolean }[]

export const DEFAULT_DRAFT_SHEET_LAYOUT: DraftSheetLayout =
  (Object.keys(DRAFT_SHEET_COLUMNS) as DraftSheetColumnId[]).map(id => ({ id, visible: true }))

const LAYOUT_CHANGED = 'atelier:draft-sheet-layout-changed'

function storageKey(accountId: string) {
  return `atelier:draft-sheet-layout:${accountId}`
}

function readLayout(raw: string | null): DraftSheetLayout {
  if (!raw) return DEFAULT_DRAFT_SHEET_LAYOUT
  try {
    const items: unknown = JSON.parse(raw)
    if (!Array.isArray(items)) return DEFAULT_DRAFT_SHEET_LAYOUT

    const remaining = new Set(DEFAULT_DRAFT_SHEET_LAYOUT.map(({ id }) => id))
    const layout: DraftSheetLayout = [
      ...items.flatMap((item: unknown) => {
        if (!item || typeof item !== 'object' || !('id' in item) || !('visible' in item)
          || typeof item.id !== 'string' || typeof item.visible !== 'boolean') return []
        const id = item.id as DraftSheetColumnId
        return remaining.delete(id) ? [{ id, visible: item.visible }] : []
      }),
      ...DEFAULT_DRAFT_SHEET_LAYOUT.filter(({ id }) => remaining.has(id)),
    ]
    if (layout.some(column => column.visible)) return layout
  } catch {
    // A malformed browser preference should leave the default table available.
  }
  return DEFAULT_DRAFT_SHEET_LAYOUT
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(LAYOUT_CHANGED, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(LAYOUT_CHANGED, onChange)
  }
}

function emptySnapshot() { return null }

export function useDraftSheetLayout(accountId: string | undefined) {
  const getSnapshot = useCallback(() => {
    try {
      return accountId ? window.localStorage.getItem(storageKey(accountId)) : null
    } catch {
      return null
    }
  }, [accountId])
  const raw = useSyncExternalStore(subscribe, getSnapshot, emptySnapshot)
  return useMemo(() => readLayout(raw), [raw])
}

export function saveDraftSheetLayout(accountId: string, layout: DraftSheetLayout) {
  try {
    window.localStorage.setItem(storageKey(accountId), JSON.stringify(layout))
  } catch {
    return false
  }
  window.dispatchEvent(new Event(LAYOUT_CHANGED))
  return true
}
