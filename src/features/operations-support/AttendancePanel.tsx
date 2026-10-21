import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Download, LayoutGrid, List, Printer, Search, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { hasPermission } from '@/lib/company/permissions'
import { useRenderWatch } from '@/lib/diagnostics'
import { interactionContext } from '@/lib/diagnostics/perf-watch'
import { useAuth } from '@/lib/supabase/auth'
import { formatNumber } from '@/lib/utils'
import { AttendanceCalendar } from './AttendanceCalendar'
import { AttendanceStartSettingsPanel } from './AttendanceStartSettingsPanel'
import { useAttendanceStartSettings } from './use-attendance-start-settings'
import { attendanceStartIndex, resolveAttendanceStart, type AttendanceStartSetting } from './attendance-start-settings'
import { exportAttendance, type AttendanceRow } from './attendance-export'
import { memberLabel, OpsPanelFrame, OpsStat } from './OpsStat'
import { useOpsDirectory } from './ops-directory'
import { koreanHolidayNames } from './korean-holidays'
import { EMPTY_SCHEDULE, formatTime, isWorkday, localDateKey, monthDates, monthLabel, monthlyAttendance, shiftMonth, type AttendanceRecords, type AttendanceSchedule, type WorkdayOverrides } from './monthly-attendance'
import './monthly-attendance.css'

const PAGE_SIZE = 25
function timeAttendanceWork<T>(fn: () => T): T {
  const started = performance.now()
  const result = fn()
  const elapsed = Math.round(performance.now() - started)
  if (elapsed >= 200) console[elapsed >= 1000 ? 'warn' : 'info'](`[attendance-work] monthly-summary ${elapsed}ms`, interactionContext())
  return result
}

export function AttendancePanel() {
  const source = useOpsDirectory()
  const { departments, members: allMembers, departmentName, loading, error } = source
  const refetchRef = useRef(source.refetch)
  useEffect(() => { refetchRef.current = source.refetch })
  const members = useMemo(() => allMembers.filter(member => !member.attendanceExempt), [allMembers])
  const directory = useMemo<ReturnType<typeof useOpsDirectory>>(() => ({ departments, members, departmentName, loading, error, refetch: () => refetchRef.current() }), [departments, members, departmentName, loading, error])
  const { profile } = useAuth()
  const saved = useAttendanceStartSettings()
  const [part, setPart] = useState<'all' | 'settings'>('all')
  const [editing, setEditing] = useState<{ id?: string; month?: string }>({})
  return <div className="space-y-5">
    <div role="group" aria-label="근태 관리 메뉴" className="flex flex-wrap gap-2">
      <Button variant={part === 'all' ? 'default' : 'outline'} aria-pressed={part === 'all'} onClick={() => setPart('all')}>전체 근태 관리</Button>
      <Button variant={part === 'settings' ? 'default' : 'outline'} aria-pressed={part === 'settings'} onClick={() => {setEditing({});setPart('settings')}}>출근시간 확인</Button>
    </div>
    <div hidden={part !== 'all'}><AttendanceWorkspace directory={directory} canEdit={hasPermission(profile, 'attendance.manage')} savedSettings={saved.settings} settingsLoading={saved.loading} settingsError={Boolean(saved.error)} onEditStart={(id,month) => {setEditing({id,month});setPart('settings')}}/></div>
    {part === 'settings' && <AttendanceStartSettingsPanel readOnly key={`${editing.id}:${editing.month}`} directory={directory} schedules={saved} initialEmployeeId={editing.id} initialMonth={editing.month}/>}
  </div>
}

