import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { EllipsisVertical, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn } from '@/lib/utils'
import { VisualCategoryComments } from './VisualCategoryComments'
import type { ContentBlock } from './work-request-types'
import { visualWorkDate, type VisualWorkDetail } from './visual-work-detail'

function SummaryCell({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return <div className="flex min-w-0 flex-col items-center justify-center gap-1.5 bg-card px-2 py-3 text-center lg:min-h-24" title={title}>
    <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
    <dd className="max-w-full wrap-anywhere text-sm font-medium sm:text-base">{children}</dd>
  </div>
}

function SummaryDate({ value }: { value: string }) {
  const date = visualWorkDate(value)
  if (!date) return '미정'
  return <time dateTime={value} title={[date.fullDate, date.time].filter(Boolean).join(' ')} className="block tabular-nums">
    {date.shortDate}
    {date.time && <span className="block text-xs font-normal leading-4 text-muted-foreground">{date.time}</span>}
  </time>
}

function ContentSection({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="bg-background/70 shadow-none">
    <CardContent className="space-y-4 p-4 sm:p-6">
      <CardTitle>{title}</CardTitle>
      <div className="min-w-0 space-y-5 rounded-md border border-border bg-card p-4 sm:p-6">{children}</div>
    </CardContent>
  </Card>
}

export function VisualWorkRequestDrawer({
  requestId, title, detail, initialCategory, viewerId, canManage, isRequester,
  summary, onClose, headerActions, notice, mainReferences, management, legacyConversation, memberName, renderBody, renderAssignment,
}: {
  requestId: string
  title: string
  detail: VisualWorkDetail
  initialCategory: string | null
  viewerId: string
  canManage: boolean
  isRequester: boolean
  summary: { requesterDepartment: string; requesterName: string; status: string; requestedAt: string; dueDate: string; brand: string; finalApprover?: string }
  onClose: () => void
  headerActions: ReactNode
  notice?: ReactNode
  mainReferences?: ReactNode
  management?: ReactNode
  legacyConversation?: ReactNode
  memberName: (id: string) => string
  renderBody: (blocks: ContentBlock[]) => ReactNode
  renderAssignment: (categoryId: string) => ReactNode
}) {
  useRenderWatch('VisualWorkRequestDrawer')
  const location = useLocation()
  const instance = useId()
  const body = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDetailsElement>(null)
  const [chosen, setChosen] = useState(initialCategory)
  const [linkStatus, setLinkStatus] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const current = detail.sections.find(section => section.id === chosen) ?? detail.sections[0]

  function choose(id: string) {
    setChosen(id)
    setLinkStatus('')
    menu.current?.removeAttribute('open')
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
    menu.current?.removeAttribute('open')
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
  const assignmentDate = assigned?.assignedAt && visualWorkDate(assigned.assignedAt)
  const panelId = instance + '-panel'
  const managementId = instance + '-management'
  return (
    <aside aria-label={title + ' 상세'} className="absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col border-l border-border bg-card shadow-2xl lg:w-[calc(100%-3rem)]">
      <header className="flex min-h-12 shrink-0 items-stretch justify-between border-b border-border bg-card">
        <div role="group" className="flex min-w-0 flex-wrap items-baseline gap-x-2 self-center py-2 pl-4 pr-2 sm:pl-8 lg:pl-10" aria-label="요청자">
          <span className="text-sm text-muted-foreground">{summary.requesterDepartment}</span>
          <strong className="wrap-anywhere text-base font-medium">{summary.requesterName}</strong>
        </div>
        <Button type="button" variant="ghost" aria-label="상세 닫기" onClick={onClose}
          className="h-auto w-12 shrink-0 rounded-none border-l border-border px-0 text-muted-foreground">
          <X className="size-6" />
        </Button>
      </header>
      {current && <div
        role="tablist" aria-label="Visual 업무 분류"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card p-2 lg:absolute lg:right-full lg:top-56 lg:max-h-[calc(100dvh-14rem)] lg:w-11 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:border-0 lg:bg-transparent lg:p-0"
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
              'shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-offset-[-4px] focus-visible:outline-primary-foreground lg:h-40 lg:w-full lg:overflow-hidden lg:rounded-r-none lg:rounded-l-xl lg:px-0 lg:py-3 lg:text-base lg:text-ellipsis lg:tracking-widest lg:[writing-mode:vertical-rl]',
              selected ? 'bg-primary' : 'bg-muted-foreground hover:bg-foreground/80',
            )}
          >{section.label}</button>
        })}
      </div>}
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto pb-6 sm:pb-8">
        <div id={panelId} role={current ? 'tabpanel' : undefined}
          aria-labelledby={current ? instance + '-' + current.id : undefined}>
          <div className="px-4 pt-6 sm:px-8 sm:pt-10 lg:px-10 lg:pt-12">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="min-w-0 wrap-anywhere text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
              <details ref={menu} className="relative shrink-0">
                <summary aria-label="업무 메뉴" className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden">
                  <EllipsisVertical className="size-5" />
                </summary>
                <div className="absolute right-0 z-10 grid min-w-32 gap-1 rounded-lg border border-border bg-card p-1.5 shadow-sm [&_button]:w-full [&_button]:justify-start">
                  {headerActions}
                  <Button type="button" variant="ghost" size="sm" onClick={() => void copyLink()}>링크 복사</Button>
                  {management && <Button type="button" variant="ghost" size="sm" aria-expanded={manageOpen} aria-controls={manageOpen ? managementId : undefined}
                    onClick={() => { setManageOpen(open => !open); menu.current?.removeAttribute('open') }}>
                    {manageOpen ? '업무 관리 닫기' : '업무 관리'}
                  </Button>}
                </div>
              </details>
            </div>
            <dl aria-label="업무 기본 정보" className={cn('grid grid-cols-2 gap-px border-y border-border bg-border sm:grid-cols-3', summary.finalApprover === undefined ? 'lg:grid-cols-6' : 'lg:grid-cols-7')}>
              {summary.finalApprover !== undefined && <SummaryCell label="총괄 관리자" title="이 업무의 최종 승인자">{summary.finalApprover}</SummaryCell>}
              <SummaryCell label="관리자" title="이 분류의 배정 관리자">{assigned?.assignedBy ? memberName(assigned.assignedBy) : '미지정'}</SummaryCell>
              <SummaryCell label="중간 관리자">{assigned?.assigneeId ? memberName(assigned.assigneeId) : '미지정'}</SummaryCell>
              <SummaryCell label="상태" title="업무 전체 상태">{summary.status}</SummaryCell>
              <SummaryCell label="요청 날짜"><SummaryDate value={summary.requestedAt} /></SummaryCell>
              <SummaryCell label="마감 날짜"><SummaryDate value={summary.dueDate} /></SummaryCell>
              <SummaryCell label="브랜드">{summary.brand}</SummaryCell>
            </dl>
            {linkStatus && <p role="status" className="mt-2 text-sm text-muted-foreground">{linkStatus}</p>}
            <div className="mt-6 space-y-5 sm:mt-8 sm:space-y-6 lg:mt-10">
              {notice}
              {manageOpen && <section id={managementId} aria-label="업무 관리" className="space-y-4">
                {current && <p className="text-sm text-muted-foreground">
                  {current.label} · {assigned?.assigneeId ? '배정됨' : '미배정'}
                  {assignmentDate && assigned && <time dateTime={assigned.assignedAt}> · {assignmentDate.fullDate} {assignmentDate.time}</time>}
                </p>}
                {current && canManage && renderAssignment(current.id)}
                {management}
              </section>}
              <ContentSection title="메인 내용">
                {detail.main.length ? renderBody(detail.main) : !mainReferences && <p className="text-sm text-muted-foreground">등록된 메인 내용이 없습니다.</p>}
                {mainReferences}
              </ContentSection>
              {current && <ContentSection title={current.title}>
                {!!current.fields.length && <dl className="space-y-1.5 text-[15px] leading-6">
                  {current.fields.map(field => <div key={field.id} className="relative wrap-anywhere pl-4 before:absolute before:left-1 before:content-['•']">
                    <dt className="inline font-medium">{field.label}</dt>
                    <dd className="inline whitespace-pre-wrap before:mx-1.5 before:text-muted-foreground before:content-['·']">{field.value.trim() ? field.value : <span className="text-muted-foreground">—</span>}</dd>
                  </div>)}
                </dl>}
                {current.blocks.length ? renderBody(current.blocks) : !current.fields.length && <p className="text-sm text-muted-foreground">등록된 분류 내용이 없습니다.</p>}
              </ContentSection>}
            </div>
          </div>
          {current && <VisualCategoryComments
            key={viewerId + ':' + requestId}
            requestId={requestId}
            category={current}
            canDiscuss={isRequester || canManage || Boolean(viewerId && assigned?.assigneeId === viewerId)}
            legacyConversation={legacyConversation}
          />}
        </div>
      </div>
    </aside>
  )
}
