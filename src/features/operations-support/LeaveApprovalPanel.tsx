import { useMemo, useState } from 'react'
import { Check, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { requestLabel, isFullLeave } from '@/features/settings/personal-requests'
import { useLeaveRequests } from './use-leave-requests'
import { OpsPanelFrame, OpsStat } from './OpsStat'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const LABELS = { pending: '승인 대기', approved: '승인', rejected: '반려', cancelled: '취소' }

function leaveDateLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()]
  return weekday ? `${date} (${weekday})` : date
}

function leaveSpanLabel(from: string, to: string) {
  return to !== from ? `${leaveDateLabel(from)} ~ ${leaveDateLabel(to)}` : leaveDateLabel(from)
}
const STATUS_CLASS = { pending: 'bg-warning/10 text-warning', approved: 'bg-success/10 text-success', rejected: 'bg-danger/10 text-danger', cancelled: 'bg-muted text-muted-foreground' }
export function LeaveApprovalPanel({ readOnly = false }: { readOnly?: boolean }) {
  useRenderWatch('LeaveApprovalPanel')
  const leave = useLeaveRequests(readOnly ? 'all' : 'approvals')
  const [status, setStatus] = useState('pending')
  const [department, setDepartment] = useState('all')
  const [search, setSearch] = useState('')
  const [month, setMonth] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const departments = useMemo(() => [...new Set(leave.requests.map(item => item.departmentName))].sort((a,b) => a.localeCompare(b,'ko')), [leave.requests])
  const visible = useMemo(() => leave.requests.filter(item =>
    (status === 'all' || item.status === status) && (department === 'all' || department === item.departmentName)
    && (!month || (item.from <= `${month}-31` && item.to >= `${month}-01`))
    && (!search.trim() || `${item.employeeName} ${item.departmentName} ${requestLabel(item.kind)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  ), [leave.requests, status, department, search, month])
  const pages = Math.max(1, Math.ceil(visible.length / 10))
  const currentPage = Math.min(page, pages)
  const rows = visible.slice((currentPage - 1) * 10, currentPage * 10)
  const detail = leave.requests.find(item => item.id === selected)
  async function decide(next: 'approved' | 'rejected') {
    if (readOnly || !detail || detail.status !== 'pending' || leave.busy) return
    if (next === 'rejected' && !note.trim()) { setMessage('반려 사유를 입력해 주세요.'); return }
    try {
      await leave.transition.mutateAsync({ id: detail.id, status: next, note })
      setMessage(`${detail.employeeName}님의 ${requestLabel(detail.kind)} 신청을 ${LABELS[next]}했습니다.`)
      setSelected(null); setNote('')
    } catch (error) {
      console.warn('[leave-requests] 지정 승인자 처리 실패', error)
      setMessage(error instanceof Error ? error.message : '신청 처리에 실패했습니다.')
    }
  }
  return <OpsPanelFrame>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">{readOnly ? '연차·야근 신청 현황' : '승인할 신청'}</h2><p className="mt-1 text-sm text-muted-foreground">{readOnly ? '부서별 지정 담당자가 승인합니다. 운영지원은 신청과 처리 결과를 확인합니다.' : '담당 부서의 연차·반차·반반차·야근 신청을 검토합니다. 본인 신청은 목록에서 제외됩니다.'}</p></div><Button size="sm" variant="outline" disabled={leave.busy} onClick={() => void leave.refresh()}><RefreshCw size={14}/>새로고침</Button></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{(['pending','approved','rejected','cancelled'] as const).map(key => <OpsStat key={key} label={LABELS[key]} value={`${leave.requests.filter(item => item.status === key).length}건`}/>)}</div>
    <div className="flex flex-wrap gap-2">
      <Input aria-label="휴가 신청 검색" placeholder="직원·부서 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} className="h-9 w-full sm:w-60"/>
      <Select aria-label="휴가 신청 상태" value={status} onChange={event => { setStatus(event.target.value); setPage(1) }} className="h-9 w-32"><option value="all">전체 상태</option>{Object.entries(LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</Select>
      <Select aria-label="휴가 신청 부서" value={department} onChange={event => { setDepartment(event.target.value); setPage(1) }} className="h-9 w-40"><option value="all">전체 부서</option>{departments.map(name => <option key={name}>{name}</option>)}</Select>
      <Input aria-label="휴가 사용 월" type="month" value={month} onChange={event => { setMonth(event.target.value); setPage(1) }} className="h-9 w-40"/>{month && <Button size="sm" variant="ghost" onClick={() => setMonth('')}>전체 기간</Button>}
    </div>
    {message && <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">{message}</p>}
    {leave.error && <p role="alert" className="text-sm text-danger">신청을 불러오지 못했습니다. 새로고침으로 다시 확인해 주세요.</p>}
    {detail && <article aria-label="휴가 신청 검토" className="rounded-2xl border border-primary/30 bg-card p-5">
      <header className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{detail.employeeName} · {requestLabel(detail.kind)}</h3><p className="mt-1 text-sm text-muted-foreground">{detail.departmentName} · {leaveSpanLabel(detail.from, detail.to)} · {isFullLeave(detail.kind) ? '종일' : `${detail.start}–${detail.end}`}</p></div><Button variant="ghost" size="icon" aria-label="휴가 검토 닫기" disabled={leave.busy} onClick={() => setSelected(null)}><X size={16}/></Button></header>
      <p className="my-4 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{detail.note || '신청 메모가 없습니다.'}</p>
      {detail.status === 'pending' && !readOnly ? <>
        <label className="block text-sm">처리 의견 <span className="text-muted-foreground">· 반려 시 필수</span><Textarea aria-label="휴가 처리 의견" maxLength={2000} rows={2} value={note} disabled={leave.busy} onChange={event => setNote(event.target.value)} className="mt-2" placeholder="반려 사유 또는 전달할 의견을 적어 주세요."/></label>
        {detail.employeeId === leave.userId && <p className="mt-3 text-sm text-warning">본인 신청은 다른 지정 승인자가 처리해야 합니다.</p>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={leave.busy || detail.employeeId === leave.userId} onClick={() => void decide('rejected')}><X size={14}/>{leave.busy ? '처리 중…' : '반려'}</Button><Button disabled={leave.busy || detail.employeeId === leave.userId} onClick={() => void decide('approved')}><Check size={14}/>{leave.busy ? '처리 중…' : '승인'}</Button></div>
      </> : detail.status === 'pending' ? <p className="text-sm text-muted-foreground">부서별 지정 승인자의 검토를 기다리고 있습니다.</p> : <p className="text-sm">{LABELS[detail.status]} · {detail.decidedByName || '처리자 미확인'}{detail.decidedAt ? ` · ${new Date(detail.decidedAt).toLocaleString('ko-KR')}` : ''}{detail.decisionNote && <span className="mt-2 block whitespace-pre-wrap">{detail.decisionNote}</span>}</p>}
    </article>}
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto"><table aria-label="휴가 신청 목록" className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground"><tr>{['신청자·부서','신청 종류','사용 일정','신청일','상태','검토'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>
        {!rows.length ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{leave.loading ? '신청을 불러오는 중…' : leave.error ? '신청 조회에 실패했습니다.' : '해당 조건의 휴가 신청이 없습니다.'}</td></tr> : rows.map(item => <tr key={item.id} className="border-b border-border/70 last:border-0"><td className="px-4 py-4"><strong className="font-medium">{item.employeeName}</strong><span className="mt-1 block text-xs text-muted-foreground">{item.departmentName}</span></td><td className="px-4 py-4">{requestLabel(item.kind)}</td><td className="px-4 py-4 tabular-nums">{leaveSpanLabel(item.from, item.to)}<span className="mt-1 block text-xs text-muted-foreground">{isFullLeave(item.kind) ? '종일' : `${item.start}–${item.end}`}</span></td><td className="px-4 py-4 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString('ko-KR')}</td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs ${STATUS_CLASS[item.status]}`}>{LABELS[item.status]}</span></td><td className="px-4 py-4"><Button size="sm" variant="outline" disabled={leave.busy} onClick={() => { setSelected(item.id); setNote(''); setMessage('') }}>{item.status === 'pending' ? '검토' : '상세'}</Button></td></tr>)}
      </tbody></table></div>
      <footer className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground"><span>{visible.length}건 · {currentPage}/{pages} 페이지</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button><Button variant="outline" size="sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</Button></div></footer>
    </article>
    <p className="text-xs text-muted-foreground">승인 기록은 저장됩니다. 잔여일 자동 차감·근태 반영·알림 발송은 아직 연결되지 않았습니다.</p>
  </OpsPanelFrame>
}
