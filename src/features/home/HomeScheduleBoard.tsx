import { useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  RotateCcw,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  HOME_EVENT_DEPT_BAR,
  HOME_EVENT_DEPT_DOT,
  HOME_EVENT_DEPT_LABEL,
  HOME_EVENT_DEPTS,
  HOME_EVENT_KIND_LABEL,
  HOME_EVENT_STATUS_LABEL,
  buildMonthGrid,
  eventsOnDay,
  formatDateLabel,
  formatMonthTitle,
  formatRangeLabel,
  layoutWeekEventBars,
  listOwners,
  ongoingEvents,
  splitWeeks,
  toDateKey,
  trimCalendarWeeks,
  upcomingEvents,
  weekdayLabels,
  type HomeEvent,
  type HomeEventDept,
  type WeekEventBar,
} from './home-events'

const MAX_BARS_PER_DAY = 3

type PanelTab = 'selected' | 'ongoing' | 'upcoming'

type HomeScheduleBoardProps = {
  events: HomeEvent[]
  sampleNotice?: boolean
}

function EventRow({
  event,
  active,
  onSelect,
}: {
  event: HomeEvent
  active?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-foreground/25 bg-muted/50'
          : 'border-border hover:bg-muted/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-block size-2 shrink-0 rounded-full',
                HOME_EVENT_DEPT_DOT[event.dept],
              )}
            />
            <span className="truncate text-sm font-medium">{event.title}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatRangeLabel(event.startDate, event.endDate)} · {event.owner}
          </div>
          {event.note ? (
            <p className="mt-1 text-xs text-muted-foreground">{event.note}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            variant={
              event.status === 'ongoing'
                ? 'success'
                : event.status === 'upcoming'
                  ? 'warning'
                  : 'muted'
            }
          >
            {HOME_EVENT_STATUS_LABEL[event.status]}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {HOME_EVENT_DEPT_LABEL[event.dept]} ·{' '}
            {HOME_EVENT_KIND_LABEL[event.kind]}
          </span>
        </div>
      </div>
    </button>
  )
}

function CalendarEventBar({
  bar,
  onSelect,
}: {
  bar: WeekEventBar
  onSelect: () => void
}) {
  const singleDay = !bar.continuesBefore && !bar.continuesAfter && bar.span === 1

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      className={cn(
        'pointer-events-auto relative z-10 mx-1 flex h-[18px] items-center overflow-hidden text-left text-[10px] font-medium leading-none shadow-sm ring-1 ring-inset transition-[filter,transform] hover:brightness-[0.97] active:scale-[0.99]',
        HOME_EVENT_DEPT_BAR[bar.event.dept],
        singleDay && 'rounded-full px-2',
        !singleDay &&
          !bar.continuesBefore &&
          !bar.continuesAfter &&
          'rounded-full px-2.5',
        !singleDay &&
          bar.continuesBefore &&
          bar.continuesAfter &&
          'mx-0 rounded-none px-2',
        !singleDay &&
          !bar.continuesBefore &&
          bar.continuesAfter &&
          'ml-1 mr-0 rounded-l-full rounded-r-none pl-2.5 pr-1',
        !singleDay &&
          bar.continuesBefore &&
          !bar.continuesAfter &&
          'ml-0 mr-1 rounded-r-full rounded-l-none pl-1 pr-2.5',
      )}
      style={{
        gridColumn: `${bar.startCol + 1} / span ${bar.span}`,
        gridRow: bar.lane + 1,
      }}
      title={`${bar.event.title} · ${formatRangeLabel(bar.event.startDate, bar.event.endDate)}`}
    >
      {!bar.continuesBefore ? (
        <span
          className={cn(
            'mr-1.5 size-1.5 shrink-0 rounded-full opacity-70',
            HOME_EVENT_DEPT_DOT[bar.event.dept],
          )}
        />
      ) : (
        <span className="mr-1 h-1 w-1 shrink-0 rounded-full bg-current opacity-30" />
      )}
      <span className="truncate tracking-tight">
        {bar.showTitle ? bar.event.title : '\u00a0'}
      </span>
    </button>
  )
}

