import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input, Textarea } from '@/components/ui/input'
import { StatusPill } from '@/components/ui/status-pill'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useMyHomeNotifications, useReadMyHomeNotification } from '@/features/settings/use-my-home-notifications'
import { MyHomeNotificationList } from '@/features/settings/MyHomeNotificationList'
import { HolidaySettlementEditor, HolidayWorkInput, type HolidaySave } from './HolidayWorkEditor'
import { holidayCredit, holidayPhase, holidayTime, HOLIDAY_LOCATIONS, type HolidayWork } from './holiday-work'
import { useHolidayWork } from './use-holiday-work'
import { HolidayOffsiteCases } from './HolidayOffsiteCases'
import { localDateKey } from './monthly-attendance'

export function HolidayWorkPanel({ scope, month: monthProp }: { scope: 'mine' | 'review' | 'operations'; month?: string }) {
  useRenderWatch('HolidayWorkPanel')
  const active = useWorkspaceTabActivity(), [params, setParams] = useSearchParams()
  const { profile } = useAuth()
  const [localMonth, setMonth] = useState(localDateKey(new Date()).slice(0, 7))
  const routedMonth = params.get('holidayMonth')
  const month = routedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(routedMonth) ? routedMonth : monthProp ?? localMonth
  const caseId = scope==='operations' ? params.get('offsiteCase') ?? undefined : undefined
  const work = useHolidayWork(month, scope, caseId), [search, setSearch] = useState(''), [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<HolidayWork | 'plan' | null>(null)
  const [basket, setBasket] = useState<HolidayWork[]>([]), [settling, setSettling] = useState(false), [limit, setLimit] = useState(50)
  const detailAnchor = useRef<HTMLDivElement>(null), editorAnchor = useRef<HTMLDivElement>(null)
  const row = work.rows.find(r => (r.id ?? `${r.employeeId}:${r.date}`) === selected)
  const notices = useMyHomeNotifications()
  const detailEvents = notices.work.filter(event => event.entity_id === row?.id && event.event_type.startsWith('holiday-'))
  // Only the event selected by the detail route (or the newest rendered event) is acknowledged.
  const requestedKey = params.get('holidayEvent')
  const detailEvent = requestedKey ? detailEvents.find(event => event.event_key === requestedKey) : [...detailEvents].sort((a,b) => b.created_at.localeCompare(a.created_at))[0]
  const read = useReadMyHomeNotification('request', row?.id ?? undefined, detailEvent?.event_key, active && Boolean(row))
  useEffect(() => { setSelected(null); setEditing(null); setBasket([]); setSettling(false) }, [profile?.id,profile?.companyId,caseId])
  useEffect(() => { const id = params.get('holidayWork'); if (active && id && work.rows.some(r => r.id === id)) setSelected(id) }, [active, params, work.rows])
  const detailDisplayed = Boolean(row)
  useEffect(() => { if (active && selected && detailDisplayed) detailAnchor.current?.scrollIntoView({ block: 'nearest' }) }, [active,selected,detailDisplayed])
  useEffect(() => { if (active && editing) editorAnchor.current?.scrollIntoView({ block: 'nearest' }) }, [active,editing])
  const visible = useMemo(() => work.rows.filter(r => `${r.employeeName} ${r.departmentName ?? ''}`.toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko'))
    && (filter === 'all' || filter === 'review' && r.state === 'submitted' || filter === 'settle' && r.state === 'approved' && r.remainingUnits > 0 || filter === 'paid' && r.settlements.length > 0 || filter === 'planned' && ['planned', 'unreported', 'returned'].includes(r.state))), [work.rows, filter, search])
  function close() {
    setSelected(null)
    if (active && params.has('holidayWork')) setParams(previous => { const next = new URLSearchParams(previous); next.delete('holidayWork'); next.delete('holidayMonth'); next.delete('holidayEvent'); return next }, { replace: true })
  }
  const save: HolidaySave = async (action, payload) => { await work.save.mutateAsync({ action, payload }) }
  function selectCompensation(item: HolidayWork) {
    setBasket(current => current.some(r => r.id === item.id) ? current.filter(r => r.id !== item.id) : [...current.filter(r => r.employeeId === item.employeeId), item])
  }
  return <section className="space-y-4" aria-label={scope === 'operations' ? '주말·공휴일 근무 관리' : scope === 'review' ? '주말·공휴일 실제 시간 확인' : '내 주말·공휴일 근무'}>
    <header><h2 className="text-base font-semibold">{scope === 'operations' ? '주말·공휴일 근무 관리' : scope === 'review' ? '주말·공휴일 실제 시간 확인' : '주말·공휴일 근무'}</h2><p className="text-sm text-muted-foreground">{scope === 'mine' ? '외근·출퇴근 기록을 참고해 실제 일한 구간만 제출하세요. 부서 승인자가 시간을 확인하고 운영지원이 수당·보상휴가를 확정합니다.' : '사무실·외근을 직원·날짜별로 한 번만 확인합니다. 실제 시간과 가산 보상 시간을 구분하며 평일 야근 누적에 중복 반영하지 않습니다.'}</p></header>
    {scope === 'operations' && <MyHomeNotificationList tab="holiday-work" />}
    <FilterBar>{!monthProp && !caseId && <label className="text-sm">근무 월<Input aria-label="휴일 근무 월" type="month" value={month} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) { setMonth(e.target.value); setLimit(50); if (params.has('holidayMonth')) close() } }} /></label>}<Input aria-label="휴일 근무 직원 검색" placeholder="직원·부서 검색" value={search} onChange={e => setSearch(e.target.value)} />
      {scope === 'mine' && <Button type="button" disabled={!work.data?.ready} onClick={() => setEditing('plan')}>주말·공휴일 근무 예정 등록</Button>}</FilterBar>
    {!work.enabled && <p className="text-sm text-muted-foreground">본인 계정의 활성 화면에서 조회합니다.</p>}
    {work.isSuccess && !work.data.ready && <p role="status" className="rounded-xl border border-border bg-muted p-3 text-sm">주말·공휴일 근무의 추가 DB 설정 적용 대기입니다. 기존 근무·연차·권한은 그대로 유지됩니다.</p>}
    {work.error && <p role="alert" className="text-sm text-danger">{work.error.message}<Button type="button" size="sm" variant="outline" onClick={() => void work.refetch()}>다시 조회</Button></p>}
    {work.data?.ready && <>
      {scope==='operations' && <HolidayOffsiteCases month={month} search={search} policyReady={Boolean(work.data.policy)}
        enabled={work.enabled} rows={caseId ? work.rows : []} loading={work.isPending} error={work.error} refresh={work.refetch} />}
      {caseId && <p className="text-sm font-medium">선택 외근 전체 기간의 주말·공휴일 기록 · 다른 달의 날짜도 함께 표시합니다.</p>}
      <FilterTabs ariaLabel="휴일 근무 진행 구분" value={filter} onChange={setFilter} tabs={[{ value: 'all', label: '전체', count: work.rows.length }, { value: 'planned', label: '예정·입력 필요', count: work.rows.filter(r => ['planned', 'unreported', 'returned'].includes(r.state)).length }, { value: 'review', label: '부서 확인 대기', count: work.rows.filter(r => r.state === 'submitted').length }, { value: 'settle', label: '정산 대기', count: work.rows.filter(r => r.state === 'approved' && r.remainingUnits > 0).length }, { value: 'paid', label: '정산 내역', count: work.rows.filter(r => r.settlements.length).length }]} />
      <StatGrid><StatTile label="주말·공휴일 실제 시간" value={holidayCredit(work.rows.reduce((sum, r) => sum + (r.actualMinutes ?? 0) * 2, 0))} /><StatTile label="미정산 보상 시간" value={holidayCredit(work.rows.reduce((sum, r) => sum + r.remainingUnits, 0))} /><StatTile label="부서 확인 대기" value={`${work.rows.filter(r => r.state === 'submitted').length}건`} /></StatGrid>
      {editing && <div ref={editorAnchor}><HolidayWorkInput key={editing === 'plan' ? `plan:${month}` : `${editing.employeeId}:${editing.date}:${editing.version}`} row={editing === 'plan' ? undefined : editing} planned={editing === 'plan'} month={month} save={save} close={() => setEditing(null)} /></div>}
      {row && <div ref={detailAnchor}><HolidayWorkDetail key={`${row.employeeId}:${row.date}`} row={row} event={detailEvent?.note} scope={scope} save={save} close={close} edit={() => setEditing(row)} /></div>}
      {read.error && <p role="alert" className="text-sm text-danger">{read.error}<Button type="button" variant="outline" size="sm" onClick={read.retry}>읽음 저장 재시도</Button></p>}
      {scope === 'operations' && <>
        <p className="text-xs text-muted-foreground">토요일은 회사 기준 1.5배, 일요일·공휴일은 8시간 이내 1.5배·초과분 2배, 22시~06시 근무는 0.5배를 추가해 표시합니다. 지급 전 계약·근무일 구분과 통상시급을 확인하세요.</p>
        <HolidayPolicy policy={work.data.policy} save={save} />
        {basket.length > 0 && <Card className="flex flex-wrap items-center gap-3 p-3"><p className="text-sm">{basket[0].employeeName} · 선택 {basket.length}일 · {holidayCredit(basket.reduce((s, r) => s + r.remainingUnits, 0))}<span className="block text-xs text-muted-foreground">월을 바꿔 같은 직원의 시간을 모을 수 있습니다. 시간은 자동 소멸하지 않습니다.</span></p><Button type="button" onClick={() => setSettling(true)}>선택한 시간 정산</Button><Button type="button" variant="outline" onClick={() => { setBasket([]); setSettling(false) }}>선택 해제</Button></Card>}
        {settling && basket.length > 0 && <HolidaySettlementEditor rows={basket} policyReady={Boolean(work.data.policy)} save={save} close={() => { setSettling(false); setBasket([]) }} />}
      </>}
      <Card className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><caption className="sr-only">주말·공휴일 근무 목록</caption><thead className="bg-primary text-primary-foreground"><tr>{['직원·부서', '근무일·장소', '실제 근무', '가산 보상', '미정산', '상태', '확인'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
        {visible.slice(0, limit).map(item => <tr key={`${item.employeeId}:${item.date}`} className="border-t border-border"><td className="p-3">{item.employeeName}<span className="block text-xs text-muted-foreground">{item.departmentName || '부서 미지정'}</span></td><td className="p-3">{item.date}<span className="block text-xs text-muted-foreground">{HOLIDAY_LOCATIONS[item.location]}</span></td><td className="p-3">{item.actualMinutes === null ? '미확인' : holidayCredit(item.actualMinutes * 2)}</td><td className="p-3">{item.creditUnits === null ? '—' : holidayCredit(item.creditUnits)}</td><td className="p-3">{holidayCredit(item.remainingUnits)}</td><td className="p-3"><StatusPill tone={item.state === 'submitted' || item.remainingUnits > 0 ? 'warning' : 'muted'}>{holidayPhase(item)}</StatusPill></td><td className="p-3"><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSelected(item.id ?? `${item.employeeId}:${item.date}`)}>상세</Button>{item.canSubmit && !item.legacySettled && <Button type="button" size="sm" variant="outline" onClick={() => setEditing(item)}>실제 시간 입력</Button>}{scope === 'operations' && item.canSettle && item.remainingUnits > 0 && !item.legacySettled && <label className="flex items-center gap-1"><input type="checkbox" aria-label={`${item.employeeName} ${item.date} 정산 선택`} checked={basket.some(r => r.id === item.id)} onChange={() => selectCompensation(item)} />정산 선택</label>}</div></td></tr>)}
        {!visible.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">{work.isPending ? '불러오는 중…' : '해당하는 근무가 없습니다.'}</td></tr>}
      </tbody></table></Card>{visible.length > limit && <Button type="button" variant="outline" onClick={() => setLimit(n => n + 50)}>더 보기</Button>}
    </>}
  </section>
}

function HolidayWorkDetail({ row, event, scope, save, close, edit }: { row: HolidayWork; event?: string; scope: string; save: HolidaySave; close: () => void; edit: () => void }) {
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [paidOn, setPaidOn] = useState(localDateKey(new Date())), [paidConfirmed, setPaidConfirmed] = useState(false)
  async function change(action: 'review' | 'paid' | 'cancel', payload: object) {
    setBusy(true); setError(null)
    try { await save(action, payload) } catch (cause) { setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.') } finally { setBusy(false) }
  }
  return <Card className="space-y-3 p-4" aria-label="주말·공휴일 근무 상세"><header className="flex justify-between gap-2"><h3 className="font-semibold">{row.employeeName} · {row.date} · {holidayPhase(row)}</h3><Button type="button" size="sm" variant="outline" disabled={busy} onClick={close}>상세 닫기</Button></header>
    {event && <p className="rounded-lg bg-muted p-3 text-sm">{event}</p>}<p className="whitespace-pre-wrap text-sm">{row.reason || '근무 내역을 입력해 주세요.'}</p>
    {row.plannedIntervals?.length > 0 && <p className="text-sm">예정 구간: {row.plannedIntervals.map(i => `${holidayTime(i.start)}~${holidayTime(i.end)}`).join(', ')}</p>}
    <p className="text-sm">실제 구간: {row.intervals.map(i => `${holidayTime(i.start)}~${holidayTime(i.end)}`).join(', ') || '미제출'}</p>
    <p className="text-sm">실제 {row.actualMinutes === null ? '미확인' : holidayCredit(row.actualMinutes * 2)} · 야간 {holidayCredit((row.nightMinutes ?? 0) * 2)} · 가산 보상 {row.creditUnits === null ? '부서 확인 후 확정' : holidayCredit(row.creditUnits)}</p>
    <p className="text-xs text-muted-foreground">외근 원본 {row.source.offsites.length}건 · 승인된 근무 신청 {row.source.overtimes?.length ?? 0}건 · 출퇴근 참고 {row.source.clocks.map(c => `${c.date} 출근 ${c.in} / 퇴근 ${c.out ? new Date(c.out).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미등록'}`).join(', ') || '없음'}</p>
    {row.reviewNote && <p className="text-sm">부서 확인 의견: {row.reviewNote}</p>}
    <fieldset disabled={busy} className="space-y-3">
      {row.canReview && scope === 'review' && <><label className="block text-sm">확인 의견 · 보완 요청 시 필수<Textarea aria-label="휴일 실제 시간 확인 의견" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label><div className="flex gap-2"><Button type="button" onClick={() => void change('review', { id: row.id, version: row.version, decision: 'approve', note })}>실제 시간 확인</Button><Button type="button" variant="outline" disabled={!note.trim()} onClick={() => void change('review', { id: row.id, version: row.version, decision: 'return', note })}>보완 요청</Button></div></>}
      {row.canSubmit && !row.legacySettled && <Button type="button" variant="outline" onClick={edit}>실제 시간 입력</Button>}
      {row.canSubmit && ['planned', 'returned'].includes(row.state) && <Button type="button" variant="outline" onClick={() => void change('cancel', { date: row.date, version: row.version })}>예정 등록 취소</Button>}
      {row.settlements.map(item => <article key={item.id} className="space-y-2 rounded-lg border border-border p-3 text-sm"><p>{item.mode === 'leave' ? `보상휴가 ${item.days}일 · ${item.expires}까지` : `${item.amountWon?.toLocaleString('ko-KR') ?? '비공개'}원 · ${item.paidOn ? `${item.paidOn} 지급 완료` : `${item.paymentMonth?.slice(0, 7)} 지급 예정`}`}</p><p className="text-xs text-muted-foreground">묶음 정산 총액·휴가 기준입니다. 이 날짜에서 사용한 보상 시간: {holidayCredit(item.units)}</p><p className="whitespace-pre-wrap">{item.note}</p>{scope === 'operations' && item.mode === 'cash' && !item.paidOn && <><Input aria-label="휴일 수당 실제 지급일" type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} /><label className="flex items-center gap-2"><input type="checkbox" checked={paidConfirmed} onChange={e => setPaidConfirmed(e.target.checked)} />실제 지급을 확인했습니다.</label><Button type="button" disabled={!paidConfirmed || !paidOn} onClick={() => void change('paid', { id: item.id, version: item.version, date: paidOn, confirmed: paidConfirmed })}>수당 지급 완료 기록</Button></>}</article>)}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </fieldset>
  </Card>
}

function HolidayPolicy({ policy, save }: { policy: { ref: string; date: string } | null; save: HolidaySave }) {
  const [open, setOpen] = useState(false), [ref, setRef] = useState(''), [date, setDate] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  return <Card className="space-y-2 p-3"><p className="text-sm">{policy ? `보상휴가 서면합의 기준: ${policy.ref} · ${policy.date}` : '보상휴가 서면합의 기준 미등록 · 시간 기록과 수당 정산은 가능하며 휴가 지급은 잠겨 있습니다.'}</p><Button type="button" variant="outline" size="sm" onClick={() => setOpen(!open)}>합의 기준 등록</Button>{open && <fieldset disabled={busy} className="space-y-2"><p className="text-xs text-muted-foreground">이 입력은 합의를 대신하지 않습니다. 근로자대표와 실제 체결한 서면합의가 있을 때만 등록하세요.</p><Input aria-label="보상휴가 서면합의 기준명" placeholder="체결한 문서명·관리번호" maxLength={300} value={ref} onChange={e => setRef(e.target.value)} /><Input aria-label="보상휴가 서면합의 체결일" type="date" value={date} onChange={e => setDate(e.target.value)} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />해당 서면합의가 체결되어 있고 적용 범위를 확인했습니다.</label>{error && <p role="alert" className="text-sm text-danger">{error}</p>}<Button type="button" disabled={!confirmed || !ref.trim() || !date} onClick={async () => { setBusy(true); setError(null); try { await save('policy', { ref, date, confirmed }); setOpen(false) } catch (cause) { setError(cause instanceof Error ? cause.message : '등록 실패') } finally { setBusy(false) } }}>합의 기준 저장</Button></fieldset>}</Card>
}
