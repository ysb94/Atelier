import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resolveDraftPriceDestinationOptions, type DraftPriceDestinationOption } from '@/lib/drafts/manual-price'
import { CHINA_TEAM_DESTINATION } from '@/lib/drafts/sample-receipt'
import type { SharedDraftPriceDestination } from '@/lib/supabase/draft-price-requests'

type Editor = { kind: 'add' } | { kind: 'rename' | 'remove'; option: DraftPriceDestinationOption }

export function DraftPriceDestinationPicker({ value, onChange, shared, disabled, onAdd, onEdit, ready, error, retry }: {
  value: string
  onChange: (option: DraftPriceDestinationOption) => void
  shared: readonly SharedDraftPriceDestination[]
  disabled: boolean
  onAdd?: (name: string) => Promise<void>
  onEdit?: (option: DraftPriceDestinationOption, name: string | null) => Promise<void>
  ready: boolean
  error?: string
  retry?: () => void
}) {
  const [editor, setEditor] = useState<Editor>()
  const [name, setName] = useState('')
  const [saveError, setSaveError] = useState('')
  const options = resolveDraftPriceDestinationOptions(shared)
  const china = options.find(option => option.value === CHINA_TEAM_DESTINATION.value)
  const manual = options.filter(option => option.value !== CHINA_TEAM_DESTINATION.value)

  function openEditor(next: Editor) {
    setEditor(next)
    setName(next.kind === 'add' ? '' : next.option.label)
    setSaveError('')
  }

  function editForm(current: Editor) {
    const removing = current.kind === 'remove'
    return <form className="grid gap-2 rounded-md border border-border p-2 text-sm" onSubmit={async event => {
      event.preventDefault()
      if (disabled || !ready || (!removing && !name.trim())) return
      setSaveError('')
      try {
        if (current.kind === 'add') await onAdd?.(name)
        else await onEdit?.(current.option, removing ? null : name)
        setEditor(undefined)
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : '공용 제조처 목록을 저장하지 못했습니다.')
      }
    }}>
      {removing ? <p className="break-words">회사 공용 선택 목록에서 {current.option.label}을 삭제할까요?</p> : <>
        <label className="grid gap-1">제조국 이름
          <Input value={name} maxLength={40} onChange={event => setName(event.currentTarget.value)} />
        </label>
        {current.kind === 'add' && <p className="text-xs text-muted-foreground">같은 회사 직원에게 이 버튼이 표시됩니다.</p>}
        {current.kind === 'add' && shared.some(row => row.preset_key && row.removed) &&
          <p className="text-xs text-muted-foreground">삭제한 기본 제조처는 기존 이름을 입력하면 복원됩니다.</p>}
      </>}
      {saveError && <p role="alert" className="text-xs text-danger">{saveError}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setEditor(undefined)}>취소</Button>
        <Button type="submit" size="sm" variant={removing ? 'danger' : 'default'}
          disabled={!ready || (!removing && !name.trim())}>
          {removing ? '제조처 삭제' : current.kind === 'add' ? '공용 제조국 추가' : '이름 저장'}
        </Button>
      </div>
    </form>
  }

  function renderOption(option: DraftPriceDestinationOption) {
    return <div key={option.value} className="grid gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_2rem_2rem] items-center gap-1.5">
        <Button type="button" size="sm" variant={value === option.value ? 'default' : 'outline'}
          aria-pressed={value === option.value} aria-haspopup="dialog"
          className="h-auto min-h-8 min-w-0 justify-start overflow-x-auto whitespace-nowrap text-left"
          onClick={() => onChange(option)}><span className="shrink-0">{option.label}</span></Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`${option.label} 수정`}
          title="이름 수정" disabled={!ready || !onEdit} onClick={() => openEditor({ kind: 'rename', option })}>
          <Pencil size={15} aria-hidden="true" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8 text-danger" aria-label={`${option.label} 삭제`}
          title="목록에서 삭제" disabled={!ready || !onEdit} onClick={() => openEditor({ kind: 'remove', option })}>
          <Trash2 size={15} aria-hidden="true" />
        </Button>
      </div>
      {editor && editor.kind !== 'add' && editor.option.value === option.value && editForm(editor)}
    </div>
  }

  return <fieldset className="mt-3 min-w-0 space-y-2" disabled={disabled}>
    <legend className="mb-1.5 text-sm font-medium">제조국·제조처</legend>
    {china && renderOption(china)}
    {manual.length > 0 && <div className={china ? 'grid gap-1 border-t border-border pt-2' : 'grid gap-1'}>
      {manual.map(renderOption)}
    </div>}
    {error && <div className="flex items-center gap-2">
      <p role="status" className="text-xs text-muted-foreground">{error}</p>
      <Button type="button" size="sm" variant="outline" onClick={retry}>목록 다시 조회</Button>
    </div>}
    {onAdd && <>
      <Button type="button" size="icon" variant="outline" className="size-8" aria-expanded={editor?.kind === 'add'}
        aria-label="제조국 추가" title="제조국 추가" disabled={!ready}
        onClick={() => { if (editor?.kind === 'add') setEditor(undefined); else openEditor({ kind: 'add' }) }}>
        <Plus size={16} aria-hidden="true" />
      </Button>
      {editor?.kind === 'add' && editForm(editor)}
    </>}
  </fieldset>
}