export function HomeScheduleBoard({
  events,
  sampleNotice = false,
}: HomeScheduleBoardProps) {
  const today = useMemo(() => new Date(), [])
  const todayKey = toDateKey(today)

  const [cursor, setCursor] = useState(() =>
    new Date(today.getFullYear(), today.getMonth(), 1),
  )
  const [selectedKey, setSelectedKey] = useState(todayKey)
  const [hiddenDepts, setHiddenDepts] = useState<Set<HomeEventDept>>(
    () => new Set(),
  )
  const [hiddenOwners, setHiddenOwners] = useState<Set<string>>(() => new Set())
  const [panelTab, setPanelTab] = useState<PanelTab>('selected')

  const owners = useMemo(() => listOwners(events), [events])
  const cells = useMemo(() => buildMonthGrid(cursor), [cursor])

  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          !hiddenDepts.has(event.dept) && !hiddenOwners.has(event.owner),
      ),
    [events, hiddenDepts, hiddenOwners],
  )

  const weeks = useMemo(
    () => trimCalendarWeeks(splitWeeks(cells), visibleEvents),
    [cells, visibleEvents],
  )

  const weekLayouts = useMemo(
    () =>
      weeks.map((week) =>
        layoutWeekEventBars(week, visibleEvents, MAX_BARS_PER_DAY),
      ),
    [weeks, visibleEvents],
  )

  const hiddenCount = events.length - visibleEvents.length
  const selectedEvents = eventsOnDay(visibleEvents, selectedKey)
  const ongoing = ongoingEvents(visibleEvents, todayKey)
  const upcoming = upcomingEvents(visibleEvents, todayKey)

  const panelItems =
    panelTab === 'selected'
      ? selectedEvents
      : panelTab === 'ongoing'
        ? ongoing
        : upcoming

  function toggleDept(dept: HomeEventDept) {
    setHiddenDepts((prev) => {
      const next = new Set(prev)
      if (next.has(dept)) next.delete(dept)
      else next.add(dept)
      return next
    })
  }

  function toggleOwner(owner: string) {
    setHiddenOwners((prev) => {
      const next = new Set(prev)
      if (next.has(owner)) next.delete(owner)
      else next.add(owner)
      return next
    })
  }

  function showAll() {
    setHiddenDepts(new Set())
    setHiddenOwners(new Set())
  }

  function goToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
    setSelectedKey(todayKey)
    setPanelTab('selected')
  }

  function selectEvent(event: HomeEvent) {
    setSelectedKey(event.startDate)
    const start = event.startDate
    const [y, m] = start.split('-').map(Number)
    setCursor(new Date(y, m - 1, 1))
    setPanelTab('selected')
  }

  return (
    <section className="mb-8 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="size-4 text-muted-foreground" />
            일정
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            모든 부서·담당자 일정이 기본으로 보입니다. 잠깐 숨길 수 있지만
            저장되지 않습니다.
          </p>
        </div>
        {sampleNotice ? (
          <Badge variant="outline">예시 데이터 · 회의 후 항목 확정 예정</Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">부서</span>
        {HOME_EVENT_DEPTS.map((dept) => {
          const on = !hiddenDepts.has(dept)
          return (
            <button
              key={dept}
              type="button"
              onClick={() => toggleDept(dept)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                on
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground line-through decoration-muted-foreground/50',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  HOME_EVENT_DEPT_DOT[dept],
                  !on && 'opacity-40',
                )}
              />
              {HOME_EVENT_DEPT_LABEL[dept]}
            </button>
          )
        })}
        <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" />
        <span className="mr-1 text-xs text-muted-foreground">담당</span>
        {owners.map((owner) => {
          const on = !hiddenOwners.has(owner)
          return (
            <button
              key={owner}
              type="button"
              onClick={() => toggleOwner(owner)}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors',
                on
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground line-through decoration-muted-foreground/50',
              )}
            >
              {owner}
            </button>
          )
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1 text-xs"
          onClick={showAll}
          disabled={hiddenCount === 0}
        >
          <Eye className="size-3.5" />
          전체 다시 보기
          {hiddenCount > 0 ? (
            <span className="tabular-nums text-muted-foreground">
              (숨김 {hiddenCount})
            </span>
          ) : null}
        </Button>
      </div>

      <div className="grid gap-4 lg:h-[clamp(520px,calc(100vh-300px),820px)] lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3">
            <CardTitle className="text-base">
              {formatMonthTitle(cursor)}
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="이전 달"
                onClick={() =>
                  setCursor(
                    new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1),
                  )
                }
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={goToday}
              >
                <RotateCcw className="size-3.5" />
                오늘
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="다음 달"
                onClick={() =>
                  setCursor(
                    new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1),
                  )
                }
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div className="grid shrink-0 grid-cols-7 border-b border-border bg-muted/30">
              {weekdayLabels().map((label) => (
                <div
                  key={label}
                  className="px-2 py-2 text-center text-[11px] font-medium text-muted-foreground"
                >
                  {label}
                </div>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col divide-y divide-border">
              {weeks.map((week, weekIndex) => {
                const layout = weekLayouts[weekIndex]
                const laneCount = Math.max(layout.laneCount, 1)
                const hasOverflow = week.some(
                  (cell) => (layout.overflowByDay[cell.key] ?? 0) > 0,
                )

                return (
                  <div
                    key={week[0].key}
                    className="relative flex min-h-0 flex-1 flex-col"
                  >
                    {/* z-0: 열 배경·세로선·날짜 선택 클릭 */}
                    <div className="absolute inset-0 z-0 grid grid-cols-7">
                      {week.map((cell) => {
                        const isToday = cell.key === todayKey
                        const isSelected = cell.key === selectedKey
                        return (
                          <button
                            key={`hit-${cell.key}`}
                            type="button"
                            aria-label={formatDateLabel(cell.key)}
                            onClick={() => {
                              setSelectedKey(cell.key)
                              setPanelTab('selected')
                            }}
                            className={cn(
                              'border-r border-border/50 last:border-r-0',
                              !cell.inCurrentMonth && 'bg-muted/20',
                              isSelected && 'bg-accent/45',
                              isToday && !isSelected && 'bg-muted/35',
                              !isSelected && 'hover:bg-muted/30',
                            )}
                          />
                        )
                      })}
                    </div>

                    {/* z-10: 날짜 숫자 + 일정 레인 */}
                    <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col">
                      <div className="grid h-8 shrink-0 grid-cols-7">
                        {week.map((cell) => {
                          const isToday = cell.key === todayKey
                          const isSelected = cell.key === selectedKey
                          return (
                            <div
                              key={cell.key}
                              className="flex items-center px-2"
                            >
                              <span
                                className={cn(
                                  'inline-flex size-6 items-center justify-center text-xs tabular-nums',
                                  !cell.inCurrentMonth &&
                                    'text-muted-foreground/45',
                                  isToday &&
                                    'rounded-full bg-foreground font-medium text-background',
                                  isSelected &&
                                    !isToday &&
                                    'font-semibold text-foreground',
                                )}
                              >
                                {cell.date.getDate()}
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      <div
                        className="grid min-h-0 flex-1 grid-cols-7 content-start px-0.5 pb-1.5"
                        style={{
                          gridTemplateRows: `repeat(${laneCount}, 20px)${
                            hasOverflow ? ' 16px' : ''
                          }`,
                          rowGap: '3px',
                        }}
                      >
                        {layout.bars.map((bar) => (
                          <CalendarEventBar
                            key={`${bar.event.id}-${week[0].key}-${bar.lane}`}
                            bar={bar}
                            onSelect={() => {
                              setSelectedKey(
                                bar.event.startDate > week[0].key
                                  ? bar.event.startDate
                                  : week[bar.startCol].key,
                              )
                              setPanelTab('selected')
                            }}
                          />
                        ))}

                        {week.map((cell, col) => {
                          const overflow = layout.overflowByDay[cell.key] ?? 0
                          if (overflow <= 0) return null
                          return (
                            <button
                              key={`overflow-${cell.key}`}
                              type="button"
                              className="pointer-events-auto z-10 px-2 text-left text-[10px] font-medium text-muted-foreground hover:text-foreground"
                              style={{
                                gridColumn: col + 1,
                                gridRow: laneCount + 1,
                              }}
                              onClick={() => {
                                setSelectedKey(cell.key)
                                setPanelTab('selected')
                              }}
                            >
                              +{overflow}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 gap-1 border-b border-border p-2">
            {(
              [
                {
                  id: 'selected' as const,
                  label: formatDateLabel(selectedKey),
                  count: selectedEvents.length,
                },
                {
                  id: 'ongoing' as const,
                  label: '진행 중',
                  count: ongoing.length,
                },
                {
                  id: 'upcoming' as const,
                  label: '다가오는',
                  count: upcoming.length,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPanelTab(tab.id)}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-start rounded-md px-2.5 py-2 text-left transition-colors',
                  panelTab === tab.id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <span className="w-full truncate text-xs font-medium">
                  {tab.label}
                </span>
                <span className="mt-0.5 text-[10px] tabular-nums opacity-70">
                  {tab.count}건
                </span>
              </button>
            ))}
          </div>
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {panelItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {panelTab === 'selected'
                  ? '이 날짜에 일정이 없습니다.'
                  : panelTab === 'ongoing'
                    ? '진행 중인 일정이 없습니다.'
                    : '다가오는 일정이 없습니다.'}
              </p>
            ) : (
              panelItems.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  active={
                    panelTab === 'selected' &&
                    event.startDate <= selectedKey &&
                    event.endDate >= selectedKey
                  }
                  onSelect={() => selectEvent(event)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
