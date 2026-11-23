import { useId, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { CircleCheck, CircleDashed, CircleDot, GripVertical, MessageSquare, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createPreviewWork, type WorkItem, type WorkState } from '@/features/work-requests/my-work-preview-data'
import { cn } from '@/lib/utils'
import { MyWorkCardDrawer } from './MyWorkCardDrawer'

const columns = [
  { id: 'todo', label: 'ToDo', icon: CircleDashed, tone: 'text-muted-foreground' },
  { id: 'doing', label: 'ing', icon: CircleDot, tone: 'text-primary' },
  { id: 'feedback', label: 'feedback', icon: MessageSquare, tone: 'text-warning' },
  { id: 'done', label: 'done', icon: CircleCheck, tone: 'text-success' },
] as const

type BoardCard = Pick<WorkItem, 'id' | 'title' | 'description' | 'status'>
type DropTarget = { status: WorkState; beforeId?: string }

function cardAt(event: DragEvent<HTMLElement>) {
  return event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-my-work-card]')?.dataset.myWorkCard
    : undefined
}

export function MyWorkBoard() {
  const [cards, setCards] = useState<BoardCard[]>(() => createPreviewWork()
    .filter(item => item.assignee === 'me')
    .map(({ id, title, description, status }) => ({ id, title, description, status })))
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [draftTitle, setDraftTitle] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedCard = cards.find(card => card.id === selectedId)
  const addFormId = useId()
  const addButton = useRef<HTMLButtonElement>(null)

  function closeAddForm() {
    setDraftTitle(null)
    addButton.current?.focus()
  }

  function addCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = draftTitle?.trim()
    if (!title) return
    const card: BoardCard = { id: crypto.randomUUID(), title, description: '', status: 'todo' }
    setCards(current => [card, ...current])
    setAnnouncement(`${title} · ToDo에 추가`)
    closeAddForm()
  }

  function moveCard(id: string, status: WorkState, beforeId?: string) {
    const card = cards.find(item => item.id === id)
    if (!card || id === beforeId) return
    setCards(current => {
      const next = current.filter(item => item.id !== id)
      const index = next.findIndex(item => item.id === beforeId)
      next.splice(index >= 0 ? index : next.length, 0, { ...card, status })
      return next
    })
    setAnnouncement(`${card.title} · ${columns.find(column => column.id === status)?.label} 이동`)
  }

  function endDrag() {
    setDraggedId(null)
    setTarget(null)
  }

  return <section aria-label="내 업무 보드">
    <p className="sr-only" role="status">{announcement}</p>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {columns.map(({ id, label, icon: Icon, tone }) => {
        const items = cards.filter(card => card.status === id)
        const isTarget = target?.status === id
        return <section key={id} aria-label={label}
          className={cn('min-h-44 min-w-0 rounded-xl border border-border bg-muted/45 p-3 transition-colors motion-reduce:transition-none',
            isTarget && 'border-primary/60 bg-primary/5')}
          onDragOver={event => {
            if (!draggedId) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const beforeId = cardAt(event)
            setTarget(current => current?.status === id && current.beforeId === beforeId ? current : { status: id, beforeId })
          }}
          onDrop={event => {
            if (!draggedId) return
            event.preventDefault()
            moveCard(draggedId, id, cardAt(event))
            endDrag()
          }}>
          <header className="mb-3 flex items-center gap-2 px-1">
            <Icon size={16} className={tone} aria-hidden="true" />
            <h2 className="text-sm font-semibold">{label}</h2>
            <span className="ml-auto min-w-6 rounded-full bg-card px-1.5 py-0.5 text-center text-xs tabular-nums text-muted-foreground">
              {items.length}
            </span>
            {id === 'todo' && <button ref={addButton} type="button" title="업무 카드 추가" aria-label="업무 카드 추가"
              aria-expanded={draftTitle !== null} aria-controls={draftTitle !== null ? addFormId : undefined}
              className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-card text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => draftTitle === null ? setDraftTitle('') : closeAddForm()}>
              <Plus size={16} aria-hidden="true" />
            </button>}
          </header>
          {id === 'todo' && draftTitle !== null && <form id={addFormId} aria-label="업무 카드 추가" onSubmit={addCard}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              closeAddForm()
            }} className="mb-2.5 space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
            <Input autoFocus aria-label="업무 제목" placeholder="업무 제목" value={draftTitle} required maxLength={120}
              className="h-8" onChange={event => setDraftTitle(event.currentTarget.value)} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={closeAddForm}>취소</Button>
              <Button type="submit" size="sm" disabled={!draftTitle.trim()}>추가</Button>
            </div>
          </form>}
          {items.length ? <ul className="space-y-2.5">
            {items.map(card => <li key={card.id} data-my-work-card={card.id} draggable
              className={cn('cursor-grab rounded-xl active:cursor-grabbing', card.id === draggedId && 'opacity-45',
                isTarget && target.beforeId === card.id && card.id !== draggedId && 'ring-2 ring-primary/50')}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', card.id)
                setDraggedId(card.id)
              }} onDragEnd={endDrag}>
              <Card>
                <h3 className="text-sm font-medium leading-5">
                  <button type="button" aria-haspopup="dialog"
                    className="flex w-full cursor-inherit items-start gap-2 rounded-xl p-3 text-left hover:bg-muted/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => setSelectedId(card.id)}>
                    <GripVertical size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 wrap-anywhere">{card.title}</span>
                  </button>
                </h3>
              </Card>
            </li>)}
          </ul> : <p className="rounded-lg border border-dashed border-border bg-card/60 px-3 py-5 text-center text-xs text-muted-foreground">
            카드가 없습니다.
          </p>}
        </section>
      })}
    </div>
    {selectedCard && <MyWorkCardDrawer key={selectedCard.id} card={selectedCard}
      statusLabel={columns.find(column => column.id === selectedCard.status)?.label}
      onClose={() => setSelectedId(null)}
      onSave={details => {
        setCards(current => current.map(card => card.id === selectedCard.id ? { ...card, ...details } : card))
        setAnnouncement(`${details.title} · 수정됨`)
      }} onDelete={() => {
        setCards(current => current.filter(card => card.id !== selectedCard.id))
        setAnnouncement(`${selectedCard.title} · 삭제됨`)
        addButton.current?.focus()
      }} />}
  </section>
}
