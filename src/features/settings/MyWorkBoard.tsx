import { useState, type DragEvent } from 'react'
import { CircleCheck, CircleDashed, CircleDot, GripVertical, MessageSquare } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { createPreviewWork, type WorkItem, type WorkState } from '@/features/work-requests/my-work-preview-data'
import { cn } from '@/lib/utils'

const columns = [
  { id: 'todo', label: 'ToDo', icon: CircleDashed, tone: 'text-muted-foreground' },
  { id: 'doing', label: 'ing', icon: CircleDot, tone: 'text-primary' },
  { id: 'feedback', label: 'feedback', icon: MessageSquare, tone: 'text-warning' },
  { id: 'done', label: 'done', icon: CircleCheck, tone: 'text-success' },
] as const

type BoardCard = Pick<WorkItem, 'id' | 'title' | 'status'>
type DropTarget = { status: WorkState; beforeId?: string }

function cardAt(event: DragEvent<HTMLElement>) {
  return event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-my-work-card]')?.dataset.myWorkCard
    : undefined
}

export function MyWorkBoard() {
  const [cards, setCards] = useState<BoardCard[]>(() => createPreviewWork()
    .filter(item => item.assignee === 'me')
    .map(({ id, title, status }) => ({ id, title, status })))
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [announcement, setAnnouncement] = useState('')

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

  return <section className="space-y-3" aria-label="내 업무 보드">
    <p className="text-sm text-muted-foreground">예시 카드입니다. 카드를 원하는 열로 끌어 놓아 옮겨 보세요.</p>
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
          </header>
          {items.length ? <ul className="space-y-2.5">
            {items.map(card => <li key={card.id} data-my-work-card={card.id} draggable
              className={cn('cursor-grab rounded-xl active:cursor-grabbing', card.id === draggedId && 'opacity-45',
                isTarget && target.beforeId === card.id && card.id !== draggedId && 'ring-2 ring-primary/50')}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', card.id)
                setDraggedId(card.id)
              }} onDragEnd={endDrag}>
              <Card className="flex items-start gap-2 p-3">
                <GripVertical size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <h3 className="min-w-0 break-words text-sm font-medium leading-5">{card.title}</h3>
              </Card>
            </li>)}
          </ul> : <p className="rounded-lg border border-dashed border-border bg-card/60 px-3 py-5 text-center text-xs text-muted-foreground">
            카드가 없습니다.
          </p>}
        </section>
      })}
    </div>
  </section>
}
