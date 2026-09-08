import { UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LOCAL_SELF_ID, PRIORITY_META, type LocalTeamMember } from './work-request-types'
import type { WorkRequestRecord } from './work-request-types'

const POSITION_RANK: Record<string, number> = {
  이사: 4,
  팀장: 3,
  과장: 2,
  대리: 1,
  사원: 0,
}

function positionRank(position: string) {
  return POSITION_RANK[position] ?? 0
}

function isHardPriority(priority: WorkRequestRecord['managerPriority']) {
  return priority === 'urgent' || priority === 'high'
}

export function WorkRequestAssignDialog({
  request,
  teamMembers,
  assigned,
  currentWorkByMember,
  onClose,
  onOpenDetail,
  onAssign,
}: {
  request: WorkRequestRecord
  teamMembers: LocalTeamMember[]
  assigned: WorkRequestRecord[]
  currentWorkByMember: Record<string, string>
  onClose: () => void
  onOpenDetail: () => void
  onAssign: (memberId: string) => void
}) {
  const hard = isHardPriority(request.managerPriority)
  const self = teamMembers.find((member) => member.id === LOCAL_SELF_ID)
  const others = teamMembers
    .filter((member) => member.id !== LOCAL_SELF_ID)
    .sort((left, right) => {
      if (hard) {
        return positionRank(right.position) - positionRank(left.position)
      }
      const leftBusy = Number(Boolean(currentWorkByMember[left.id]))
      const rightBusy = Number(Boolean(currentWorkByMember[right.id]))
      if (leftBusy !== rightBusy) return leftBusy - rightBusy
      return involvedCount(assigned, left.id) - involvedCount(assigned, right.id)
    })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[min(36rem,calc(100vh-2rem))] w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">담당자 선택</h2>
          <p className="mt-1 text-sm font-medium">{request.values.title}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {hard
              ? '난이도가 높습니다. 팀장이 직접 하거나, 숙련된 사람에게 맡기세요.'
              : '팀장이 직접 하거나, 여유 있는 사람에게 맡기세요.'}
          </p>
          {request.managerPriority ? (
            <div className="mt-2">
              <Badge variant={PRIORITY_META[request.managerPriority].variant}>
                우선순위 {PRIORITY_META[request.managerPriority].label}
              </Badge>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {self ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
                직접 맡기
              </p>
              <MemberAssignRow
                member={self}
                assigned={assigned}
                currentWorkByMember={currentWorkByMember}
                recommended
                recommendLabel="내가 하기"
                onAssign={onAssign}
              />
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
              부서 구성원
            </p>
            <div className="space-y-2">
              {others.map((member) => (
                <MemberAssignRow
                  key={member.id}
                  member={member}
                  assigned={assigned}
                  currentWorkByMember={currentWorkByMember}
                  recommended={hard && positionRank(member.position) >= 1}
                  recommendLabel="숙련 추천"
                  onAssign={onAssign}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" onClick={onOpenDetail}>
            상세
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
        </div>
      </div>
    </div>
  )
}

function involvedCount(assigned: WorkRequestRecord[], memberId: string) {
  return assigned.filter(
    (request) =>
      request.assignee === memberId || request.collaborators.includes(memberId),
  ).length
}

function MemberAssignRow({
  member,
  assigned,
  currentWorkByMember,
  recommended,
  recommendLabel,
  onAssign,
}: {
  member: LocalTeamMember
  assigned: WorkRequestRecord[]
  currentWorkByMember: Record<string, string>
  recommended: boolean
  recommendLabel: string
  onAssign: (memberId: string) => void
}) {
  const current = assigned.find(
    (request) => request.id === currentWorkByMember[member.id],
  )
  const todoCount = involvedCount(assigned, member.id)
  const idle = !current

  return (
    <button
      type="button"
      onClick={() => onAssign(member.id)}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
        recommended ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
      )}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {member.id === LOCAL_SELF_ID ? (
          <UserPlus className="size-4" />
        ) : (
          member.name.slice(0, 1)
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">
            {member.name}
            {member.isSelf ? ' (나)' : ''} · {member.position}
          </span>
          {recommended ? <Badge variant="default">{recommendLabel}</Badge> : null}
          {idle ? (
            <Badge variant="muted">여유</Badge>
          ) : (
            <Badge variant="outline">하는 중</Badge>
          )}
        </span>
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">
          {current
            ? `지금 ${current.values.title}`
            : todoCount > 0
              ? `할 일 ${todoCount}건 · 지금은 안 함`
              : '맡은 일 없음'}
        </span>
      </span>
    </button>
  )
}
