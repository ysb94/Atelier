import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useOpsDirectory } from '@/features/operations-support/ops-directory'
import { useAttendanceStartSettings } from '@/features/operations-support/use-attendance-start-settings'
import { ATTENDANCE_GRACE_MINUTES, forgivenClock, resolveAttendanceStart, startTone, SUGGESTED_START } from '@/features/operations-support/attendance-start-settings'
import { StartTimeChoices } from '@/features/operations-support/StartTimeChoices'
import { memberLabel } from '@/features/operations-support/OpsStat'
import { useAuth } from '@/lib/supabase/auth'
import { canManageDepartmentAttendance } from '@/lib/company/attendance-assignment'
import '@/features/operations-support/attendance-start-settings.css'

export function MyAttendanceStartPanel({ departmentIds }: { departmentIds: string[] }) {
  useRenderWatch('MyAttendanceStartPanel')
  const { profile } = useAuth()
  const directory = useOpsDirectory()
  const { members: directoryMembers, departmentName } = directory
  const schedules = useAttendanceStartSettings({ assigned: true, departmentIds })
  const now = new Date()
  const [year, setYear] = useState(String(now.getFullYear()))
  const [monthNo, setMonthNo] = useState(String(now.getMonth() + 1).padStart(2, '0'))
  const month = `${year}-${monthNo}`
  const [search, setSearch] = useState('')
  const [checked, setChecked] = useState<string[]>([])
  const [start, setStart] = useState(SUGGESTED_START)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
  const departmentSet = useMemo(() => new Set(directory.departments.filter(department => canManageDepartmentAttendance(profile, departmentIds, department.id)).map(department => department.id)), [directory.departments, profile, departmentIds])
  const members = useMemo(() => directoryMembers.filter(member => member.departmentId && departmentSet.has(member.departmentId) && !member.attendanceExempt && (!search.trim() || `${memberLabel(member.displayName)} ${departmentName(member.departmentId)}`.toLowerCase().includes(search.trim().toLowerCase()))).sort((a, b) => departmentName(a.departmentId).localeCompare(departmentName(b.departmentId), 'ko') || memberLabel(a.displayName).localeCompare(memberLabel(b.displayName), 'ko')), [directoryMembers, departmentName, departmentSet, search])
  const visibleIds = members.map(member => member.id)
  const checkedVisible = visibleIds.filter(id => checked.includes(id))
  const allVisible = visibleIds.length > 0 && checkedVisible.length === visibleIds.length
  const graceUntil = forgivenClock(start, ATTENDANCE_GRACE_MINUTES)
  const tone = startTone(start)
  const busy = saving || schedules.save.isPending
  const unavailable = schedules.loading || directory.loading || Boolean(schedules.error || directory.error)
  const departmentLabel = directory.departments.filter(item => departmentSet.has(item.id)).map(item => item.name).join(' · ')

  function toggle(id: string) {
    setChecked(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }
  function toggleVisible() {
    setChecked(current => allVisible ? current.filter(id => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])])
  }
  async function apply() {
    const targets = members.filter(member => member.departmentId && checked.includes(member.id))
    if (!targets.length || busy || !validYear || unavailable) { if (!targets.length) setMessage('적용할 직원을 선택해 주세요.'); return }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) { setMessage('출근시간을 입력해 주세요.'); return }
    setSaving(true)
    setMessage('')
    try {
      for (const member of targets) {
        await schedules.save.mutateAsync({ month, until: month, departmentId: member.departmentId, employeeId: member.id, start, grace: ATTENDANCE_GRACE_MINUTES })
      }
      setMessage(`${Number(monthNo)}월 · ${targets.length}명에게 ${tone.label}를 적용했습니다.`)
      setChecked([])
    } catch (error) {
      console.warn('[attendance-start] 담당 부서 출근시간 적용 실패', error)
      setMessage(error instanceof Error ? error.message : '저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="attendance-start-settings space-y-4">
    <header>
      <h2 className="text-base font-semibold">담당 부서 출근시간</h2>
      <p className="mt-1 text-sm text-muted-foreground">{departmentLabel || '담당 부서 없음'} · 월을 고르고 시간을 정한 뒤, 직원을 체크해 적용합니다.</p>
    </header>
    {message && <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">{message}</p>}
    {unavailable && <p role="status" className="text-sm text-muted-foreground">{schedules.error || directory.error ? '직원 또는 출근시간을 불러오지 못했습니다.' : '담당 직원과 출근시간을 불러오는 중…'}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="출근시간 연도" type="number" min="2000" max="2100" className="h-9 w-24" value={year} disabled={busy} onChange={event => setYear(event.target.value)} />
      <Input aria-label="담당 직원 검색" placeholder="직원·부서 검색" value={search} onChange={event => setSearch(event.target.value)} className="h-9 w-full sm:w-56" />
    </div>
    <div className="attendance-start-months" role="group" aria-label="설정 기준 월">{months.map(value => <button key={value} type="button" disabled={busy || !validYear} aria-pressed={month === value} onClick={() => setMonthNo(value.slice(5, 7))}>{Number(value.slice(5, 7))}월</button>)}</div>
    {!validYear && <p role="alert" className="text-sm text-danger">2000–2100년 사이의 연도를 입력해 주세요.</p>}
      <div className="flex flex-wrap items-end gap-3">
      <StartTimeChoices value={start} disabled={busy} onChange={setStart} />
      <p className="pb-2 text-xs text-muted-foreground">정해진 출근시간에서 {ATTENDANCE_GRACE_MINUTES}분까지 인정합니다.</p>
      <Button type="button" disabled={busy || unavailable || !validYear || checkedVisible.length === 0} onClick={() => void apply()}><Check size={14} />{busy ? '적용 중…' : `${Number(monthNo)}월 · ${checkedVisible.length}명 적용`}</Button>
      {graceUntil && <p className="pb-2 text-xs text-muted-foreground">{graceUntil}까지는 기준 초과로 보지 않습니다.</p>}
    </div>
    <div className="overflow-auto rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full min-w-[640px] text-left text-sm" aria-label="담당 직원 출근시간">
        <thead className="bg-primary text-xs text-primary-foreground"><tr><th className="w-12 px-4 py-3"><input type="checkbox" aria-label="표시된 직원 모두 선택" checked={allVisible} disabled={unavailable || busy || !members.length} onChange={toggleVisible} /></th><th className="px-4 py-3 font-medium">직원</th><th className="px-4 py-3 font-medium">부서</th><th className="px-4 py-3 font-medium">{Number(monthNo)}월</th></tr></thead>
        <tbody>
          {members.map(member => {
            const resolved = resolveAttendanceStart(schedules.index, member.id, member.departmentId, month)
            const current = startTone(resolved.start)
            const name = memberLabel(member.displayName)
            return <tr key={member.id} className="border-t border-border">
              <td className="px-4 py-3"><input type="checkbox" aria-label={`${name} 선택`} checked={checked.includes(member.id)} disabled={unavailable || busy} onChange={() => toggle(member.id)} /></td>
              <th scope="row" className="px-4 py-3 font-medium">{name}</th>
              <td className="px-4 py-3 text-muted-foreground">{directory.departmentName(member.departmentId)}</td>
              <td className="px-4 py-3"><span className={`attendance-start-mark ${current.tone}`}>{current.label}</span></td>
            </tr>
          })}
          {!members.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{unavailable ? '정보를 확인하는 중입니다.' : '담당 부서에 정할 직원이 없습니다.'}</td></tr>}
        </tbody>
      </table>
    </div>
  </div>
}
