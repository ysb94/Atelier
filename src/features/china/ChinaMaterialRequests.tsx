import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChinaAssignmentWarning } from './ChinaAssignmentWarning'
import { Check, SquareArrowOutUpRight, X } from 'lucide-react'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { StatusPill } from '@/components/ui/status-pill'
import { RequestBodyPreview } from '@/features/work-requests/WorkRequestPage'
import type { MaterialRequest } from '@/features/planning/MaterialRequestDialog'
import { elapsedMaterialRequestDays } from '@/features/planning/material-request-days'
import { materialRequestError, useMaterialRequests } from '@/features/planning/useMaterialRequests'
import { readMaterialDetail } from '@/lib/supabase/material-requests'
import { latestMaterialAssignee, managerMaterialGroups, workerMaterialGroups } from './china-material-workload'

type Props =
  | { assignees: readonly { id: string; name: string }[]; activeAssigneeIds: ReadonlySet<string> | null; selectedAssigneeId: string | null; showHistory?: boolean }
  | { accountId: string }

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

export function ChinaMaterialRequests(props: Props) {
  const { brandById } = useCompanyBrandScope()
  const cache = useQueryClient()
  const { requests, query, mutation } = useMaterialRequests('china')
  const [detail, setDetail] = useState<{ requestId: string; roundNumber: number; request: MaterialRequest } | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const writing = useRef(false)
  const [warning, setWarning] = useState<{ heading?: string; messages: string[] } | null>(null)
  const [now, setNow] = useState(Date.now)
  const assignees = 'assignees' in props ? props.assignees : null
  const accountId = 'accountId' in props ? props.accountId : null
  const currentScope = 'assignees' in props ? props.selectedAssigneeId : null
  const showHistory = 'assignees' in props && Boolean(props.showHistory)
  const activeAssigneeIds = 'assignees' in props ? props.activeAssigneeIds : null
  const registeredIds = new Set(assignees?.map(person => person.id))
  const eligible = assignees?.filter(person => activeAssigneeIds?.has(person.id)) ?? []
  const rowGroups = accountId ? workerMaterialGroups(requests, accountId)
    : managerMaterialGroups(requests, currentScope, registeredIds, activeAssigneeIds, showHistory)
  const visible = rowGroups.flatMap(({ request, rounds }) => rounds.map(round => ({ request, round })))
  const hasPending = visible.some(({ round }) => !round.shippedAt)
  const reviewing = detail && visible.some(({ request }) => request.id === detail.requestId) ? detail : null
  useEffect(() => {
    if (!hasPending) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [hasPending])

  const detailToken = useRef(0)
  async function openRequest(listRequest: MaterialRequest, number: number) {
    const cached = detail?.requestId === listRequest.id
      ? detail.request.rounds.find(round => round.number === number)?.content
      : undefined
    if (cached && detail) {
      detailToken.current += 1
      setLoadingDetail(false)
      setDetail({ ...detail, roundNumber: number })
      return
    }
    const token = ++detailToken.current
    setError('')
    setDetailError('')
    setLoadingDetail(true)
    try {
      const loaded = await readMaterialDetail('china', listRequest.id, number)
      if (token !== detailToken.current) return
      const loadedRound = loaded.rounds.find(round => round.number === number)
      if (!loadedRound?.content) throw new Error('요청 내용 없음')
      setDetail(current => {
        const base = current?.requestId === listRequest.id ? current.request : listRequest
        return {
          requestId: listRequest.id,
          roundNumber: number,
          request: {
            ...loaded,
            rounds: base.rounds.map(round => round.number === number ? { ...round, ...loadedRound } : round),
          },
        }
      })
    } catch (cause) {
      if (token !== detailToken.current) return
      setError(materialRequestError(cause, '요청 내용을 불러오지 못했습니다. 다시 열어 주세요.'))
      void query.refetch()
    } finally {
      if (token === detailToken.current) setLoadingDetail(false)
    }
  }

  async function act(action: 'assign' | 'review' | 'confirm' | 'ship', request: MaterialRequest, round: MaterialRequest['rounds'][number], assignee?: string) {
    if (writing.current) return
    if (action === 'ship' && !round.assigneeRead) {
      setWarning({ heading: '한국 발송 전 확인', messages: ['요청 내용을 열고 확인을 눌러 주세요.'] })
      return
    }
    const inDetail = action === 'review' || action === 'confirm'
    writing.current = true
    setError('')
    setDetailError('')
    try {
      await mutation.mutateAsync({ action, request, round: round.number, assignee })
      if (inDetail) setDetail(null)
      setNow(Date.now())
    } catch (cause) {
      const message = materialRequestError(cause, '저장하지 못했습니다. 요청 상태를 확인하고 다시 시도해 주세요.')
      if (inDetail) setDetailError(message)
      else if (action === 'ship') setWarning({ heading: '한국 발송 전 확인', messages: [message] })
      else setError(message)
    } finally { writing.current = false }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" role="status">{loadingDetail ? '요청 내용을 불러오는 중…' : query.isPending ? '자재요청을 불러오는 중…' : ''}</p>
        <Button type="button" size="sm" variant="outline" disabled={query.isFetching || mutation.isPending} onClick={() => {
          void query.refetch()
          if (assignees) void cache.invalidateQueries({ queryKey: ['china-work-screen'] })
        }}>새로 조회</Button>
      </div>
      {(error || query.isError) && <p role="alert" className="text-sm text-danger">{error || materialRequestError(query.error, '자재요청 목록을 불러오지 못했습니다.')}</p>}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table aria-label="중국팀 자재요청 목록" className="w-full min-w-[820px] table-fixed text-sm">
            <colgroup>{accountId
              ? <><col className="w-[14%]" /><col className="w-[24%]" /><col className="w-[46%]" /><col className="w-[16%]" /></>
              : <><col className="w-[11%]" /><col className="w-[14%]" /><col className="w-[23%]" /><col className="w-[38%]" /><col className="w-[14%]" /></>}
            </colgroup>
            <thead className="bg-primary text-primary-foreground">
              <tr>{(accountId
                ? ['요청자 / Brand', '요청 내용', '요청 차수', '발송 처리']
                : ['요청자 / Brand', '담당자', '요청 내용', '요청 차수', '업무 배정']).map(label => (
                <th key={label} scope="col" className="px-3 py-3 text-center font-medium">{label}</th>
              ))}</tr>
            </thead>
            {query.isSuccess && rowGroups.length === 0 && <tbody><tr><td colSpan={accountId ? 4 : 5} className="p-10 text-center text-muted-foreground">
              {showHistory ? '완료된 자재요청이 없습니다.' : assignees && currentScope === null ? '새로운 자재요청이 없습니다.' : '배정된 자재요청이 없습니다.'}
            </td></tr></tbody>}
            {rowGroups.map(({ request, rounds }) => {
                const target = assignees && !showHistory ? rounds.filter(round => !round.shippedAt && (currentScope === null || round.assigneeId === currentScope)).at(-1) : undefined
                const latest = rounds.at(-1)!
                const assignmentForm = `material-assignment-${request.id}-${target?.number ?? 0}`
                const saved = eligible.find(person => person.id === target?.assigneeId)
                const previous = target ? latestMaterialAssignee(request, target.number) : undefined
                const continuingId = previous?.assigneeId && (!saved || saved.id === previous.assigneeId)
                  && registeredIds.has(previous.assigneeId) && activeAssigneeIds?.has(previous.assigneeId) ? previous.assigneeId : ''
                const defaultId = saved?.id ?? continuingId
                const groupAssigneeId = target ? defaultId : latest.assigneeId
                return (
                  <tbody key={request.id} className="border-b border-primary/35 last:border-b-0">
                    {rounds.map((round, index) => {
                      const days = elapsedMaterialRequestDays(round.requestedAt, round.shippedAt ?? now)
                      const read = assignees ? Boolean(round.reviewedAt) : round.assigneeRead
                      return <tr key={round.number} className="border-t border-border first:border-t-0">
                      {index === 0 && <td rowSpan={rounds.length} className="border-r border-border px-3 py-4 text-center align-middle">
                        <BrandAvatar brand={brandById.get(latest.brandId) ?? { name: '미정', color: 'gray', logoUrl: null }} className="mx-auto size-8 rounded-full text-[10px]" />
                        <p className="mt-2 text-xs">요청자 · {request.ownerName || '—'}</p>
                      </td>}
                      {!accountId && index === 0 && <td rowSpan={rounds.length} className="border-r border-border px-3 py-4 text-center align-middle">
                        {target ? <form id={assignmentForm} onSubmit={event => {
                          event.preventDefault()
                          const assigneeId = continuingId || String(new FormData(event.currentTarget).get('assignee') ?? '')
                          const missing = []
                          if (!activeAssigneeIds) missing.push('담당자의 재직 상태를 먼저 확인해 주세요.')
                          else if (continuingId && !registeredIds.has(continuingId)) missing.push('기존 담당자를 담당자 탭에 다시 추가해 주세요.')
                          else if (!eligible.some(person => person.id === assigneeId)) missing.push('담당자를 지정해 주세요.')
                          if (!target.reviewedAt) missing.push('요청사항을 열고 확인을 눌러 주세요.')
                          if (missing.length) {
                            setWarning({ messages: missing })
                            return
                          }
                          void act('assign', request, target, assigneeId)
                        }}>
                          <Select key={defaultId} name="assignee" aria-label={`${target.title} 담당자 배정`} defaultValue={defaultId}
                            disabled={Boolean(continuingId) || !activeAssigneeIds}
                            title={continuingId ? '이전 차수를 맡은 재직 직원에게 이어서 배정합니다.' : undefined}>
                            <option value="" disabled>담당자</option>
                            {eligible.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                          </Select>
                          {previous && !saved && !continuingId && activeAssigneeIds && <p className="mt-1 text-xs text-muted-foreground">새 담당자를 선택해 주세요.</p>}
                        </form> : <span className="font-medium">{latest.assigneeName || '—'}</span>}
                      </td>}
                      {index === 0 && <th scope="rowgroup" rowSpan={rounds.length} className="break-words border-r border-border px-4 py-4 text-left align-middle font-medium">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 break-words">{latest.title}</span>
                          <Button type="button" size="icon" variant="outline" className="size-7 shrink-0"
                            aria-expanded={reviewing?.requestId === request.id} disabled={mutation.isPending}
                            aria-label={`${latest.title} 열기`} onClick={() => void openRequest(request, (target ?? latest).number)}>
                            <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </th>}
                      <th scope="row" className="border-r border-border px-4 py-3 text-left align-middle font-normal">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-3 whitespace-nowrap">
                            <strong className="font-medium">{round.number}차 요청</strong>
                            <span className={`font-semibold tabular-nums ${round.shippedAt ? 'text-foreground' : 'text-primary'}`}
                              title={round.shippedAt ? '요청부터 한국 발송까지 걸린 기간' : '요청부터 오늘까지 지난 기간'}>
                              {round.shippedAt ? '' : '+ '}{days}days
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {read && <Badge variant="success" className="h-8 shrink-0 gap-1 rounded-md">
                              <Check className="size-3.5" aria-hidden="true" />읽음
                            </Badge>}
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="whitespace-nowrap">{dateFormat.format(round.requestedAt)} 요청</span>
                          {round.shippedAt && <span className="whitespace-nowrap">{dateFormat.format(round.shippedAt)} 한국 발송</span>}
                          {round.received && <span className="whitespace-nowrap">본사 수령 완료</span>}
                          {assignees && round.assigneeName && round.assigneeId !== groupAssigneeId && <span>이 차수 담당 · {round.assigneeName}</span>}
                        </div>
                      </th>
                      {accountId ? <td className="px-3 py-3 text-center">
                        {round.shippedAt ? <StatusPill tone="success">발송 완료</StatusPill>
                          : <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void act('ship', request, round)}>발송 처리</Button>}
                      </td> : index === 0 && <td rowSpan={rounds.length} className="px-3 py-4 text-center align-middle">
                        {target ? <Button type="submit" form={assignmentForm} size="sm" variant="outline" disabled={mutation.isPending}>업무 배정</Button>
                          : <StatusPill tone={showHistory ? 'success' : 'muted'}>{showHistory ? '완료' : '완료 대기'}</StatusPill>}
                      </td>}
                    </tr>
                    })}
                  </tbody>
                )
              })}
          </table>
        </div>
      </Card>
      {warning && <ChinaAssignmentWarning {...warning} onClose={() => setWarning(null)} />}
      {reviewing && <WorkspaceTabOverlay>
        <MaterialRequestReview request={reviewing.request} roundNumber={reviewing.roundNumber} loading={loadingDetail}
          brandName={brandById.get(reviewing.request.rounds.find(round => round.number === reviewing.roundNumber)?.brandId ?? '')?.name ?? '브랜드 미정'}
          busy={mutation.isPending} error={detailError} isWorker={Boolean(accountId)} onClose={() => setDetail(null)}
          onSelectRound={number => void openRequest(reviewing.request, number)}
          onConfirm={round => void act(accountId ? 'confirm' : 'review', reviewing.request, round)} />
      </WorkspaceTabOverlay>}
    </div>
  )
}

function MaterialRequestReview({ request, roundNumber, brandName, isWorker, busy, loading, error, onClose, onSelectRound, onConfirm }: {
  request: MaterialRequest
  roundNumber: number
  brandName: string
  isWorker: boolean
  busy: boolean
  loading: boolean
  error: string
  onClose: () => void
  onSelectRound: (number: number) => void
  onConfirm: (round: MaterialRequest['rounds'][number]) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const round = request.rounds.find(item => item.number === roundNumber) ?? request.rounds.at(-1)!
  useEffect(() => { dialog.current?.showModal() }, [])
  const confirmed = isWorker ? round.assigneeRead : Boolean(round.reviewedAt)
  return (
    <dialog ref={dialog} aria-labelledby="material-review-title" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-3xl overflow-hidden border-l border-border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-foreground/30">
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h2 id="material-review-title" className="text-base font-semibold">{request.rounds.at(-1)?.title || request.title}</h2>
          <Button type="button" size="icon" variant="ghost" aria-label="자재 요청 닫기" disabled={busy} onClick={onClose}><X size={18} /></Button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <FilterTabs
            tabs={request.rounds.map(item => ({
              value: String(item.number),
              label: `${item.number}차 작성`,
            }))}
            value={String(round.number)}
            onChange={value => onSelectRound(Number(value))}
            ariaLabel="자재요청 차수"
            variant="underline"
          />
          <section className="space-y-3 rounded-lg border border-border p-4" aria-label="전송한 요청 내용">
            <p className="text-xs text-muted-foreground">{brandName}</p>
            <h3 className="break-words text-base font-semibold">{round.title}</h3>
            {loading && !round.content ? <p className="text-sm text-muted-foreground">요청 내용을 불러오는 중…</p>
              : round.content ? <RequestBodyPreview blocks={round.content.blocks} richPreview />
                : <p className="text-sm text-muted-foreground">이 차수의 작성 내용이 기록되어 있지 않습니다.</p>}
          </section>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
          {isWorker && <Button type="button" variant="outline" disabled={busy} onClick={onClose}>닫기</Button>}
          {confirmed ? <StatusPill tone="success">확인했습니다</StatusPill>
            : !round.shippedAt && <Button type="button" disabled={busy || loading} onClick={() => onConfirm(round)}>확인</Button>}
        </footer>
      </div>
    </dialog>
  )
}
