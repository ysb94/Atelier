import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { formatNumber } from '@/lib/utils'
import { DraftNotice, memberLabel, OpsPanelFrame, OpsStat } from './OpsStat'
import { useOpsDirectory } from './ops-directory'
import { LeaveApprovalPanel } from './LeaveApprovalPanel'

type LeaveDraft = { granted: string; used: string; note: string }

const EMPTY_DRAFT: LeaveDraft = { granted: '', used: '', note: '' }

function parseDays(value: string) {
  if (!value.trim()) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return number
}

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function hireLabel(date: string | null) {
  if (!date) return '없음'
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()]
  return weekday ? `${date} (${weekday})` : date
}

export function LeavePanel() {
  const [view, setView] = useState('requests')
  return <div className="space-y-4">
    <div className="flex gap-2" role="group" aria-label="연차관리 보기">
      <Button variant={view === 'requests' ? 'default' : 'outline'} aria-pressed={view === 'requests'} onClick={() => setView('requests')}>신청 현황</Button>
      <Button variant={view === 'balance' ? 'default' : 'outline'} aria-pressed={view === 'balance'} onClick={() => setView('balance')}>연차 현황 · 시안</Button>
    </div>
    {view === 'requests' ? <LeaveApprovalPanel readOnly/> : <LeaveBalancePanel/>}
  </div>
}

function LeaveBalancePanel() {
  const directory = useOpsDirectory()
  const year = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(String(year))
  const [departmentId, setDepartmentId] = useState('all')
  const [draftsByYear, setDraftsByYear] = useState<Record<string, Record<string, LeaveDraft>>>({})
  const drafts = useMemo(() => draftsByYear[selectedYear] ?? {}, [draftsByYear, selectedYear])

  const visible = useMemo(() => {
    return directory.members
      .filter((member) => departmentId === 'all' || member.departmentId === departmentId)
      .sort((left, right) =>
        memberLabel(left.displayName).localeCompare(memberLabel(right.displayName), 'ko'),
      )
  }, [departmentId, directory.members])

  const totals = useMemo(() => {
    let granted = 0
    let used = 0
    let filled = 0
    for (const member of visible) {
      const draft = drafts[member.id] ?? EMPTY_DRAFT
      const grant = parseDays(draft.granted)
      const spend = parseDays(draft.used)
      if (grant == null && spend == null) continue
      filled += 1
      granted += grant ?? 0
      used += spend ?? 0
    }
    return { granted, used, filled, remaining: granted - used }
  }, [drafts, visible])

  function updateDraft(id: string, patch: Partial<LeaveDraft>) {
    setDraftsByYear((current) => {
      const yearDrafts = current[selectedYear] ?? {}
      return {
        ...current,
        [selectedYear]: {
          ...yearDrafts,
          [id]: { ...(yearDrafts[id] ?? EMPTY_DRAFT), ...patch },
        },
      }
    })
  }

  return (
    <OpsPanelFrame>
      <DraftNotice>
        {selectedYear}년 연차 숫자는 이 화면에서만 바뀝니다. 아직 저장되지 않으며 새로고침하면 사라집니다.
        <br />
        연차 부여 일수·입사일·연도 계산 기준은 보류 중입니다. 자동 부여·잔여일 계산·차감은 적용하지 않습니다.
      </DraftNotice>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Select
          aria-label="연차 연도"
          value={selectedYear}
          onChange={(event) => setSelectedYear(event.target.value)}
          className="h-9 sm:w-32"
        >
          {[year - 1, year, year + 1].map((item) => (
            <option key={item} value={String(item)}>{item}년</option>
          ))}
        </Select>
        <Select
          aria-label="연차 부서"
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
          className="h-9 sm:w-44"
        >
          <option value="all">전체 부서</option>
          {directory.departments.map((dept) => (
            <option key={dept.id} value={dept.id}>{dept.name}</option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <OpsStat label="대상" value={`${formatNumber(visible.length)}명`} detail={`입력 ${formatNumber(totals.filled)}명`} />
        <OpsStat label="부여" value={`${formatDays(totals.granted)}일`} />
        <OpsStat label="사용" value={`${formatDays(totals.used)}일`} />
        <OpsStat label="잔여" value={`${formatDays(totals.remaining)}일`} />
      </div>
      <article className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">이름</th>
                <th className="px-4 py-2.5 font-medium">부서</th>
                <th className="px-4 py-2.5 font-medium">입사일</th>
                <th className="px-4 py-2.5 font-medium">부여</th>
                <th className="px-4 py-2.5 font-medium">사용</th>
                <th className="px-4 py-2.5 font-medium">잔여</th>
                <th className="px-4 py-2.5 font-medium">메모</th>
              </tr>
            </thead>
            <tbody>
              {directory.loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">불러오는 중...</td></tr>
              ) : directory.error ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center">
                    <p className="text-sm text-danger">직원 목록을 불러오지 못했습니다.</p>
                    <Button className="mt-3" size="sm" variant="outline" onClick={directory.refetch}>다시 불러오기</Button>
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">표시할 직원이 없습니다.</td></tr>
              ) : visible.map((member) => {
                const draft = drafts[member.id] ?? EMPTY_DRAFT
                const granted = parseDays(draft.granted)
                const used = parseDays(draft.used)
                const remaining = granted == null && used == null ? null : (granted ?? 0) - (used ?? 0)
                return (
                  <tr key={member.id} className="border-b border-border/70 last:border-0">
                    <td className="px-4 py-3 font-medium">{memberLabel(member.displayName)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{directory.departmentName(member.departmentId)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{hireLabel(member.hireDate)}</td>
                    <td className="px-4 py-2">
                      <Input
                        aria-label={`${memberLabel(member.displayName)} 부여 일수`}
                        inputMode="decimal"
                        value={draft.granted}
                        placeholder="0"
                        className="h-8 w-20 px-2 text-xs"
                        onChange={(event) => updateDraft(member.id, { granted: event.target.value })}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        aria-label={`${memberLabel(member.displayName)} 사용 일수`}
                        inputMode="decimal"
                        value={draft.used}
                        placeholder="0"
                        className="h-8 w-20 px-2 text-xs"
                        onChange={(event) => updateDraft(member.id, { used: event.target.value })}
                      />
                    </td>
                    <td className={`px-4 py-3 tabular-nums ${remaining != null && remaining < 0 ? 'text-danger' : ''}`}>
                      {remaining == null ? '—' : `${formatDays(remaining)}일`}
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        aria-label={`${memberLabel(member.displayName)} 연차 메모`}
                        value={draft.note}
                        placeholder="메모"
                        className="h-8 px-2 text-xs"
                        onChange={(event) => updateDraft(member.id, { note: event.target.value })}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </article>
    </OpsPanelFrame>
  )
}
