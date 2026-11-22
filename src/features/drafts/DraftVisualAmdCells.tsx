import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type { DraftColorRow } from '@/lib/types'
import { DRAFT_VISUAL_INFORMATION_TABS, type DraftVisualInformationField } from './draft-information-tabs'
import { DraftTeamActions, DraftTeamNotice } from './DraftTeamActions'
import { matchesTeamColors, useDraftTeamSection, type DraftTeamWork } from './use-draft-team-work'

const EMPTY_CODES = { sabangnet: '', barcode: '' }

export function DraftVisualAmdCells({ colors, readOnly, panelId, activeTrigger, onOpenVisualTab, teamWork }: {
  colors: DraftColorRow[]
  readOnly: boolean
  panelId: string
  activeTrigger: { colorId: string | null; field: DraftVisualInformationField } | null
  onOpenVisualTab: (anchor: HTMLButtonElement, colorId: string, field: DraftVisualInformationField) => void
  teamWork: DraftTeamWork
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
