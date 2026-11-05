import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { StatusPill } from '@/components/ui/status-pill'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { canReviewMember } from '@/lib/company/capabilities'
import { isPreviewProfile } from '@/lib/company/profile-preview'
import { emptyList } from '@/lib/utils'
import { listEmployeeAccessRequests, type Profile } from '@/lib/supabase/profiles'
import { NewEmployeeAccessDialog } from './NewEmployeeAccessDialog'
import { accessStatusLabel, EMPLOYEE_ACCESS_QUERY, inNewEmployeeView, newEmployeeRows, type NewEmployeeRow, type NewEmployeeView } from './new-employee-access'
import { canManageOnboarding, ONBOARDING_QUERY, EMPLOYEE_FILES, SIGNED_FILES, listOnboardings, getOnboarding, saveOnboarding, completeOnboarding, onboardingInformationRows, type OnboardingRecord, type OnboardingEmployee } from '@/lib/supabase/employee-onboarding'
import { NewEmployeeCompanyInformation, type CompanyInformation } from './NewEmployeeCompanyInformation'
import { NewEmployeeDocumentPreview } from './NewEmployeeDocumentPreview'
import { SIGNATURE_DOCUMENTS, type SignatureDocument } from './new-employee-document-templates'
import { OnboardingFiles } from './OnboardingFiles'

