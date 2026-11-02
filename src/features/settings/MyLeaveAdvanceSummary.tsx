import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { useLeaveAdvances } from '@/features/operations-support/use-leave-advances'
import { AdvanceHistory } from '@/features/operations-support/LeaveAdvancePanel'

export function MyLeaveAdvanceSummary() {
  useRenderWatch('MyLeaveAdvanceSummary')
  const query = useLeaveAdvances()
  const employee = query.data?.employees[0]
  if (query.isError) return <p role="alert" className="text-sm text-danger">선사용 내역을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>다시 조회</Button></p>
  if (!employee || !query.data?.ready || employee.outstanding <= 0) return null
  return <Card className="mb-4 p-4 text-sm" aria-label="내 연차 선사용">
    <details>
      <summary className="cursor-pointer font-semibold">연차 선사용</summary>
      <div className="mt-2 space-y-2">
        <p>현재 연차 잔액 <strong className={(employee.remainingBalance ?? 0) < 0 ? 'text-danger' : ''}>{employee.remainingBalance == null ? '미등록' : `${employee.remainingBalance}일`}</strong> · 기본분 {employee.baseBalance == null ? '미등록' : `${employee.baseBalance}일`}</p>
        <p>다음 발생분 선사용 <strong>{employee.outstanding}일</strong> · 허용 한도 {employee.limit}일 · 다음 발생일 {employee.nextDate || '확인 필요'}</p>
        <p className="text-xs text-muted-foreground">승인된 부족분은 마이너스 잔액에 포함됩니다. 다음 기본 연차 발생 시 정산하며, 추가·생일 연차는 별도로 관리합니다.</p>
        {(employee.needsReview || employee.unclassified > 0) && <p className="text-warning">연차 기준 또는 기존 부족분 확인이 필요합니다. 운영지원에 문의해 주세요.</p>}
        <AdvanceHistory events={query.data.events}/>
      </div>
    </details>
  </Card>
}
