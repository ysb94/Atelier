import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { todayDateKey, type Profile } from '@/lib/supabase/profiles'
import { loadEmployeeAccessServer, reviewEmployeeAccess } from '@/lib/supabase/employee-access'
import { canReviewMember } from '@/lib/company/capabilities'
import { isPreviewProfile } from '@/lib/company/profile-preview'
import { personNameError } from '@/lib/company/person-name'
import { startWorkflow } from '@/lib/diagnostics'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'

export function NewEmployeeAccessDialog({ profile, departments, duties, grades, onDone, onClose }: {
  profile: Profile; departments: { id: string; name: string }[]; duties: string[]; grades: string[]
  onDone: () => Promise<void>; onClose: () => void
}) {
  const { profile: actor, session } = useAuth()
  const active = useWorkspaceTabActivity()
  const dialog = useRef<HTMLDialogElement>(null), title = useId()
  const [name, setName] = useState(profile.displayName || '')
  const [department, setDepartment] = useState(profile.departmentId || '')
  const [position, setPosition] = useState(profile.position || '')
  const [grade, setGrade] = useState(profile.jobGrade || '')
  const [hireDate, setHireDate] = useState(profile.hireDate || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [committed, setCommitted] = useState(false)
  const nameError = personNameError(name)
  const allowed = active && actor?.id === session?.user.id && !isPreviewProfile(actor) && actor?.id !== profile.id && canReviewMember(actor, profile.status)
  const server = useQuery({ queryKey:['employee-access-server',actor?.id,session?.user.id],queryFn:loadEmployeeAccessServer,enabled:allowed,retry:false,staleTime:0,refetchOnWindowFocus:false })
  const writable = allowed && server.data?.ready === true && server.data.canReview && !committed
  useEffect(() => { dialog.current?.showModal() }, [])

  async function decide(approved: boolean) {
    const trace = startWorkflow('app', approved ? 'access_approve' : 'access_reject', { scope: 'members' })
    trace.step('check_access')
    if (!writable || busy) { trace.block('access_denied'); return }
    trace.step('validate_input')
    if (approved && nameError) { setError(nameError); trace.block('invalid_name'); return }
    setBusy(true); setError('')
    let saved = false
    try {
      await trace.run('save', context => reviewEmployeeAccess({ profileId:profile.id,decision:approved?'approve':'reject',displayName:name,
        departmentId:department,position,jobGrade:grade,hireDate },context))
      saved = true
      setCommitted(true)
      await trace.run('refresh_queries', onDone, { writeOutcome: 'committed' })
      trace.done({ writeOutcome: 'committed' })
      onClose()
    } catch (caught) {
      trace.fail(caught, { writeOutcome: saved ? 'committed' : 'unknown' })
      setError(saved ? '처리는 저장됐지만 화면 갱신에 실패했습니다. 다시 승인하지 말고 목록을 새로고침해 주세요.' : caught instanceof Error ? caught.message : '가입 신청을 처리하지 못했습니다.')
      if (((caught as Error)?.cause as {code?:string})?.code === '40001') {
        setCommitted(true)
        try { await onDone() } catch { console.warn('[employee-access] 선처리 후 목록 갱신 실패') }
      }
    } finally { setBusy(false) }
  }
  const options = (values: string[], current: string) => [...new Set([...values, ...(current ? [current] : [])])]
  return <dialog ref={dialog} aria-labelledby={title} onClose={onClose} onCancel={event => { if (busy) event.preventDefault() }}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm backdrop:bg-black/35">
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void decide(true) }}>
      <h3 id={title} className="font-semibold">가입 승인 관리 · {profile.displayName || profile.email}</h3>
      <p className="text-sm text-muted-foreground">본명과 소속을 확인해 사이트 이용을 승인합니다. 승인 후 필수정보와 서류는 신규직원 목록에서 계속 확인합니다.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1"><span className="text-sm">본명</span><Input aria-label="본명" value={name} onChange={event => setName(event.target.value)} disabled={busy || committed || !allowed}/>{nameError?<p className="text-xs text-danger">{nameError}</p>:null}</label>
        <label className="space-y-1"><span className="text-sm">팀</span><Select aria-label="팀" value={department} onChange={event => setDepartment(event.target.value)} disabled={busy || committed || !allowed}><option value="">선택</option>{departments.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <label className="space-y-1"><span className="text-sm">직책</span><Select aria-label="직책" value={position} onChange={event=>setPosition(event.target.value)} disabled={busy || committed || !allowed}><option value="">미설정</option>{options(duties,position).map(value=><option key={value}>{value}</option>)}</Select></label>
        <label className="space-y-1"><span className="text-sm">직급</span><Select aria-label="직급" value={grade} onChange={event=>setGrade(event.target.value)} disabled={busy || committed || !allowed}><option value="">미설정</option>{options(grades,grade).map(value=><option key={value}>{value}</option>)}</Select></label>
        <label className="space-y-1"><span className="text-sm">입사일</span><Input aria-label="입사일" type="date" min="1950-01-01" max={todayDateKey()} value={hireDate} onChange={event=>setHireDate(event.target.value)} disabled={busy || committed || !allowed}/><p className="text-xs text-muted-foreground">비워 두면 없음입니다. 승인 후 수정은 조직도에서 합니다.</p></label>
      </div>
      {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
      {!allowed?<p role="alert" className="text-sm text-warning">현재 계정에서는 이 가입 신청을 처리할 수 없습니다.</p>:null}
      {allowed && !server.data?.ready?<p role="status" className="text-sm text-warning">{server.isPending?'가입 승인 서버 연결 확인 중…':server.isError?'가입 승인 서버를 확인하지 못했습니다.':'가입 승인 서버 연결 대기 · 서버 적용 후 승인·거절할 수 있습니다.'}</p>:null}
      {allowed && server.data?.ready && !server.data.canReview?<p role="alert" className="text-sm text-warning">서버에서 가입 승인 권한을 확인하지 못했습니다.</p>:null}
      {allowed && !server.isPending && !server.data?.ready?<Button type="button" variant="outline" size="sm" onClick={()=>void server.refetch()}>서버 연결 다시 확인</Button>:null}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>닫기</Button><Button type="button" variant="outline" disabled={busy || !writable} onClick={()=>void decide(false)}>거절</Button><Button type="submit" disabled={busy || !writable || Boolean(nameError)}>{busy?'처리 중…':'승인'}</Button></div>
    </form>
  </dialog>
}