export function AttendanceWorkspace({ directory, canEdit, today = localDateKey(new Date()), initialMonth, initialRecords = {}, initialSchedules = {}, savedSettings, settingsLoading = false, settingsError = false, onEditStart }: {
  directory: ReturnType<typeof useOpsDirectory>; canEdit: boolean; today?: string; initialMonth?: string
  initialRecords?: AttendanceRecords; initialSchedules?: Record<string, AttendanceSchedule>
  savedSettings?: AttendanceStartSetting[]; settingsLoading?: boolean; settingsError?: boolean; onEditStart?: (id: string,month: string) => void
}) {
  useRenderWatch('AttendanceWorkspace')
  const { members, departmentName } = directory
  const [month, setMonth] = useState(initialMonth ?? today.slice(0, 7))
  const [departmentId, setDepartmentId] = useState('all')
  const [search, setSearch] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [view, setView] = useState<'summary' | 'report'>('summary')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const records = initialRecords
  const [schedules, setSchedules] = useState<Record<string, AttendanceSchedule>>(initialSchedules)
  const savedIndex = useMemo(() => attendanceStartIndex(savedSettings ?? []), [savedSettings])
  const [overrides, setOverrides] = useState<WorkdayOverrides>({})
  const [reviews, setReviews] = useState<Record<string, boolean>>({})
  const [workdaySettings, setWorkdaySettings] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const dates = useMemo(() => monthDates(month), [month])
  const needle = search.trim().toLocaleLowerCase('ko')
  const rows = useMemo(() => timeAttendanceWork(() => members.map(member => {
    const schedule = savedSettings ? resolveAttendanceStart(savedIndex, member.id, member.departmentId, month) : schedules[member.id] ?? EMPTY_SCHEDULE
    const summary = monthlyAttendance(member.id, month, records, schedule, overrides, today)
    return { member, team: departmentName(member.departmentId), schedule, summary, complete: Boolean(reviews[`${month}:${member.id}`]) && summary.pending === 0 }
  }).sort((a, b) => a.team.localeCompare(b.team, 'ko') || memberLabel(a.member.displayName).localeCompare(memberLabel(b.member.displayName), 'ko'))), [members, departmentName, month, records, schedules, overrides, today, reviews, savedSettings, savedIndex])
  const scopeRows = useMemo(() => rows.filter(row => (departmentId === 'all' || (departmentId === 'unassigned' ? !row.member.departmentId : row.member.departmentId === departmentId)) && (!needle || [memberLabel(row.member.displayName), row.team, row.member.position, row.member.jobGrade].join(' ').toLocaleLowerCase('ko').includes(needle))), [rows, departmentId, needle])
  const visible = useMemo(() => onlyPending ? scopeRows.filter(row => row.summary.pending > 0 || !row.complete) : scopeRows, [scopeRows, onlyPending])
  const totals = useMemo(() => ({ pending: scopeRows.filter(row => row.summary.pending > 0).length, missing: scopeRows.reduce((sum, row) => sum + row.summary.missingDates.length, 0), complete: scopeRows.filter(row => row.complete).length }), [scopeRows])
  const selected = rows.find(row => row.member.id === selectedId)
  const pageSize = view === 'report' ? 8 : PAGE_SIZE
  const pages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pages)
  const pageRows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const unavailable = directory.loading || Boolean(directory.error) || settingsLoading || settingsError

  function chooseMonth(next: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) return
    setMonth(next); setPage(1); setWorkdaySettings(false)
  }
  function updateSchedule(patch: Partial<AttendanceSchedule>) {
    if (!selected || !canEdit) return
    const id = selected.member.id
    setSchedules(current => ({ ...current, [id]: { ...(current[id] ?? EMPTY_SCHEDULE), ...patch } }))
    setReviews(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, key.endsWith(`:${id}`) ? false : value])))
  }
  function toggleWorkday(date: string) {
    if (!canEdit) return
    setOverrides(current => ({ ...current, [date]: !isWorkday(date, current) }))
    setReviews(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, key.startsWith(`${month}:`) ? false : value])))
  }
  function selectEmployee(row: AttendanceRow) {
    setSelectedId(row.member.id)
  }
  async function download() {
    setExporting(true); setExportError('')
    try { await exportAttendance(month, visible, records) }
    catch (error) { console.warn('[attendance-work] 월별 근태 내보내기 실패', { error, month, ...interactionContext() }); setExportError('엑셀을 만들지 못했습니다. 다시 시도해 주세요.') }
    finally { setExporting(false) }
  }

  return <OpsPanelFrame className="monthly-attendance">
    <div className="attendance-draft-note"><strong>월별 근태 관리</strong><span>출근 기준은 출근시간 설정의 월별 저장값을 사용합니다. 출퇴근 원본·연차 반영은 아직 미연결이며, 월 검토 표시는 화면 시안입니다.</span></div>
    <div className="attendance-topbar">
      <div className="attendance-month-picker"><Button variant="outline" size="icon" aria-label="이전 월" onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></Button><Input aria-label="근태 월" type="month" value={month} onChange={event => chooseMonth(event.target.value)} /><Button variant="outline" size="icon" aria-label="다음 월" onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></Button><Button variant="ghost" size="sm" onClick={() => chooseMonth(today.slice(0, 7))}>이번 달</Button></div>
      <div className="attendance-export-actions"><Button variant="outline" size="sm" disabled={unavailable || !visible.length || exporting} onClick={() => void download()}><Download size={14} />{exporting ? '엑셀 만드는 중…' : '엑셀 내보내기'}</Button><Button variant="outline" size="sm" disabled={view !== 'report' || unavailable || !visible.length} title={view !== 'report' ? '월간 보고서 보기에서 인쇄할 수 있습니다.' : '현재 보고서 페이지를 인쇄합니다.'} onClick={() => window.print()}><Printer size={14} />인쇄</Button></div>
    </div>
    <div className="attendance-filters"><Select aria-label="근태 부서" value={departmentId} onChange={event => { setDepartmentId(event.target.value); setPage(1); setSelectedId(null) }}><option value="all">전체 부서</option>{directory.departments.map(dept => <option key={dept.id} value={dept.id}>{dept.name}</option>)}{directory.members.some(member => !member.departmentId) && <option value="unassigned">소속 없음</option>}</Select><div className="attendance-search"><Search size={15} /><Input aria-label="근태 직원 검색" placeholder="직원 이름, 부서, 직책 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></div><label className="attendance-pending-filter"><input type="checkbox" checked={onlyPending} onChange={event => { setOnlyPending(event.target.checked); setPage(1) }} />확인 필요만</label><Button variant="ghost" size="sm" onClick={() => setWorkdaySettings(value => !value)} aria-expanded={workdaySettings}><Settings2 size={14} />근무일 설정</Button></div>
    {workdaySettings && <div className="attendance-workdays"><div><strong>{monthLabel(month)} 공통 근무일</strong><p>공휴일, 대체공휴일, 선거일과 임시공휴일은 국가 달력 기준으로 이미 휴무입니다. 회사 휴무만 선택을 해제하고, 휴일 근무는 선택해 주세요.</p></div><div className="attendance-workday-buttons">{dates.map(date => { const names = koreanHolidayNames(date); const weekday = ['일','월','화','수','목','금','토'][new Date(`${date}T12:00:00`).getDay()]; const work = isWorkday(date, overrides); return <button key={date} type="button" aria-label={`${date} ${[weekday, ...names].join(' ')} ${work ? '근무일' : '휴무'}`} title={names.join(' · ') || undefined} aria-pressed={work} disabled={!canEdit} onClick={() => toggleWorkday(date)}>{Number(date.slice(-2))}<small>{weekday}</small></button> })}</div></div>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><OpsStat label="월 검토 대상" value={unavailable ? '—' : `${formatNumber(scopeRows.length)}명`} detail={monthLabel(month)} /><OpsStat label="확인 필요 직원" value={unavailable ? '—' : `${formatNumber(totals.pending)}명`} detail="미기록·기준 초과·예외 확인" /><OpsStat label="미기록" value={unavailable ? '—' : `${formatNumber(totals.missing)}건`} detail="오늘까지의 근무일 기준" /><OpsStat label="월 검토 완료" value={unavailable ? '—' : `${formatNumber(totals.complete)}명`} detail="해당 월 입력값 검토" /></div>
    <div className="attendance-results-bar"><div role="group" aria-label="근태 보기 방식"><button type="button" aria-pressed={view === 'summary'} onClick={() => { setView('summary'); setPage(1) }}><List size={14} />월별 요약</button><button type="button" aria-pressed={view === 'report'} onClick={() => { setView('report'); setPage(1); setSelectedId(null) }}><LayoutGrid size={14} />월간 보고서</button></div><span role="status">{unavailable ? '직원 정보를 확인하는 중' : `${visible.length}명 표시 · 직원 이름을 누르면 개인 달력이 열립니다.`}</span></div>
    {exportError && <p role="alert" className="text-sm text-danger">{exportError}</p>}
    <div className={`attendance-workspace${selected && view === 'summary' ? ' has-detail' : ''}`}>
      <div className="attendance-results">
        {unavailable ? <div className="attendance-empty"><p>{directory.loading || settingsLoading ? '직원과 출근시간을 불러오고 있습니다.' : '직원 또는 출근시간을 불러오지 못했습니다.'}</p>{directory.error && <Button variant="outline" size="sm" onClick={directory.refetch}>다시 불러오기</Button>}</div> : !visible.length ? <div className="attendance-empty"><p>{onlyPending ? '현재 조건에서 확인할 직원이 없습니다.' : '표시할 직원이 없습니다.'}</p><Button variant="ghost" size="sm" onClick={() => { setSearch(''); setDepartmentId('all'); setOnlyPending(false) }}>전체 직원 보기</Button></div> : view === 'summary' ? <div className="attendance-table-scroll"><table className="attendance-summary-table"><caption className="attendance-sr-only">{monthLabel(month)} 직원별 근태 요약</caption><thead><tr><th scope="col">직원·부서</th><th scope="col">출근 기준</th><th scope="col">출근 기록일</th><th scope="col">정시 이후</th><th scope="col">기준 초과</th><th scope="col">연차·반차</th><th scope="col">미기록</th><th scope="col">확인 필요</th><th scope="col">월 검토</th></tr></thead><tbody>{pageRows.map(row => <tr key={row.member.id} className={selectedId === row.member.id ? 'is-selected' : ''}><th scope="row"><button type="button" onClick={() => selectEmployee(row)}>{memberLabel(row.member.displayName)}</button><small>{row.team} · {[row.member.position, row.member.jobGrade].filter(Boolean).join(' / ') || '직책 미설정'}</small></th><td>{row.schedule.start || <span className="attendance-muted">미설정</span>}<small>{row.schedule.start ? `+${row.schedule.grace}분 기준` : savedSettings ? 'My home에서 지정' : '개인 달력에서 설정'}</small></td><td><strong>{row.summary.records}</strong><small>현재 근무일 {row.summary.dueDays}일</small></td><td className={row.summary.after ? 'attendance-after-text' : ''}>{row.schedule.start ? `${row.summary.after}회` : '—'}</td><td className={row.summary.exceeded ? 'attendance-exceeded-text' : ''}>{row.schedule.start ? `${row.summary.exceeded}회` : '—'}</td><td>연차 {row.summary.annual}일<small>반차 {row.summary.half}회</small></td><td>{row.summary.missingDates.length ? <button type="button" className="attendance-count-link" onClick={() => selectEmployee(row)}>{row.summary.missingDates.length}건</button> : '—'}</td><td><button type="button" className={row.summary.pending ? 'attendance-count-link' : 'attendance-muted'} onClick={() => selectEmployee(row)}>{row.summary.pending ? `${row.summary.pending}건` : '없음'}</button></td><td><span className={`attendance-review-badge${row.complete ? ' is-complete' : ''}`}>{row.complete ? '검토 완료' : row.summary.pending ? '확인 필요' : '검토 전'}</span></td></tr>)}</tbody></table></div> : <div className="attendance-print-target"><header className="attendance-report-heading"><h2>{monthLabel(month)} 출근 기록</h2><p>{departmentId === 'all' ? '전체 부서' : directory.departmentName(departmentId)} · 화면 시안 입력값 · {currentPage}/{pages} 페이지</p></header><div className="attendance-report-grid">{pageRows.map(row => <article key={row.member.id} className="attendance-report-card"><header><h3>{memberLabel(row.member.displayName)} <span>{row.schedule.start ? `${row.schedule.start} 출근` : '출근 기준 미설정'}</span></h3><small>{row.team}</small></header><AttendanceCalendar month={month} memberId={row.member.id} records={records} schedule={row.schedule} overrides={overrides} today={today} /><dl><div><dt>출근 기록일수</dt><dd>{row.summary.records}일</dd></div><div><dt>평균 출근 시각</dt><dd>{formatTime(row.summary.average)}</dd></div><div><dt>기준 초과 / 정시 이후</dt><dd>{row.schedule.start ? `${row.summary.exceeded}회 / ${row.summary.after}회` : '미설정'}</dd></div><div><dt>가장 이른 / 늦은 출근</dt><dd>{formatTime(row.summary.earliest)} / {formatTime(row.summary.latest)}</dd></div><div><dt>연차 / 반차</dt><dd>{row.summary.annual}일 / {row.summary.half}회</dd></div></dl></article>)}</div></div>}
        {!unavailable && visible.length > 0 && <nav className="attendance-pagination" aria-label="근태 페이지 이동"><span>{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)} / {visible.length}명</span><div><Button variant="outline" size="icon" aria-label="이전 직원 페이지" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></Button><span>{currentPage} / {pages}</span><Button variant="outline" size="icon" aria-label="다음 직원 페이지" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></Button></div></nav>}
      </div>
      {selected && view === 'summary' && <aside className="attendance-detail" aria-label={`${memberLabel(selected.member.displayName)} 월별 근태 상세`}>
        <header><div><span>{selected.team} · {monthLabel(month)}</span><h2>{memberLabel(selected.member.displayName)}</h2></div><button type="button" aria-label="개인 달력 닫기" onClick={() => setSelectedId(null)}><X size={18} /></button></header>
        <div className="attendance-detail-body">
          <div className="attendance-schedule">{savedSettings ? <div><p className="text-sm">저장된 출근 기준 · {selected.schedule.start || '미설정'} · 초과 +{selected.schedule.grace}분</p><Button variant="outline" size="sm" className="mt-2" onClick={() => onEditStart?.(selected.member.id,month)}>출근시간 확인</Button></div> : <><label>출근 기준<Select aria-label="직원 출근 기준" value={selected.schedule.start} disabled={!canEdit} onChange={event => updateSchedule({ start: event.target.value })}><option value="">미설정</option><option value="09:00">09:00</option><option value="10:00">10:00</option>{selected.schedule.start && !['09:00', '10:00'].includes(selected.schedule.start) && <option value={selected.schedule.start}>{selected.schedule.start}</option>}</Select></label><label>초과 기준<Input type="number" aria-label="출근 초과 기준 분" min={0} max={60} value={selected.schedule.grace} disabled={!canEdit} onChange={event => updateSchedule({ grace: Math.max(0, Math.min(60, Number(event.target.value) || 0)) })} /></label></>}</div>
          <p className="attendance-detail-hint">토요일은 파란색, 일요일과 공휴일은 빨간색, 미기록 근무일은 주황색입니다. 정시 이후는 분홍색, 출근 기준 +{selected.schedule.grace}분 초과는 더 진한 빨간색입니다. 미래 날짜는 월 집계에서 제외합니다.</p>
          <AttendanceCalendar month={month} memberId={selected.member.id} records={records} schedule={selected.schedule} overrides={overrides} today={today} />
          <dl className="attendance-person-stats"><div><dt>평균 출근</dt><dd>{formatTime(selected.summary.average)}</dd></div><div><dt>가장 이른 출근</dt><dd>{formatTime(selected.summary.earliest)}</dd></div><div><dt>가장 늦은 출근</dt><dd>{formatTime(selected.summary.latest)}</dd></div><div><dt>예비군·공가 / 결근</dt><dd>{selected.summary.official}일 / {selected.summary.absent}일</dd></div></dl>
          <div className="attendance-review-footer"><p>{selected.summary.scheduleMissing ? '출근 기준을 설정해 주세요.' : selected.summary.pending > 0 ? `확인할 항목이 ${selected.summary.pending}건 남아 있습니다.` : selected.summary.dueDays === 0 ? '아직 검토할 근무일이 없습니다.' : '입력한 월별 기록을 검토 완료로 표시할 수 있습니다.'}</p><Button size="sm" disabled={!canEdit || selected.summary.pending > 0 || selected.summary.dueDays === 0} variant={selected.complete ? 'outline' : 'default'} onClick={() => setReviews(current => ({ ...current, [`${month}:${selected.member.id}`]: !selected.complete }))}><Check size={14} />{selected.complete ? '검토 완료 해제' : '월 검토 완료'}</Button></div>
          {!canEdit && <p className="attendance-detail-hint">조회 화면입니다. 운영지원팀 화면에서는 입력·검토할 수 있습니다.</p>}
        </div>
      </aside>}
    </div>
    <p className="attendance-bottom-note">공휴일·대체공휴일·선거일·임시공휴일은 국가 달력 기준으로 휴무입니다. 출근 기록일은 실제 근무일·급여 계산값과 다르며, 근무시간·연장근무 집계에는 퇴근 기록과 별도 기준이 필요합니다.</p>
  </OpsPanelFrame>
}
