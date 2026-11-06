import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SquareArrowOutUpRight, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { useReleaseAccess } from '@/components/layout/release-access-context'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { StatusPill } from '@/components/ui/status-pill'
import { RequestBodyPreview } from '@/features/work-requests/WorkRequestPage'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import { materialNudgeKey, readMaterialNudge } from '@/lib/supabase/material-nudges'
import { confirmMaterialNudgeRequest, materialNudgeRequestsKey, readMaterialNudgeRequest, readMaterialNudgeRequests } from '@/lib/supabase/material-requests'
import { materialNudgeHref, type MaterialNudgeTarget } from '@/lib/workspace/material-request-navigation'
import type { MaterialRequest } from './MaterialRequestDialog'

function nudgeErrorCode(error: unknown) {
  return error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined
}

function nudgeViewError(error: unknown) {
  if (nudgeErrorCode(error) === '42501') return '공유 권한이 바뀌었거나 요청이 삭제되어 내용을 열 수 없습니다.'
  return '자재요청을 불러오지 못했습니다. 다시 시도해 주세요.'
}

export function MaterialNudgeRequestList({ accountId, paused, onBack }: {
  accountId: string
  paused: boolean
  onBack?: () => void
}) {
  useRenderWatch('MaterialNudgeRequestList')
  const { brandById } = useCompanyBrandScope()
  const { materialNudgeNotifications } = useReleaseAccess()
  const active = useWorkspaceTabActivity()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const inboxIds = useMemo(() => materialNudgeNotifications.map(item => item.id).sort().join(','), [materialNudgeNotifications])
  const previousInboxIds = useRef(inboxIds)
  const requests = useQuery({
    queryKey: materialNudgeRequestsKey(accountId),
    queryFn: ({ signal }) => readMaterialNudgeRequests(signal),
    enabled: Boolean(accountId) && active && !paused,
    retry: false,
    staleTime: 10_000,
  })
  useEffect(() => {
    if (previousInboxIds.current === inboxIds) return
    previousInboxIds.current = inboxIds
    void cache.invalidateQueries({ queryKey: materialNudgeRequestsKey(accountId) })
  }, [accountId, cache, inboxIds])
  return <div className="space-y-4">
    <PageHeader title="자재요청" description="조르기 알림으로 공유받은 요청의 내용과 진행 상태를 확인합니다." />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-medium">받은 조르기</h2>
      <div className="flex gap-2">
        {onBack && <Button type="button" size="sm" variant="outline" onClick={onBack}>일반 자재요청</Button>}
        <Button type="button" size="sm" variant="outline" disabled={requests.isFetching || paused}
          onClick={() => void requests.refetch()}>새로 조회</Button>
      </div>
    </div>
    {requests.isError ? <p role="alert" className="text-sm text-danger">{nudgeViewError(requests.error)}</p> : requests.isPending
      ? <p role="status" className="text-sm text-muted-foreground">받은 요청을 불러오는 중…</p>
      : <Card className="overflow-x-auto">
        <table aria-label="공유받은 자재요청" className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-primary text-primary-foreground"><tr>
            {['요청 제목', '요청자', '브랜드', '상태'].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {requests.data.map(request => <tr key={request.id}>
              <th scope="row" className="px-4 py-2 font-medium">
                <Button type="button" variant="ghost" className="h-auto whitespace-normal px-0 text-left"
                  onClick={() => navigate(materialNudgeHref({ scope: 'request', id: request.id }))}>
                  <span className="break-words">{request.title}</span><SquareArrowOutUpRight size={14} aria-hidden="true" />
                </Button>
              </th>
              <td className="px-4 py-2">{request.ownerName || '—'}</td>
              <td className="px-4 py-2">{brandById.get(request.brandId)?.name ?? '브랜드 미정'}</td>
              <td className="px-4 py-2"><StatusPill tone={request.status === '완료' ? 'success' : 'muted'}>{request.status}</StatusPill></td>
            </tr>)}
            {!requests.data.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
              확인할 조르기가 없습니다.
            </td></tr>}
          </tbody>
        </table>
      </Card>}
  </div>
}

export function MaterialNudgeDetailDialog({ accountId, target, onClose }: {
  accountId: string
  target: MaterialNudgeTarget
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const visible = useNotificationDetailVisibility()
  const cache = useQueryClient()
  const { brandById } = useCompanyBrandScope()
  const [round, setRound] = useState<number>()
  const queryKey = ['material-nudge-detail', accountId, target.scope, target.id] as const
  const latest = useQuery({
    queryKey: [...queryKey, 'latest'],
    queryFn: ({ signal }) => readMaterialNudgeRequest(target, signal),
    retry: false,
    gcTime: 0,
  })
  const previous = useQuery({
    queryKey: [...queryKey, round],
    queryFn: ({ signal }) => readMaterialNudgeRequest(target, signal, round),
    enabled: round !== undefined && latest.isSuccess,
    retry: false,
    gcTime: 0,
  })
  const request = latest.isSuccess ? latest.data.request : null
  const current = Boolean(request && (!request.rounds.length || (request.status === '요청예정'
    && (request.draftStage === 'writing' || request.draftStage === 'ready'))))
  const latestRound = request?.rounds.at(-1)
  const latestTab = current ? 'current' : String(latestRound?.number)
  const shown = round === undefined ? latest : previous
  const content = request && shown.isSuccess
    ? round === undefined && current ? shown.data.request
      : shown.data.request.rounds.find(item => item.number === (round ?? latestRound?.number))?.content
    : undefined
  const attempted = useRef(false)
  const { mutate: markRead, isError: readError } = useMutation({
    mutationFn: () => readMaterialNudge(target.id),
    onSuccess: () => cache.invalidateQueries({ queryKey: materialNudgeKey(accountId) }),
  })
  const pendingNoticeIds = target.scope === 'request' ? latest.data?.pendingNoticeIds : undefined
  const confirmation = useMutation({
    mutationFn: async (noticeIds: string[]) => {
      const trace = startWorkflow('notification', 'confirm_material_nudge_request')
      trace.step('match_displayed_notices', { count: noticeIds.length })
      try {
        const stillPending = await trace.run('save_confirmation', context => confirmMaterialNudgeRequest(target.id, noticeIds, context))
        await trace.run('refresh_queries', async () => {
          const listKey = materialNudgeRequestsKey(accountId)
          await cache.cancelQueries({ queryKey: listKey })
          if (!stillPending) cache.setQueryData<MaterialRequest[]>(listKey, rows => rows?.filter(item => item.id !== target.id))
          await cache.invalidateQueries({ queryKey: listKey, refetchType: 'none' })
          void cache.invalidateQueries({ queryKey: materialNudgeKey(accountId) })
        }, { writeOutcome: 'committed' })
        trace.done({ writeOutcome: 'committed' })
      } catch (error) {
        trace.fail(error)
        throw error
      }
    },
  })
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  useEffect(() => {
    if (!visible || !content || !dialog.current?.open || target.scope !== 'notice' || latest.data?.readAt || attempted.current) return
    attempted.current = true
    markRead()
  }, [visible, content, target.scope, latest.data?.readAt, markRead])

  return <dialog ref={dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}
    className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-3xl overflow-hidden border-l border-border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-foreground/30">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <h2 id={titleId} className="font-semibold">자재요청 상세 보기</h2>
        <Button type="button" size="icon" variant="ghost" aria-label="자재요청 상세 닫기" onClick={onClose}><X size={18} /></Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {request && <FilterTabs tabs={[
          ...request.rounds.map(item => ({
            value: String(item.number),
            label: `${item.number}차 작성`,
            subtitle: item.satisfaction === undefined ? undefined : `만족도 ${item.satisfaction}/10`,
          })),
          ...(current ? [{ value: 'current', label: '최근 저장 요청' }] : []),
        ]} value={round === undefined ? latestTab : String(round)} ariaLabel="자재요청 작성 이력" variant="underline"
          onChange={tab => setRound(tab === latestTab ? undefined : Number(tab))} />}
        {shown.isPending && <p role="status" className="text-sm text-muted-foreground">요청 내용을 불러오는 중…</p>}
        {shown.isError && <div role="alert" className="space-y-2 text-sm text-danger">
          <p>{nudgeViewError(shown.error)}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void shown.refetch()}>다시 조회</Button>
        </div>}
        {content && <section aria-label="공유된 요청 내용" className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">{brandById.get(content.brandId)?.name ?? '브랜드 미정'}</p>
          <h3 className="break-words text-base font-semibold">{content.title}</h3>
          {content.blocks.length ? <RequestBodyPreview blocks={content.blocks} richPreview />
            : <p className="text-sm text-muted-foreground">저장된 요청 내용이 없습니다.</p>}
        </section>}
        {readError && <div role="alert" className="space-y-2 text-sm text-danger">
          <p>읽음 상태를 저장하지 못했습니다.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => { if (visible && content) markRead() }}>다시 시도</Button>
        </div>}
      </div>
      {Boolean(pendingNoticeIds?.length) && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-3">
        {confirmation.isError && <p role="alert" className="mr-auto text-sm text-danger">
          {nudgeErrorCode(confirmation.error) === '42501' ? '공유 권한이 바뀌어 확인 완료할 수 없습니다.'
            : '확인 완료를 저장하지 못했습니다. 다시 시도해 주세요.'}
        </p>}
        <Button type="button" disabled={!visible || !content || confirmation.isPending} onClick={() => {
          if (visible && content && pendingNoticeIds?.length && !confirmation.isPending) {
            confirmation.mutate(pendingNoticeIds, { onSuccess: onClose })
          }
        }}>{confirmation.isPending ? '저장 중…' : '확인 완료'}</Button>
      </footer>}
    </div>
  </dialog>
}
