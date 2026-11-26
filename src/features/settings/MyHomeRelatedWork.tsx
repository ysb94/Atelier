import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusPill, type StatusTone } from '@/components/ui/status-pill'
import { useRenderWatch } from '@/lib/diagnostics'
import { WORK_REQUEST_CONFIG } from '@/features/work-requests/work-request-form-config'
import { STATUS_META, type RequestStatus } from '@/features/work-requests/work-request-types'
import { VISUAL_CATEGORY_STATES } from '@/features/work-requests/visual-category-workflow'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { type PersonalWorkCard } from '@/lib/supabase/personal-work'
import { listMyHomeRelatedWork, personalRelatedWork, relatedWorkKey,
  type RelatedWorkCursor, type RelatedWorkItem, type RelatedWorkTarget, type RelatedWorkView } from '@/lib/supabase/my-home-related-work'
import { emptyList } from '@/lib/utils'
import { personalWorkCardsKey } from './use-personal-work-feedback-notices'

const activityDate = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })
const personalStatuses: Record<string, { label: string; variant: StatusTone }> = {
  todo: { label: 'ToDo', variant: 'muted' }, doing: { label: 'ing', variant: 'default' },
  feedback: { label: 'feedback', variant: 'warning' }, done: { label: 'done', variant: 'success' },
}
const refreshSources = new Set(['personal-work-cards', 'personal-work-feedback-notices', 'visual-workflow-notices',
  'work-requests', 'department-work', 'work-request-settings'])

function relatedWorkHref(item: RelatedWorkItem, target?: RelatedWorkTarget) {
  const params = new URLSearchParams({ requestId: item.id })
  if (target?.categoryId) params.set('visualTab', target.categoryId)
  if (target?.kind === 'requester_review') {
    params.set('part', 'my-work')
    params.set('visualReview', '1')
    return '/settings/profile?' + params
  }
  if (target?.kind === 'completionConfirm' || (!target && item.isRequester && !item.internal)) {
    params.set('part', 'work')
    params.set('workOwner', item.owner!)
    return '/settings/profile?' + params
  }
  return `/work-requests/${item.owner}?${params}`
}

function targetLabel(target: RelatedWorkTarget) {
  const state = VISUAL_CATEGORY_STATES[target.kind as keyof typeof VISUAL_CATEGORY_STATES]
  return [target.label, state ?? (target.kind === 'final_approval' ? '총괄 승인 대기'
    : target.kind === 'completionReview' ? '완료 검수 대기' : '결과 확인 대기')].filter(Boolean).join(' · ')
}

export function MyHomeRelatedWork({ actorId, active, cards, cardsReady, cardsError, onOpenPersonal }: {
  actorId?: string; active: boolean; cards: readonly PersonalWorkCard[]; cardsReady: boolean; cardsError: boolean
  onOpenPersonal: (item: RelatedWorkItem) => void
}) {
  useRenderWatch('MyHomeRelatedWork')
  const cache = useQueryClient()
  useEffect(() => {
    if (!active || !actorId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void cache.invalidateQueries({ queryKey: relatedWorkKey(actorId),
        predicate: query => (query.state.data as { pages?: { available: boolean }[] } | undefined)?.pages?.[0]?.available !== false,
      }), 150)
    }
    const unsubscribe = cache.getQueryCache().subscribe(event => {
      if (event.type !== 'updated' || !['success', 'invalidate'].includes(event.action.type)) return
      const key = event.query.queryKey
      if (refreshSources.has(String(key[0])) && (key.includes(actorId) || key[0] === 'work-request-settings')) refresh()
    })
    window.addEventListener('online', refresh)
    return () => { unsubscribe(); clearTimeout(timer); window.removeEventListener('online', refresh) }
  }, [active, actorId, cache])
  return <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:grid-cols-2" aria-label="관련 업무">
    {(['feedback', 'issued'] as const).map(view => <RelatedWorkPanel key={`${actorId}:${view}`} view={view}
      actorId={actorId} active={active} cards={cards} cardsReady={cardsReady} cardsError={cardsError} onOpenPersonal={onOpenPersonal} />)}
  </div>
}

