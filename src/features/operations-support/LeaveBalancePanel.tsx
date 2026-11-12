import { useMemo, useRef, useState } from 'react'
import { useIsFetching, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { InfoNote } from '@/components/ui/info-note'
import { Input } from '@/components/ui/input'
import { canEditOrgAssignment } from '@/lib/company/capabilities'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import { saveEmployeeRosterField } from '@/lib/supabase/employee-roster'
import { MemberCell, memberLabel, OpsPanelFrame } from './OpsStat'
import { ScopeCards, departmentScopeCards, inDepartmentScope } from '@/components/ui/scope-cards'
import { useOpsDirectory } from './ops-directory'
import { HireDateScrollField } from '@/features/org/HireDateScrollField'
import { koreaDateKey } from '@/features/settings/my-attendance'
import { saveExtraLeave, type ExtraLeave, type SaveExtraLeave, type LeaveEvent } from '@/lib/supabase/employee-extra-leave'
import { LeaveAdvancePanel } from './LeaveAdvancePanel'
import { useEmployeeRoster } from './use-employee-roster'

export function LeaveBalancePanel() {
  useRenderWatch('LeaveBalancePanel')
  const { profile } = useAuth()
  const { access, isPending: accessPending } = useBasicWorkAccess()
  const canManage = canEditOrgAssignment(profile) || access?.domains.includes('operations') === true
  const client = useQueryClient()
  const advanceFetching = useIsFetching({ queryKey: ['employee-leave-advances', profile?.id, true] })
  const directory = useOpsDirectory('head-office')
  const [departmentId, setDepartmentId] = useState('all')
  const [search, setSearch] = useState('')
  const [advanceSelection, setAdvanceSelection] = useState<{ employeeId: string; viewerId: string | undefined } | null>(null)
  const advanceMember = advanceSelection && advanceSelection.viewerId === profile?.id
    ? directory.members.find(member => member.id === advanceSelection.employeeId)
    : undefined
  const snapshot = useEmployeeRoster(canManage)
  const roster = { ...snapshot, data: snapshot.data?.rosters }
  const extras = { ...snapshot, data: snapshot.data?.extraLeave }
  // 부서 카드 건수를 위해 부서 조건 없이 먼저 모으고, 아래에서 부서 범위로 거른다.
  const searchedRows = useMemo(() => {
    const balances = new Map(roster.data?.map(row => [row.profileId, row]))
    return directory.members.filter(member => memberLabel(member.displayName).includes(search.trim()))
      .sort((a, b) => memberLabel(a.displayName).localeCompare(memberLabel(b.displayName), 'ko'))
      .map(member => ({ member, balance: balances.get(member.id) }))
  }, [directory.members, roster.data, search])
  const rows = useMemo(() => searchedRows.filter(({ member }) => inDepartmentScope(departmentId, member.departmentId)), [searchedRows, departmentId])
  const deptCards = useMemo(() => departmentScopeCards({
    items: searchedRows, departments: directory.departments, departmentOf: ({ member }) => member.departmentId,
    unavailable: directory.loading || roster.isPending || Boolean(directory.error || roster.error),
    detail: { label: '미등록', count: scoped => scoped.filter(({ balance }) => balance?.remainingAnnualLeave == null).length },
  }), [searchedRows, directory.departments, directory.loading, directory.error, roster.isPending, roster.error])
  const totals = useMemo(() => rows.reduce((sum, { balance }) => ({
    granted: sum.granted + (balance?.accruedAnnualLeave ?? 0),
    remaining: sum.remaining + (balance?.remainingAnnualLeave ?? 0),
    registered: sum.registered + (balance?.remainingAnnualLeave != null ? 1 : 0),
    missingGrant: sum.missingGrant || (balance !== undefined && balance.accruedAnnualLeave === undefined),
  }), { granted: 0, remaining: 0, registered: 0, missingGrant: false }), [rows])
  if (!canManage) return <OpsPanelFrame><p className="text-sm text-muted-foreground">{accessPending ? '연차 관리 권한을 확인하고 있습니다.' : '연차 현황은 직원 명부 관리 권한이 있는 담당자만 조회·수정할 수 있습니다.'}</p></OpsPanelFrame>
  const failed = Boolean(directory.error || roster.error)
  const loading = directory.loading || roster.isPending
  const ready = !failed && !loading
  return <OpsPanelFrame>
    <InfoNote label="연차 계산 기준">
    <p>조직도 직원 배치와 같은 현재 연차 값입니다. 입사일 기준 연차 기간에 따라 발생일수가 자동 갱신됩니다. 남은 연차를 수정해 저장하면 조직도에도 반영됩니다.</p>
    <p>{extras.data?.fefoReady ? '기본·추가 연차 중 기한이 빠른 순서로 사용합니다. 부여 취소로 부족해진 일수도 총 잔여에 반영되며, 만료와 재계산 기록은 이력에 남습니다.' : '기본·추가 연차 통합 기한순 차감·만료 이력·부여 취소 재계산은 서버 적용 승인 대기 중입니다. 현재는 기존 추가 연차 우선 차감 방식이 유지됩니다.'}</p>
    </InfoNote>
    {!extras.isError && extras.data?.ready === false ? <p className="text-sm text-warning">추가 연차 서버 연결 대기 중입니다. 기존 연차 값은 유지됩니다.</p> : null}
    <ScopeCards ariaLabel="연차 부서" value={departmentId} onChange={setDepartmentId} cards={deptCards} />
    <FilterBar>
      <Input aria-label="연차 직원 검색" placeholder="직원 이름 검색" value={search} onChange={event => setSearch(event.target.value)} className="sm:w-52"/>
      <Button variant="outline" disabled={roster.isFetching || advanceFetching > 0} onClick={() => { directory.refetch(); void snapshot.refetch(); void client.invalidateQueries({ queryKey: ['employee-leave-advances', profile?.id, true] }) }}>새로고침</Button>
    </FilterBar>
    <p role="status" className="text-sm text-muted-foreground">{ready ? <>대상 직원 <strong className="text-foreground">{rows.length}명</strong> · 잔여 등록 {totals.registered}명 · 발생일수 합계 {totals.missingGrant ? '—' : `${totals.granted}일`} · 남은 연차 합계 <strong className="text-foreground">{totals.remaining}일</strong> <span className="text-xs">(등록된 값만 합산)</span></> : '직원과 연차를 확인하고 있습니다.'}</p>
    <Card className="overflow-hidden"><div className="overflow-x-auto">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="bg-primary text-primary-foreground"><tr>
          {['이름', '부서', '입사일', '발생일수', '추가 연차', '남은 연차', '선사용'].map((label, index) => <th key={label} className={`whitespace-nowrap px-4 py-2.5 font-medium ${index === 0 ? 'sticky left-0 z-10 bg-primary' : ''}`}>{label}</th>)}
        </tr></thead>
        <tbody>
          {failed ? <tr><td colSpan={7} className="px-4 py-8 text-center text-danger" role="alert">연차 현황을 불러오지 못했습니다. 새로고침으로 다시 조회해 주세요.</td></tr>
            : loading ? <tr><td colSpan={7} className="px-4 py-8 text-center">불러오는 중…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center">표시할 직원이 없습니다.</td></tr>
            : rows.map(({ member, balance }) => <tr key={`${profile?.id}:${member.id}`} className="border-b border-border/70 last:border-0">
              <td className="sticky left-0 bg-card px-4 py-3"><MemberCell name={memberLabel(member.displayName)} /></td>
              <td className="px-4 py-3">{directory.departmentName(member.departmentId)}</td>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums">{member.hireDate || <MissingValue/>}</td>
              <td className="px-4 py-3 tabular-nums" aria-label={`${memberLabel(member.displayName)} 발생일수`}>{balance && balance.accruedAnnualLeave === undefined ? '조회 실패' : balance?.accruedAnnualLeave == null ? <MissingValue/> : `${balance.accruedAnnualLeave}일`}</td>
              <td className="px-4 py-3" aria-label={`${memberLabel(member.displayName)} 추가 연차`}>
                <AdditionalLeaveInputs name={memberLabel(member.displayName)} employeeId={member.id} entries={extras.data?.entries.filter(entry => entry.employeeId === member.id) ?? []} events={extras.data?.events?.filter(event => event.employeeId === member.id) ?? []} fefoReady={extras.data?.fefoReady === true} baseRegistered={balance?.remainingAnnualLeave != null} available={extras.data?.ready ? extras.data.balances.find(row => row.profileId === member.id)?.available ?? 0 : undefined} ready={extras.data?.ready === true && !extras.isError}/>
              </td>
              <td className="px-4 py-2"><RemainingLeaveEditor profileId={member.id} name={memberLabel(member.displayName)} value={balance?.remainingAnnualLeave ?? null}/><RemainingBar remaining={balance?.remainingAnnualLeave ?? null} accrued={balance?.accruedAnnualLeave ?? null}/></td>
              <td className="px-4 py-2">
                <Button type="button" variant="outline" size="sm" aria-label={`${memberLabel(member.displayName)} 선사용`} aria-haspopup="dialog" aria-expanded={advanceMember?.id === member.id}
                  onClick={() => setAdvanceSelection({ employeeId: member.id, viewerId: profile?.id })}>선사용</Button>
              </td>
            </tr>)}
        </tbody>
      </table>
    </div></Card>
    <LeaveAdvancePanel selection={advanceMember ? { id: advanceMember.id, name: memberLabel(advanceMember.displayName), department: directory.departmentName(advanceMember.departmentId) } : null}
      onClose={() => setAdvanceSelection(null)}/>
  </OpsPanelFrame>
}

function AdditionalLeaveInputs({ name, employeeId, entries, events, available, ready, baseRegistered, fefoReady }: { name: string; employeeId: string; entries: ExtraLeave[]; events: LeaveEvent[]; available?: number; ready: boolean; baseRegistered: boolean; fefoReady: boolean }) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState<ExtraLeave | null>(null)
  const [newId, setNewId] = useState(() => crypto.randomUUID())
  const [days, setDays] = useState('')
  const [expires, setExpires] = useState(koreaDateKey)
  const [note, setNote] = useState('')
  const client = useQueryClient()
  const [message, setMessage] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  function clearInput() { setEditing(null); setNewId(crypto.randomUUID()); setDays(''); setExpires(koreaDateKey()); setNote('') }
  const mutation = useMutation({ mutationFn: saveExtraLeave,
    onSuccess: async (_data, input) => {
      await Promise.all(['employee-extra-leave', 'employee-roster', 'employee-leave-advances', 'my-attendance-basis', 'my-extra-leave', 'leave-notice-management'].map(key => client.invalidateQueries({ queryKey: [key] })))
      clearInput(); setDeleting(null); setCancelReason(''); setMessage(input.remove ? '부여 취소 및 사용 내역 재계산이 완료되었습니다.' : '저장되었습니다.')
    },
    onError: () => { void client.invalidateQueries({ queryKey: ['employee-roster'] }) },
  })
  const dateLabel = (date: string) => date.slice(2).replaceAll('-', '.')
  return <div className="space-y-2">
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="tabular-nums">{!baseRegistered ? '기본 연차 미등록' : available === undefined ? '조회 대기' : `${available}일`}</span>
      <Button type="button" variant="outline" size="sm" className="size-8 p-0" aria-label={`${name} 추가 연차 추가`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { dialog.current?.showModal(); setOpen(true) }}>+</Button>
    </div>
    <dialog ref={dialog} onClose={() => setOpen(false)} aria-label={`${name} 추가 연차 입력`} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md space-y-4 overflow-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-lg backdrop:bg-black/40">
      <h3 className="font-semibold">{name} · 추가 연차</h3>
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault()
        const amount = Number(days)
        if (!ready || mutation.isPending || !Number.isFinite(amount) || amount <= 0 || !expires || !note.trim()) return
        setMessage('')
        mutation.mutate({ id: editing?.id ?? newId, employeeId, days: amount, expires, note: note.trim(), version: editing?.version ?? 0 })
      }}>
      <fieldset disabled={!ready || !baseRegistered || mutation.isPending} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm"><span>추가 일수</span><Input aria-label={`${name} 추가 일수`} type="number" min="0.01" max="99999.99" step="0.01" required value={days} onChange={event => setDays(event.target.value)} placeholder="예: 1.5"/></label>
        <div className="space-y-1 text-sm"><span>사용 기한</span><HireDateScrollField label={`${name} 추가 연차 사용 기한`} value={expires} min="1950-01-01" max={`${Number(koreaDateKey().slice(0, 4)) + 5}-12-31`} clearable={false} className="w-full" onChange={setExpires}/></div>
        <label className="col-span-2 space-y-1 text-sm"><span>메모</span><Input aria-label={`${name} 추가 연차 메모`} placeholder="추가 사유" maxLength={500} required value={note} onChange={event => setNote(event.target.value)}/></label>
      </div>
      <div className="flex justify-end gap-2">
        {editing ? <Button type="button" variant="ghost" size="sm" onClick={clearInput}>수정 취소</Button> : null}
        <Button type="submit" size="sm">{mutation.isPending ? '저장 중…' : editing ? '수정 반영' : '이력에 추가'}</Button>
      </div>
      </fieldset>
      </form>
      {mutation.error ? <p role="alert" className="text-sm text-danger">{mutation.error instanceof Error ? mutation.error.message : '저장하지 못했습니다.'}</p> : null}
      {message ? <p role="status" className="text-sm text-success">{message}</p> : null}
      <section className="space-y-2 border-t border-border pt-3" aria-label={`${name} 추가 연차 이력`}>
        <h4 className="text-sm font-medium">추가 이력</h4>
        {entries.length === 0 ? <p className="text-sm text-muted-foreground">추가 이력이 없습니다.</p> : <ul className="space-y-2">
          {entries.map(entry => <li key={entry.id} className="space-y-2 rounded-xl border border-border p-3 text-sm">
            <p className="break-words"><strong>+{entry.days}일</strong> ({dateLabel(entry.expires)}까지) [{entry.note}]</p>
            <p className="text-xs text-muted-foreground">사용·예약 {entry.used}일{entry.expires < koreaDateKey() ? ' · 기한 만료' : ''}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">등록 날짜: {dateLabel(entry.created)}</span>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" disabled={!ready || mutation.isPending} onClick={() => { setEditing(entry); setDays(String(entry.days)); setExpires(entry.expires); setNote(entry.note); setMessage(''); mutation.reset() }}>수정</Button>
                <Button type="button" size="sm" variant="ghost" disabled={!ready || !fefoReady || mutation.isPending} title={!fefoReady ? '재계산 서버 적용 승인 대기 중입니다.' : undefined} onClick={() => { setDeleting(entry.id); setCancelReason('') }}>부여 취소</Button>
              </div>
            </div>
            {deleting === entry.id ? <div className="space-y-2"><p>부여를 취소하면 기존 휴가는 유지하고 사용 내역을 다시 배분합니다. 잔여가 부족하면 음수로 표시됩니다.</p><Input aria-label={`${name} 부여 취소 사유`} placeholder="부여 취소 사유" maxLength={500} value={cancelReason} onChange={event => setCancelReason(event.target.value)}/><div className="flex gap-2"><Button type="button" size="sm" disabled={mutation.isPending || !cancelReason.trim()} onClick={() => mutation.mutate({ ...entry, employeeId, note: cancelReason.trim(), remove: true } satisfies SaveExtraLeave)}>취소 확정</Button><Button type="button" size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => setDeleting(null)}>닫기</Button></div></div> : null}
          </li>)}
        </ul>}
      </section>
      <section className="space-y-2 border-t border-border pt-3" aria-label={`${name} 연차 변동 이력`}>
        <h4 className="text-sm font-medium">연차 변동 이력</h4>
        {events.length === 0 ? <p className="text-xs text-muted-foreground">기록된 변동이 없습니다.</p> : <ul className="space-y-2">{events.map(event => <li key={event.id} className="rounded-xl border border-border p-3 text-sm">
          <p><strong>{event.days > 0 ? '+' : ''}{event.days}일</strong> · {event.source === 'base' ? '기본 연차' : '추가 연차'} {({ granted: '부여', edited: '수정', revoked: '부여 취소', expired: '만료', expiry_adjustment: '만료 정정' } as Record<string,string>)[event.kind] ?? event.kind}</p>
          <p className="text-xs text-muted-foreground">{dateLabel(event.date)}{event.actorName ? ` · ${event.actorName}` : ''}{event.recalculated ? ' · 사용 내역 재계산' : ''}</p>
          {event.reason || event.note ? <p className="mt-1 break-words">{event.reason || event.note}</p> : null}
        </li>)}</ul>}
      </section>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{!baseRegistered ? '기본 잔여 연차를 먼저 등록해 주세요.' : !fefoReady ? '만료 이력·부여 취소 재계산은 서버 적용 승인 대기 중입니다.' : ready ? '사용 기한 당일까지 반영됩니다. 만료·부여 취소 기록은 보존됩니다.' : '서버 연결 전에는 추가·수정·삭제할 수 없습니다.'}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => dialog.current?.close()}>닫기</Button>
      </div>
    </dialog>
  </div>
}

