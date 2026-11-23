import type { ReactNode } from 'react'
import { DEFAULT_DRAFT_SHEET_LAYOUT, DRAFT_SHEET_COLUMNS, type DraftSheetLayout } from './draft-sheet-layout'

export function DraftSheetTable({ layout = DEFAULT_DRAFT_SHEET_LAYOUT, caption, children }: {
  layout?: DraftSheetLayout
  caption?: string
  children: ReactNode
}) {
  const columns = layout.filter(column => column.visible)
  const minWidth = columns.reduce((total, { id }) => total + DRAFT_SHEET_COLUMNS[id].width, 0)
  return <table className="draft-board-table" style={{ minWidth }}>
    {caption && <caption className="sr-only">{caption}</caption>}
    <colgroup>{columns.map(({ id }) => <col key={id} className={`draft-column-${id}`}
      style={id === 'sample' ? undefined : { width: DRAFT_SHEET_COLUMNS[id].width }} />)}</colgroup>
    <thead>
      <tr>{columns.map(({ id }) => <th key={id} scope="col" className={`draft-column-${id}`}>{DRAFT_SHEET_COLUMNS[id].label}</th>)}</tr>
    </thead>
    {children}
  </table>
}