function RelatedWorkPanel({ view, actorId, active, cards, cardsReady, cardsError, onOpenPersonal }: {
  view: RelatedWorkView; actorId?: string; active: boolean; cards: readonly PersonalWorkCard[]
  cardsReady: boolean; cardsError: boolean; onOpenPersonal: (item: RelatedWorkItem) => void
}) {
  const label = view === 'feedback' ? '피드백 온 업무' : '내가 지시한 업무'
  const cache = useQueryClient()
  const enabled = active && Boolean(actorId)
  const query = useInfiniteQuery({
    ...sharedReadPolicy, queryKey: [...relatedWorkKey(actorId), view], enabled,
    initialPageParam: null as RelatedWorkCursor | null,
    queryFn: ({ pageParam, signal }) => listMyHomeRelatedWork(view, pageParam, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchInterval: state => state.state.data?.pages[0]?.available === false ? false : readPollInterval(30_000, enabled)(state),
  })
  const fallback = query.data?.pages[0]?.available === false
  const [fallbackLimit, setFallbackLimit] = useState(20)
  const personal = useMemo(() => personalRelatedWork(cards, actorId, view), [actorId, cards, view])
  const rows = useMemo(() => {
    if (!actorId) return emptyList<RelatedWorkItem>()
    if (fallback) return personal.slice(0, fallbackLimit)
    const unique = new Map(query.data?.pages.flatMap(page => page.items).map(item => [item.key, item]))
    return [...unique.values()].sort((a, b) => b.activityAt.localeCompare(a.activityAt) || b.key.localeCompare(a.key))
  }, [actorId, fallback, fallbackLimit, personal, query.data])
  const total = actorId ? fallback ? personal.length : query.data?.pages[0]?.total ?? 0 : 0
  const more = fallback ? personal.length > fallbackLimit : query.hasNextPage
  const loading = enabled && (query.isPending || (fallback && !cardsReady && !cardsError))
  function reload() {
    void query.refetch()
    if (fallback) void cache.refetchQueries({ queryKey: personalWorkCardsKey(actorId), exact: true, type: 'active' })
  }

  return <Card role="region" aria-label={label} className="min-h-44 min-w-0 p-4">
    <header className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{label}</h2>
      <span className="text-xs tabular-nums text-muted-foreground">{fallback ? '개인 업무 ' : ''}{total}건</span>
    </header>
    {fallback && <p className="mb-3 text-xs text-muted-foreground" role="status">
      부서 업무 서버 연결 대기 중입니다. 개인 업무만 표시합니다.
      <Button type="button" size="sm" variant="ghost" onClick={reload}>연결 다시 확인</Button>
    </p>}
    {(query.isError || (fallback && cardsError)) && <div role="alert" className="mb-3 text-sm text-danger">
      업무 목록을 불러오지 못했습니다. {rows.length > 0 && '표시된 내용이 최신이 아닐 수 있습니다.'}
      <Button type="button" size="sm" variant="outline" onClick={reload}>다시 불러오기</Button>
    </div>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">업무를 불러오는 중입니다.</p>
      : rows.length ? <ul className="divide-y divide-border">
        {rows.map(item => {
          const status = item.finalApprovalPending ? { label: '총괄 승인 대기', variant: 'warning' as const }
            : item.source === 'personal' ? personalStatuses[item.status] : STATUS_META[item.status as RequestStatus]
          const contents = <>
            <span className="min-w-0 flex-1 wrap-anywhere font-medium">{item.title}</span>
            <StatusPill tone={status.variant}>{status.label}</StatusPill>
          </>
          const titleClass = 'flex w-full items-start justify-between gap-3 rounded py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring'
          const timestamp = Date.parse(item.activityAt)
          return <li key={item.key} className="min-w-0 py-2">
            {item.source === 'personal' ? <button type="button" className={titleClass} aria-haspopup="dialog" onClick={() => onOpenPersonal(item)}>{contents}</button>
              : <Link className={titleClass} to={relatedWorkHref(item, view === 'feedback' ? item.targets[0] : undefined)}>{contents}</Link>}
            <p className="wrap-anywhere text-xs text-muted-foreground">
              {item.owner ? `${WORK_REQUEST_CONFIG[item.owner].label} · 부서 업무` : '내 업무'}
              {' · 요청 '}{item.requesterName}{' · 담당 '}{item.assigneeNames.join(', ') || '미배정'}{item.round && ` · ${item.round}차`}
            </p>
            <time className="mt-1 block text-xs text-muted-foreground" dateTime={item.activityAt}>
              최근 활동 · {Number.isNaN(timestamp) ? '날짜 미정' : activityDate.format(timestamp)}
            </time>
            {view === 'feedback' && item.targets.length > 0 && <ul className="mt-2 flex flex-wrap gap-2" aria-label={`${item.title} 검토 항목`}>
              {item.targets.map(target => <li key={`${target.categoryId}:${target.kind}`}>
                <Link className="inline-block rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-muted"
                  to={relatedWorkHref(item, target)}>{targetLabel(target)}</Link>
              </li>)}
            </ul>}
          </li>
        })}
      </ul> : !query.isError && !(fallback && cardsError) && <p className="py-4 text-sm text-muted-foreground">
        {!actorId ? '본인 계정에서 확인할 수 있습니다.' : view === 'feedback' ? '피드백을 기다리는 업무가 없습니다.' : '지시한 업무가 없습니다.'}
      </p>}
    {more && <Button type="button" size="sm" variant="outline" className="mt-3 w-full" disabled={query.isFetching}
      onClick={() => { if (fallback) setFallbackLimit(limit => limit + 20); else void query.fetchNextPage() }}>
      {query.isFetchingNextPage ? '불러오는 중...' : '더 보기'}
    </Button>}
  </Card>
}
