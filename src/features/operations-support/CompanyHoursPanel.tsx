import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { canEditOrgAssignment } from '@/lib/company/capabilities'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import { useAuth } from '@/lib/supabase/auth'
import { loadCompanyLunch, saveCompanyLunch } from '@/lib/supabase/company-work-hours'
import { addAttendanceStartOption, removeAttendanceStartOption } from '@/lib/supabase/attendance-start-options'
import { startOptionLabel } from './attendance-start-settings'
import { useAttendanceStartOptions } from './use-attendance-start-options'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function CompanyHoursPanel() {
  useRenderWatch('CompanyHoursPanel')
  const { profile } = useAuth()
  const { access } = useBasicWorkAccess()
  const canEdit = canEditOrgAssignment(profile) || access?.domains.includes('operations') === true
  const canRemove = canEditOrgAssignment(profile)
  const client = useQueryClient()
  const options = useAttendanceStartOptions()
  const [draft, setDraft] = useState('')
  const [lunchStart, setLunchStart] = useState('12:00')
  const [lunchEnd, setLunchEnd] = useState('13:00')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const lunch = useQuery({ queryKey: ['company-work-hours'], queryFn: loadCompanyLunch })
  useEffect(() => {
    if (lunch.error) console.warn('[company-hours] 점심시간 불러오기 실패', lunch.error)
  }, [lunch.error])
  useEffect(() => {
    if (!lunch.data) return
    setLunchStart(lunch.data.start)
    setLunchEnd(lunch.data.end)
  }, [lunch.data])

  const saveLunch = useMutation({
    mutationFn: () => saveCompanyLunch(lunchStart, lunchEnd),
    onSuccess: async () => {
      setError('')
      setMessage('점심시간을 저장했습니다.')
      await client.invalidateQueries({ queryKey: ['company-work-hours'] })
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : '점심시간을 저장하지 못했습니다.'),
  })
  const addOption = useMutation({
    mutationFn: (start: string) => addAttendanceStartOption(start),
    onSuccess: async () => {
      setDraft('')
      setError('')
      setMessage('출근시간 선택지를 추가했습니다.')
      await client.invalidateQueries({ queryKey: ['attendance-start-options'] })
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : '출근시간을 추가하지 못했습니다.'),
  })
  const removeOption = useMutation({
    mutationFn: (start: string) => removeAttendanceStartOption(start),
    onSuccess: async () => {
      setError('')
      setMessage('출근시간 선택지를 목록에서 뺐습니다. 이미 지정된 직원 시간은 그대로입니다.')
      await client.invalidateQueries({ queryKey: ['attendance-start-options'] })
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : '출근시간을 빼지 못했습니다.'),
  })
  const busy = saveLunch.isPending || addOption.isPending || removeOption.isPending

  function add() {
    if (!TIME.test(draft)) { setError('출근시간을 입력해 주세요.'); return }
    if (options.options.includes(draft)) { setError('이미 있는 출근시간입니다.'); return }
    setError('')
    addOption.mutate(draft)
  }
  function saveBreak() {
    if (!TIME.test(lunchStart) || !TIME.test(lunchEnd) || lunchEnd <= lunchStart) {
      setError('점심 종료는 시작보다 뒤여야 합니다.')
      return
    }
    setError('')
    saveLunch.mutate()
  }

  return <div className="space-y-5">
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold">점심시간</h2>
      <p className="mt-1 text-sm text-muted-foreground">회사 공통 점심시간입니다.</p>
      {lunch.data && !lunch.data.saved && <p className="mt-2 text-xs text-muted-foreground">아직 저장된 점심시간이 없어 12:00–13:00을 보여 줍니다.</p>}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">시작<Input aria-label="점심 시작" type="time" className="mt-1 h-9 w-36" value={lunchStart} disabled={!canEdit || busy} onChange={event => setLunchStart(event.target.value)} /></label>
        <label className="text-sm">종료<Input aria-label="점심 종료" type="time" className="mt-1 h-9 w-36" value={lunchEnd} disabled={!canEdit || busy} onChange={event => setLunchEnd(event.target.value)} /></label>
        <Button type="button" disabled={!canEdit || busy} onClick={saveBreak}>{saveLunch.isPending ? '저장 중…' : '점심시간 저장'}</Button>
      </div>
    </section>
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="px-5 pt-5">
        <h2 className="text-base font-semibold">출근시간 선택지</h2>
        <p className="mt-1 text-sm text-muted-foreground">부서·직원 출근시간을 정할 때 고를 수 있는 시간입니다. 11시처럼 추가하면 그 선택지가 목록에 나타납니다.</p>
      </div>
      {message && <p role="status" className="mx-5 mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{message}</p>}
      {error && <p role="alert" className="mx-5 mt-3 text-sm text-danger">{error}</p>}
      {!canEdit && <p className="mx-5 mt-3 text-sm text-muted-foreground">선택지와 점심시간은 조직 관리 권한이 있어야 바꿀 수 있습니다.</p>}
      <div className="mt-4 flex flex-wrap items-end gap-3 px-5">
        <label className="text-sm">추가할 시간<Input aria-label="추가할 출근시간" type="time" className="mt-1 h-9 w-36" value={draft} disabled={!canEdit || busy} onChange={event => setDraft(event.target.value)} /></label>
        <Button type="button" disabled={!canEdit || busy || !TIME.test(draft)} onClick={add}>{addOption.isPending ? '추가 중…' : '선택지 추가'}</Button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="border-y border-border bg-primary text-xs text-primary-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">출근시간</th>
              <th className="px-4 py-2.5 font-medium">표시</th>
              <th className="px-4 py-2.5 font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {options.loading ? <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">불러오는 중…</td></tr>
              : options.options.map(item => <tr key={item} className="border-b border-border/70 last:border-0">
                <th scope="row" className="px-4 py-3 font-medium">{item}</th>
                <td className="px-4 py-3 text-muted-foreground">{startOptionLabel(item)}</td>
                <td className="px-4 py-2"><Button type="button" size="sm" variant="outline" disabled={!canRemove || busy} onClick={() => removeOption.mutate(item)}>빼기</Button></td>
              </tr>)}
            {!options.loading && options.options.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">등록된 출근시간이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>
}
