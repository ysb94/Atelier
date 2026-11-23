import { useRef, useState, type DragEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleDashed, CircleDot, GripVertical, MessageSquare, Plus, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { chatKeys } from '@/features/chat/use-chat'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { listPersonalWorkCards, personalWorkAction, personalWorkErrorMessage, personalWorkUnavailable,
  type PersonalWorkCard, type PersonalWorkInput, type PersonalWorkStatus } from '@/lib/supabase/personal-work'
import { cn } from '@/lib/utils'
import { MyWorkCardDrawer } from './MyWorkCardDrawer'
import { MyWorkFeedbackDialog } from './MyWorkFeedbackDialog'

const columns = [
  { id: 'todo', label: 'ToDo', icon: CircleDashed, tone: 'text-muted-foreground' },
  { id: 'doing', label: 'ing', icon: CircleDot, tone: 'text-primary' },
  { id: 'feedback', label: 'feedback', icon: MessageSquare, tone: 'text-warning' },
  { id: 'done', label: 'done', icon: CircleCheck, tone: 'text-success' },
] as const

function statusLabel(status: PersonalWorkStatus) {
  return columns.find(column => column.id === status)?.label
}

function loadFeedbackRecipients(actorId?: string): string[] {
  if (!actorId) return []
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`atelier:my-work-feedback:${actorId}`) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function cardAt(event: DragEvent<HTMLElement>) {
  return event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-my-work-card]')?.dataset.myWorkCard
    : undefined
}

function actionFor(card: PersonalWorkCard, status: PersonalWorkStatus) {
  if (card.status === 'todo' && status === 'doing') return 'start'
  if (card.status === 'doing' && status === 'todo') return 'pause'
  if (card.status === 'doing' && status === 'feedback') return 'submit'
  if (card.status === 'doing' && status === 'done' && card.created_by === card.assignee_id) return 'complete'
}

