import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { offsiteSettlementPreview, saveOffsiteSettlement, type OffsiteSettlement } from '@/lib/supabase/offsite-settlements'
import { durationInputMinutes, durationInputValue, formatDurationClock, workDurationLabel } from './overtime-hours'
import type { LeaveRequest } from '@/lib/supabase/leave-requests'
import { isWorkday } from './monthly-attendance'

export function OffsiteSettlementEditor({ request, onClose }: { request: LeaveRequest; onClose: () => void }) {
  useRenderWatch('OffsiteSettlementEditor')
  const { profile } = useAuth()
  const cache = useQueryClient()
  const preview = useQuery({ queryKey: ['offsite-settlement-preview', profile?.id, request.id], queryFn: () => offsiteSettlementPreview(request.id), retry: false })
  const [mode, setMode] = useState<OffsiteSettlement['mode']>('overtime')
  const [minutes, setMinutes] = useState<Record<string,string>>({})
  const [days, setDays] = useState('0.25'), [expires, setExpires] = useState(''), [note, setNote] = useState('')
  const [limit, setLimit] = useState(31)
  const save = useMutation({ mutationFn: saveOffsiteSettlement, onSuccess: async () => {
    await Promise.all(['offsite-settlements', 'offsite-settlement-preview', 'overtime-actuals', 'employee-extra-leave', 'employee-roster', 'my-extra-leave', 'my-attendance-basis', 'leave-notice-management', 'my-home-work-notices'].map(key => cache.invalidateQueries({ queryKey: [key] })))
  } })
  useEffect(() => { if (preview.error) console.warn('[offsite-settlement] 화면 조회 실패', preview.error) }, [preview.error])
  useEffect(() => {
    const rows = preview.data?.dates?.filter(row => row.minutes != null && row.minutes > 0 && isWorkday(row.date, {})) ?? []
    if (!rows.length) return
    setMinutes(current => {
      let changed = false
      const next = { ...current }
      for (const row of rows) {
        const existing = next[row.date]
        if (existing == null) {
          next[row.date] = formatDurationClock(row.minutes!)
          changed = true
        } else if (/^\d+$/.test(existing)) {
          next[row.date] = formatDurationClock(Number(existing))
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [preview.data])
  const prior = preview.data?.settlement
  const allDates = preview.data?.dates
  const dates = allDates?.filter(row => isWorkday(row.date, {}))
  const holidayDates = allDates?.filter(row => !isWorkday(row.date, {}))
  const positive = dates?.filter(row => row.minutes != null && row.minutes > 0)
  const parsed = Object.entries(minutes).map(([date, value]) => [date, value.trim(), durationInputMinutes(value)] as const)
  const actual = mode === 'none' ? {} : Object.fromEntries(parsed.filter(([, value, amount]) => value !== '' && amount != null).map(([date, , amount]) => [date, amount!]))
  const invalidTime = parsed.some(([, value, amount]) => value !== '' && amount == null)
  const total = Object.values(actual).reduce((sum,value) => sum+value,0)
  const valid = Boolean(dates?.length && !prior && !save.isSuccess && note.trim() && !invalidTime && (mode === 'none' || (total>0 && Object.entries(actual).every(([date,value]) => Number.isInteger(value) && value>=0 && value<=(dates.find(row=>row.date===date)?.minutes ?? -1)))) && (mode !== 'leave' || (Number(days)>0 && Number(days)<=365 && Number(days)*4%1===0 && expires)))
  return <Card className="space-y-3 p-4" aria-label="외근 후처리">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{request.employeeName} · {request.from} 외근 후처리</h3><Button variant="outline" size="sm" disabled={save.isPending} onClick={onClose}>닫기</Button></div>
    {Boolean(holidayDates?.length) && <p className="text-sm">주말·공휴일 {holidayDates!.length}일은 별도 확인·정산합니다. <Link className="text-primary underline" to={`/operations-support?part=attendance&attendanceView=holiday&holidayMonth=${holidayDates![0].date.slice(0,7)}`}>주말·공휴일 근무 관리로 이동</Link></p>}
    {preview.isPending ? <p>불러오는 중…</p> : preview.isError ? <p role="alert" className="text-warning">{preview.error.message} <Button variant="outline" size="sm" onClick={()=>void preview.refetch()}>다시 불러오기</Button></p> : prior ? <div className="space-y-2"><p>처리 완료 · {prior.mode==='leave' ? `추가 휴가 ${prior.leave_days}일 · ${prior.expires_on}까지 · 야근 누적 제외` : prior.mode==='overtime' ? `야근 누적 ${workDurationLabel(Object.values(prior.minutes_by_date).reduce((sum,value)=>sum+Number(value),0))}` : '추가 근무 없음'}</p><p className="whitespace-pre-wrap text-sm">{prior.note}</p><p className="text-xs text-muted-foreground">{new Date(prior.decided_at).toLocaleString('ko-KR')} · 확정된 이력은 보존합니다.</p></div> : save.isSuccess ? <p role="status" className="text-success">후처리를 저장했습니다. 휴가와 야근은 선택한 방식으로만 반영했습니다.</p> : <>
      <p className="text-sm text-muted-foreground">예상 추가 근무 시간을 시:분으로 넣었습니다. 예: 4:00, 3:30. 이동·숙박·휴식 시간을 빼고 실제 근무한 시간만 고쳐 주세요. 빈 칸은 0분으로 처리합니다. 확정한 보상은 이력으로 남으며 이 화면에서 변경·취소하지 않습니다.</p>
      {dates?.some(row=>row.minutes==null) && <p role="alert" className="text-warning">근무·공휴일 기준이 없는 날짜가 있습니다. 해당 날짜는 기준 설정 후 다시 조회해 주세요.</p>}
      <label className="block text-sm">처리 방식<Select aria-label="외근 처리 방식" value={mode} onChange={event=>setMode(event.target.value as OffsiteSettlement['mode'])}><option value="overtime">야근 누적 · 포괄임금 시간에 포함</option><option value="leave">추가 휴가 지급 · 야근 누적 제외</option><option value="none">실제 추가 근무 없음</option></Select></label>
      {mode!=='none' && <><table className="w-full text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr><th className="p-2">날짜</th><th className="p-2">예상 추가 근무</th><th className="p-2">실제 추가 근무</th></tr></thead><tbody>{positive?.slice(0,limit).map(row=><tr key={row.date}><td className="p-2">{row.date}</td><td className="p-2">{workDurationLabel(row.minutes!)}</td><td className="p-2"><Input inputMode="numeric" aria-label={`${row.date} 실제 추가 근무 시:분`} value={durationInputValue(minutes[row.date])} placeholder="4:00" onChange={event=>setMinutes(current=>({...current,[row.date]:event.target.value}))}/></td></tr>)}</tbody></table>{positive && positive.length>limit && <Button variant="outline" onClick={()=>setLimit(value=>value+31)}>날짜 더 보기</Button>}<p>실제 추가 근무 합계 {workDurationLabel(total)}</p></>}
      {mode==='leave' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">지급 일수<Input aria-label="외근 보상 휴가 일수" type="number" min="0.25" max="365" step="0.25" value={days} onChange={event=>setDays(event.target.value)}/><span className="text-xs text-muted-foreground">반반차 .25일 · 반차 .5일 · 연차 1일, 합산 가능</span></label><label className="text-sm">사용기한<Input type="date" aria-label="외근 보상 휴가 사용기한" value={expires} onChange={event=>setExpires(event.target.value)}/></label></div>}
      <label className="block text-sm">처리 사유 · 필수<Textarea aria-label="외근 후처리 사유" maxLength={500} value={note} onChange={event=>setNote(event.target.value)}/></label>
      {save.error && <p role="alert" className="text-danger">{save.error.message}</p>}
      <Button disabled={!valid||save.isPending} onClick={()=>save.mutate({requestId:request.id,mode,minutes:actual,days:mode==='leave'?Number(days):null,expires:mode==='leave'?expires:null,note})}>{save.isPending?'저장 중…':'후처리 확정'}</Button>
    </>}
  </Card>
}
