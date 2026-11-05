import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { manageLeaveAdvance, type AdvanceEvent } from '@/lib/supabase/leave-advances'
import { useLeaveAdvances } from './use-leave-advances'
import { useOpsDirectory } from './ops-directory'

const EVENT_LABELS: Record<string, string> = { limit: '한도 설정', import: '기존 음수 이월 등록', import_cancel: '기존 이월 분류 취소', approved: '선사용 승인', cancelled: '신청 취소', settled: '발생분 정산', monthly_settled: '월 발생분 정산', settlement_reversed: '정산 복구' }
export function AdvanceHistory({ events }: { events: AdvanceEvent[] }) {
  return <details className="text-sm"><summary className="cursor-pointer py-2 font-medium">선사용·정산 기록 {events.length}건</summary>
    {events.length ? <ul className="max-h-64 space-y-3 overflow-auto py-2">{events.map(event => <li key={event.id} className="border-b border-border pb-2">
      <strong>{EVENT_LABELS[event.kind] ?? event.kind} · {event.days}일</strong>
      <p className="text-xs text-muted-foreground">{new Date(event.created).toLocaleString('ko-KR')} · {event.actor || '자동 정산'}{event.source ? ` · 원래 기간 ${event.source}` : ''}{event.target ? ` → ${event.target}` : ''}</p>
      {event.note && <p className="whitespace-pre-wrap">{event.note}</p>}
    </li>)}</ul> : <p className="py-2 text-muted-foreground">등록된 선사용 기록이 없습니다.</p>}
  </details>
}
export function LeaveAdvancePanel() {
  useRenderWatch('LeaveAdvancePanel')
  const query = useLeaveAdvances(true)
  const directory = useOpsDirectory('head-office')
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [action, setAction] = useState<'limit' | 'import' | 'import_cancel'>('limit')
  const [days, setDays] = useState('')
  const [note, setNote] = useState('')
  const [period, setPeriod] = useState('')
  const [message, setMessage] = useState('')
  const employee = query.data?.employees.find(row => row.employeeId === employeeId)
  const events = query.data?.events.filter(row => row.employeeId === employeeId) ?? []
  const save = useMutation({ mutationFn: manageLeaveAdvance,
    onSuccess: async () => {
      setMessage(action === 'import_cancel' ? '이월 분류를 취소했습니다. 기존 잔액과 사용 내역은 지우지 않고 정산을 다시 계산했습니다.' : action === 'limit' ? '선사용 한도를 저장했습니다.' : '기존 음수 잔액을 선사용 이월로 등록했습니다. 잔여일은 중복 차감하지 않았습니다.')
      setDays(''); setNote(''); setPeriod('')
      await Promise.all(['employee-leave-advances', 'employee-roster', 'my-attendance-basis', 'home-my-leave', 'employee-extra-leave'].map(key => client.invalidateQueries({ queryKey: [key] })))
    },
    onError: error => setMessage(error instanceof Error ? error.message : '저장하지 못했습니다.'),
  })
  if (query.isPending) return <p className="text-sm text-muted-foreground">선사용 관리 내역을 불러오는 중…</p>
  if (query.isError) return <p role="alert" className="text-sm text-danger">선사용 조회에 실패했습니다. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>다시 조회</Button></p>
  if (!query.data?.ready) return <p className="text-sm text-warning">연차 선사용은 운영 DB 적용 전입니다. 기존 연차와 신청은 유지됩니다.</p>
  return <Card className="space-y-4 p-4">
    <div><h3 className="font-semibold">연차 선사용 관리</h3><p className="mt-1 text-sm text-muted-foreground">직원별 한도를 설정하면 부족분 선사용을 신청할 수 있습니다. 기존 부서 승인자가 별도로 승인하며 본인 승인은 불가합니다.</p></div>
    <Select aria-label="선사용 관리 직원" disabled={save.isPending} value={employeeId} onChange={event => { setEmployeeId(event.target.value); setDays(''); setNote(''); setPeriod(''); setMessage('') }}>
      <option value="">직원 선택</option>{directory.members.map(member => <option key={member.id} value={member.id}>{member.displayName} · {directory.departmentName(member.departmentId)}</option>)}
    </Select>
    {employee && <>
      <p className="text-sm">한도 <strong>{employee.limit}일</strong> · 선사용 잔액 <strong>{employee.outstanding}일</strong> · 다음 발생일 {employee.nextDate || '기준 확인 필요'}</p>
      {employee.needsReview && <p role="status" className="text-sm text-warning">퇴사·상태·입사일 또는 발생 기준 확인이 필요합니다. 자동 정산을 진행하지 않습니다.</p>}
      {employee.unclassified > 0 && <p className="text-sm text-warning">분류되지 않은 부족분 {employee.unclassified}일이 있습니다. 엑셀과 기준일을 확인한 뒤 해당 기간의 선사용분만 이월 등록해 주세요. 과거 사용일·승인자를 임의 생성하지 않습니다.</p>}
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); setMessage(''); void save.mutateAsync({ employeeId, action, days: action === 'import_cancel' ? 0 : Number(days), note, period: action !== 'limit' ? period : undefined }).catch(() => { /* Mutation onError displays and the API logs the failure. */ }) }}>
        <fieldset disabled={save.isPending || employee.needsReview} className="space-y-3">
          <Select aria-label="선사용 관리 작업" value={action} onChange={event => { setAction(event.target.value as 'limit' | 'import' | 'import_cancel'); setDays(''); setMessage('') }}><option value="limit">선사용 한도 설정</option><option value="import">기존 음수 잔액 이월 등록</option><option value="import_cancel">기존 이월 분류 취소</option></Select>
          {action !== 'limit' && <Select required aria-label="기존 선사용 대상 기간" value={period} onChange={event => setPeriod(event.target.value)}><option value="">부족분의 원래 기간 선택</option>{employee.periods.filter(row => action === 'import' ? row.unclassified > 0 : row.imported > 0).map(row => <option key={row.period} value={row.period}>{row.period} ~ {row.expires} · {action === 'import' ? `미분류 ${row.unclassified}` : `이월 등록 ${row.imported}`}일</option>)}</Select>}
          {action !== 'import_cancel' && <label className="block text-sm">{action === 'limit' ? '허용 한도 · 0일은 신규 선사용 중지' : '확인한 기존 선사용 일수'}<Input required aria-label="선사용 일수" type="number" min={action === 'limit' ? 0 : 0.25} max={99999.75} step={0.25} value={days} onChange={event => setDays(event.target.value)} /></label>}
          <Textarea required aria-label="선사용 관리 사유" maxLength={2000} placeholder={action === 'import' ? '엑셀 기준일과 선사용 확인 근거를 적어 주세요.' : '한도 설정 사유를 적어 주세요.'} value={note} onChange={event => setNote(event.target.value)} />
          <Button type="submit">{save.isPending ? '저장 중…' : action === 'limit' ? '한도 저장' : action === 'import' ? '확인한 선사용 이월 등록' : '이월 분류 취소'}</Button>
        </fieldset>
      </form>
      {message && <p role="status" className="text-sm">{message}</p>}
      <AdvanceHistory events={events}/>
    </>}
  </Card>
}
