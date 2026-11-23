import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { DraftColorRow } from '@/lib/types'
import { DRAFT_VISUAL_INFORMATION_TABS, type DraftVisualInformationField } from './draft-information-tabs'
import { DraftTeamActions, DraftTeamNotice } from './DraftTeamActions'
import { matchesTeamColors, useDraftTeamSection, type DraftTeamWork } from './use-draft-team-work'
import { DraftVisualAssignees } from './DraftVisualAssignees'
import type { DraftVisualBoardRow } from './use-draft-visual-board'

const EMPTY_CODES = { sabangnet: '', barcode: '' }

export function DraftVisualAmdCells({ colors, readOnly, panelId, activeTrigger, onOpenVisualTab, teamWork, visualBoard }: {
  colors: DraftColorRow[]
  readOnly: boolean
  panelId: string
  activeTrigger: { colorId: string | null; field: DraftVisualInformationField } | null
  onOpenVisualTab: (anchor: HTMLButtonElement, colorId: string, field: DraftVisualInformationField) => void
  teamWork: DraftTeamWork
  visualBoard: DraftVisualBoardRow
}) {
  const amd = useDraftTeamSection(teamWork, 'amd', { collection: '', colors: {} }, readOnly)
  const confirmed = amd.confirmed && matchesTeamColors(amd.value.colors, colors)
  const locked = amd.locked || confirmed || amd.conflict

  function changeCode(colorId: string, code: keyof typeof EMPTY_CODES, value: string) {
    amd.change(previous => ({ ...previous, colors: {
      ...previous.colors, [colorId]: { ...(previous.colors[colorId] ?? EMPTY_CODES), [code]: value },
    } }))
  }

  return <>
    <td className="draft-sheet-visual-cell">
      <DraftVisualAssignees board={visualBoard} readOnly={readOnly} />
      <div className="draft-color-lines">
        {colors.map((color, index) => {
          const name = color.name.trim() || `컬러 ${index + 1}`
          return <div key={color.id} className={`draft-color-line${index % 2 ? ' is-alt' : ''}`}>
            {DRAFT_VISUAL_INFORMATION_TABS.map(({ field, label }) => {
              const expanded = activeTrigger?.colorId === color.id && activeTrigger.field === field
              const temporary = (field === 'image' ? visualBoard.status?.temporary_images : visualBoard.status?.temporary_html)?.includes(color.id)
              const saved = (field === 'image' ? visualBoard.status?.saved_images : visualBoard.status?.saved_html)?.includes(color.id)
              const tone = temporary ? 'is-editing' : saved ? 'is-done' : 'is-neutral'
              const statusText = temporary ? '임시저장됨' : saved ? '저장됨' : undefined
              return <Button key={field} type="button" variant="outline" size="sm" className={cn('draft-team-control draft-information-action', tone)}
                aria-label={`${name} ${label}`} aria-haspopup="dialog" aria-expanded={expanded}
                aria-description={statusText} title={statusText}
                aria-controls={expanded ? panelId : undefined} onClick={event => onOpenVisualTab(event.currentTarget, color.id, field)}>
                {label}
              </Button>
            })}
            {index === 0 && <Button type="button" variant="outline" size="sm" className="draft-team-control draft-team-confirm"
              aria-label="비주얼 팀 확정" disabled>확정</Button>}
          </div>
        })}
      </div>
    </td>
    <td className="draft-sheet-amd-cell">
      <div className="draft-color-pad draft-amd-header">
        <label className="draft-amd-entry">
          <Input className="draft-team-control" aria-label="모음전 번호" placeholder="모음전 no." autoComplete="off"
            value={amd.value.collection} maxLength={80} disabled={locked} onChange={event => {
              const collection = event.currentTarget.value
              amd.change(previous => ({ ...previous, collection }))
            }} />
        </label>
        <DraftTeamActions label="AMD" className="ml-auto" locked={amd.locked} confirmed={confirmed}
          editing={amd.editing} busy={amd.busy} conflict={amd.conflict} onReset={amd.reset}
          onEdit={() => amd.change(value => value)} onSave={confirm => void amd.save(confirm, {
            collection: amd.value.collection,
            colors: Object.fromEntries(colors.map(color => [color.id, amd.value.colors[color.id] ?? EMPTY_CODES])),
          })} />
      </div>
      <div className="draft-color-lines">
        {colors.map((color, index) => {
          const name = color.name.trim() || `컬러 ${index + 1}`
          const codes = amd.value.colors[color.id] ?? EMPTY_CODES
          return <div key={color.id} className={`draft-color-line${index % 2 ? ' is-alt' : ''}`}>
            <label className="draft-amd-entry">
              <Input className="draft-team-control" aria-label={`${name} 사방넷 번호`} placeholder="사방넷 no."
                autoComplete="off" maxLength={80} disabled={locked} value={codes.sabangnet}
                onChange={event => changeCode(color.id, 'sabangnet', event.currentTarget.value)} />
            </label>
            <label className="draft-amd-entry">
              <Input className="draft-team-control" aria-label={`${name} 바코드 번호`} placeholder="바코드 no."
                inputMode="numeric" autoComplete="off" maxLength={80} disabled={locked} value={codes.barcode}
                onChange={event => changeCode(color.id, 'barcode', event.currentTarget.value)} />
            </label>
          </div>
        })}
      </div>
      <DraftTeamNotice error={amd.error} conflict={amd.conflict} />
    </td>
  </>
}
