import type { DraftColorRow } from '../types'

export function isColorSampleOrdered(draft: {
  orderInProgress?: boolean
  orderDone?: boolean
}) {
  return Boolean(draft.orderInProgress || draft.orderDone)
}

export function isColorSampleReadyForPhoto(draft: {
  orderInProgress?: boolean
  orderDone?: boolean
  photoSampleDone?: boolean
}) {
  return isColorSampleOrdered(draft) && !draft.photoSampleDone
}

export function startColorSamples(colors: DraftColorRow[]) {
  return colors.map((color) =>
    color.name.trim() ? { ...color, sampleInProgress: true } : color,
  )
}

export function sanitizeColorWorkOrder(color: DraftColorRow): DraftColorRow {
  const url = color.sampleWorkOrderUrl?.trim() || null
  const shipped = Boolean(url && color.sampleWorkOrderShipped)
  return {
    ...color,
    sampleWorkOrderUrl: url,
    sampleWorkOrderName: url ? (color.sampleWorkOrderName?.trim() ?? '') : '',
    sampleWorkOrderShipped: shipped,
    sampleWorkOrderShippedAt: shipped
      ? (color.sampleWorkOrderShippedAt ?? new Date().toISOString())
      : null,
    sampleInProgress: Boolean(color.sampleInProgress || url),
  }
}

export function colorWorkOrderFileName(color: DraftColorRow) {
  return (
    color.sampleWorkOrderName.trim() ||
    `${color.name.trim() || '컬러'} 샘플 작업 지시서`
  )
}

export function filledColorWorkOrders(colors: readonly DraftColorRow[]) {
  return colors.filter((color) => Boolean(color.sampleWorkOrderUrl?.trim()))
}

export function setColorWorkOrderShipped(
  colors: DraftColorRow[],
  colorId: string,
  shipped: boolean,
  at = new Date().toISOString(),
) {
  return colors.map((color) =>
    color.id === colorId
      ? {
          ...color,
          sampleWorkOrderShipped: shipped,
          sampleWorkOrderShippedAt: shipped
            ? (color.sampleWorkOrderShippedAt ?? at)
            : null,
        }
      : color,
  )
}