/** 발생일수 대비 남은 연차 막대(시안). 값이 없으면 그리지 않는다. 3일 이하이면 레드로 보인다. */
function RemainingBar({ remaining, accrued }: { remaining: number | null; accrued: number | null }) {
  if (remaining == null || !accrued || accrued <= 0) return null
  const ratio = Math.max(0, Math.min(1, remaining / accrued))
  return <span className="mt-1.5 block h-1 w-28 overflow-hidden rounded-full bg-muted" role="img" aria-label={`발생 ${accrued}일 중 ${remaining}일 남음`}>
    <span className={`block h-full rounded-full ${remaining <= 3 ? 'bg-primary' : 'bg-foreground/70'}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
  </span>
}

function MissingValue() {
  return <span className="rounded bg-warning/15 px-2 py-1 text-warning">미등록</span>
}

function RemainingLeaveEditor({ profileId, name, value }: { profileId: string; name: string; value: number | null }) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const mutation = useMutation({
    mutationFn: (next: string) => saveEmployeeRosterField(profileId, 'remainingAnnualLeave', next),
    onSuccess: async () => {
      await Promise.all(['employee-roster', 'employee-leave-advances', 'employee-extra-leave', 'my-attendance-basis', 'my-extra-leave', 'leave-notice-management'].map(key => client.invalidateQueries({ queryKey: [key] })))
      setDraft(null)
      setSaved(true)
    },
    onError: error => console.warn('[leave-balance] 잔여 연차 저장 실패', { profileId, error }),
  })
  return <form onSubmit={event => { event.preventDefault(); if (draft !== null && !mutation.isPending) mutation.mutate(draft) }} className="space-y-1">
    <div className="flex items-center gap-2">
      <Input type="number" step="0.01" aria-label={`${name} 남은 연차 입력`} placeholder="미등록" value={draft ?? (value == null ? '' : String(value))}
        disabled={mutation.isPending} className={`h-9 w-24 text-right tabular-nums ${value === null && draft === null ? 'bg-warning/15' : ''}`}
        onChange={event => { setDraft(event.target.value); setSaved(false); mutation.reset() }}/>
      <span>일</span>
      <Button type="submit" size="sm" disabled={draft === null || mutation.isPending}>{mutation.isPending ? '저장 중…' : '저장'}</Button>
      {draft !== null ? <Button type="button" size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => { setDraft(null); mutation.reset() }}>취소</Button> : null}
    </div>
    {mutation.error ? <p role="alert" className="text-xs text-danger">{mutation.error instanceof Error ? mutation.error.message : '저장하지 못했습니다. 다시 시도해 주세요.'}</p> : null}
    {saved ? <p role="status" className="text-xs text-success">저장되었습니다.</p> : null}
  </form>
}
