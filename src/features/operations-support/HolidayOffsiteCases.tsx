import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status-pill'
import { useRenderWatch } from '@/lib/diagnostics'
import { firstOffsiteHoliday } from './offsite-holiday-routing'
import { useMonthlyWorkRequests } from './use-monthly-work-requests'
import { HolidayOffsiteSettlementDialog } from './HolidayOffsiteSettlementDialog'
import { offsitePhase, OFFSITE_PHASE_LABEL } from './offsite-period'
import type { HolidayWork } from './holiday-work'

/** One trip is managed here, regardless of which dates/months its parts occupy. */
export function HolidayOffsiteCases({ month, search, policyReady, enabled, rows: holidayRows, loading, error, refresh }: {
  month: string; search: string; policyReady: boolean; enabled: boolean
  rows: HolidayWork[]; loading: boolean; error: Error | null; refresh: () => Promise<unknown>
}) {
  useRenderWatch('HolidayOffsiteCases')
  const [params,setParams]=useSearchParams(), requests=useMonthlyWorkRequests(month,enabled)
  const rows=requests.rows.filter(r=>r.kind==='offsite' && firstOffsiteHoliday(r) && `${r.employeeName} ${r.departmentName}`.toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko')))
  const selected=requests.rows.find(r=>r.id===params.get('offsiteCase') && firstOffsiteHoliday(r))
  function select(id: string | null) {
    setParams(previous=>{const next=new URLSearchParams(previous); if(id)next.set('offsiteCase',id);else next.delete('offsiteCase');next.delete('holidayWork');next.delete('holidayEvent');return next},{replace:true})
  }
  return <section className="space-y-3" aria-label="주말 포함 외근 건 전체 후처리">
    <h3 className="font-semibold">주말·공휴일 포함 외근</h3>
    <p className="text-sm text-muted-foreground">평일이 섞여 있어도 외근 한 건의 전체 기간을 이곳에서 처리합니다. 평일 추가 근무와 주말·공휴일의 계산 기준은 각각 유지합니다.</p>
    {requests.error && <p role="alert" className="text-sm text-danger">외근을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={()=>void requests.refetch()}>다시 조회</Button></p>}
    <Card className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">주말 포함 외근 목록</caption><thead className="bg-primary text-primary-foreground"><tr>{['직원','외근 전체 기간','장소','진행','후처리'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
      {rows.map(r=><tr key={r.id} className="border-t border-border"><td className="p-3">{r.employeeName}<span className="block text-xs text-muted-foreground">{r.departmentName}</span></td><td className="p-3">{r.from} {r.start} ~ {r.to} {r.end}{r.endNextDay?' (다음 날 종료)':''}</td><td className="p-3">{r.place}</td><td className="p-3"><StatusPill tone="muted">{OFFSITE_PHASE_LABEL[offsitePhase(r,Date.now())]}</StatusPill></td><td className="p-3"><Button type="button" size="sm" variant="outline" onClick={()=>select(r.id)}>건 전체 후처리</Button></td></tr>)}
      {!rows.length && <tr><td colSpan={5} className="p-4 text-muted-foreground">{requests.isPending?'외근 불러오는 중…':'해당 월에 주말·공휴일이 포함된 외근이 없습니다.'}</td></tr>}
    </tbody></table></Card>
    {selected && <HolidayOffsiteSettlementDialog key={selected.id} request={selected} active={enabled}
      rows={holidayRows} loading={loading} error={error} refresh={refresh} policyReady={policyReady} close={()=>select(null)} />}
  </section>
}