export function MyWorkBoard({ feedbackActorId: actorId, active = true }: { feedbackActorId?: string; active?: boolean }) {
  const cache = useQueryClient()
  const key = ['personal-work-cards', actorId] as const
  const query = useQuery({ ...sharedReadPolicy, queryKey: key, queryFn: listPersonalWorkCards,
    enabled: active && Boolean(actorId), retry: false,
    refetchInterval: readPollInterval(15_000, active && Boolean(actorId)),
  })
  const cards = query.data ?? []
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [target, setTarget] = useState<{ status: PersonalWorkStatus; beforeId?: string } | null>(null)
  const [order, setOrder] = useState<string[]>([])
  const [announcement, setAnnouncement] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const moveAttempt = useRef<{ key: string; command: string }>(null)
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [recipientIds, setRecipientIds] = useState(() => loadFeedbackRecipients(actorId))
  const [feedbackDrop, setFeedbackDrop] = useState<{ cardId: string; revision: number } | null>(null)
  const [feedbackSettings, setFeedbackSettings] = useState(false)
  const selectedCard = cards.find(card => card.id === selectedId)
  const feedbackCard = cards.find(card => card.id === feedbackDrop?.cardId)
  const ownCards = cards.filter(card => card.assignee_id === actorId).sort((first, second) => order.indexOf(first.id) - order.indexOf(second.id))
  const reviewCards = cards.filter(card => card.reviewer_id === actorId && card.status === 'feedback')
  const assignedCards = cards.filter(card => card.created_by === actorId && card.assignee_id !== actorId && card.status !== 'feedback')
  const ready = Boolean(actorId) && query.isSuccess

  async function save(input: PersonalWorkInput) {
    if (inFlight.current) throw new Error('업무를 처리하는 중입니다.')
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      await personalWorkAction(input)
      void cache.invalidateQueries({ queryKey: chatKeys.rooms })
      setAnnouncement('업무에 반영했습니다.')
    } finally {
      await cache.invalidateQueries({ queryKey: key })
      inFlight.current = false
      setPending(false)
    }
  }

  function endDrag() {
    setDraggedId(null)
    setTarget(null)
  }

  function requestReview(card: PersonalWorkCard) {
    setSelectedId(null)
    setFeedbackDrop({ cardId: card.id, revision: card.revision })
  }

  async function dropCard(card: PersonalWorkCard, status: PersonalWorkStatus, beforeId?: string) {
    endDrag()
    if (!ready || inFlight.current) return
    if (card.status === status) {
      if (beforeId === card.id) return
      const next = ownCards.filter(item => item.id !== card.id).map(item => item.id)
      const index = next.indexOf(beforeId ?? '')
      next.splice(index >= 0 ? index : next.length, 0, card.id)
      setOrder(next)
      return
    }
    const action = actionFor(card, status)
    if (action === 'submit') {
      requestReview(card)
      return
    }
    if (!action) return
    const attemptKey = `${card.id}:${card.revision}:${action}`
    if (moveAttempt.current?.key !== attemptKey) moveAttempt.current = { key: attemptKey, command: crypto.randomUUID() }
    try {
      await save({ id: card.id, revision: card.revision, action, command: moveAttempt.current.command })
    } catch (failure) {
      setError(personalWorkErrorMessage(failure))
    }
  }

  function saveFeedbackRecipients(ids: string[]) {
    if (!actorId) return
    setRecipientIds(ids)
    try { localStorage.setItem(`atelier:my-work-feedback:${actorId}`, JSON.stringify(ids)) } catch { /* 현재 화면의 선택을 유지한다. */ }
    setFeedbackSettings(false)
  }

  function renderRelated(label: string, items: PersonalWorkCard[]) {
    if (!items.length) return null
    return <section aria-label={label} className="mt-5 rounded-xl border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">{label} <span className="text-muted-foreground">{items.length}</span></h2>
      <ul className="divide-y divide-border">
        {items.map(card => <li key={card.id}>
          <button type="button" aria-haspopup="dialog" onClick={() => setSelectedId(card.id)}
            className="flex w-full flex-wrap items-baseline justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted">
            <span className="min-w-0 wrap-anywhere font-medium">{card.title}</span>
            <span className="text-xs text-muted-foreground">{card.assignee_name} · {statusLabel(card.status)} · {card.round}차</span>
          </button>
        </li>)}
      </ul>
    </section>
  }

  return <section aria-label="내 업무 보드">
    <p className="sr-only" role="status">{announcement}</p>
    {!actorId && <p className="mb-3 text-sm text-muted-foreground">내 업무는 본인 계정에서 사용할 수 있습니다.</p>}
    {actorId && query.isPending && <p role="status" className="mb-3 text-sm text-muted-foreground">내 업무를 불러오는 중입니다.</p>}
    {query.isError && <div className="mb-3 flex flex-wrap items-center gap-2" role="alert">
      <p className="text-sm text-muted-foreground">{personalWorkUnavailable(query.error) ? '내 업무 서버 연결 대기 중입니다.' : '내 업무를 불러오지 못했습니다.'}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>다시 불러오기</Button>
    </div>}
    {error && <p className="mb-3 text-sm text-danger" role="alert">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {columns.map(({ id, label, icon: Icon, tone }) => {
        const items = ownCards.filter(card => card.status === id)
        const draggedCard = ownCards.find(card => card.id === draggedId)
        const canDrop = draggedCard && (draggedCard.status === id || actionFor(draggedCard, id))
        const isTarget = target?.status === id
        return <section key={id} aria-label={label}
          className={cn('min-h-44 min-w-0 rounded-xl border border-border bg-muted/45 p-3 transition-colors motion-reduce:transition-none',
            isTarget && 'border-primary/60 bg-primary/5')}
          onDragOver={event => {
            if (!canDrop || pending) { if (target) setTarget(null); return }
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const beforeId = cardAt(event)
            setTarget(current => current?.status === id && current.beforeId === beforeId ? current : { status: id, beforeId })
          }}
          onDrop={event => {
            if (!canDrop || !draggedCard) return
            event.preventDefault()
            void dropCard(draggedCard, id, cardAt(event))
          }}>
          <header className="mb-3 flex items-center gap-2 px-1">
            <Icon size={16} className={tone} aria-hidden="true" />
            <h2 className="text-sm font-semibold">{label}</h2>
            <span className="ml-auto min-w-6 rounded-full bg-card px-1.5 py-0.5 text-center text-xs tabular-nums text-muted-foreground">{items.length}</span>
            {id === 'todo' && <Button type="button" variant="outline" size="icon" className="size-7 shrink-0 text-primary"
              title="업무 카드 추가" aria-label="업무 카드 추가" aria-haspopup="dialog" disabled={!ready || pending} onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
            </Button>}
            {id === 'feedback' && <Button type="button" variant="outline" size="icon" className="size-7 shrink-0"
              title="피드백 담당자 설정" aria-label="피드백 담당자 설정" aria-haspopup="dialog" onClick={() => setFeedbackSettings(true)}>
              <Settings2 size={15} aria-hidden="true" />
            </Button>}
          </header>
          {items.length ? <ul className="space-y-2.5">
            {items.map(card => <li key={card.id} data-my-work-card={card.id} draggable={ready && !pending}
              className={cn('cursor-grab rounded-xl active:cursor-grabbing', card.id === draggedId && 'opacity-45',
                isTarget && target.beforeId === card.id && card.id !== draggedId && 'ring-2 ring-primary/50')}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', card.id)
                setDraggedId(card.id)
              }} onDragEnd={endDrag}>
              <Card>
                <h3 className="text-sm font-medium leading-5">
                  <button type="button" aria-haspopup="dialog" aria-label={card.title}
                    className="flex w-full cursor-inherit items-start gap-2 rounded-xl p-3 text-left hover:bg-muted/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => setSelectedId(card.id)}>
                    <GripVertical size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 wrap-anywhere">
                      {card.title}
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {card.round}차{card.reviewer_name && ` · 피드백 ${card.reviewer_name}`}
                      </span>
                    </span>
                  </button>
                </h3>
              </Card>
            </li>)}
          </ul> : <p className="rounded-lg border border-dashed border-border bg-card/60 px-3 py-5 text-center text-xs text-muted-foreground">카드가 없습니다.</p>}
        </section>
      })}
    </div>
    {renderRelated('검토 요청', reviewCards)}
    {renderRelated('내가 배정한 업무', assignedCards)}
    {(feedbackSettings || feedbackCard) && <MyWorkFeedbackDialog actorId={actorId} settings={feedbackSettings}
      cardTitle={feedbackCard?.title} recipientIds={recipientIds}
      fixedReviewer={feedbackCard && feedbackCard.created_by !== feedbackCard.assignee_id
        ? { id: feedbackCard.created_by, name: feedbackCard.creator_name } : undefined}
      onSettings={() => setFeedbackSettings(true)} onSave={saveFeedbackRecipients}
      onClose={() => { setFeedbackSettings(false); setFeedbackDrop(null) }}
      onRequest={async (reviewer, note, command) => {
        if (!feedbackDrop) return
        await save({ id: feedbackDrop.cardId, revision: feedbackDrop.revision, action: 'submit', reviewer, note, command })
        setAnnouncement('피드백 요청을 보냈습니다.')
      }} />}
    {actorId && (selectedCard || creating) && <MyWorkCardDrawer key={selectedCard?.id ?? 'new'} actorId={actorId}
      card={selectedCard} statusLabel={selectedCard && statusLabel(selectedCard.status)}
      onClose={() => { setSelectedId(null); setCreating(false) }} onAction={save}
      onRequestReview={selectedCard && (() => requestReview(selectedCard))} />}
  </section>
}
