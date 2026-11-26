import { useId, useState } from 'react'
import { useDraftLoading } from './DraftLoading'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SeasonOpening } from '@/lib/types'
import { cn } from '@/lib/utils'

export function DraftFolderOpeningDate({ opening, editable, onSave }: {
  opening?: SeasonOpening
  editable: boolean
  onSave: (next: SeasonOpening, expected: SeasonOpening) => Promise<void>
}) {
  const inputId = useId()
  const [edit, setEdit] = useState<{ value: string; expected: SeasonOpening }>()
  const [busy, setBusy] = useState(false)
  useDraftLoading(busy && '폴더 오픈 예정일을 저장하는 중…', true)
  const [error, setError] = useState('')
  const value = edit?.value ?? opening?.date ?? ''
  const confirmed = Boolean(opening?.confirmed && !edit)
  const dirty = Boolean(edit && (edit.expected.date ?? '') !== value)
  const locked = busy || !editable || !opening
  const invalid = Boolean(value && !/^\d{4}-\d{2}-\d{2}$/.test(value))

  async function save(confirmDate: boolean) {
    if (locked || invalid || (confirmDate && !value)) return
    setBusy(true)
    setError('')
    try {
      await onSave({ date: value || null, confirmed: confirmDate }, edit?.expected ?? opening)
      setEdit(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '오픈 예정일을 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return <div role="group" aria-label="폴더 오픈 일정" className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
    <label htmlFor={inputId} className="whitespace-nowrap text-xs font-medium">오픈 예정일</label>
    <span className={cn('relative', value && !confirmed && 'draft-md-unconfirmed')}>
      <Input id={inputId} type="date" value={value} disabled={locked || confirmed} max="9999-12-31"
        aria-description={confirmed ? '확정됨' : opening?.date && !opening.confirmed && !dirty ? '임시 저장됨' : undefined}
        className={cn('h-7 w-36 px-2 text-xs', confirmed && 'border-primary bg-primary text-primary-foreground disabled:bg-primary disabled:opacity-100')}
        onChange={event => {
          if (!opening) return
          setError('')
          setEdit({ value: event.currentTarget.value, expected: edit?.expected ?? opening })
        }} />
    </span>
    {!opening ? <span role="status" className="text-xs text-muted-foreground">서버 연결 대기</span>
      : confirmed ? editable && <Button type="button" size="sm" variant="outline" className="h-7 px-2"
        aria-label="오픈 예정일 수정" onClick={() => setEdit({ value, expected: opening })}>수정</Button>
      : <>
        {opening.date && !opening.confirmed && !dirty && <span role="status" className="text-xs text-warning">임시 저장</span>}
        {editable && <>
          {dirty && <Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={busy || invalid}
            aria-label="오픈 예정일 임시 저장" onClick={() => void save(false)}>임시 저장</Button>}
          <Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={busy || invalid || !value}
            aria-label="오픈 예정일 확정" onClick={() => void save(true)}>확정</Button>
          {edit && opening.confirmed && <Button type="button" size="sm" variant="ghost" className="h-7 px-2"
            aria-label="오픈 예정일 수정 취소" disabled={busy} onClick={() => { setEdit(undefined); setError('') }}>취소</Button>}
        </>}
      </>}
    {error && <p role="alert" className="basis-full text-xs text-danger">{error}</p>}
  </div>
}
