import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { RELEASE_COMPANY_ID, RELEASE_EXCEPTION_IDS } from '@/lib/company/release-access'
import { OnboardingFiles } from '@/features/org/OnboardingFiles'
import { EMPLOYEE_FILES, ONBOARDING_QUERY, getOnboarding, listOnboardings, loadMyOnboarding, onboardingInformationRows, saveOnboarding, startOnboardingTest, type OnboardingRecord } from '@/lib/supabase/employee-onboarding'
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>
}
function EmailField({ label, name, domain, defaultValue = '' }: { label: string; name: string; domain: string; defaultValue?: string }) {
  const id = useId()
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <div className="flex min-w-0 items-center gap-2">
      <Input id={id} name={name} required inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254} pattern={'[A-Za-z0-9._%+\\-]{1,64}'} placeholder="아이디" defaultValue={defaultValue} aria-describedby={`${id}-domain`} className="min-w-0 flex-1" onChange={event => {
        const input = event.currentTarget
        const value = input.value.trim()
        input.value = value.toLowerCase().endsWith(`@${domain}`) ? value.slice(0, -(domain.length + 1)) : value
      }} />
      <span id={`${id}-domain`} className="shrink-0 text-sm text-muted-foreground">@{domain}</span>
    </div>
  </div>
}
function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, value.startsWith('02') ? 10 : 11)
  const prefix = digits.startsWith('02') ? 2 : 3
  if (digits.length <= prefix) return digits
  if (digits.length <= prefix + 4) return `${digits.slice(0, prefix)}-${digits.slice(prefix)}`
  const middle = digits.length > prefix + 7 ? 4 : 3
  return `${digits.slice(0, prefix)}-${digits.slice(prefix, prefix + middle)}-${digits.slice(prefix + middle)}`
}
function birthDate(front: string, back: string) {
  const century = /^[1256]/.test(back) ? 1900 : /^[3478]/.test(back) ? 2000 : /^[90]/.test(back) ? 1800 : null
  if (century === null || !/^\d{6}$/.test(front)) return ''
  const year = century + Number(front.slice(0, 2)), month = Number(front.slice(2, 4)), day = Number(front.slice(4, 6))
  const value = new Date(year, month - 1, day)
  return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day ? `${year}-${front.slice(2, 4)}-${front.slice(4, 6)}` : ''
}

