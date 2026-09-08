import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  completionRequestDate,
  dateInRange,
  formatSlashDate,
  formatWorkDuration,
  requestDueDate,
} from './work-request-schedule'
import {
  type LocalTeamMember,
  type WorkRequestRecord,
} from './work-request-types'

export function WorkRequestCompletedPanel({
  canManage,
  requests,
  teamMembers,
  from,
  to,
  onFromChange,
  onToChange,
  workDurationLabel,
  workDurationMs,
  departmentLabel,
  requesterLabel,
  onOpen,
}: {
  canManage: boolean
  requests: WorkRequestRecord[]
  teamMembers: LocalTeamMember[]
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  workDurationLabel: (memberId: string, requestId: string) => string
  workDurationMs: (memberId: string, requestId: string) => number
  departmentLabel: (value: string) => string
  requesterLabel: (request: WorkRequestRecord) => string
  onOpen: (request: WorkRequestRecord) => void
}) {
  const filtered = requests.filter((request) =>
    dateInRange(request.completedAt || request.updatedAt, from, to),
  )
  const groups = teamMembers.map((member) => {
    const items = filtered.filter((request) => request.assignee === member.id)
    const lateCount = items.filter(isLate).length
    const rejectCount = items.reduce(
      (sum, request) => sum + request.completionRejectCount,
      0,
    )
    const totalMs = items.reduce(
      (sum, request) => sum + workDurationMs(member.id, request.id),
      0,
    )
    return { member, items, lateCount, rejectCount, totalMs }
  })
  const maxCount = Math.max(0, ...groups.map((group) => group.items.length))
  const minLate = Math.min(...groups.map((group) => group.lateCount))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div>
          <p className="font-semibold">완료 기간</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {canManage
              ? `${filtered.length}건 · 직원별 건수·실질·마감 준수를 비교합니다.`
              : `${filtered.length}건 · 내가 완료한 업무`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            시작
            <Input
              type="date"
              className="h-8 w-36"
              value={from}
              onChange={(event) => onFromChange(event.target.value)}
            />
          </label>
          <span className="mb-1.5 text-xs text-muted-foreground">~</span>
          <label className="space-y-1 text-xs text-muted-foreground">
            종료
            <Input
              type="date"
              className="h-8 w-36"
              value={to}
              onChange={(event) => onToChange(event.target.value)}
            />
          </label>
        </div>
      </div>

      {canManage ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {groups.map((group) => (
              <div
                key={group.member.id}
                className={cn(
                  'rounded-xl border bg-card px-4 py-3',
                  group.items.length === maxCount && maxCount > 0
                    ? 'border-primary/40'
                    : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-semibold">
                    {group.member.name}
                    {group.member.isSelf ? ' (나)' : ''} · {group.member.position}
                  </p>
                  <Badge variant="muted">{group.items.length}건</Badge>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
                  <div>
                    <dt className="text-muted-foreground">실질 합계</dt>
                    <dd className="mt-0.5 font-medium tabular-nums">
                      {group.totalMs > 0
                        ? formatWorkDuration(group.totalMs)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">마감 준수</dt>
                    <dd
                      className={cn(
                        'mt-0.5 font-medium tabular-nums',
                        group.lateCount > 0
                          ? 'text-danger'
                          : group.items.length > 0 &&
                              group.lateCount === minLate
                            ? 'text-primary'
                            : '',
                      )}
                    >
                      {group.items.length > 0
                        ? `${group.items.length - group.lateCount}/${group.items.length}`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">반려</dt>
                    <dd
                      className={cn(
                        'mt-0.5 font-medium tabular-nums',
                        group.rejectCount > 0 && 'text-danger',
                      )}
                    >
                      {group.rejectCount}회
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {groups.map((group) => (
              <section
                key={group.member.id}
                className="flex max-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-xs font-semibold">
                    {group.member.name}
                    {group.member.isSelf ? ' (나)' : ''}
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {group.items.length > 0 ? (
                    <table className="w-full border-collapse text-left text-[11px]">
                      <thead className="sticky top-0 bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5 font-medium">업무</th>
                          <th
                            className="w-[5.5rem] px-2 py-1.5 font-medium"
                            title="받은 날 ~ 마감"
                          >
                            기간
                          </th>
                          <th
                            className="w-10 px-2 py-1.5 font-medium"
                            title="마지막 완료 요청일"
                          >
                            완료
                          </th>
                          <th className="w-8 px-2 py-1.5 font-medium">반려</th>
                          <th className="w-14 px-2 py-1.5 font-medium">실질</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((request) => (
                          <CompletedRow
                            key={request.id}
                            request={request}
                            duration={workDurationLabel(
                              group.member.id,
                              request.id,
                            )}
                            departmentLabel={departmentLabel}
                            requesterLabel={requesterLabel}
                            onOpen={onOpen}
                          />
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                      이 기간 완료 없음
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : filtered.length > 0 ? (
        <div className="max-h-[40rem] overflow-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">업무</th>
                <th className="w-40 px-3 py-2 font-medium">요청</th>
                <th
                  className="w-24 px-3 py-2 font-medium"
                  title="받은 날 ~ 마감"
                >
                  기간
                </th>
                <th
                  className="w-16 px-3 py-2 font-medium"
                  title="마지막 완료 요청일"
                >
                  완료
                </th>
                <th className="w-14 px-3 py-2 font-medium">반려</th>
                <th className="w-20 px-3 py-2 font-medium">실질</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((request) => (
                <tr
                  key={request.id}
                  className={cn(
                    'cursor-pointer border-t border-border/70 hover:bg-muted/50',
                    isLate(request) && 'bg-danger/5',
                  )}
                  onClick={() => onOpen(request)}
                >
                  <td className="px-3 py-1.5">
                    <span className="truncate font-medium">
                      {request.values.title}
                    </span>
                    {isLate(request) ? (
                      <Badge variant="danger" className="ml-1.5">
                        초과
                      </Badge>
                    ) : null}
                  </td>
                  <td className="truncate px-3 py-1.5 text-muted-foreground">
                    {departmentLabel(request.requesterDepartment)} ·{' '}
                    {requesterLabel(request)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    {periodLabel(request)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    {formatSlashDate(completionRequestDate(request))}
                  </td>
                  <td
                    className={cn(
                      'whitespace-nowrap px-3 py-1.5 tabular-nums',
                      request.completionRejectCount > 0 && 'text-danger',
                    )}
                  >
                    {request.completionRejectCount}회
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    {workDurationLabel(request.assignee, request.id) || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          선택한 기간에 완료한 업무가 없습니다.
        </p>
      )}
    </div>
  )
}

function receivedDate(request: WorkRequestRecord) {
  return (
    request.assignedAt ||
    request.plannedStart ||
    request.createdAt
  ).slice(0, 10)
}

function periodLabel(request: WorkRequestRecord) {
  return `${formatSlashDate(receivedDate(request))}~${formatSlashDate(requestDueDate(request))}`
}

function isLate(request: WorkRequestRecord) {
  const dueDate = requestDueDate(request)
  const finished = completionRequestDate(request)
  return Boolean(dueDate && finished && finished > dueDate)
}

function CompletedRow({
  request,
  duration,
  departmentLabel,
  requesterLabel,
  onOpen,
}: {
  request: WorkRequestRecord
  duration: string
  departmentLabel: (value: string) => string
  requesterLabel: (request: WorkRequestRecord) => string
  onOpen: (request: WorkRequestRecord) => void
}) {
  const finished = completionRequestDate(request)
  const late = isLate(request)

  return (
    <tr
      title={`${departmentLabel(request.requesterDepartment)} · ${requesterLabel(request)}`}
      className={cn(
        'cursor-pointer border-t border-border/70 hover:bg-muted/50',
        late && 'bg-danger/5',
      )}
      onClick={() => onOpen(request)}
    >
      <td className="max-w-0 px-2 py-1">
        <span className="block truncate font-medium">
          {request.values.title}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-1 tabular-nums">
        {periodLabel(request)}
      </td>
      <td className="whitespace-nowrap px-2 py-1 tabular-nums">
        {formatSlashDate(finished)}
      </td>
      <td
        className={cn(
          'whitespace-nowrap px-2 py-1 tabular-nums',
          request.completionRejectCount > 0 && 'text-danger',
        )}
      >
        {request.completionRejectCount}
      </td>
      <td className="whitespace-nowrap px-2 py-1 tabular-nums">
        {duration || '—'}
      </td>
    </tr>
  )
}
