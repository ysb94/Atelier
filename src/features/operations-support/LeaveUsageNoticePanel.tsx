import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { FilterBar } from '@/components/ui/filter-bar'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { StatusPill } from '@/components/ui/status-pill'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { canEditOrgAssignment } from '@/lib/company/capabilities'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { emptyList } from '@/lib/utils'
import { getLeaveNoticeManagement, LEAVE_NOTICE_LABELS, LEAVE_NOTICE_PHASES, type LeaveNoticeEmployee, type LeaveUsageNotice, type LeaveNoticePhase } from '@/lib/supabase/leave-usage-notices'
import { downloadLeaveNoticeReceipt, leaveNoticeDates, leaveNoticeSetupReason, leaveNoticeTime } from './leave-usage-notices'

type Filter = 'all' | 'pending' | 'setup'
export function LeaveUsageNoticePanel() {
  useRenderWatch('LeaveUsageNoticePanel')
  const { profile } = useAuth()
  const permitted = canEditOrgAssignment(profile)
  const active = useWorkspaceTabActivity()
  const query = useQuery({ queryKey: ['leave-notice-management', profile?.id], queryFn: getLeaveNoticeManagement, enabled: permitted, refetchInterval: permitted && active ? 30_000 : false })
  const [department, setDepartment] = useState('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [document, setDocument] = useState<LeaveUsageNotice | null>(null)
  useEffect(() => { if (query.error) console.warn('[leave-notices] 운영지원 기록 조회 실패', { error: query.error }) }, [query.error])
  const employees = query.data?.employees ?? emptyList<LeaveNoticeEmployee>()
  const notices = query.data?.notices ?? emptyList<LeaveUsageNotice>()
  if (!permitted) return <Card className="p-5 text-sm text-muted-foreground">직원별 잔여 연차와 확인 기록은 기존 명부 관리 권한이 있는 담당자만 확인할 수 있습니다.</Card>
  const departments = [...new Set(employees.map(row => row.department))].sort()
  const scoped = employees.filter(row => department === 'all' || row.department === department)
  const pending = new Set(notices.filter(row => !row.confirmed_at).map(row => row.employee_id))
  const needsSetup = (row: LeaveNoticeEmployee) => !row.resigned_on && (!row.hire_date || row.remaining_days === null || (row.remaining_days > 0 && !row.balance_current && Boolean(row.reset_date)))
  const visible = scoped.filter(row => filter === 'all' || (filter === 'pending' ? pending.has(row.id) : needsSetup(row)))
  const scopedIds = new Set(scoped.map(row => row.id))
  const scopedNotices = notices.filter(row => scopedIds.has(row.employee_id))
  return <div className="space-y-4">
    <Card className="space-y-2 p-4 text-sm"><p className="font-medium">{query.data?.enabled ? '자동 안내 사용 중 · 매일 오전 9시' : '자동 안내 준비 중'}</p><p className="text-muted-foreground">다음 입사 기념일 전날이 사용기한입니다. 3개월·1개월·2주 전에 명부에 등록된 잔여 연차로 안내하며, 안내일이 지난 경우 가장 최근 단계 한 건을 발송합니다.</p><p className="text-xs text-muted-foreground">입사일·잔여 연차가 없으면 발송하지 않습니다. 새 사용연도나 입사일 변경 후에는 조직도 명부에서 잔여 연차를 확인해 다시 저장해 주세요. 잔액 자동 차감·초기화는 하지 않습니다.</p></Card>
    <StatGrid><StatTile label="직원" value={`${scoped.length}명`}/><StatTile label="발송" value={`${scopedNotices.length}건`}/><StatTile label="본인 미확인" value={`${scopedNotices.filter(row => !row.confirmed_at).length}건`}/><StatTile label="정보 확인 필요" value={`${scoped.filter(needsSetup).length}명`}/></StatGrid>
    <FilterBar><Select aria-label="연차 안내 부서" value={department} onChange={event => setDepartment(event.target.value)} className="sm:w-44"><option value="all">전체 부서</option>{departments.map(name => <option key={name} value={name}>{name}</option>)}</Select><FilterTabs<Filter> ariaLabel="연차 안내 상태" value={filter} onChange={setFilter} tabs={[{ value: 'all', label: '전체 직원', count: scoped.length }, { value: 'pending', label: '본인 미확인', count: scoped.filter(row => pending.has(row.id)).length }, { value: 'setup', label: '정보 확인 필요', count: scoped.filter(needsSetup).length }]}/><Button size="sm" variant="outline" onClick={() => void query.refetch()}>새로고침</Button></FilterBar>
    {query.error && <p role="alert" className="text-sm text-danger">{query.error.message}</p>}
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-left text-sm" aria-label="직원 연차 안내 발송 및 확인 기록">
      <thead className="bg-primary text-primary-foreground"><tr>{['이름', '부서', '입사일', '다음 초기화 · 사용기한', '3개월 전', '1개월 전', '2주 전'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
      <tbody>{query.isPending ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">불러오는 중…</td></tr> : visible.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">표시할 직원이 없습니다.</td></tr> : visible.map(employee => {
        const dates = employee.reset_date ? leaveNoticeDates(employee.reset_date) : null
        const reason = leaveNoticeSetupReason(employee)
        const cycleNotices = notices.filter(row => row.employee_id === employee.id && row.expires_on === dates?.expiresOn)
        return <tr key={employee.id} className="border-b border-border last:border-0"><td className="px-4 py-3 align-top"><p className="font-medium">{employee.display_name || '이름 없음'}</p><p className="mt-1 text-xs text-muted-foreground">잔여 {employee.remaining_days === null ? '미등록' : `${employee.remaining_days}일`}</p>{reason && <p className="mt-1 text-xs text-warning">{reason}</p>}</td><td className="px-4 py-3 align-top">{employee.department}</td><td className="px-4 py-3 align-top tabular-nums">{employee.hire_date || '미등록'}</td><td className="px-4 py-3 align-top text-xs tabular-nums"><p>{employee.reset_date || '—'}</p><p className="mt-1 text-muted-foreground">사용기한 {dates?.expiresOn || '—'}</p></td>{LEAVE_NOTICE_PHASES.map(phase => <NoticeCell key={phase} phase={phase} date={dates?.[phase]} record={cycleNotices.find(row => row.phase === phase)} today={query.data!.today} reason={reason} laterSent={cycleNotices.some(row => row.scheduled_on > (dates?.[phase] ?? ''))} onOpen={setDocument}/>)}</tr>
      })}</tbody>
    </table></div></Card>
    <details className="rounded-xl border border-border bg-card p-4 text-sm"><summary className="cursor-pointer font-medium">전체 발송 기록 {scopedNotices.length}건</summary><div className="mt-3 space-y-2">{scopedNotices.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"><span>{row.recipient_name} · {row.expires_on} · {LEAVE_NOTICE_LABELS[row.phase]} · {row.confirmed_at ? '본인 확인 완료' : '미확인'}</span><Button size="sm" variant="outline" onClick={() => setDocument(row)}>안내문·기록 보기</Button></div>)}{!scopedNotices.length && <p className="text-muted-foreground">발송 기록이 없습니다.</p>}</div></details>
    <p className="text-xs text-muted-foreground">발송 원문과 최초 읽음·열람·본인 확인 시각은 서버에 보관합니다. 일반 사용 안내 기록이며 법정 사용촉진 완료를 뜻하지 않습니다.</p>
    {document && <ManagementDocument record={document} close={() => setDocument(null)}/>}
  </div>
}
function NoticeCell({ phase, date, record, today, reason, laterSent, onOpen }: { phase: LeaveNoticePhase; date?: string; record?: LeaveUsageNotice; today: string; reason: string | null; laterSent: boolean; onOpen: (row: LeaveUsageNotice) => void }) {
  return <td className="px-4 py-3 align-top"><p className="mb-1 text-xs tabular-nums text-muted-foreground">{date || '—'}</p>{record ? <>
    <div className="flex flex-wrap gap-1"><StatusPill tone="success">발송</StatusPill><StatusPill tone={record.viewed_at ? 'success' : 'warning'}>{record.viewed_at ? '열람' : '미열람'}</StatusPill><StatusPill tone={record.confirmed_at ? 'success' : 'warning'}>{record.confirmed_at ? '확인 완료' : '미확인'}</StatusPill></div>
    <div className="mt-2 space-y-1 text-xs text-muted-foreground"><p>발송 {leaveNoticeTime(record.issued_at)}</p>{record.read_at && <p>읽음 {leaveNoticeTime(record.read_at)}</p>}{record.viewed_at && <p>열람 {leaveNoticeTime(record.viewed_at)}</p>}{record.confirmed_at && <p>확인 {leaveNoticeTime(record.confirmed_at)}</p>}</div>
    <Button size="sm" variant="outline" className="mt-2" aria-label={`${record.recipient_name} ${LEAVE_NOTICE_LABELS[phase]} 안내문 보기`} onClick={() => onOpen(record)}>안내문 보기</Button>
  </> : <StatusPill tone={reason ? 'muted' : date && date <= today && !laterSent ? 'warning' : 'muted'}>{reason ? '발송 제외' : laterSent ? '후속 단계로 안내' : date && date <= today ? '발송 대기' : '발송 예정'}</StatusPill>}</td>
}
function ManagementDocument({ record, close }: { record: LeaveUsageNotice; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return createPortal(<dialog ref={dialog} aria-labelledby="leave-management-document" onCancel={event => { event.preventDefault(); close() }} className="m-auto max-h-[90dvh] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-sm backdrop:bg-foreground/30">
    <h3 id="leave-management-document" className="font-semibold">{record.recipient_name} · {record.title} · {LEAVE_NOTICE_LABELS[record.phase]}</h3>
    <article className="my-4 whitespace-pre-wrap rounded-lg border border-border p-4 text-sm leading-6">{record.body}</article>
    <div className="space-y-1 text-xs text-muted-foreground"><p>문서 {record.id}</p><p>발송 {leaveNoticeTime(record.issued_at)}</p><p>알림 읽음 {leaveNoticeTime(record.read_at)}</p><p>안내문 열람 {leaveNoticeTime(record.viewed_at)}</p><p>본인 확인 {leaveNoticeTime(record.confirmed_at)}</p></div>
    <p className="mt-3 text-xs text-muted-foreground">관리자 열람은 직원의 열람·본인 확인 기록을 바꾸지 않습니다.</p><footer className="mt-4 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => downloadLeaveNoticeReceipt(record)}>기록 다운로드</Button><Button size="sm" onClick={close}>닫기</Button></footer>
  </dialog>, window.document.body)
}
