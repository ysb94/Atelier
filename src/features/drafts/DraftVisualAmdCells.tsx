import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DraftColorRow } from '@/lib/types'
import { DRAFT_VISUAL_INFORMATION_TABS, type DraftVisualInformationField } from './draft-information-tabs'
import { DraftAmdCell } from './DraftAmdCell'
import type { DraftTeamWork } from './use-draft-team-work'
import { DraftVisualAssignees } from './DraftVisualAssignees'
import type { DraftVisualBoardRow } from './use-draft-visual-board'

export function DraftVisualAmdCells({ colors, colorPhotos, readOnly, panelId, activeTrigger, onOpenVisualTab, teamWork, visualBoard }: {
  colors: DraftColorRow[]
  colorPhotos?: Readonly<Record<string, string>>
  readOnly: boolean
  panelId: string
  activeTrigger: { colorId: string | null; field: DraftVisualInformationField } | null
  onOpenVisualTab: (anchor: HTMLButtonElement, colorId: string, field: DraftVisualInformationField) => void
  teamWork: DraftTeamWork
  visualBoard: DraftVisualBoardRow
}) {
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
              const colorPhoto = field === 'image' && !saved && Boolean(colorPhotos?.[color.id])
              const tone = temporary || colorPhoto ? 'is-editing' : saved ? 'is-done' : 'is-neutral'
              const statusText = temporary ? '임시저장됨' : saved ? '저장됨' : colorPhoto ? '컬러에 등록된 임시 이미지' : undefined
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
    <DraftAmdCell colors={colors} readOnly={readOnly} teamWork={teamWork} />
  </>
}
