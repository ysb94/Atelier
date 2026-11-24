import { Activity, useState, type ReactNode } from 'react'
import { FilterTabs, type FilterTab } from '@/components/ui/filter-tabs'
import { DraftMdOptionsProvider } from './DraftMdTeamCell'
import { DraftSheetColumnSettings } from './DraftSheetColumnSettings'
import { DraftSheetTable } from './DraftSheetTable'
import { moveDraftSheetColumn, saveDraftSheetLayout, type DraftSheetColumnId, type DraftSheetLayout } from './draft-sheet-layout'

export type DraftBoardMode = 'table' | 'card'

const viewTabs: FilterTab<DraftBoardMode>[] = [
  { value: 'table', label: '표 보기' },
  { value: 'card', label: '카드 보기' },
]

export function DraftBoardView({ layout, accountId, label, emptyMessage, folderControls, tableNotice, renderRows }: {
  layout: DraftSheetLayout
  accountId?: string
  label: string
  emptyMessage?: string
  folderControls?: ReactNode
  tableNotice?: ReactNode
  renderRows: (mode: DraftBoardMode) => ReactNode
}) {
  const [mode, setMode] = useState<DraftBoardMode>('table')
  const [layoutError, setLayoutError] = useState(false)
  const visibleColumns = layout.filter(column => column.visible).length

  function moveColumn(from: DraftSheetColumnId, target: DraftSheetColumnId, after: boolean) {
    if (!accountId) return
    const next = moveDraftSheetColumn(layout, from, target, after)
    if (next !== layout) setLayoutError(!saveDraftSheetLayout(accountId, next))
  }

  return <>
    <div role="group" aria-label="기획안 목록 도구" className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
      {folderControls && <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">{folderControls}</div>}
      <div className="ml-auto flex max-w-full flex-wrap items-center gap-1.5">
        <FilterTabs size="compact" tabs={viewTabs} value={mode} onChange={setMode} ariaLabel="기획안 보기 방식" />
        {mode === 'table' && <DraftSheetColumnSettings key={accountId} accountId={accountId} layout={layout} />}
      </div>
    </div>
    {mode === 'table' && tableNotice}
    {mode === 'table' && layoutError && <p role="alert" className="mb-2 text-right text-xs text-danger">브라우저에 열 순서를 저장하지 못했습니다.</p>}
    <Activity mode={mode === 'table' ? 'visible' : 'hidden'}>
      <div className="draft-board-scroll" role="region" aria-label={label} tabIndex={0}>
        <DraftSheetTable layout={layout} onMoveColumn={accountId ? moveColumn : undefined}
          caption="기획안별 샘플, 상품 정보 및 팀별 진행 현황">
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
