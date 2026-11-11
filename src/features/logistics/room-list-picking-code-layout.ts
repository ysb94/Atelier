import type { CSSProperties } from 'react'

const CODE_FIELDS = ['styleNo', 'location', 'nextLocation'] as const
export type PickingCodeField = typeof CODE_FIELDS[number]
export type PickingPrintColumns = '1' | '2'

export type PickingCodeLayout = {
  columnWidths: CSSProperties
  fontSizes: Map<PickingCodeField, Map<string, number>>
}

export function measurePickingCodes(sheet: HTMLElement, columns: PickingPrintColumns): PickingCodeLayout {
  const table = sheet.querySelector('table')
  if (!table) return { columnWidths: {}, fontSizes: new Map() }
  const tableWidth = table.getBoundingClientRect().width
  const tableColumns = table.querySelectorAll('col')
  const cell = table.querySelector('th')!
  const cellStyle = getComputedStyle(cell)
  // Include padding, borders, and a small allowance for print rounding.
  const cellInset = parseFloat(cellStyle.paddingLeft) + parseFloat(cellStyle.paddingRight)
    + parseFloat(cellStyle.borderLeftWidth) + parseFloat(cellStyle.borderRightWidth) + 1

  const widths = CODE_FIELDS.map((field, index) => {
    const minimum = tableColumns[index === 2 ? 4 : index].getBoundingClientRect().width
    const textWidths = new Map<string, number>()
    let desired = minimum
    for (const code of sheet.querySelectorAll<HTMLElement>(`[data-picking-code="${field}"]`)) {
      const text = code.textContent ?? ''
      if (textWidths.has(text)) continue
      const width = code.getBoundingClientRect().width
      textWidths.set(text, width)
      desired = Math.max(desired, width + cellInset)
    }
    return { field, minimum, desired, textWidths }
  })

  // Let long codes borrow room from the product name while keeping that column usable.
  const minimumTotal = widths.reduce((total, { minimum }) => total + minimum, 0)
  const requestedGrowth = widths.reduce((total, { minimum, desired }) => total + desired - minimum, 0)
  const growthBudget = Math.max(0, tableWidth * (columns === '2' ? .66 : .55) - minimumTotal)
  const growth = requestedGrowth > growthBudget ? growthBudget / requestedGrowth : 1
  const fontSize = parseFloat(getComputedStyle(table).fontSize)
  const columnWidths = Object.fromEntries(widths.map(({ field, minimum, desired }) => {
    const width = minimum + (desired - minimum) * growth
    sheet.style.setProperty(`--room-list-${field}-width`, `${width}px`)
    return [`--room-list-${field}-width`, `${width}px`]
  })) as CSSProperties
  const fontSizes = new Map<PickingCodeField, Map<string, number>>()
  for (const { field, minimum, desired, textWidths } of widths) {
    const available = minimum + (desired - minimum) * growth - cellInset
    const fitted = new Map<string, number>()
    for (const [text, width] of textWidths) {
      if (width > available) fitted.set(text, fontSize * available / width)
    }
    fontSizes.set(field, fitted)
  }
  return { columnWidths, fontSizes }
}
