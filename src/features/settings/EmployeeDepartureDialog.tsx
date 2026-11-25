import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { confirmEmployeeDeparture, employeeDepartureError, previewEmployeeDeparture } from '@/lib/supabase/employee-departure'
import { todayDateKey, type Profile } from '@/lib/supabase/profiles'
import { WORK_REQUEST_CONFIG, type WorkRequestOwner } from '@/features/work-requests/work-request-form-config'

export function EmployeeDepartureDialog({ employee, staff, onClose, onCompleted }: {
  employee: Profile; staff: readonly Profile[]; onClose: () => void; onCompleted: (handoverOnly: boolean, deferred: boolean) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const command = useRef<{ key: string; id: string } | null>(null)
  const [date, setDate] = useState<string>()
  const [work, setWork] = useState('')
  const [approval, setApproval] = useState('')
  const [requests, setRequests] = useState<Partial<Record<WorkRequestOwner, string>>>({})
  const preview = useQuery({
    queryKey: ['employee-departure-preview', employee.id], queryFn: () => previewEmployeeDeparture(employee.id), staleTime: 0, retry: false,
  })

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  const plan = preview.data
  const completed = Boolean(plan?.processedAt)
  const dateValue = date ?? plan?.resignedOn ?? todayDateKey()
  const activeStaff = staff.filter(person => person.id !== employee.id && person.companyId === employee.companyId && person.status === 'active')
  const requestGroups = (plan?.requestGroups ?? []).map(group => ({ ...group,
    staff: activeStaff.filter(person => Boolean(group.departmentId) && person.departmentId === group.departmentId),
    choice: requests[group.owner] ?? '',
  }))
  const requestChoices = Object.fromEntries(requestGroups.filter(group => group.choice).map(group => [group.owner, group.choice]))
  const workCount = plan ? plan.personalCount + plan.sentCount : 0
  const requestCount = requestGroups.reduce((count, group) => count + group.count + group.settingsCount, 0)
  const approvalCount = plan?.approvalCount ?? 0
  const deferred = (workCount > 0 && !work) || (approvalCount > 0 && !approval) || requestGroups.some(group => !group.choice)
  const confirm = useMutation({ mutationFn: confirmEmployeeDeparture,
    onSuccess: (_, input) => onCompleted(input.handoverOnly, deferred) })
  const ready = Boolean(plan && dateValue && !preview.isFetching && !confirm.isPending && !confirm.isSuccess
    && (!work || (workCount > 0 && activeStaff.some(person => person.id === work)))
    && requestGroups.every(group => !group.choice || group.staff.some(person => person.id === group.choice))
    && (!approval || (approvalCount > 0 && plan.canHandoverApprovals && activeStaff.some(person => person.id === approval)))
    && (!completed || work || approval || Object.keys(requestChoices).length))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || !plan) return
    const key = JSON.stringify([plan.version,dateValue,work,approval,requestChoices])
    if (key !== command.current?.key) command.current = { key, id: crypto.randomUUID() }
    confirm.mutate({ employeeId: employee.id, resignedOn: dateValue, handoverOnly: completed, version: plan.version, command: command.current.id,
      workSuccessor: work || null, approvalSuccessor: approval || null, requestSuccessors: requestChoices })
  }

  function options(people: readonly Profile[]) {
    return people.map(person => <option key={person.id} value={person.id}>
      {person.displayName || person.email}{person.departmentName && ` · ${person.departmentName}`}
    </option>)
  }

  return <dialog ref={dialog} aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); if (!confirm.isPending) onClose() }}
    className="m-auto max-h-[90dvh] w-[min(calc(100%-2rem),36rem)] overflow-y-auto rounded-xl border border-border bg-card text-card-foreground shadow-xl backdrop:bg-black/40">
    <form className="space-y-4 p-5 sm:p-6" onSubmit={submit}>
      <header>
        <h2 id={heading} className="text-lg font-semibold">{completed ? '인계 관리' : '퇴사 처리'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{employee.displayName || employee.email}{employee.departmentName && ` · ${employee.departmentName}`}</p>
      </header>
      {preview.isPending && <p role="status" className="text-sm">인계 대상과 권한을 확인하는 중입니다.</p>}
      {preview.isError && <p role="alert" className="text-sm text-danger">{employeeDepartureError(preview.error)}</p>}
      {completed && <p role="status" className="text-sm">퇴사 처리 완료 · {plan?.resignedOn}</p>}
      {plan && <>
        {!completed && <label className="grid gap-1 text-sm font-medium">퇴사일
          <Input type="date" value={dateValue} min={employee.hireDate ?? '1950-01-01'}
            onChange={event => setDate(event.currentTarget.value)} disabled={confirm.isPending} required />
        </label>}
        <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 text-sm">
          <div><dt className="text-muted-foreground">진행 중 내 업무</dt><dd className="font-medium">{plan.personalCount}건</dd></div>
          <div><dt className="text-muted-foreground">진행 중 보낸 요청</dt><dd className="font-medium">{plan.sentCount}건</dd></div>
          <div><dt className="text-muted-foreground">작업 요청 배정·담당 설정</dt><dd className="font-medium">{requestCount}건</dd></div>
          <div><dt className="text-muted-foreground">부서 승인 담당</dt><dd className="font-medium">{approvalCount}건</dd></div>
        </dl>
        {workCount > 0 && <label className="grid gap-1 text-sm font-medium">업무 후임자
          <Select value={work} onChange={event => setWork(event.currentTarget.value)} disabled={confirm.isPending}>
            <option value="">후임 미정 · 나중에 인계</option>{options(activeStaff)}
          </Select>
        </label>}
        {requestGroups.map(group => <label key={group.owner} className="grid gap-1 text-sm font-medium">
          {WORK_REQUEST_CONFIG[group.owner].label} 작업 요청 후임자 <span className="text-xs text-muted-foreground">요청 {group.count}건 · 담당 설정 {group.settingsCount}건</span>
          <Select value={group.choice} onChange={event => {
            const value = event.currentTarget.value
            setRequests(current => ({ ...current, [group.owner]: value }))
          }} disabled={confirm.isPending}>
            <option value="">{group.staff.length ? '후임 미정 · 나중에 인계' : '선택할 재직 직원 없음'}</option>{options(group.staff)}
          </Select>
        </label>)}
        {approvalCount > 0 && (plan.canHandoverApprovals ? <label className="grid gap-1 text-sm font-medium">승인 후임자
          <Select value={approval} onChange={event => setApproval(event.currentTarget.value)} disabled={confirm.isPending}>
            <option value="">후임 미정 · 나중에 인계</option>{options(activeStaff)}
          </Select>
        </label> : <p role="alert" className="text-sm text-danger">부서 승인 담당을 인계하려면 승인자 지정 권한이 필요합니다.</p>)}
        {!completed && <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          확정 즉시 계정을 정지하고 모든 로그인 세션과 계정 권한을 회수합니다. 퇴사자의 근태와 완료 이력은 보존됩니다.
          {deferred && ' 후임이 미정인 업무는 퇴사 목록의 인계 관리에서 이어서 처리할 수 있습니다.'}
        </p>}
      </>}
      {confirm.isError && <p role="alert" className="text-sm text-danger">{employeeDepartureError(confirm.error)}</p>}
      <footer className="flex flex-wrap justify-end gap-2">
        {(confirm.isError || preview.isError) && <Button type="button" variant="ghost" onClick={() => { confirm.reset(); void preview.refetch() }}>인계 대상 다시 확인</Button>}
        <Button type="button" variant="outline" disabled={confirm.isPending} onClick={onClose}>{completed ? '닫기' : '취소'}</Button>
        {plan && (!completed || workCount + requestCount + approvalCount > 0) && <Button type="submit" variant={completed ? 'default' : 'danger'} disabled={!ready}>
          {confirm.isPending ? '처리 중…' : completed ? '인계 저장' : '퇴사 확정'}
        </Button>}
      </footer>
    </form>
  </dialog>
}
