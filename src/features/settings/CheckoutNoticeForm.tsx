import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { useMyClockIn } from '@/features/home/use-my-clock-in'
import { useLeaveRequests } from '@/features/operations-support/use-leave-requests'
import { confirmPreviousClockOut } from '@/lib/supabase/attendance-entry'
import { checkoutCorrection, checkoutNoticeRoute } from './checkout-notice'
import { koreaDateKey } from './my-attendance'
import { DEFAULT_REMINDER_BASIS, validateRequest } from './personal-requests'

export function CheckoutNoticeForm({ workDate, onClose }: { workDate: string; onClose: () => void }) {
  const cache = useQueryClient(), clock = useMyClockIn(), leave = useLeaveRequests()
  const actor = useRef(leave.userId); actor.current = leave.userId
  const [value, setValue] = useState(''), [note, setNote] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const route = checkoutNoticeRoute(clock.rows, leave.requests, workDate, koreaDateKey())
  const loading = clock.loading || leave.loading
  const failed = Boolean(clock.queryError || leave.error)
  const canSave = route === 'direct' || route === 'correction'
  async function refresh() {
    await Promise.all([clock.refresh(), leave.refresh(), cache.invalidateQueries({ queryKey: ['my-home-work-notices'] })])
  }
  async function save() {
    if (busy || !value || !canSave || loading || failed) return
    const owner = leave.userId, expectedRoute = route
    setBusy(true); setError(null)
    try {
      const [clocks, requests] = await Promise.all([clock.refresh(), leave.refresh()])
      if (actor.current !== owner) return
      if (clocks[0].error || requests.error || !clocks[0].data || !requests.data) throw new Error('최신 출퇴근 기록을 확인하지 못했습니다. 다시 조회해 주세요.')
      const latestRoute = checkoutNoticeRoute(clocks[0].data, requests.data, workDate, koreaDateKey())
      if (latestRoute !== expectedRoute) throw new Error('출퇴근 기록 또는 신청 상태가 바뀌었습니다. 아래 안내를 확인한 뒤 다시 진행해 주세요.')
      const time = new Date(value)
      if (!Number.isFinite(time.getTime())) throw new Error('실제 퇴근 날짜와 시각을 입력해 주세요.')
      if (latestRoute === 'direct') await confirmPreviousClockOut(workDate, time.toISOString())
      else {
        const record = clocks[0].data.find(row => row.date === workDate)!
        const form = checkoutCorrection(workDate, record.clockIn, value, note)
        const problem = validateRequest(form, requests.data, DEFAULT_REMINDER_BASIS, koreaDateKey())
        if (problem) throw new Error(problem)
        await leave.create.mutateAsync(form)
      }
      await Promise.all(['my-home-work-notices', 'attendance-clock-ins', 'attendance-presence', 'company-attendance-spans', 'company-deferred-clock-outs'].map(key => cache.invalidateQueries({ queryKey: [key] })))
      onClose()
    } catch (failure) {
      console.warn('[my-home-notifications] 퇴근 확인 처리 실패', failure)
      setError(failure instanceof Error ? failure.message : '퇴근 확인을 처리하지 못했습니다.')
    } finally { setBusy(false) }
  }
  if (loading) return <p role="status" className="my-3 text-sm text-muted-foreground">출퇴근 기록과 정정 신청을 확인하고 있습니다.</p>
  if (failed || route === 'missing') return <div role="alert" className="my-3 text-sm text-danger">출퇴근 기록 또는 신청을 확인하지 못했습니다. <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>다시 조회</Button></div>
  if (!canSave) return <p role="status" className="my-3 text-sm text-muted-foreground">{route === 'handled' ? '이미 퇴근 기록이 있거나 정정 신청이 처리 중입니다.' : route === 'next-day' ? '오늘 자동 종료된 기록은 다음 출근 후 확인할 수 있습니다.' : '오늘 출근을 먼저 기록한 뒤 직전 근무일의 퇴근시간을 확인해 주세요.'}</p>
  return <div className="my-3 space-y-3">
    {route === 'correction' && <p className="text-sm text-muted-foreground">직전 출근일보다 이전인 {workDate} 기록입니다. 실제 퇴근시간으로 출퇴근 정정을 신청하면 기존 지정 승인자가 처리합니다. 승인 전까지 출퇴근 원본은 바뀌지 않습니다.</p>}
    <label className="block text-sm">실제 퇴근 날짜·시각<Input type="datetime-local" value={value} disabled={busy} onChange={event => setValue(event.target.value)} /></label>
    {route === 'correction' && <label className="block text-sm">정정 신청 사유<Textarea value={note} maxLength={1000} disabled={busy} onChange={event => setNote(event.target.value)} /></label>}
    {route === 'direct' && <p className="text-xs text-muted-foreground">직전 근무일의 누락 퇴근만 기존 본인 확인 절차로 저장합니다.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <Button type="button" disabled={busy || !value || (route === 'correction' && !note.trim())} onClick={() => void save()}>{busy ? '처리 중…' : route === 'correction' ? '출퇴근 정정 신청' : '실제 퇴근시간 등록'}</Button>
  </div>
}
