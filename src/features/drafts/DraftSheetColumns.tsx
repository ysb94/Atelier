const columns = [
  { id: 'brand', label: 'BRAND' },
  { id: 'sample', label: 'SAMPLE' },
  { id: 'price', label: 'PRICE' },
  { id: 'color', label: 'COLOR' },
  { id: 'information', label: 'INFORMATION' },
  { id: 'visual', label: 'VISUAL TEAM' },
  { id: 'amd', label: 'AMD' },
  { id: 'md', label: 'MD TEAM' },
  { id: 'ect', label: 'e.c.t' },
] as const

export const DRAFT_SHEET_COLUMN_COUNT = columns.length

export function DraftSheetColumns() {
  return <>
    <colgroup>{columns.map(({ id }) => <col key={id} className={`draft-column-${id}`} />)}</colgroup>
    <thead>
      <tr>{columns.map(({ id, label }) => <th key={id} scope="col" className={`draft-column-${id}`}>{label}</th>)}</tr>
    </thead>
  </>
}
