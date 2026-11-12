import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { manageLeaveAdvance, type AdvanceEvent } from '@/lib/supabase/leave-advances'
import { formatNumber } from '@/lib/utils'
import { LeaveAdvanceDrawer } from './LeaveAdvanceDrawer'
import type { useLeaveAdvances } from './use-leave-advances'

const EVENT_LABELS: Record<string, string> = { limit: '한도 설정', import: '기존 음수 이월 등록', import_cancel: '기존 이월 분류 취소', approved: '선사용 승인', cancelled: '신청 취소', settled: '발생분 정산', monthly_settled: '월 발생분 정산', settlement_reversed: '정산 복구' }
export function AdvanceHistory({ events, expanded = false }: { events: AdvanceEvent[]; expanded?: boolean }) {
  return <details open={expanded} className="text-sm"><summary className="cursor-pointer py-2 font-medium">선사용·정산 기록 {events.length}건</summary>
    {events.length ? <ul className="max-h-64 space-y-3 overflow-auto py-2">{events.map(event => {
      const used = event.days > 0 && (event.kind === 'approved' || event.kind === 'import')
      return <li key={event.id} className="border-b border-border pb-2">
        <strong>{EVENT_LABELS[event.kind] ?? event.kind} · <span className={used ? 'text-danger' : undefined}>{formatNumber(used ? -event.days : event.days)}일</span></strong>
        <p className="text-xs text-muted-foreground">{new Date(event.created).toLocaleString('ko-KR')} · {event.actor || '자동 정산'}{event.source ? ` · 원래 기간 ${event.source}` : ''}{event.target ? ` → ${event.target}` : ''}</p>
        {event.note && <p className="whitespace-pre-wrap">{event.note}</p>}
      </li>
    })}</ul> : <p className="py-2 text-muted-foreground">등록된 선사용 기록이 없습니다.</p>}
  </details>
}
type AdvanceSelection = { id: string; name: string; department: string }

export function LeaveAdvancePanel({ selection, query, onClose }: { selection: AdvanceSelection | null; query: ReturnType<typeof useLeaveAdvances>; onClose: () => void }) {
  useRenderWatch('LeaveAdvancePanel')
  if (!selection) return null
  return <WorkspaceTabOverlay>
    <LeaveAdvanceDetail key={selection.id} selection={selection} query={query} onClose={onClose}/>
  </WorkspaceTabOverlay>
}

