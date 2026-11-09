import { useState } from 'react'
import { CheckoutNoticeForm } from './CheckoutNoticeForm'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMyHomeNotifications, useReadMyHomeNotification } from './use-my-home-notifications'
import { myHomeNotificationSummary, notificationNeedsAttention, type MyHomeNotificationTab } from '@/lib/inbox/my-home-notifications'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useVisualWorkflowNotices, visualWorkflowNoticeItem } from '@/features/work-requests/use-visual-workflow-notices'
import type { InboxNotification } from '@/lib/inbox/types'

export function MyHomeNotificationBadge({ tab }: { tab: string }) {
  const notices=useMyHomeNotifications()
  const rows=notices.items.filter(item=>item.current!==false && item.target?.tab===tab)
  const {pending,unread}=myHomeNotificationSummary(rows)
  return <>{unread>0&&<span className="ml-1 inline-block size-2 rounded-full bg-danger" aria-label="새 알림"/>}{pending>0&&<span className="personal-page-tab-count" aria-label={`처리 필요 ${pending}건`}>{pending}</span>}</>
}
export function MyHomeNotificationList({ tab }: { tab: MyHomeNotificationTab }) {
  useRenderWatch('MyHomeNotificationList')
  const notices=useMyHomeNotifications()
  return <NotificationRows items={notices.items.filter(item => item.target?.tab === tab)} error={notices.error} />
}

export function VisualWorkflowNotificationList() {
  const notices = useVisualWorkflowNotices()
  if (!notices.available && !notices.error) return null
  return <NotificationRows items={notices.rows?.map(visualWorkflowNoticeItem) ?? []} error={notices.error} />
}

function NotificationRows({ items, error }: { items: readonly InboxNotification[]; error: unknown }) {
  const navigate=useNavigate()
  const [history,setHistory]=useState(false)
  const rows=items.filter(item=>history || notificationNeedsAttention(item))
  return <section className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm" aria-label="이 탭의 알림">
    <header className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">알림·처리할 일</h2><Button type="button" size="sm" variant="ghost" onClick={()=>setHistory(value=>!value)}>{history?'확인·처리 필요':'전체 기록'}</Button></header>
    {Boolean(error)&&<p role="alert" className="my-2 text-sm text-danger">{error instanceof Error?error.message:'알림을 불러오지 못했습니다.'}</p>}
    {rows.length===0?<p className="mt-2 text-sm text-muted-foreground">{history?'알림 기록이 없습니다.':'확인하거나 처리할 알림이 없습니다.'}</p>:<ul className="mt-2 divide-y divide-border">{rows.map(item=><li key={`${item.kind}:${item.id}`}><button type="button" className="w-full py-3 text-left" onClick={()=>navigate(item.href)}><span className="flex items-center gap-2 text-sm font-medium">{!item.readAt&&<span className="size-2 shrink-0 rounded-full bg-danger" aria-label="새 알림"/>}{item.title}</span><span className="mt-1 block whitespace-pre-line text-sm text-muted-foreground">{item.body}</span>{item.action&&<span className="mt-1 block text-xs text-primary">{item.action.label}</span>}</button></li>)}</ul>}
  </section>
}

/** A successful server query supplies the actual request snapshot before acknowledging it. */
export function MyHomeWorkNoticeDetail() {
  const active=useWorkspaceTabActivity()
  const [params,setParams]=useSearchParams()
  const key=params.get('workNotice')
  const notices=useMyHomeNotifications()
  const row=notices.work.find(item=>item.event_key===key)
  const item=notices.items.find(item=>item.id===key)
  const sameTab=row?.tab===(params.get('part')??'my-attendance')
  const read=useReadMyHomeNotification('request',row?.entity_id,key??undefined,active&&sameTab&&Boolean(row&&item))
  if(!key||!active||row&&!sameTab)return null
  function close(){setParams(previous=>{const next=new URLSearchParams(previous);next.delete('workNotice');return next},{replace:true})}
  return <section role="dialog" aria-modal="false" aria-label="신청 알림 상세" className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm">
    {row&&item?<><h2 className="font-semibold">{item.title}</h2><p className="my-3 whitespace-pre-line text-sm">{item.body}</p><p className="my-3 whitespace-pre-line text-sm">{row.note||'신청 메모가 없습니다.'}</p>{row.event_type==='checkout'?<CheckoutNoticeForm workDate={row.entity_id} onClose={close}/>:row.action_needed&&<Button type="button" onClick={()=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('workNotice');next.set('request',row.entity_id);return next},{replace:true})}>신청 검토하기</Button>}</>:<p role="status">{notices.error?'알림을 불러오지 못했습니다.':'알림을 확인 중이거나 이미 처리되어 더 이상 접근할 수 없습니다.'}</p>}
    {read.error&&<p role="alert" className="my-2 text-sm text-danger">{read.error}<Button type="button" size="sm" variant="outline" onClick={read.retry}>읽음 저장 재시도</Button></p>}
    <Button type="button" size="sm" variant="ghost" onClick={close}>닫기</Button>
  </section>
}
