import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import type { InboxNotification } from '@/lib/inbox/types'
import { materialNudgeKey, readMaterialNudge, sendMaterialNudge } from '@/lib/supabase/material-nudges'
import { listOrgChartMembers, type OrgChartMember } from '@/lib/supabase/profiles'
import type { MaterialRequest } from './MaterialRequestDialog'

function NudgeDialog({ title, busy = false, onClose, children }: {
  title: string
  busy?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog ref={dialog} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-foreground/30">
      <h2 id={titleId} className="text-base font-semibold">{title}</h2>
      {children}
    </dialog>
  )
}

function recipientName(member: OrgChartMember) {
  const position = member.position?.trim() || member.jobGrade?.trim() || ''
  const title = position === '대표이사' ? '대표' : position === '부대표이사' ? '부대표' : position
  return [member.displayName?.trim() || '이름 미등록', title].filter(Boolean).join(' ') + '님'
}

export function MaterialNudgeConfirm({ request, recipients, onClose, onSent }: {
  request: Pick<MaterialRequest, 'id' | 'title'> & { revision: number }
  recipients: readonly string[]
  onClose: () => void
  onSent: (count: number) => void
}) {
  const [eventId] = useState(() => crypto.randomUUID())
  const sending = useRef(false)
  const cache = useQueryClient()
  const members = useQuery({ queryKey: ['org-chart-members'], queryFn: listOrgChartMembers })
  const byId = new Map(members.data?.map(member => [member.id, member]))
  const people = recipients.map(id => byId.get(id)).filter(member => member !== undefined)
  const ready = members.isSuccess && recipients.length > 0 && people.length === recipients.length
  const send = useMutation({
    mutationFn: () => sendMaterialNudge({ requestId: request.id, revision: request.revision, recipients, eventId }),
    onSuccess: count => {
      void cache.invalidateQueries({ queryKey: ['material-nudge-notices'] })
      onSent(count)
    },
    onError: error => {
      if ((error.cause as { code?: string } | undefined)?.code === '40001') {
        void cache.invalidateQueries({ queryKey: ['material-nudge-recipients'] })
        void cache.invalidateQueries({ queryKey: ['material-requests'] })
      }
    },
    onSettled: () => { sending.current = false },
  })
  function confirm() {
    if (!ready || sending.current) return
    sending.current = true
    send.mutate()
  }
  return (
    <NudgeDialog title="자재요청 조르기" busy={send.isPending} onClose={onClose}>
      <div className="mt-4 space-y-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">받는 사람</p>
          {members.isPending && <p role="status">받는 사람을 불러오는 중…</p>}
          {members.isError && <p role="alert" className="text-danger">받는 사람을 불러오지 못했습니다.</p>}
          {members.isSuccess && !ready && <p role="alert" className="text-danger">조르기 설정에서 받는 사람을 다시 확인해 주세요.</p>}
          {ready && <p className="mt-1 break-words font-medium">{people.map(recipientName).join(', ')}</p>}
        </div>
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">보낼 내용</p>
          <p className="mt-1 whitespace-pre-wrap break-words">「{request.title}」 자재요청의 진행 상황을 확인해 주세요.</p>
        </div>
        <p className="text-xs text-muted-foreground">받는 사람은 이 요청의 저장된 내용과 첨부를 볼 수 있습니다.</p>
        {send.error && <p role="alert" className="text-danger">{send.error.message}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" autoFocus disabled={send.isPending} onClick={onClose}>취소</Button>
        <Button type="button" disabled={!ready || send.isPending} onClick={confirm}>{send.isPending ? '보내는 중…' : '확인'}</Button>
      </div>
    </NudgeDialog>
  )
}

export function MaterialNudgeNotice({ item, accountId, onClose }: {
  item: InboxNotification
  accountId: string
  onClose: () => void
}) {
  const visible = useNotificationDetailVisibility()
  const cache = useQueryClient()
  const started = useRef(false)
  const { mutate: markRead, isError } = useMutation({
    mutationFn: () => readMaterialNudge(item.id),
    onSuccess: () => cache.invalidateQueries({ queryKey: materialNudgeKey(accountId) }),
  })
  useEffect(() => {
    if (!visible || item.readAt || started.current) return
    started.current = true
    markRead()
  }, [visible, item.readAt, markRead])

  return (
    <NudgeDialog title={item.title} onClose={onClose}>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.body}</p>
      {isError && <p role="alert" className="mt-2 text-sm text-danger">읽음 상태를 저장하지 못했습니다.</p>}
      <div className="mt-5 flex justify-end gap-2">
        {isError && <Button type="button" variant="outline" onClick={() => markRead()}>다시 시도</Button>}
        <Button type="button" onClick={onClose}>닫기</Button>
      </div>
    </NudgeDialog>
  )
}
