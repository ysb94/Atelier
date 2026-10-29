import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { readImpersonationState } from '@/lib/supabase/impersonation'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { attendancePresence } from '@/lib/supabase/attendance-presence'
import type { AttendancePresence } from '@/lib/supabase/attendance-presence'
import { useAttendanceEntry } from './attendance-entry-context'

export function AttendancePresenceMonitor() {
  useRenderWatch('AttendancePresenceMonitor')
  const entry = useAttendanceEntry()
  const { session } = useAuth()
  const cache = useQueryClient()
  const preview = usePagePreview()
  const impersonation = readImpersonationState()
  const userId = session?.user.id
  const enabled = Boolean(entry?.phase === 'ready' && entry.clock.needsClockOut && !preview?.active && !impersonation)
  const key = ['attendance-presence', userId, entry?.today]
  const query = useQuery({ queryKey: key, queryFn: () => attendancePresence(), enabled,
    refetchInterval: enabled ? 15_000 : false, retry: false })
  const current = query.data
  const refetchPresence = query.refetch
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const [seconds, setSeconds] = useState(300)
  const clock = useRef({ server: 0, local: 0 })
  const deliveryAttempt = useRef('')
  async function refresh() {
    await Promise.all(['attendance-presence', 'attendance-clock-ins', 'company-deferred-clock-outs'].map(part => cache.invalidateQueries({ queryKey: [part] })))
  }
  const deliver = useMutation({ mutationFn: (id: string) => attendancePresence('present', id),
    onSuccess: data => cache.setQueryData(key, data), onError: () => { deliveryAttempt.current = ''; void query.refetch() } })
  const answer = useMutation({ mutationFn: (action: 'continue' | 'clock_out') => attendancePresence(action, current?.check?.id),
    onSuccess: refresh, onError: () => { void query.refetch() } })
  const due = enabled && visible && (current?.state === 'waiting' || current?.state === 'awaiting_delivery') && Boolean(current.check) && !entry?.checkoutOpen
  useEffect(() => {
    const visibility = () => { const shown = document.visibilityState === 'visible'; setVisible(shown); if (shown && enabled) void refetchPresence() }
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [enabled, refetchPresence])
  const checkId = current?.check?.id
  const present = deliver.mutate
  useEffect(() => {
    if (!due || current?.state !== 'awaiting_delivery' || !checkId || deliveryAttempt.current === checkId) return
    if (document.querySelector('dialog[open]')) return
    deliveryAttempt.current = checkId
    present(checkId)
  }, [due, current?.state, current?.serverNow, checkId, present])
  const deadline = current?.check?.deadlineAt
  useEffect(() => {
    if (!current?.serverNow) return
    clock.current = { server: Date.parse(current.serverNow), local: performance.now() }
  }, [current?.serverNow])
  useEffect(() => {
    if (!due || !deadline) return
    const tick = () => {
      const now = clock.current.server + performance.now() - clock.current.local
      setSeconds(Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [due, deadline])
  useEffect(() => {
    if (current?.state === 'auto_closed' || current?.state === 'clocked_out') void cache.invalidateQueries({ queryKey: ['attendance-clock-ins', userId] })
  }, [current?.state, cache, userId])
  useEffect(() => {
    if (query.error) console.warn('[attendance-presence] 근무 확인 상태 조회 실패', query.error)
  }, [query.error])
  if (!enabled || !visible) return null
  if (query.error) return <aside role="alert" className="fixed right-4 top-16 z-40 max-w-sm rounded-xl border border-border bg-card p-4 text-sm shadow-sm">근무 확인 상태를 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void query.refetch()}>다시 조회</Button></aside>
  if (!due || !current?.check) return null
  const busy = deliver.isPending || answer.isPending
  const error = answer.error ?? deliver.error
  return <AttendancePresencePrompt current={current} seconds={seconds} busy={busy} error={error instanceof Error ? error.message : error ? '응답을 저장하지 못했습니다.' : null} onRetry={() => deliver.mutate(current.check!.id)} onAnswer={action => answer.mutate(action)} />
}

export function AttendancePresencePrompt({ current, seconds, busy, error, onRetry, onAnswer }: {
  current: AttendancePresence; seconds: number; busy: boolean; error: string | null
  onRetry: () => void; onAnswer: (action: 'continue' | 'clock_out') => void
}) {
  return <section role="dialog" aria-modal="false" aria-labelledby="attendance-presence-title" className="fixed right-4 top-16 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-5 shadow-sm">
    <h2 id="attendance-presence-title" className="text-base font-semibold">지금도 근무 중인가요?</h2>
    <p className="mt-2 text-sm text-muted-foreground">예정 퇴근시간이 지났습니다. 계속 근무 중이면 아래 버튼을 눌러 주세요.</p>
    <p role="timer" aria-label="근무 확인 응답 남은 시간" className="my-3 text-3xl font-semibold tabular-nums">{current.state === 'awaiting_delivery' ? '확인 중…' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</p>
    <p className="mb-3 text-xs text-muted-foreground">연속 무응답 {current.missedCount ?? 0}회 / 5회 · 응답 없으면 30분 간격으로 다시 확인합니다. 5회 연속 무응답 시 자동 퇴근·확인 필요로 표시됩니다.</p>
    {seconds === 0 && current.state === 'waiting' && <p className="mb-3 text-sm text-warning">응답 시간이 지났습니다. 처리 결과를 확인하고 있습니다.</p>}
    {error && <p role="alert" className="mb-3 text-sm text-danger">{error}{current.state === 'awaiting_delivery' && <Button size="sm" variant="outline" onClick={onRetry}>다시 연결</Button>}</p>}
    <div className="flex gap-2"><Button disabled={busy || current.state !== 'waiting' || seconds === 0} onClick={() => onAnswer('continue')}>계속 근무 중</Button><Button variant="outline" disabled={busy || current.state !== 'waiting' || seconds === 0} onClick={() => onAnswer('clock_out')}>지금 퇴근하기</Button></div>
  </section>
}
