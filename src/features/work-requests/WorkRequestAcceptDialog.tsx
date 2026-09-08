import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  LOCAL_SELF_ID,
  PRIORITY_META,
  type LocalTeamMember,
  type ManagerPriority,
} from './work-request-types'
import type { WorkRequestRecord } from './work-request-types'

export type AcceptDecision = {
  managerPriority: ManagerPriority
  confirmedDueDate: string
  collaborators: string[]
}

export function WorkRequestAcceptDialog({
  request,
  teamMembers,
  onClose,
  onConfirm,
}: {
  request: WorkRequestRecord
  teamMembers: LocalTeamMember[]
  onClose: () => void
  onConfirm: (decision: AcceptDecision) => void
}) {
  const [managerPriority, setManagerPriority] = useState<ManagerPriority>(
    request.managerPriority || 'normal',
  )
  const [confirmedDueDate, setConfirmedDueDate] = useState(
    request.confirmedDueDate || request.values.dueDate,
  )
  const [collaborators, setCollaborators] = useState<string[]>(
    request.collaborators,
  )

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
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold">요청 수락</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          우선순위와 확정 마감일을 정하면 미배정 목록으로 넘어갑니다.
        </p>
        <div className="mt-4 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">부서 우선순위</span>
            <Select
              className="w-full"
              value={managerPriority}
              onChange={(event) =>
                setManagerPriority(event.target.value as ManagerPriority)
              }
            >
              {Object.entries(PRIORITY_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">확정 마감일</span>
            <Input
              type="date"
              value={confirmedDueDate}
              onChange={(event) => setConfirmedDueDate(event.target.value)}
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">협업자</legend>
            <div className="grid grid-cols-2 gap-2">
              {teamMembers.map((member) => {
                const checked = collaborators.includes(member.id)
                return (
                  <label
                    key={member.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm',
                      checked ? 'border-primary bg-primary/5' : 'border-border',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      className="size-4 accent-primary"
                      onChange={() =>
                        setCollaborators((current) =>
                          checked
                            ? current.filter((id) => id !== member.id)
                            : [...current, member.id],
                        )
                      }
                    />
                    <span className="truncate">
                      {member.name}
                      {member.id === LOCAL_SELF_ID ? ' (나)' : ''} ·{' '}
                      {member.position}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            disabled={!confirmedDueDate}
            onClick={() =>
              onConfirm({
                managerPriority,
                confirmedDueDate,
                collaborators,
              })
            }
          >
            수락
          </Button>
        </div>
      </div>
    </div>
  )
}
