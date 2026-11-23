import { Activity, useState, type ReactNode } from 'react'
import { FilterTabs, type FilterTab } from '@/components/ui/filter-tabs'
import { DraftMdOptionsProvider } from './DraftMdTeamCell'
import { DraftSheetColumnSettings } from './DraftSheetColumnSettings'
import { DraftSheetTable } from './DraftSheetTable'
import type { DraftSheetLayout } from './draft-sheet-layout'

export type DraftBoardMode = 'table' | 'card'

const viewTabs: FilterTab<DraftBoardMode>[] = [
  { value: 'table', label: '표 보기' },
  { value: 'card', label: '카드 보기' },
]

export function DraftBoardView({ layout, accountId, label, emptyMessage, tableNotice, renderRows }: {
  layout: DraftSheetLayout
  accountId?: string
  label: string
  emptyMessage?: string
  tableNotice?: ReactNode
  renderRows: (mode: DraftBoardMode) => ReactNode
}) {
  const [mode, setMode] = useState<DraftBoardMode>('table')
  const visibleColumns = layout.filter(column => column.visible).length

  return <>
    {mode === 'table' && tableNotice}
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      <FilterTabs tabs={viewTabs} value={mode} onChange={setMode} ariaLabel="기획안 보기 방식" />
      {mode === 'table' && <DraftSheetColumnSettings key={accountId} accountId={accountId} layout={layout} />}
    </div>
    <Activity mode={mode === 'table' ? 'visible' : 'hidden'}>
      <div className="draft-board-scroll" role="region" aria-label={label} tabIndex={0}>
        <DraftSheetTable layout={layout} caption="기획안별 샘플, 상품 정보 및 팀별 진행 현황">
          <DraftMdOptionsProvider><tbody>
            {emptyMessage ? <tr>
              <td colSpan={visibleColumns} className="bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </td>
            </tr> : renderRows('table')}
          </tbody></DraftMdOptionsProvider>
        </DraftSheetTable>
      </div>
    </Activity>
    {mode === 'card' && <div className="draft-cards-region" role="region" aria-label={label}>
      {emptyMessage
        ? <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        : <div className="draft-cards-grid">{renderRows('card')}</div>}
    </div>}
  </>
}
