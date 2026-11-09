import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status-pill'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn } from '@/lib/utils'
import { VisualCategoryComments } from './VisualCategoryComments'
import { formatDateTime } from './work-request-schedule'
import type { ContentBlock } from './work-request-types'
import type { VisualWorkDetail } from './visual-work-detail'

export function VisualWorkRequestDrawer({
  requestId, title, detail, initialCategory, viewerId, canManage, isRequester,
  header, notice, mainReferences, management, memberName, renderBody, renderAssignment,
}: {
  requestId: string
  title: string
  detail: VisualWorkDetail
  initialCategory: string | null
  viewerId: string
  canManage: boolean
  isRequester: boolean
  header: (menuAction: ReactNode) => ReactNode
  notice?: ReactNode
  mainReferences?: ReactNode
  management?: ReactNode
  memberName: (id: string) => string
  renderBody: (blocks: ContentBlock[]) => ReactNode
  renderAssignment: (categoryId: string) => ReactNode
}) {
  useRenderWatch('VisualWorkRequestDrawer')
  const location = useLocation()
  const instance = useId()
  const body = useRef<HTMLDivElement>(null)
  const [chosen, setChosen] = useState(initialCategory)
  const [linkStatus, setLinkStatus] = useState('')
  const current = detail.sections.find(section => section.id === chosen) ?? detail.sections[0]

  function choose(id: string) {
    setChosen(id)
    setLinkStatus('')
    body.current?.scrollTo({ top: 0 })
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const length = detail.sections.length
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = length - 1
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + length - 1) % length
    else return
    event.preventDefault()
    choose(detail.sections[next].id)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
  }

  async function copyLink() {
    const url = new URL(location.pathname + location.search, window.location.origin)
    url.searchParams.set('requestId', requestId)
    if (current) url.searchParams.set('visualTab', current.id)
    try {
      await navigator.clipboard.writeText(url.href)
      setLinkStatus('분류 링크를 복사했습니다.')
    } catch {
      console.warn('[visual-work-detail] 링크 복사 실패')
      setLinkStatus('링크를 복사하지 못했습니다.')
    }
  }

  const assigned = current?.assignment
  const panelId = instance + '-panel'
  return (
    <aside aria-label={title + ' 상세'} className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl">
      {header(current && <Button type="button" variant="ghost" size="sm" onClick={event => {
        event.currentTarget.closest('details')?.removeAttribute('open')
        void copyLink()
      }}><Link2 className="size-4" />링크 복사</Button>)}
      {current && <div
        role="tablist" aria-label="Visual 업무 분류"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card p-2 lg:absolute lg:right-full lg:top-28 lg:max-h-[calc(100dvh-8rem)] lg:w-10 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:border-0 lg:bg-transparent lg:p-0"
      >
        {detail.sections.map((section, index) => {
          const selected = section.id === current.id
          return <button
            key={section.id} type="button" role="tab"
            id={instance + '-' + section.id}
            aria-selected={selected} aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1} title={section.label}
            onClick={() => choose(section.id)} onKeyDown={event => handleTabKey(event, index)}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium outline-offset-[-2px] lg:max-h-36 lg:min-h-16 lg:overflow-hidden lg:rounded-r-none lg:rounded-l-xl lg:px-2 lg:py-3 lg:text-ellipsis lg:[writing-mode:vertical-rl]',
              selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >{section.label}</button>
        })}
      </div>}
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {notice}
        <div id={panelId} role={current ? 'tabpanel' : undefined}
          aria-labelledby={current ? instance + '-' + current.id : undefined} className="space-y-4">
          {current && <Card><CardContent className="space-y-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="break-words text-sm">{current.label}</strong>
              {linkStatus && <span role="status" className="text-xs text-muted-foreground">{linkStatus}</span>}
            </div>
            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-4">
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">배정 관리자</dt><dd className="break-words font-medium">{assigned?.assignedBy ? memberName(assigned.assignedBy) : '—'}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">담당자</dt><dd className="break-words font-medium">{assigned?.assigneeId ? memberName(assigned.assigneeId) : '미지정'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">배정 상태</dt><dd><StatusPill tone={assigned?.assigneeId ? 'success' : 'muted'}>{assigned?.assigneeId ? '배정됨' : '미배정'}</StatusPill></dd></div>
              <div><dt className="text-xs text-muted-foreground">배정일</dt><dd>{assigned?.assignedAt ? formatDateTime(assigned.assignedAt) : '—'}</dd></div>
            </dl>
          </CardContent></Card>}
          <Card><CardContent className="space-y-3 p-4">
            <h3 className="text-sm font-semibold">메인 내용</h3>
            <div className="min-w-0 space-y-3 rounded-md border border-border bg-background p-3">
              {detail.main.length ? renderBody(detail.main) : !mainReferences && <p className="text-sm text-muted-foreground">등록된 메인 내용이 없습니다.</p>}
              {mainReferences}
            </div>
          </CardContent></Card>
          {current && <Card><CardContent className="space-y-3 p-4">
            <h3 className="text-sm font-semibold">{current.title}</h3>
            <div className="min-w-0 space-y-4 rounded-md border border-border bg-background p-3">
              {!!current.fields.length && <dl className="space-y-2 text-sm">
                {current.fields.map(field => <div key={field.id}>
                  <dt className="font-medium">{field.label}</dt>
                  <dd className="whitespace-pre-wrap break-words">{field.value}</dd>
                </div>)}
              </dl>}
              {current.blocks.length ? renderBody(current.blocks) : !current.fields.length && <p className="text-sm text-muted-foreground">등록된 분류 내용이 없습니다.</p>}
            </div>
          </CardContent></Card>}
          {current && canManage && renderAssignment(current.id)}
          {management && <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">업무 관리 및 이전 대화</summary>
            <div className="mt-4">{management}</div>
          </details>}
          {current && <VisualCategoryComments
            key={viewerId + ':' + requestId}
            requestId={requestId}
            category={current}
            canDiscuss={isRequester || canManage || Boolean(viewerId && assigned?.assigneeId === viewerId)}
          />}
        </div>
      </div>
    </aside>
  )
}
