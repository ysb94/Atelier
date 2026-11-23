import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DraftMdOption } from './draft-md-options'

export function DraftMdOptionDialog({ label, options, onChange, onClose }: {
  label: string
  options: DraftMdOption[]
  onChange: (options: DraftMdOption[]) => void
  onClose: () => void
}) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { dialog.current?.showModal() }, [])

  function clearForm() {
    setEditing(null)
    setName('')
    setError('')
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = name.trim().replace(/\s+/g, ' ')
    if (!next) return
    if (options.some(option => option.id !== editing && option.label.toLowerCase() === next.toLowerCase())) {
      setError('같은 이름의 항목이 이미 있습니다.')
      return
    }
    onChange(editing
      ? options.map(option => option.id === editing ? { ...option, label: next } : option)
      : [...options, { id: crypto.randomUUID(), label: next }])
    clearForm()
  }

  return createPortal(
    <dialog ref={dialog} aria-labelledby={titleId}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-border bg-card p-4 text-foreground shadow-xl backdrop:bg-black/35"
      onClose={onClose}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold">{label} 목록</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => dialog.current?.close()}>닫기</Button>
      </div>
      {options.length ? (
        <ul className="my-3 max-h-[45vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
          {options.map(option => (
            <li key={option.id} className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="min-w-0 break-words text-sm">{option.label}</span>
              <div className="flex shrink-0">
                <Button type="button" variant="ghost" size="sm" className="px-2" aria-label={`${option.label} 수정`} onClick={() => {
                  setEditing(option.id)
                  setName(option.label)
                  setError('')
                  input.current?.focus()
                }}>수정</Button>
                <Button type="button" variant="ghost" size="sm" className="px-2 text-danger" aria-label={`${option.label} 삭제`} onClick={() => {
                  onChange(options.filter(item => item.id !== option.id))
                  if (editing === option.id) clearForm()
                }}>삭제</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="my-3 text-sm text-muted-foreground">등록된 항목이 없습니다.</p>}
      <form className="flex flex-wrap items-center gap-2" onSubmit={save}>
        <Input autoFocus ref={input} className="h-8 min-w-0 flex-1" aria-label="항목 이름" maxLength={60} value={name} onChange={event => {
          setName(event.currentTarget.value)
          setError('')
        }} />
        {editing && <Button type="button" variant="ghost" size="sm" onClick={clearForm}>취소</Button>}
        <Button type="submit" size="sm" disabled={!name.trim()}>{editing ? '저장' : '추가'}</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </dialog>,
    document.body,
  )
}
