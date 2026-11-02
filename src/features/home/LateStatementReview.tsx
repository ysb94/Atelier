import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import { readLateStatementNotice } from '@/lib/supabase/late-arrival-statements'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { InboxNotification } from '@/lib/inbox/types'
import { getLateArrivalStatement, listMyLateStatementNotices, listMyManageableLateStatements, type LateStatementNotice } from '@/lib/supabase/late-arrival-statements'
import { LateArrivalStatementDocument } from './LateArrivalClockIn'

function dateLabel(date: string) {
  const [year, month, day] = date.split('-')
  return `${year}년 ${Number(month)}월 ${Number(day)}일`
}

export function lateStatementNoticeItems(records: readonly LateStatementNotice[]): InboxNotification[] {
  return records.map(record => ({
    id: record.noticeId,
    kind: record.kind === 'manager' ? 'late_statement_manager' : 'late_statement_confirmed',
    title: record.kind === 'manager' ? `${record.employeeName} 지각 사유서` : '지각 사유서가 확인되었습니다',
    body: record.kind === 'manager' ? `${dateLabel(record.date)} · ${record.minutes}분` : `${dateLabel(record.date)} 지각 사유서가 확인되었습니다.`,
    href: `/settings/profile?lateStatement=${record.statementId}&lateRole=${record.kind === 'manager' ? 'manager' : 'done'}`,
    createdAt: record.createdAt,
    readAt: record.readAt,
  }))
}

export function useLateStatementNotices(enabled: boolean) {
  const query = useQuery({
    queryKey: ['late-statement-notices'],
    queryFn: listMyLateStatementNotices,
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  })
  useEffect(() => {
    if (query.error) console.warn('[late-arrival] 사유서 알림 조회 실패', query.error)
  }, [query.error])
  return { items: lateStatementNoticeItems(query.data ?? []), error: query.error instanceof Error ? query.error.message : query.error ? '지각 사유서 알림을 불러오지 못했습니다.' : null }
}

export function LateStatementApprovalList() {
  const [, setSearchParams] = useSearchParams()
  const tasks = useQuery({ queryKey: ['late-statement-tasks'], queryFn: listMyManageableLateStatements })
  useEffect(() => {
    if (tasks.error) console.warn('[late-arrival] 확인할 사유서 조회 실패', tasks.error)
  }, [tasks.error])
  if (tasks.isPending || tasks.isError || !tasks.data?.length) {
    return tasks.isError ? <p role="alert" className="mb-4 text-sm text-danger">확인할 지각 사유서를 불러오지 못했습니다.</p> : null
  }
  return <section className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm" aria-label="확인할 지각 사유서">
    <h2 className="text-base font-semibold">지각 사유서</h2>
    <p className="mt-1 text-sm text-muted-foreground">담당 직원의 지각 사유서를 확인합니다. 확인하면 사유서의 부서장 칸에 이름이 남습니다.</p>
    <ul className="mt-3 divide-y divide-border">
      {tasks.data.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span className="text-sm">{item.employeeName} · {dateLabel(item.date)} · {item.minutes}분{item.reasonKind ? ` · ${item.reasonKind}` : ''}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('lateStatement', item.id); next.set('lateRole', 'manager'); return next }, { replace: true })}>사유서 보기</Button>
      </li>)}
    </ul>
  </section>
}

export function LateStatementNoticeDialog() {
  const client = useQueryClient()
  const {profile}=useAuth()
  const preview=usePagePreview()
  const active=useNotificationDetailVisibility()
  const [readError,setReadError]=useState<string|null>(null)
  const [readRetry,setReadRetry]=useState(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const id = searchParams.get('lateStatement')
  const review = searchParams.get('lateRole') === 'manager' ? 'manager' : 'view'
  const statement = useQuery({
    queryKey: ['late-arrival-statement', id],
    queryFn: () => getLateArrivalStatement(id ?? ''),
    enabled: Boolean(id),
  })
  useEffect(() => {
    if (statement.error) console.warn('[late-arrival] 알림 사유서 조회 실패', statement.error)
  }, [statement.error])
  useEffect(()=>{
    if(!id||!statement.data||!active||preview?.active)return
    let cancelled=false
    async function read(){
      try{
        const notices=await listMyLateStatementNotices()
        for(const notice of notices.filter(row=>row.statementId===id&&!row.readAt))await readLateStatementNotice(notice.kind==='manager'?'manager':'employee',notice.noticeId)
        if(!cancelled)setReadError(null)
        await client.invalidateQueries({queryKey:['late-statement-notices',profile?.id]})
      }catch(error){console.warn('[late-arrival] 상세 열람 읽음 저장 실패',error);if(!cancelled)setReadError('읽음 기록을 저장하지 못했습니다.')}
    }
    void read();return()=>{cancelled=true}
  },[id,statement.data,active,preview?.active,client,profile?.id,readRetry])
  if (!id || !active) return null
  function close() {
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('lateStatement'); next.delete('lateRole'); return next }, { replace: true })
  }
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-background/75 p-4" role="dialog" aria-label="지각 사유서">
    {readError&&<p role="alert" className="text-sm text-danger">{readError}<Button type="button" size="sm" onClick={()=>setReadRetry(value=>value+1)}>읽음 저장 재시도</Button></p>}
    {statement.isPending ? <p className="rounded-xl bg-white px-6 py-4 text-sm">사유서를 불러오는 중입니다.</p>
      : statement.data ? <LateArrivalStatementDocument statement={statement.data} review={review} onClose={close} onUpdated={saved => { client.setQueryData(['late-arrival-statement', id], saved) }} />
      : <section className="rounded-xl bg-white px-6 py-4"><p role="alert" className="text-sm text-danger">사유서를 불러오지 못했습니다.</p><Button type="button" className="mt-3" variant="outline" size="sm" onClick={close}>닫기</Button></section>}
  </div>
}
