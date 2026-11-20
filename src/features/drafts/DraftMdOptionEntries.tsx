import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type DraftMdOptionEntry = { id: string; name: string; price: string }

export function DraftMdOptionEntries({ entries, surcharge, disabled, confirmed, onChange }: {
  entries: DraftMdOptionEntry[]
  surcharge: boolean
  disabled: boolean
  confirmed: boolean
  onChange: (entries: DraftMdOptionEntry[]) => void
}) {
  function changeEntry(id: string, change: Partial<Pick<DraftMdOptionEntry, 'name' | 'price'>>) {
    onChange(entries.map(entry => entry.id === id ? { ...entry, ...change } : entry))
  }

  return (
    <div className="draft-md-option-items">
      {entries.map((entry, index) => (
        <div key={entry.id} className={`draft-md-option-entry${entry.name.trim() && !confirmed ? ' draft-md-unconfirmed' : ''}`}>
          <Input aria-label={`옵션명 ${index + 1}`} placeholder="옵션명" value={entry.name} disabled={disabled}
            onChange={event => changeEntry(entry.id, { name: event.currentTarget.value })} />
          {surcharge && <div className="draft-md-option-price">
            <Input aria-label={`옵션 추가금 ${index + 1}`} inputMode="numeric" placeholder="추가금" disabled={disabled}
              value={entry.price.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} onChange={event => {
                const next = event.currentTarget.value.replaceAll(',', '')
                if (/^\d*$/.test(next)) changeEntry(entry.id, { price: next })
              }} />
            <span>원</span>
          </div>}
        </div>
      ))}
      <Button type="button" variant="ghost" size="icon" className="draft-md-add-entry" aria-label="옵션 입력칸 추가"
        disabled={disabled} onClick={() => onChange([...entries, { id: crypto.randomUUID(), name: '', price: '' }])}>
        <Plus size={15} aria-hidden="true" />
      </Button>
    </div>
  )
}
