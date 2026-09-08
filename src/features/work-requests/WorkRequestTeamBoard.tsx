import { Fragment, useRef, useState, type PointerEvent } from 'react'
import { CalendarRange, ListTodo, Pin, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { WorkRequestAssignDialog } from './WorkRequestAssignDialog'
import {
  assignDefaultRange,
  buildTeamTimelineDates,
  compareRequestsByDeadline,
  calendarDayDifference,
  toCalendarDate,
  DRAG_THRESHOLD,
  deadlineLabel,
  formatCompactDate,
  formatDate,
  isPlanOverdue,
  isSameCalendarDate,
  layoutTimelineRequests,
  requestDueDate,
  requestPlannedRange,
  resizePlannedRange,
  shiftPlannedRange,
  snapDays,
  TIMELINE_DAY_WIDTH,
} from './work-request-schedule'
import {
  LOCAL_SELF_ID,
  PRIORITY_META,
  STATUS_META,
  type LocalTeamMember,
  type RequestStatus,
  type WorkRequestRecord,
} from './work-request-types'

type BoardView = 'timeline' | 'todos'

type DragKind = 'move' | 'resize-start' | 'resize-end'

const BOARD_VIEWS: {
  id: BoardView
  label: string
  icon: typeof CalendarRange
}[] = [
  { id: 'timeline', label: '일정표', icon: CalendarRange },
  { id: 'todos', label: '할 일', icon: ListTodo },
]

const TODO_STATUS_ORDER: Partial<Record<RequestStatus, number>> = {
  completionReview: 0,
  completionConfirm: 0,
  inProgress: 1,
  accepted: 2,
  waiting: 3,
}

function memberTodoRequests(
  assigned: WorkRequestRecord[],
  memberId: string,
) {
  return assigned.filter(
    (request) =>
      request.assignee === memberId ||
      request.collaborators.includes(memberId),
  )
}

function compareMemberTodos(currentWorkId?: string) {
  return (left: WorkRequestRecord, right: WorkRequestRecord) => {
    const leftCurrent = left.id === currentWorkId
    const rightCurrent = right.id === currentWorkId
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1
    const statusOrder =
      (TODO_STATUS_ORDER[left.status] ?? 3) -
      (TODO_STATUS_ORDER[right.status] ?? 3)
    return statusOrder || compareRequestsByDeadline(left, right)
  }
}

type DragState = {
  kind: DragKind
  requestId: string
  startX: number
  startY: number
  active: boolean
}

export function WorkRequestTeamBoard({
  unassigned,
  assigned,
  teamMembers,
  departmentLabel,
  requesterLabel,
  memberLabel,
  onOpen,
  onAssign,
  currentWorkByMember,
  workDurationByMember,
}: {
  unassigned: WorkRequestRecord[]
  assigned: WorkRequestRecord[]
  teamMembers: LocalTeamMember[]
  departmentLabel: (value: string) => string
  requesterLabel: (request: WorkRequestRecord) => string
  memberLabel: (value: string) => string
  onOpen: (request: WorkRequestRecord) => void
  currentWorkByMember: Record<string, string>
  workDurationByMember: Record<string, string>
  onAssign: (
    requestId: string,
    patch: Pick<WorkRequestRecord, 'assignee' | 'plannedStart' | 'plannedEnd'> &
      Partial<Pick<WorkRequestRecord, 'assignedBy'>>,
  ) => void
}) {
  const [boardView, setBoardView] = useState<BoardView>('timeline')
  const [assignRequestId, setAssignRequestId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const didDragRef = useRef(false)
  const timelineDates = buildTeamTimelineDates([
    ...assigned,
    ...unassigned.filter((request) => request.confirmedDueDate),
  ])
  const timelineStart = timelineDates[0]
  const timelineDayCount = timelineDates.length
  const assignRequest =
    unassigned.find((item) => item.id === assignRequestId) ?? null

  function applyDrop(current: DragState, clientX: number, clientY: number) {
    if (!timelineStart) return
    const row = document
      .elementsFromPoint(clientX, clientY)
      .find((node) => node instanceof HTMLElement && node.dataset.memberId)
    if (!(row instanceof HTMLElement) || !row.dataset.memberId) return
    const source =
      assigned.find((item) => item.id === current.requestId) ??
      unassigned.find((item) => item.id === current.requestId)
    if (!source) return
    const range = requestPlannedRange(source)
    const assignee = row.dataset.memberId
    if (current.kind === 'move') {
      onAssign(current.requestId, {
        assignee,
        ...shiftPlannedRange(
          range.start,
          range.end,
          snapDays(clientX - current.startX),
        ),
      })
      return
    }
    onAssign(current.requestId, {
      assignee: source.assignee,
      ...resizePlannedRange(
        range.start,
        range.end,
        current.kind === 'resize-start' ? 'start' : 'end',
        snapDays(clientX - current.startX),
      ),
    })
  }

  function beginDrag(
    event: PointerEvent<HTMLElement>,
    kind: DragKind,
    request: WorkRequestRecord,
  ) {
    event.preventDefault()
    event.stopPropagation()
    const nextDrag: DragState = {
      kind,
      requestId: request.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    }
    dragRef.current = nextDrag
    setDrag(nextDrag)

    function onMove(moveEvent: globalThis.PointerEvent) {
      const current = dragRef.current
      if (!current || current.requestId !== request.id) return
      const moved =
        current.active ||
        Math.hypot(
          moveEvent.clientX - current.startX,
          moveEvent.clientY - current.startY,
        ) > DRAG_THRESHOLD
      if (!moved || current.active) return
      const next = { ...current, active: true }
      dragRef.current = next
      setDrag(next)
    }

    function onUp(upEvent: globalThis.PointerEvent) {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current || current.requestId !== request.id) return
      if (current.active) {
        didDragRef.current = true
        applyDrop(current, upEvent.clientX, upEvent.clientY)
      } else {
        onOpen(request)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function barTone(request: WorkRequestRecord) {
    const overdue = isPlanOverdue(
      requestPlannedRange(request).end,
      request.confirmedDueDate,
    )
    if (overdue) {
      return 'border-danger bg-danger/15 text-danger hover:bg-danger/20'
    }
    if (request.status === 'waiting') {
      return 'border-border bg-muted text-foreground hover:bg-muted/80'
    }
    if (
      request.status === 'completionReview' ||
      request.status === 'completionConfirm'
    ) {
      return 'border-warning/40 bg-warning/10 text-foreground hover:bg-warning/15'
    }
    if (request.managerPriority === 'urgent') {
      return 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/15'
    }
    if (request.managerPriority === 'high') {
      return 'border-warning/40 bg-warning/10 text-foreground hover:bg-warning/15'
    }
    return 'border-primary/30 bg-primary/10 text-foreground hover:bg-primary/15'
  }

  return (
    <div className="space-y-5">
      {unassigned.length > 0 ? (
        <section className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold">미배정 업무</p>
                <Badge variant="warning">{unassigned.length}건</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                카드를 누르면 부서 구성원이 나옵니다. 팀장이 직접 하거나,
                난이도에 맞는 사람에게 맡기세요.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {unassigned.map((request) => {
              const dueDate = requestDueDate(request)
              const deadline = deadlineLabel(dueDate)
              return (
                <button
                  key={request.id}
                  type="button"
                  className="w-full rounded-lg border border-warning/40 bg-card p-3 text-left transition-colors hover:border-warning"
                  onClick={() => setAssignRequestId(request.id)}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={STATUS_META[request.status].variant}>
                      {STATUS_META[request.status].label}
                    </Badge>
                    {request.managerPriority ? (
                      <Badge variant={PRIORITY_META[request.managerPriority].variant}>
                        {PRIORITY_META[request.managerPriority].label}
                      </Badge>
                    ) : null}
                    <Badge variant="warning">배정 필요</Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-medium">
                    {request.values.title}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {departmentLabel(request.requesterDepartment)} · 요청자{' '}
                    {requesterLabel(request)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    확정 마감 {formatDate(dueDate)} · {deadline.label}
                  </p>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <h3 className="font-semibold">사원별 업무 현황</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {boardView === 'timeline'
                ? '막대는 작업 예정 기간입니다. 세로로 옮기면 담당자, 가로로 옮기면 시기, 끝단을 끌면 기간이 바뀝니다.'
                : '위칸은 지금 하는 일, 아래는 남은 할 일입니다. 안 함·비어 있음이 바로 보입니다.'}
            </p>
          </div>
          <div className="flex items-stretch gap-0.5 border-b border-border">
            {BOARD_VIEWS.map((view) => {
              const Icon = view.icon
              const selected = boardView === view.id
              return (
                <button
                  key={view.id}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => setBoardView(view.id)}
                  className={cn(
                    '-mb-px flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs transition-colors',
                    selected
                      ? 'border-border bg-card text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  {view.label}
                </button>
              )
            })}
          </div>
        </div>

        {boardView === 'todos' ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {teamMembers.map((member) => {
              const currentWork = assigned.find(
                (request) => request.id === currentWorkByMember[member.id],
              )
              const queue = memberTodoRequests(assigned, member.id)
                .filter((request) => request.id !== currentWorkByMember[member.id])
                .sort(compareMemberTodos())
              const idle = !currentWork
              const empty = idle && queue.length === 0
              return (
                <div
                  key={member.id}
                  className={cn(
                    'flex h-full max-h-[44rem] min-h-72 flex-col overflow-hidden rounded-xl border bg-card',
                    currentWork
                      ? 'border-primary/40'
                      : empty
                        ? 'border-dashed border-border bg-muted/20'
                        : 'border-border',
                  )}
                >
                  <div
                    className={cn(
                      'border-b px-4 py-3',
                      currentWork
                        ? 'border-primary/20 bg-primary/5'
                        : empty
                          ? 'border-border bg-muted/40'
                          : 'border-border bg-card',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {member.name}
                          {member.isSelf ? ' (나)' : ''} · {member.position}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {currentWork
                            ? `하는 중 · ${workDurationByMember[member.id] ?? '0초'}`
                            : empty
                              ? '맡은 일 없음'
                              : '지금은 안 함'}
                        </p>
                      </div>
                      <Badge
                        variant={
                          currentWork ? 'default' : empty ? 'outline' : 'muted'
                        }
                      >
                        {currentWork
                          ? '하는 중'
                          : empty
                            ? '비어 있음'
                            : '안 함'}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto p-3">
                    <div>
                      <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
                        지금 하는 일
                      </p>
                      {currentWork ? (
                        <button
                          type="button"
                          onClick={() => onOpen(currentWork)}
                          className="flex h-32 w-full gap-2.5 overflow-hidden rounded-lg border border-primary/50 bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10"
                        >
                          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-primary bg-primary text-primary-foreground">
                            <Pin className="size-2.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1">
                              <Badge variant={STATUS_META[currentWork.status].variant}>
                                {STATUS_META[currentWork.status].label}
                              </Badge>
                              {currentWork.managerPriority ? (
                                <Badge
                                  variant={
                                    PRIORITY_META[currentWork.managerPriority]
                                      .variant
                                  }
                                >
                                  {PRIORITY_META[currentWork.managerPriority].label}
                                </Badge>
                              ) : null}
                              {currentWork.assignee !== member.id ? (
                                <Badge variant="muted">협업</Badge>
                              ) : null}
                              <Badge
                                variant={
                                  deadlineLabel(requestDueDate(currentWork)).variant
                                }
                              >
                                {deadlineLabel(requestDueDate(currentWork)).label}
                              </Badge>
                            </span>
                            <span className="mt-1.5 block truncate text-sm font-medium">
                              {currentWork.values.title}
                            </span>
                            <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                              {formatCompactDate(
                                requestPlannedRange(currentWork).start,
                              )}
                              –
                              {formatCompactDate(
                                requestPlannedRange(currentWork).end,
                              )}
                              {requestDueDate(currentWork)
                                ? ` · 마감 ${formatDate(requestDueDate(currentWork))}`
                                : ''}
                              {` · 실질 ${workDurationByMember[member.id] ?? '0초'}`}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {departmentLabel(currentWork.requesterDepartment)} ·
                              요청자 {requesterLabel(currentWork)}
                            </span>
                          </span>
                        </button>
                      ) : (
                        <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-3 text-center">
                          <p className="text-sm font-medium text-muted-foreground">
                            지금 안 함
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {empty
                              ? '배정된 일도 없습니다.'
                              : '할 일은 있지만 장착한 업무가 없습니다.'}
                          </p>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-muted-foreground">
                          할 일
                        </p>
                        <span className="text-[11px] text-muted-foreground">
                          {queue.length}건
                        </span>
                      </div>
                      {queue.length > 0 ? (
                        <div className="space-y-1.5">
                          {queue.map((request) => {
                            const range = requestPlannedRange(request)
                            const dueDate = requestDueDate(request)
                            const deadline = deadlineLabel(dueDate)
                            const isCollaborator =
                              request.assignee !== member.id &&
                              request.collaborators.includes(member.id)
                            const overdue = isPlanOverdue(
                              range.end,
                              request.confirmedDueDate,
                            )
                            const paused = request.status === 'waiting'
                            return (
                              <button
                                key={request.id}
                                type="button"
                                onClick={() => onOpen(request)}
                                className={cn(
                                  'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60',
                                  paused && 'opacity-70',
                                  overdue && 'bg-danger/5',
                                )}
                              >
                                <span
                                  className={cn(
                                    'mt-0.5 size-3.5 shrink-0 rounded-sm border',
                                    overdue
                                      ? 'border-danger/50'
                                      : 'border-muted-foreground/40',
                                  )}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm">
                                    {request.values.title}
                                  </span>
                                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                    {STATUS_META[request.status].label}
                                    {request.managerPriority
                                      ? ` · ${PRIORITY_META[request.managerPriority].label}`
                                      : ''}
                                    {isCollaborator ? ' · 협업' : ''}
                                    {` · ${deadline.label}`}
                                  </span>
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="rounded-md border border-dashed border-border/80 px-2 py-4 text-center text-[11px] text-muted-foreground">
                          {currentWork
                            ? '지금 하는 일 외에 남은 할 일이 없습니다.'
                            : '할 일이 없습니다.'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
        <div className="max-h-[44rem] overflow-auto rounded-xl border border-border bg-card">
          <div
            className="grid"
            style={{
              gridTemplateColumns: `11rem repeat(${timelineDates.length}, ${TIMELINE_DAY_WIDTH / 16}rem)`,
            }}
          >
            <div
              className="sticky left-0 top-0 z-40 flex h-14 items-center border-b border-r border-border bg-muted px-4 text-xs font-semibold"
              style={{ gridColumn: '1', gridRow: '1' }}
            >
              담당자
            </div>
            {timelineDates.map((date, dateIndex) => {
              const today = isSameCalendarDate(date, new Date())
              const weekend = date.getDay() === 0 || date.getDay() === 6
              return (
                <div
                  key={date.toISOString()}
                  className={cn(
                    'sticky top-0 z-30 flex h-14 flex-col items-center justify-center border-b border-r border-border bg-card text-[10px]',
                    weekend && 'bg-muted/50',
                    today && 'bg-primary/15 text-primary',
                  )}
                  style={{
                    gridColumn: `${dateIndex + 2}`,
                    gridRow: '1',
                  }}
                >
                  <span className="font-semibold">
                    {date.getMonth() + 1}.{date.getDate()}
                  </span>
                  <span className="mt-0.5 text-muted-foreground">
                    {new Intl.DateTimeFormat('ko-KR', {
                      weekday: 'short',
                    }).format(date)}
                  </span>
                </div>
              )
            })}

            {teamMembers.map((member, memberIndex) => {
              const currentWork = assigned.find(
                (request) => request.id === currentWorkByMember[member.id],
              )
              const memberRequests = assigned
                .filter((request) => request.assignee === member.id)
                .sort(compareRequestsByDeadline)
              const { placements, laneCount } = layoutTimelineRequests(
                memberRequests,
                timelineStart,
                timelineDayCount,
              )
              const rowHeight = Math.max(72, laneCount * 58 + 12)
              const gridRow = `${memberIndex + 2}`

              return (
                <Fragment key={member.id}>
                  <div
                    className="sticky left-0 z-20 flex items-center justify-between gap-2 border-b border-r border-border bg-card px-4"
                    style={{
                      gridColumn: '1',
                      gridRow,
                      height: rowHeight,
                    }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {member.name}
                        {member.isSelf ? ' (나)' : ''} · {member.position}
                      </p>
                      <p
                        className={cn(
                          'mt-0.5 truncate text-[10px]',
                          currentWork
                            ? 'font-medium text-primary'
                            : 'text-muted-foreground',
                        )}
                        title={currentWork?.values.title}
                      >
                        {currentWork
                          ? `지금 ${currentWork.values.title} · ${workDurationByMember[member.id] ?? '0초'}`
                          : '지금 하는 업무 없음'}
                      </p>
                    </div>
                    <Badge variant="muted">{memberRequests.length}</Badge>
                  </div>

                  <div
                    data-member-id={member.id}
                    className="relative border-b border-border"
                    style={{
                      gridColumn: `2 / span ${timelineDayCount}`,
                      gridRow,
                      height: rowHeight,
                    }}
                  >
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 grid"
                      style={{
                        gridTemplateColumns: `repeat(${timelineDayCount}, ${TIMELINE_DAY_WIDTH}px)`,
                      }}
                    >
                      {timelineDates.map((date) => {
                        const today = isSameCalendarDate(date, new Date())
                        const weekend =
                          date.getDay() === 0 || date.getDay() === 6
                        return (
                          <div
                            key={date.toISOString()}
                            className={cn(
                              'border-r border-border/60',
                              weekend && 'bg-muted/30',
                              today && 'bg-primary/5',
                            )}
                          />
                        )
                      })}
                    </div>

                    {memberRequests.map((request) => {
                      const due = request.confirmedDueDate
                      if (!due || !timelineStart) return null
                      const dueIndex = calendarDayDifference(
                        toCalendarDate(due),
                        timelineStart,
                      )
                      if (dueIndex < 0 || dueIndex >= timelineDayCount) return null
                      return (
                        <div
                          key={`${request.id}-due`}
                          aria-hidden="true"
                          className="pointer-events-none absolute top-0 z-[5] h-full w-px bg-danger/50"
                          style={{
                            left:
                              dueIndex * TIMELINE_DAY_WIDTH +
                              TIMELINE_DAY_WIDTH -
                              1,
                          }}
                        />
                      )
                    })}

                    {placements.length > 0 ? (
                      placements.map(({ request, lane, startIndex, endIndex }) => {
                        const range = requestPlannedRange(request)
                        return (
                          <div
                            key={request.id}
                            className={cn(
                              'absolute z-10 h-[50px] overflow-hidden rounded-md border text-left shadow-sm',
                              barTone(request),
                              currentWorkByMember[member.id] === request.id &&
                                'ring-2 ring-primary',
                              drag?.requestId === request.id && drag.active && 'opacity-70',
                            )}
                            style={{
                              left: startIndex * TIMELINE_DAY_WIDTH + 4,
                              top: lane * 58 + 6,
                              width: (endIndex - startIndex + 1) * TIMELINE_DAY_WIDTH - 8,
                            }}
                          >
                            <button
                              type="button"
                              className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize"
                              aria-label="시작일 조정"
                              onPointerDown={(event) =>
                                beginDrag(event, 'resize-start', request)
                              }
                            />
                            <button
                              type="button"
                              className="absolute inset-0 z-10 px-2.5 py-1.5 text-left"
                              title={`${request.values.title} · ${formatCompactDate(range.start)} → ${formatCompactDate(range.end)}`}
                              onPointerDown={(event) =>
                                beginDrag(event, 'move', request)
                              }
                            >
                              <p className="truncate text-xs font-semibold">
                                {request.values.title}
                              </p>
                              <p className="mt-1 truncate text-[10px] opacity-80">
                                {currentWorkByMember[member.id] === request.id
                                  ? `지금 하는 중 ${workDurationByMember[member.id] ?? ''} · `
                                  : ''}
                                {STATUS_META[request.status].label} ·{' '}
                                {formatCompactDate(range.start)}–
                                {formatCompactDate(range.end)}
                                {request.collaborators.length > 0
                                  ? ` · 협업 ${request.collaborators.map(memberLabel).join(', ')}`
                                  : ''}
                              </p>
                            </button>
                            <button
                              type="button"
                              className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize"
                              aria-label="종료일 조정"
                              onPointerDown={(event) =>
                                beginDrag(event, 'resize-end', request)
                              }
                            />
                          </div>
                        )
                      })
                    ) : (
                      <div className="absolute inset-y-0 left-4 z-10 flex items-center text-xs text-muted-foreground">
                        배정된 업무가 없습니다.
                      </div>
                    )}
                  </div>
                </Fragment>
              )
            })}
          </div>
        </div>
        )}
      </section>

      {assignRequest ? (
        <WorkRequestAssignDialog
          request={assignRequest}
          teamMembers={teamMembers}
          assigned={assigned}
          currentWorkByMember={currentWorkByMember}
          onClose={() => setAssignRequestId(null)}
          onOpenDetail={() => {
            setAssignRequestId(null)
            onOpen(assignRequest)
          }}
          onAssign={(memberId) => {
            onAssign(assignRequest.id, {
              assignee: memberId,
              assignedBy: LOCAL_SELF_ID,
              ...assignDefaultRange(assignRequest),
            })
            setAssignRequestId(null)
          }}
        />
      ) : null}
    </div>
  )
}