export function RequiredInformationButton() {
  const {profile,session}=useAuth()
  return <RequiredInformationContent key={`${profile?.id}:${session?.user.id}`}/>
}
function RequiredInformationContent() {
  const {profile,session}=useAuth(), client=useQueryClient()
  const active=profile?.status==='active' && profile.companyId===RELEASE_COMPANY_ID && session?.user.id===profile.id
  const developer=active && import.meta.env.DEV && profile.id===RELEASE_EXCEPTION_IDS[0]
  const queryKey=[ONBOARDING_QUERY,'mine',profile?.id,session?.user.id]
  const query=useQuery({queryKey,queryFn:async()=>{
    const state=await loadMyOnboarding()
    if(!developer||!state.ready)return state
    // 로컬 개발자 테스트도 실제 직원과 같은 완료·되돌리기 표시 규칙을 따른다.
    const tests=await listOnboardings(),test=tests.items.find(person=>person.isTest&&person.profileId===profile.id)
    return {ready:tests.ready,record:test?{id:test.id,submittedAt:test.submittedAt,completedAt:test.completedAt}:state.record}
  },enabled:active,retry:false,refetchOnWindowFocus:false})
  const [record,setRecord]=useState<OnboardingRecord|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{setRecord(null);setError('')},[profile?.id,session?.user.id])
  if(!active || query.data?.record?.completedAt || (!developer && !query.data?.record))return null
  async function open(){setError('');setBusy(true);try{
    const id=developer?await startOnboardingTest():query.data!.record!.id,next=await getOnboarding(id)
    // 다른 화면에서 먼저 완료한 경우에도 완료된 입력창을 열지 않는다.
    if(next.completedAt){client.setQueryData(queryKey,{ready:true,record:{id:next.id,submittedAt:next.submittedAt,completedAt:next.completedAt}});setRecord(null);return}
    setRecord(next)
  }catch(caught){setError(caught instanceof Error?caught.message:'정보를 불러오지 못했습니다.')}finally{setBusy(false)}}
  return <><Button type="button" className="h-11 px-7 text-base font-semibold shadow-md" disabled={busy||!query.data?.ready} onClick={()=>void open()}><FileText className="size-4" aria-hidden="true"/>{query.data?.record?.submittedAt?'제출 정보 확인':'필수정보 입력'}</Button>{developer&&!query.data?.ready?<span className="text-xs text-muted-foreground">신규 직원 서버 연결 대기</span>:null}{error?<span role="alert" className="text-sm text-danger">{error}</span>:null}{record?<RequiredInformationForm key={`${profile.id}:${session.user.id}:${record.id}`} initial={record} onClose={()=>{setRecord(null);void client.invalidateQueries({queryKey:[ONBOARDING_QUERY]})}}/>:null}</>
}
function RequiredInformationForm({initial,onClose}:{initial:OnboardingRecord;onClose:()=>void}) {
  const {profile}=useAuth(),client=useQueryClient()
  const dialog=useRef<HTMLDialogElement>(null),form=useRef<HTMLFormElement>(null),scroll=useRef<HTMLDivElement>(null)
  const titleId=useId(),descriptionId=useId()
  const [record,setRecord]=useState(initial),[bank,setBank]=useState(initial.personal.bank||''),[showResidentNumber,setShowResidentNumber]=useState(false)
  const [review,setReview]=useState<[string,string][]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  useEffect(()=>{dialog.current?.showModal()},[])
  useEffect(()=>{scroll.current?.scrollTo(0,0)},[review])
  if(!profile)return null
  const knownBanks=['KB국민은행','신한은행','우리은행','하나은행','IBK기업은행','NH농협은행','SC제일은행','한국씨티은행','카카오뱅크','토스뱅크','케이뱅크','우체국']
  if(bank && !knownBanks.includes(bank) && bank!=='other')knownBanks.push(bank)
  function values(){const data=new FormData(form.current!),result:Record<string,string>={};for(const key of ['englishName','residentFront','residentBack','phone','address','addressDetail','gmail','naverEmail','accountHolder','accountNumber'])result[key]=String(data.get(key)||'').trim();result.bank=bank==='other'?String(data.get('bankOther')||'').trim():bank;return result}
  async function save(section:'draft'|'submit'){if(busy)return;setError('');setBusy(true);try{const next=await saveOnboarding(record,section,values());setRecord(next);setNotice(section==='draft'?'임시 저장했습니다.':'제출했습니다.');await client.invalidateQueries({queryKey:[ONBOARDING_QUERY]});if(section==='submit')onClose()}catch(caught){setError(caught instanceof Error?caught.message:'저장에 실패했습니다.')}finally{setBusy(false)}}
  return <dialog ref={dialog} onClose={onClose} onCancel={event=>{if(busy)event.preventDefault()}} aria-labelledby={titleId} aria-describedby={descriptionId} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/35">
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 id={titleId} className="text-lg font-semibold">필수정보 입력{record.isTest?' · 개발자 테스트':''}</h2><p className="mt-1 text-xs text-muted-foreground">근로자 명부 · 입사정보</p></div><Button type="button" size="icon" variant="ghost" disabled={busy} autoFocus aria-label="필수정보 입력 닫기" onClick={onClose}><X className="size-4"/></Button></div>
    <form ref={form} autoComplete="off" onSubmit={event=>{event.preventDefault();setError('');if(!birthDate(values().residentFront,values().residentBack)){setError('주민등록번호의 생년월일을 확인해 주세요.');return}if(record.files.filter(f=>EMPLOYEE_FILES.some(([kind])=>kind===f.kind)).length!==5){setError('필수 첨부서류 5종을 모두 업로드해 주세요.');return}setReview(onboardingInformationRows(values()));setShowResidentNumber(false)}}>
      <div ref={scroll} className="max-h-[calc(90dvh_-_10rem)] space-y-5 overflow-y-auto p-5">
        <p id={descriptionId} className="rounded-md bg-muted p-3 text-sm text-muted-foreground">임시 저장은 직원 배치에 반영되지 않습니다. 입력 내용을 확인하고 제출하면 명부에 연결됩니다.{record.isTest?' 테스트 기록은 실제 개발자 계정의 정보·승인 상태에 반영되지 않습니다.':''}{record.completedAt?' 담당자가 완료 처리한 기록입니다. 변경은 운영지원에 문의해 주세요.':''}</p>
        <fieldset disabled={busy||Boolean(record.completedAt)} hidden={review!==null} className="min-w-0 space-y-5 border-0 p-0">
            <fieldset className="min-w-0 rounded-xl border border-border p-4"><legend className="px-2 text-sm font-semibold">기본 정보·연락처</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="영문명 *"><Input name="englishName" defaultValue={initial.personal.englishName || ''} required maxLength={100} placeholder="여권 등 공식 영문명" /></Field>
                <div className="space-y-1.5"><span className="text-sm font-medium">주민등록번호 *</span><div className="flex items-center gap-2"><Input aria-label="주민등록번호 앞 6자리" name="residentFront" defaultValue={initial.personal.residentFront || ''} inputMode="numeric" required pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="앞 6자리" /><span aria-hidden="true">-</span><Input aria-label="주민등록번호 뒤 7자리" name="residentBack" defaultValue={initial.personal.residentBack || ''} type={showResidentNumber ? 'text' : 'password'} inputMode="numeric" required pattern="[0-9]{7}" minLength={7} maxLength={7} placeholder="뒤 7자리" /><Button type="button" size="icon" variant="ghost" aria-label={showResidentNumber ? '주민번호 숨기기' : '주민번호 보기'} onClick={() => setShowResidentNumber(value => !value)}>{showResidentNumber ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button></div></div>
                <Field label="연락처 *"><Input name="phone" defaultValue={initial.personal.phone || ''} type="tel" inputMode="tel" required maxLength={20} placeholder="010-0000-0000" onChange={event => {
                  const input = event.currentTarget
                  const before = input.value
                  const caret = input.selectionStart ?? before.length
                  const digitsBeforeCaret = before.slice(0, caret).replace(/\D/g, '').length
                  input.value = formatPhone(before)
                  if (input.value !== before) {
                    let position = 0, digits = 0
                    while (position < input.value.length && digits < digitsBeforeCaret) if (/\d/.test(input.value[position++])) digits++
                    input.setSelectionRange(position, position)
                  }
                }} /></Field>
                <EmailField label="G메일 *" name="gmail" domain="gmail.com" defaultValue={initial.personal.gmail || (profile.email.toLowerCase().endsWith('@gmail.com') ? profile.email.slice(0, -10) : '')} />
                <EmailField label="네이버메일 *" name="naverEmail" domain="naver.com" defaultValue={initial.personal.naverEmail || ''} />
                <div className="grid gap-3 sm:col-span-2"><Field label="현 거주지 *"><Input name="address" defaultValue={initial.personal.address || ''} required maxLength={200} placeholder="도로명 또는 지번 주소" /></Field><Field label="상세주소"><Input name="addressDetail" defaultValue={initial.personal.addressDetail || ''} maxLength={100} placeholder="동·호수 등 상세주소" /></Field></div>
              </div>
            </fieldset>
            <fieldset className="min-w-0 rounded-xl border border-border p-4"><legend className="px-2 text-sm font-semibold">급여 지급 정보</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="은행 *"><Select name="bank" aria-label="은행" required className="w-full" value={bank} onChange={event => setBank(event.target.value)}><option value="">은행 선택</option>{knownBanks.map(name => <option key={name}>{name}</option>)}<option value="other">기타 · 직접 입력</option></Select></Field>
                <Field label="예금주 *"><Input name="accountHolder" required defaultValue={initial.personal.accountHolder || profile.displayName || ''} maxLength={100} placeholder="본인 명의 예금주" /></Field>
                {bank === 'other' && <Field label="은행명 직접 입력 *"><Input name="bankOther" defaultValue={initial.personal.bankOther || ''} required maxLength={50} /></Field>}
                <div className="sm:col-span-2"><Field label="계좌번호 *"><Input name="accountNumber" defaultValue={initial.personal.accountNumber || ''} required inputMode="numeric" maxLength={40} placeholder="통장에 표시된 계좌번호" /></Field></div>
              </div>
            </fieldset>

          <section className="rounded-xl border border-border p-4"><h3 className="mb-3 font-semibold">신규직원 첨부서류</h3><p className="mb-3 text-xs text-muted-foreground">5종 모두 필수 · PDF·JPG·PNG · 파일당 10MB 이하</p><OnboardingFiles record={record} kinds={EMPLOYEE_FILES} onChange={setRecord}/></section>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1 accent-primary"/>위 입력 내용이 틀림없음을 확인합니다.</label>
        </fieldset>
        {review?<section aria-label="입력 내용 확인" className="space-y-4"><h3 className="font-semibold">입력 내용 확인</h3><dl className="divide-y divide-border rounded-xl border border-border px-4">{review.map(([label,value])=><div key={label} className="grid gap-1 py-3 text-sm sm:grid-cols-[150px_1fr]"><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value||'미입력'}</dd></div>)}</dl></section>:null}
        {error?<p role="alert" className="text-sm text-danger">{error} <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>닫고 다시 조회</Button></p>:null}{notice?<p role="status" className="text-sm">{notice}</p>:null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-card p-4"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>닫기</Button>{!record.completedAt?<><Button type="button" variant="outline" disabled={busy} onClick={()=>void save('draft')}>임시 저장</Button>{review?<><Button type="button" variant="outline" disabled={busy} onClick={()=>setReview(null)}>수정하기</Button><Button type="button" disabled={busy} onClick={()=>void save('submit')}>{busy?'저장 중…':'제출하기'}</Button></>:<Button type="submit" disabled={busy}>입력 내용 확인</Button>}</>:null}</div>
    </form>
  </dialog>
}