function LeaveAdvanceDetail({ selection, query, onClose }: { selection: AdvanceSelection; query: ReturnType<typeof useLeaveAdvances>; onClose: () => void }) {
  const client = useQueryClient()
  const employeeId = selection.id
  const [selectedAction, setAction] = useState<'limit' | 'import' | 'import_cancel'>('limit')
  const [days, setDays] = useState('')
  const [note, setNote] = useState('')
  const [period, setPeriod] = useState('')
  const [message, setMessage] = useState('')
  const employee = query.data?.employees.find(row => row.employeeId === employeeId)
  const operationsApproval = query.data?.approvalMode === 'operations'
  const canImport = employee?.periods.some(row => row.unclassified > 0)
  const canCancelImport = employee?.periods.some(row => row.imported > 0)
  const cancelImportSelected = canCancelImport && selectedAction === 'import_cancel'
  const action = operationsApproval
    ? (!canImport || cancelImportSelected ? 'import_cancel' : 'import')
    : selectedAction
  const events = query.data?.events.filter(row => row.employeeId === employeeId) ?? []
  const save = useMutation({ mutationFn: manageLeaveAdvance,
    onSuccess: async (_data, input) => {
      setMessage(input.action === 'import_cancel' ? '이월 분류를 취소했습니다. 기존 잔액과 사용 내역은 지우지 않고 정산을 다시 계산했습니다.' : input.action === 'limit' ? '선사용 한도를 저장했습니다.' : '기존 음수 잔액을 선사용 이월로 등록했습니다. 잔여일은 중복 차감하지 않았습니다.')
      setDays(''); setNote(''); setPeriod('')
      await Promise.all(['employee-leave-advances', 'employee-roster', 'my-attendance-basis', 'home-my-leave', 'employee-extra-leave'].map(key => client.invalidateQueries({ queryKey: [key] })))
    },
    onError: error => setMessage(error instanceof Error ? error.message : '저장하지 못했습니다.'),
  })
  return <LeaveAdvanceDrawer title={`${selection.name} 연차 선사용`} department={selection.department} busy={save.isPending} onClose={onClose}>
    {query.isPending ? <p role="status" className="text-sm text-muted-foreground">선사용 관리 내역을 불러오는 중…</p>
      : query.isError ? <p role="alert" className="text-sm text-danger">선사용 조회에 실패했습니다. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>다시 조회</Button></p>
      : !query.data?.ready ? <p className="text-sm text-warning">연차 선사용은 운영 DB 적용 전입니다. 기존 연차와 신청은 유지됩니다.</p>
      : !employee ? <p className="text-sm text-muted-foreground">이 직원의 선사용 기준을 확인할 수 없습니다.</p>
      : <>
        <Card className="p-4">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {!operationsApproval && <div><dt className="text-muted-foreground">허용 한도</dt><dd className="font-semibold tabular-nums">{employee.limit}일</dd></div>}
            <div><dt className="text-muted-foreground">미정산 선사용</dt><dd className={`font-semibold tabular-nums ${employee.outstanding > 0 ? 'text-danger' : ''}`}>{formatNumber(employee.outstanding > 0 ? -employee.outstanding : 0)}일</dd></div>
            <div><dt className="text-muted-foreground">다음 발생일</dt><dd className="font-semibold tabular-nums">{employee.nextDate || '기준 확인 필요'}</dd></div>
          </dl>
        </Card>
        <AdvanceHistory events={events} expanded={operationsApproval}/>
        {employee.needsReview && <p role="status" className="text-sm text-warning">퇴사·상태·입사일 또는 발생 기준 확인이 필요합니다. 자동 정산을 진행하지 않습니다.</p>}
        {employee.unclassified > 0 && <p className="text-sm text-warning">분류되지 않은 부족분 {employee.unclassified}일이 있습니다. 엑셀과 기준일을 확인한 뒤 해당 기간의 선사용분만 이월 등록해 주세요. 과거 사용일·승인자를 임의 생성하지 않습니다.</p>}
        {(!operationsApproval || canImport || canCancelImport) && <form className="space-y-3" onSubmit={event => {
          event.preventDefault()
          setMessage('')
          save.mutate({ employeeId, action, days: action === 'import_cancel' ? 0 : Number(days), note, period: action !== 'limit' ? period : undefined })
        }}>
          <fieldset disabled={save.isPending || employee.needsReview} className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span>관리 작업</span>
              <Select aria-label="선사용 관리 작업" value={action} onChange={event => {
                setAction(event.target.value as typeof action)
                setDays(''); setPeriod(''); setMessage('')
              }}>
                {!operationsApproval && <option value="limit">선사용 한도 설정</option>}
                {(!operationsApproval || canImport) && <option value="import">기존 음수 잔액 이월 등록</option>}
                {(!operationsApproval || canCancelImport) && <option value="import_cancel">기존 이월 분류 취소</option>}
              </Select>
            </label>
            {action !== 'limit' && <Select required aria-label="기존 선사용 대상 기간" value={period} onChange={event => setPeriod(event.target.value)}>
              <option value="">부족분의 원래 기간 선택</option>
              {employee.periods.filter(row => action === 'import' ? row.unclassified > 0 : row.imported > 0).map(row =>
                <option key={row.period} value={row.period}>{row.period} ~ {row.expires} · {action === 'import' ? `미분류 ${row.unclassified}` : `이월 등록 ${row.imported}`}일</option>)}
            </Select>}
            {action !== 'import_cancel' && <label className="block text-sm">
              {action === 'limit' ? '허용 한도 · 0일은 신규 선사용 중지' : '확인한 기존 선사용 일수'}
              <Input required aria-label="선사용 일수" type="number" min={action === 'limit' ? 0 : 0.25} max={99999.75} step={0.25} value={days} onChange={event => setDays(event.target.value)} />
            </label>}
            <Textarea required aria-label="선사용 관리 사유" maxLength={2000} placeholder={action === 'import' ? '엑셀 기준일과 선사용 확인 근거를 적어 주세요.' : action === 'limit' ? '한도 설정 사유를 적어 주세요.' : '이월 분류를 취소하는 사유를 적어 주세요.'} value={note} onChange={event => setNote(event.target.value)} />
            <Button type="submit">{save.isPending ? '저장 중…' : action === 'limit' ? '한도 저장' : action === 'import' ? '확인한 선사용 이월 등록' : '이월 분류 취소'}</Button>
          </fieldset>
        </form>}
        {message && <p role="status" className="text-sm">{message}</p>}
      </>}
  </LeaveAdvanceDrawer>
}