type Props={departments:{id:string;name:string}[];duties:string[];grades:string[]}
export function NewEmployeesPanel(props:Props){
  const {profile,session}=useAuth()
  return <NewEmployeesContent key={`${profile?.id}:${session?.user.id}`} {...props}/>
}
function NewEmployeesContent({departments,duties,grades}:Props){
  useRenderWatch('NewEmployeesPanel')
  const {profile:actor,session}=useAuth(),client=useQueryClient()
  const allowed=canManageOnboarding(actor)
  const canReview=canReviewMember(actor,'pending')
  const active=useWorkspaceTabActivity()
  const sessionMatches=Boolean(actor?.id && actor.id===session?.user.id && !isPreviewProfile(actor))
  const query=useQuery({queryKey:[ONBOARDING_QUERY,'list',actor?.id,session?.user.id],queryFn:listOnboardings,enabled:allowed&&sessionMatches&&active,retry:false,refetchOnWindowFocus:false,refetchInterval:active?30_000:false})
  const requests=useQuery({queryKey:[EMPLOYEE_ACCESS_QUERY,actor?.companyId,actor?.id,session?.user.id],queryFn:listEmployeeAccessRequests,enabled:(allowed||canReview)&&sessionMatches&&active,retry:false,refetchOnWindowFocus:false,refetchInterval:active?30_000:false})
  const [view,setView]=useState<NewEmployeeView>('active'),[selected,setSelected]=useState<OnboardingEmployee|null>(null),[record,setRecord]=useState<OnboardingRecord|null>(null)
  const [review,setReview]=useState<Profile|null>(null)
  const [part,setPart]=useState<'information'|'company'|'documents'|'complete'|null>(null),[document,setDocument]=useState<SignatureDocument|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const [reveal,setReveal]=useState(false)
  useEffect(()=>{setSelected(null);setRecord(null);setPart(null);setDocument(null);setReview(null);setError('')},[actor?.id,session?.user.id,allowed,canReview,sessionMatches])
  async function refresh(){await Promise.all([client.invalidateQueries({queryKey:[EMPLOYEE_ACCESS_QUERY]},{throwOnError:true}),client.invalidateQueries({queryKey:[ONBOARDING_QUERY]},{throwOnError:true}),client.invalidateQueries({queryKey:['orgChartMembers']}),client.invalidateQueries({queryKey:['employee-roster']}),client.invalidateQueries({queryKey:['onboarding-company-information']}),client.invalidateQueries({queryKey:['manageable-profiles']})])}
  async function open(person:OnboardingEmployee,next:typeof part){setBusy(true);setError('');setReveal(false);try{const data=await getOnboarding(person.id);setSelected(person);setRecord(data);setPart(next)}catch(caught){setError(caught instanceof Error?caught.message:'조회에 실패했습니다.')}finally{setBusy(false)}}
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();await refresh()}catch(caught){setError(caught instanceof Error?caught.message:'처리하지 못했습니다.')}finally{setBusy(false)}}
  async function saveCompany(value:CompanyInformation){if(!record||!selected)return;await run(async()=>{
    const saved=await saveOnboarding(record,'company',value);setRecord(saved)
    setPart(null);setRecord(null)
  })}
  async function openReview(person:NewEmployeeRow){
    const profile=requests.data?.find(item=>item.id===person.profileId)
    if(!profile||!active||!sessionMatches||!canReviewMember(actor,profile.status))return
    setBusy(true);setError('')
    try{
      const saved=allowed&&person.connected&&person.companySaved?await getOnboarding(person.id):null
      const company=saved?.company
      setReview(company?{...profile,departmentId:company.departmentId??profile.departmentId,position:company.position??profile.position,jobGrade:company.jobGrade??profile.jobGrade,hireDate:company.hireDate??profile.hireDate}:profile)
    }catch(caught){console.warn('[employee-access] 승인 정보 조회 실패');setError(caught instanceof Error?caught.message:'승인 정보를 불러오지 못했습니다.')}
    finally{setBusy(false)}
  }
  const rows=useMemo(()=>newEmployeeRows(allowed?query.data?.items??emptyList<OnboardingEmployee>():emptyList<OnboardingEmployee>(),requests.data??emptyList<Profile>()).filter(person=>inNewEmployeeView(person,view)),[allowed,query.data?.items,requests.data,view])
  if(!allowed&&!canReview)return <p className="text-sm text-muted-foreground">운영지원 부서와 지정된 담당자만 가입 신청을 관리할 수 있습니다.</p>
  if(!sessionMatches)return <p role="status" className="text-sm text-warning">미리보기 또는 계정 전환 중에는 가입 신청을 조회·처리할 수 없습니다.</p>
  return <section className="space-y-4" aria-label="신규 직원"><div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm"><h2 className="text-base font-semibold">신규 직원</h2><p className="mt-1 text-sm text-muted-foreground">승인여부의 관리 버튼에서 가입을 승인·거절합니다. 승인·부서 배치 후에도 서류 완료 처리 전까지 목록에 남습니다.</p></div>
    <div className="flex flex-wrap items-center gap-2"><FilterTabs<NewEmployeeView> ariaLabel="신규직원 상태" value={view} onChange={setView} tabs={[{value:'active',label:'진행 중'},{value:'complete',label:'완료 목록'},{value:'rejected',label:'거절 목록'}]}/><Button variant="outline" size="sm" disabled={busy} onClick={()=>void refresh().catch(()=>setError('목록을 새로고침하지 못했습니다. 다시 시도해 주세요.'))}>새로고침</Button></div>
    {query.data&&!query.data.ready?<p role="status" className="text-sm text-warning">신규 직원 저장 기능은 공유 DB 적용 대기 중입니다. 기존 로그인·승인 상태는 유지됩니다.</p>:null}
    {error||query.isError||requests.isError?<p role="alert" className="text-sm text-danger">{error||(requests.isError?'가입 대기 목록을 확인하지 못했습니다. 새로고침해 주세요.':'신규 직원 목록 조회에 실패했습니다. 새로고침해 주세요.')}</p>:null}
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr>{['이름','이메일','신청일','승인여부','필수정보','회사 입력정보','필수서류','완료'].map(label=><th key={label} className="whitespace-nowrap px-4 py-2.5 font-medium">{label}</th>)}</tr></thead><tbody>
      {rows.map(person=><tr key={person.id} className="border-t border-border"><td className="px-4 py-3 font-medium">{person.displayName}</td><td className="px-4 py-3">{person.email}</td><td className="px-4 py-3">{person.requestedAt?new Date(person.requestedAt).toLocaleDateString('ko-KR'):'—'}</td><td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2"><StatusPill tone={person.status==='pending'?'warning':person.status==='active'?'success':person.status==='rejected'?'danger':'muted'}>{accessStatusLabel(person.status)}</StatusPill>{person.status==='pending'&&!person.isTest?<Button size="sm" variant="outline" disabled={busy||!canReview||!requests.data?.some(item=>item.id===person.profileId)} onClick={()=>void openReview(person)}>관리</Button>:null}</div></td>
        <td className="px-4 py-3"><span className="block text-xs text-muted-foreground">{person.submittedAt?'제출 완료':'미제출'}</span><Button size="sm" variant="outline" disabled={busy||!allowed||!person.connected} onClick={()=>void open(person,'information')}>필수정보 보기</Button></td>
        <td className="px-4 py-3"><span className="block text-xs text-muted-foreground">{person.companySaved?'입력됨':'미입력'}</span><Button size="sm" variant="outline" disabled={busy||!allowed||!person.connected||person.status==='rejected'} onClick={()=>void open(person,'company')}>회사정보 입력</Button></td>
        <td className="px-4 py-3"><span className="block text-xs text-muted-foreground">첨부 {person.employeeFiles}/5 · 서명본 {person.signedFiles}/3</span><Button size="sm" variant="outline" disabled={busy||!allowed||!person.connected||person.status==='rejected'} onClick={()=>void open(person,'documents')}>필수서류 보기</Button></td>
        <td className="px-4 py-3"><Button size="sm" variant="outline" disabled={busy||!allowed||!person.connected||person.status!=='active'} onClick={()=>void open(person,'complete')}>{person.completedAt?'진행 중으로 되돌리기':'완료'}</Button>{!person.connected?<p className="mt-1 text-xs text-muted-foreground">{person.status==='pending'?'승인 후 서류 관리 연결':'가입 신청 처리 기록'}</p>:null}</td></tr>)}
      {!rows.length?<tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">{requests.isPending || allowed&&query.isPending?'불러오는 중…':'해당하는 신규 직원이 없습니다.'}</td></tr>:null}
    </tbody></table></div>
    {review?<NewEmployeeAccessDialog key={review.id} profile={review} departments={departments} duties={duties} grades={grades} onDone={refresh} onClose={()=>setReview(null)}/>:null}
    {allowed&&selected&&record&&part==='company'?<NewEmployeeCompanyInformation key={record.id} person={{...selected,id:selected.profileId}} isTest={selected.isTest} saved={record.company?.wageMode?record.company:undefined} departments={departments} duties={duties} grades={grades} canEdit={!record.completedAt} busy={busy} error={error||null} onApply={value=>void saveCompany(value)} onClose={()=>{if(!busy)setPart(null)}}/>:null}
    {allowed&&selected&&record&&part&&part!=='company'?<OnboardingDetail key={`${record.id}:${part}`} title={`${selected.displayName} · ${part==='information'?'필수정보':part==='complete'?'완료 처리':'필수서류'}`} busy={busy} onClose={()=>{if(!busy)setPart(null)}}>
      {error?<p role="alert" className="mb-3 text-sm text-danger">{error}</p>:null}
      {part==='information'?<><Button size="sm" variant="outline" onClick={()=>setReveal(value=>!value)}>{reveal?'주민번호·계좌 가리기':'주민번호·계좌 확인'}</Button><dl className="divide-y divide-border">{onboardingInformationRows(record.personal,!reveal).map(([label,value])=><div key={label} className="grid gap-1 py-3 text-sm sm:grid-cols-[160px_1fr]"><dt className="text-muted-foreground">{label}</dt><dd className="break-all">{value||'미입력'}</dd></div>)}</dl></>:null}
      {part==='documents'?<div className="space-y-5"><section><h4 className="mb-3 font-semibold">신규직원 첨부서류</h4><OnboardingFiles record={record} kinds={EMPLOYEE_FILES} onChange={next=>{setRecord(current=>current?.id===next.id&&current.version===next.version?next:current);void refresh()}}/></section><section className="border-t-2 border-border pt-5"><h4 className="font-semibold">서명이 필요한 서류</h4><p className="my-2 text-xs text-muted-foreground">입력값을 확인해 출력하고, 실물 서명받은 서류를 첨부하세요.</p><div className="mb-3 flex flex-wrap gap-2">{SIGNATURE_DOCUMENTS.map(kind=><Button key={kind} variant="outline" size="sm" onClick={()=>setDocument(kind)}>{kind} 미리보기</Button>)}</div><OnboardingFiles record={record} kinds={SIGNED_FILES} onChange={next=>{setRecord(current=>current?.id===next.id&&current.version===next.version?next:current);void refresh()}}/></section></div>:null}
      {part==='complete'?<div className="space-y-4"><p className="text-sm font-medium">{record.completedAt?'진행 중으로 되돌리시겠습니까?':'정말 완료 처리하시겠습니까?'}</p><p className="text-sm text-muted-foreground">{record.completedAt?'진행 중으로 되돌리면 직원의 필수정보 입력 버튼이 다시 표시되고 입력·첨부를 수정할 수 있습니다.':'필수정보·회사 입력정보·서류 제출 여부와 관계없이 완료됩니다. 완료하면 직원의 필수정보 입력 버튼이 더 이상 표시되지 않습니다.'}</p><Button disabled={busy} onClick={()=>void run(async()=>{await completeOnboarding(record,!record.completedAt);setPart(null);setRecord(null)})}>{record.completedAt?'진행 중으로 되돌리기':'확인하고 완료'}</Button></div>:null}
    </OnboardingDetail>:null}
    {allowed&&document&&selected&&record?<NewEmployeeDocumentPreview kind={document} data={{employeeName:selected.displayName,department:departments.find(d=>d.id===record.company?.departmentId)?.name||'',position:record.company?.position||record.company?.jobGrade||'',personal:onboardingInformationRows(record.personal),company:record.company||undefined}} onClose={()=>setDocument(null)}/>:null}
  </section>
}
function OnboardingDetail({title,busy,onClose,children}:{title:string;busy:boolean;onClose:()=>void;children:React.ReactNode}){
  const dialog=useRef<HTMLDialogElement>(null),id=useId();useEffect(()=>{dialog.current?.showModal()},[])
  return <dialog ref={dialog} aria-labelledby={id} onClose={onClose} onCancel={event=>{if(busy)event.preventDefault()}} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-lg backdrop:bg-black/35"><div className="mb-4 flex items-center justify-between gap-3"><h3 id={id} className="font-semibold">{title}</h3><Button size="sm" variant="outline" disabled={busy} onClick={onClose}>닫기</Button></div>{children}</dialog>
}
