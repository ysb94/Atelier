import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { FilterBar } from '@/components/ui/filter-bar'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { StatusPill } from '@/components/ui/status-pill'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { canEditOrgAssignment } from '@/lib/company/capabilities'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { getLeaveNoticeManagement, LEAVE_NOTICE_LABELS, type LeaveUsageNotice, type LeaveNoticeSource } from '@/lib/supabase/leave-usage-notices'
import { downloadLeaveNoticeReceipt, leaveNoticeTime } from './leave-usage-notices'
import { employeeLeaveNoticeItems, itemPendingNotices, LEAVE_SOURCE_LABELS, type LeaveNoticeGroupItem } from './leave-notice-groups'

type Filter = 'all' | 'pending' | 'setup'
export function LeaveUsageNoticePanel() {
  useRenderWatch('LeaveUsageNoticePanel')
  const { profile } = useAuth()
  const permitted = canEditOrgAssignment(profile)
  const active = useWorkspaceTabActivity()
  const query = useQuery({ queryKey: ['leave-notice-management', profile?.id], queryFn: getLeaveNoticeManagement, enabled: permitted, refetchInterval: permitted && active ? 30_000 : false })
  const [department, setDepartment] = useState('all')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<LeaveNoticeSource | 'all'>('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [document, setDocument] = useState<LeaveUsageNotice | null>(null)
  useEffect(() => { if (query.error) console.warn('[leave-notices] 운영지원 기록 조회 실패', { error: query.error }) }, [query.error])
  const groups = useMemo(() => !query.data ? [] : query.data.employees
    .filter(e => (department === 'all' || e.department === department) && (e.display_name ?? '').includes(search.trim()))
    .map(employee => ({ employee, items: employeeLeaveNoticeItems(employee, query.data!).filter(i => source === 'all' || i.source === source) }))
    .filter(g => g.items.length > 0), [query.data, department, search, source])
  if (!permitted) return <Card className="p-5 text-sm text-muted-foreground">직원별 잔여 연차와 확인 기록은 기존 명부 관리 권한이 있는 담당자만 확인할 수 있습니다.</Card>
  const departments = [...new Set(query.data?.employees.map(row => row.department))].sort()
  const pending = (items: LeaveNoticeGroupItem[]) => items.reduce((sum, i) => sum + itemPendingNotices(i).length, 0)
  const needsSetup = (items: LeaveNoticeGroupItem[]) => items.some(i => i.source === 'base' && i.blocked && /미등록|확인 필요/.test(i.blocked))
  const visible = groups.filter(g => filter === 'all' || (filter === 'pending' ? pending(g.items) > 0 : needsSetup(g.items)))
  const groupIds = new Set(groups.map(g => g.employee.id))
  const history = query.data?.notices.filter(n => groupIds.has(n.employee_id) && (source === 'all' || (n.notice_source ?? 'base') === source)) ?? []
  return <div className="space-y-4">
    <Card className="space-y-2 p-4 text-sm"><p className="font-medium">{query.data?.enabled ? '연차 등록·소진 안내' : '자동 안내 준비 중'}</p>
      <p className="text-muted-foreground">기본·추가 연차는 만료 3개월·1개월·2주 전, 생일 반차는 만료 1주일 전에 안내합니다. 추가 연차 등록 안내는 저장할 때 전달하며 만료 안내는 매일 오전 9시에 확인합니다.</p>
      <p className="text-xs text-muted-foreground">이미 지난 단계는 등록 안내에 포함합니다. 모두 사용·예약한 추가분은 만료 안내를 보내지 않습니다. 아래 일수는 현재 값이고, 안내문에는 발송 당시 값이 남습니다.</p>
      {!query.data?.extraEnabled && <p className="text-xs text-warning">추가·생일 알림 서버 연결 대기 중입니다. 기존 기본 연차 안내는 유지됩니다.</p>}
    </Card>
    <StatGrid><StatTile label="직원" value={groups.length + '명'}/><StatTile label="발송 이력" value={history.length + '건'}/><StatTile label="본인 미확인" value={groups.reduce((sum, g) => sum + pending(g.items), 0) + '건'}/><StatTile label="정보 확인 필요" value={groups.filter(g => needsSetup(g.items)).length + '명'}/></StatGrid>
    <FilterBar><Input aria-label="연차 안내 직원 검색" placeholder="직원 이름 검색" value={search} onChange={e => setSearch(e.target.value)} className="sm:w-44"/>
      <Select aria-label="연차 안내 부서" value={department} onChange={e => setDepartment(e.target.value)} className="sm:w-40"><option value="all">전체 부서</option>{departments.map(name => <option key={name}>{name}</option>)}</Select>
      <Select aria-label="연차 안내 종류" value={source} onChange={e => setSource(e.target.value as typeof source)} className="sm:w-40"><option value="all">전체 연차</option>{Object.entries(LEAVE_SOURCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>
      <FilterTabs<Filter> ariaLabel="연차 안내 상태" value={filter} onChange={setFilter} tabs={[{ value: 'all', label: '전체 직원', count: groups.length }, { value: 'pending', label: '본인 미확인', count: groups.filter(g => pending(g.items)).length }, { value: 'setup', label: '정보 확인 필요', count: groups.filter(g => needsSetup(g.items)).length }]}/>
      <Button size="sm" variant="outline" onClick={() => void query.refetch()}>새로고침</Button>
    </FilterBar>
    {query.error && <p role="alert" className="text-sm text-danger">{query.error.message}</p>}
    {query.isPending ? <Card className="p-6 text-center">불러오는 중…</Card> : visible.length === 0 ? <Card className="p-6 text-center text-muted-foreground">표시할 직원이 없습니다.</Card> : visible.map(({ employee, items }) => <Card key={employee.id} className="overflow-hidden">
      <details><summary className="cursor-pointer px-4 py-3 text-sm"><span className="font-semibold">{employee.display_name || '이름 없음'}</span><span className="mx-3 text-muted-foreground">{employee.department} · 연차 {items.length}건</span><StatusPill tone={pending(items) ? 'warning' : 'muted'}>{pending(items) ? '본인 미확인 ' + pending(items) + '건' : '미확인 없음'}</StatusPill></summary>
        <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm" aria-label={employee.display_name + ' 연차별 알림 현황'}>
          <thead className="bg-primary text-primary-foreground"><tr>{['연차 구분 · 사유', '신청 가능', '사용 예약', '사용 기한', '최근 알림 · 확인'].map(label => <th key={label} className="px-4 py-2.5 font-medium">{label}</th>)}</tr></thead>
          <tbody>{items.map(item => <tr key={item.id} className="border-b border-border align-top last:border-0">
            <td className="max-w-64 px-4 py-3"><strong>{LEAVE_SOURCE_LABELS[item.source]}</strong><p className="mt-1 break-words text-xs text-muted-foreground">{item.reason}</p>{item.blocked && <p className="mt-1 text-xs text-muted-foreground">{item.blocked}</p>}</td>
            <td className="whitespace-nowrap px-4 py-3 tabular-nums">{item.remaining == null ? '미등록' : item.remaining + '일'}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{item.reserved == null ? '—' : item.reserved + '일'}</td>
            <td className="whitespace-nowrap px-4 py-3 tabular-nums">{item.expires || '미등록'}</td><td className="min-w-80 px-4 py-3"><ItemNoticeHistory item={item} today={query.data!.today} onOpen={setDocument}/></td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </Card>)}
    <details className="rounded-xl border border-border bg-card p-4 text-sm"><summary className="cursor-pointer font-medium">전체 발송 기록 {history.length}건</summary><div className="mt-3 space-y-2">{history.map(n => <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"><span>{n.recipient_name} · {LEAVE_SOURCE_LABELS[n.notice_source ?? 'base']} · {n.expires_on} · {LEAVE_NOTICE_LABELS[n.phase]} · {n.invalidated_at ? '변경·취소된 안내' : n.confirmed_at ? '본인 확인 완료' : '미확인'}</span><Button size="sm" variant="outline" onClick={() => setDocument(n)}>안내문·기록 보기</Button></div>)}</div></details>
    <p className="text-xs text-muted-foreground">발송 원문과 최초 읽음·열람·본인 확인 시각은 보존됩니다. 관리자가 열어도 직원의 본인 확인으로 처리하지 않습니다. 일반 사용 안내이며 법정 사용촉진 완료를 뜻하지 않습니다.</p>
    {document && <ManagementDocument record={document} close={() => setDocument(null)}/>}
  </div>
}
function ItemNoticeHistory({ item, today, onOpen }: { item: LeaveNoticeGroupItem; today: string; onOpen: (n: LeaveUsageNotice) => void }) {
  const latest = item.notices[0]
  return <div className="space-y-2"><p>{latest ? LEAVE_NOTICE_LABELS[latest.phase] + ' · ' + (latest.confirmed_at ? '본인 확인 완료' : '본인 미확인') : '아직 발송된 알림 없음'}</p>
    <details><summary className="cursor-pointer text-xs text-muted-foreground">알림 일정·확인 이력 보기</summary><div className="mt-2 space-y-3">{item.phases.map(({ phase, date, included }) => {
      const record = item.notices.find(n => n.phase === phase)
      const later = item.notices.some(n => n.scheduled_on > date && n.phase !== 'registered')
      return <div key={phase} className="border-t border-border pt-2 text-xs"><p>{LEAVE_NOTICE_LABELS[phase]} · {date}</p>{record ? <>
        <div className="my-1 flex gap-1"><StatusPill tone="success">발송</StatusPill><StatusPill tone={record.confirmed_at ? 'success' : 'warning'}>{record.confirmed_at ? '확인 완료' : '미확인'}</StatusPill></div>
        <p>발송 {leaveNoticeTime(record.issued_at)}</p><p>열람 {leaveNoticeTime(record.viewed_at)}</p><p>본인 확인 {leaveNoticeTime(record.confirmed_at)}</p><Button size="sm" variant="outline" className="mt-1" onClick={() => onOpen(record)}>안내문 보기</Button>
      </> : <p className="mt-1 text-muted-foreground">{item.blocked ? '발송 제외' : included ? '등록 안내에 포함' : later ? '후속 단계로 안내' : date <= today ? '발송 대기' : '발송 예정'}</p>}</div>
    })}</div></details>
  </div>
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
