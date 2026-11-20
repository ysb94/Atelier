import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type { DraftColorRow } from '@/lib/types'
import { DRAFT_VISUAL_INFORMATION_TABS, type DraftVisualInformationField } from './draft-information-tabs'

export function DraftVisualAmdCells({ colors, readOnly, panelId, activeTrigger, onOpenVisualTab }: {
  colors: DraftColorRow[]
  readOnly: boolean
  panelId: string
  activeTrigger: { colorId: string | null; field: DraftVisualInformationField } | null
  onOpenVisualTab: (anchor: HTMLButtonElement, colorId: string, field: DraftVisualInformationField) => void
}) {
  return <>
    <td className="draft-sheet-visual-cell">
      <div className="draft-color-pad draft-visual-assignee">
        <label>
          <span>담당자</span>
          <Select className="draft-team-control" disabled><option>선택</option></Select>
        </label>
        <Button type="button" variant="outline" size="icon" className="draft-team-control"
          aria-label="비주얼 팀 담당자 추가" disabled><Plus size={13} aria-hidden="true" /></Button>
      </div>
      <div className="draft-color-lines">
        {colors.map((color, index) => {
          const name = color.name.trim() || `컬러 ${index + 1}`
          return <div key={color.id} className={`draft-color-line${index % 2 ? ' is-alt' : ''}`}>
            {DRAFT_VISUAL_INFORMATION_TABS.map(({ field, label }) => {
              const expanded = activeTrigger?.colorId === color.id && activeTrigger.field === field
              return <Button key={field} type="button" variant="outline" size="sm" className="draft-team-control"
                aria-label={`${name} ${label}`} aria-haspopup="dialog" aria-expanded={expanded}
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
          <Input className="draft-team-control" aria-label="모음전 번호" placeholder="모음전 no." autoComplete="off" disabled={readOnly} />
        </label>
        <Button type="button" variant="outline" size="sm" className="draft-team-control draft-team-confirm"
          aria-label="AMD 확정" disabled>확정</Button>
      </div>
      <div className="draft-color-lines">
        {colors.map((color, index) => {
          const name = color.name.trim() || `컬러 ${index + 1}`
          return <div key={color.id} className={`draft-color-line${index % 2 ? ' is-alt' : ''}`}>
            <label className="draft-amd-entry">
              <Input className="draft-team-control" aria-label={`${name} 사방넷 번호`} placeholder="사방넷 no."
                autoComplete="off" disabled={readOnly} />
            </label>
            <label className="draft-amd-entry">
              <Input className="draft-team-control" aria-label={`${name} 바코드 번호`} placeholder="바코드 no."
                inputMode="numeric" autoComplete="off" disabled={readOnly} />
            </label>
          </div>
        })}
      </div>
    </td>
  </>
}
