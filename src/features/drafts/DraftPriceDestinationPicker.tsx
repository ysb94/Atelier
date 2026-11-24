import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DRAFT_PRICE_DESTINATIONS } from '@/lib/drafts/manual-price'
import { CHINA_TEAM_DESTINATION } from '@/lib/drafts/sample-receipt'
import type { SharedDraftPriceDestination } from '@/lib/supabase/draft-price-requests'

export function DraftPriceDestinationPicker({ value, onChange, shared, disabled, onAdd, ready, error, retry }: {
  value: string
  onChange: (option: { value: string; label: string }) => void
  shared: readonly SharedDraftPriceDestination[]
  disabled: boolean
  onAdd?: (name: string) => Promise<void>
  ready: boolean
  error?: string
  retry?: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [addError, setAddError] = useState('')
  const choose = (option: { value: string; label: string }) => (
    <Button key={option.value} type="button" size="sm" variant={value === option.value ? 'default' : 'outline'}
      aria-pressed={value === option.value} aria-haspopup="dialog" className="h-auto min-h-8 whitespace-normal text-left"
      onClick={() => onChange(option)}>{option.label}</Button>
  )

  return <fieldset className="mt-3 min-w-0 space-y-2" disabled={disabled}>
    <legend className="mb-1.5 text-sm font-medium">제조국·제조처</legend>
    <div>{choose(CHINA_TEAM_DESTINATION)}</div>
    <div className="flex flex-wrap gap-2 border-t border-border pt-2">
      {DRAFT_PRICE_DESTINATIONS.filter(option => option.value !== CHINA_TEAM_DESTINATION.value).map(choose)}
      {shared.map(row => choose({ value: row.id, label: row.name }))}
    </div>
    {error && <div className="flex items-center gap-2">
      <p role="status" className="text-xs text-muted-foreground">{error}</p>
      <Button type="button" size="sm" variant="outline" onClick={retry}>목록 다시 조회</Button>
    </div>}
    {onAdd && <div className="flex flex-col items-start gap-2">
      <Button type="button" size="icon" variant="outline" className="size-8" aria-expanded={adding}
        aria-label="제조국 추가" title="제조국 추가" disabled={!ready} onClick={() => setAdding(current => !current)}>
        <Plus size={16} aria-hidden="true" />
      </Button>
      {adding && <form className="w-full space-y-2" onSubmit={async event => {
        event.preventDefault()
        if (disabled || !ready || !name.trim()) return
        setAddError('')
        try {
          await onAdd(name)
          setName('')
          setAdding(false)
        } catch (cause) {
          setAddError(cause instanceof Error ? cause.message : '제조국을 추가하지 못했습니다.')
        }
      }}>
        <label className="grid gap-1 text-sm">제조국 이름
          <Input value={name} maxLength={40} onChange={event => setName(event.currentTarget.value)} />
        </label>
        <p className="text-xs text-muted-foreground">같은 회사 직원에게 이 버튼이 표시됩니다.</p>
        {addError && <p role="alert" className="text-xs text-danger">{addError}</p>}
        <Button type="submit" size="sm" disabled={!ready || !name.trim()}>공용 제조국 추가</Button>
      </form>}
    </div>}
  </fieldset>
}
