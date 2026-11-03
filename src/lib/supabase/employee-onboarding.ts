import { getSupabase } from './client'
import type { CompanyInformation } from '@/features/org/NewEmployeeCompanyInformation'
import { calculateCompanyWage } from '@/features/org/company-information-values'

export const ONBOARDING_QUERY = 'employee-onboarding'
export const canManageOnboarding = (profile: {id?:string;status?:string;companyId?:string|null;departmentId?:string|null}|null) => profile?.status==='active' && profile.companyId==='e0000000-0000-4000-8000-000000000001' && (profile.departmentId==='2e49ef43-75b9-4c89-b42d-9fd50ad9087b' || ['d0000000-0000-4000-8000-000000000001','a5afdd00-4a61-44dc-a1a3-082fa8a1345d','56074867-fdc2-4ce5-8e97-cea431decc36'].includes(profile.id||''))
export const EMPLOYEE_FILES = [['identity','신분증 사본'],['bank','통장 사본'],['education','학력 증명서'],['residentRegister','주민등록등본'],['businessCertificate','사업자등록증 사실 증명서']] as const
export const SIGNED_FILES = [['contract','근로계약서'],['privacyConsent','개인정보 수집 동의서'],['biometricConsent','생체인식정보 동의서']] as const
export type OnboardingFile = { id: string; kind: string; name: string; size: number }
export type OnboardingRecord = { id: string; profileId: string; isTest: boolean; version: number; submittedAt: string | null; completedAt: string | null; personal: Record<string,string>; company: CompanyInformation | null; rosterStamp: string; files: OnboardingFile[] }
export type OnboardingEmployee = { id: string; profileId: string; isTest: boolean; displayName: string; email: string; status: string; requestedAt: string | null; departmentId: string | null; position: string | null; jobGrade: string | null; hireDate: string | null; submittedAt: string | null; companySaved: boolean; completedAt: string | null; version: number; employeeFiles: number; signedFiles: number }
type StoreError = { code?: string; message?: string }
function fail(error: StoreError): never {
  console.warn('[onboarding] 요청 실패', { code: error.code })
  throw new Error(error.code === '40001' ? '다른 곳에서 정보가 변경됐습니다. 다시 조회해 주세요.' : error.code === 'P0001' ? error.message : '신규 직원 정보를 처리하지 못했습니다. 다시 시도해 주세요.')
}
export async function onboardingCall<T>(name: string, args: Record<string,unknown> = {}): Promise<T> {
  const {data,error} = await getSupabase().rpc(name,args)
  if (error) fail(error)
  return data as T
}
export async function loadMyOnboarding() {
  const {data,error} = await getSupabase().rpc('get_my_employee_onboarding_status')
  if (error && ['PGRST202','42883'].includes(error.code)) return { ready: false, record: null }
  if (error) fail(error)
  return { ready: true, record: data as Pick<OnboardingRecord,'id'|'submittedAt'|'completedAt'> | null }
}
export async function listOnboardings() {
  const {data,error} = await getSupabase().rpc('list_employee_onboardings')
  if (error && ['PGRST202','42883'].includes(error.code)) return { ready: false, items: [] as OnboardingEmployee[] }
  if (error) fail(error)
  return { ready: true, items: (data ?? []) as OnboardingEmployee[] }
}
export const getOnboarding = (id: string) => onboardingCall<OnboardingRecord>('get_employee_onboarding',{p_case:id})
export const startOnboardingTest = () => onboardingCall<string>('start_employee_onboarding_test')
export const saveOnboarding = (record: OnboardingRecord, section: 'draft'|'submit'|'company', data: Record<string,string>) => onboardingCall<OnboardingRecord>('save_employee_onboarding',{p_case:record.id,p_section:section,p_data:data,p_version:record.version,p_roster_stamp:record.rosterStamp})
export const completeOnboarding = (record: OnboardingRecord, complete: boolean) => onboardingCall<OnboardingRecord>('set_employee_onboarding_complete',{p_case:record.id,p_complete:complete,p_version:record.version})

export async function uploadOnboardingFile(record: OnboardingRecord, kind: string, file: File) {
  const bytes = new Uint8Array(await file.slice(0,8).arrayBuffer())
  const mime = bytes[0]===0x25 && bytes[1]===0x50 && bytes[2]===0x44 && bytes[3]===0x46 ? 'application/pdf' : bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff ? 'image/jpeg' : [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n) ? 'image/png' : ''
  if (!mime || file.size<1 || file.size>10*1024*1024) throw new Error('PDF·JPG·PNG 파일을 10MB 이하로 선택해 주세요.')
  const pending = await onboardingCall<{id:string;path:string}>('begin_employee_onboarding_file',{p_case:record.id,p_kind:kind,p_name:file.name,p_mime:mime,p_size:file.size})
  const {error} = await getSupabase().storage.from('employee-onboarding').upload(pending.path,file,{contentType:mime,upsert:false})
  if (error) fail(error)
  return onboardingCall<OnboardingRecord>('finish_employee_onboarding_file',{p_file:pending.id})
}
export const removeOnboardingFile = (id: string) => onboardingCall<OnboardingRecord>('remove_employee_onboarding_file',{p_file:id})
export async function downloadOnboardingFile(file: OnboardingFile) {
  // Path is obtained from a fresh authorized RPC, never accepted from a user-supplied URL.
  const path = await onboardingCall<string>('get_employee_onboarding_file_path',{p_file:file.id})
  const {data,error} = await getSupabase().storage.from('employee-onboarding').download(path)
  if (error) fail(error)
  const url = URL.createObjectURL(data), link = document.createElement('a')
  link.href=url; link.download=file.name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function onboardingInformationRows(value: Record<string,string>, mask = true): [string,string][] {
  const front=value.residentFront || '', back=value.residentBack || '', century=/^[1256]/.test(back)?'19':/^[3478]/.test(back)?'20':/^[90]/.test(back)?'18':''
  return [['영문명',value.englishName||''],['주민등록번호',front ? `${front}-${mask?'*******':back}`:''],['생년월일',century && front.length===6?`${century}${front.slice(0,2)}-${front.slice(2,4)}-${front.slice(4,6)}`:''],['연락처',value.phone||''],['현 거주지',[value.address,value.addressDetail].filter(Boolean).join(' ')],['G메일',value.gmail?`${value.gmail}@gmail.com`:''],['네이버메일',value.naverEmail?`${value.naverEmail}@naver.com`:''],['은행',value.bank||''],['예금주',value.accountHolder||''],['계좌번호',mask?(value.accountNumber||'').replace(/.(?=.{4})/g,'•'):value.accountNumber||'']]
}
export function onboardingMissing(record: OnboardingRecord) {
  const missing: string[] = []
  if (!record.submittedAt) missing.push('필수정보 제출')
  for (const [kind,label] of [...EMPLOYEE_FILES,...SIGNED_FILES]) if (!record.files.some(f=>f.kind===kind)) missing.push(label)
  for (const [key,label] of [['departmentId','부서'],['hireDate','입사일'],['annualSalary','연봉']] as const) if (!record.company?.[key]) missing.push(label)
  if (record.company) {
    const calculation=calculateCompanyWage(record.company)
    if (calculation.error) missing.push(`임금표 계산 (${calculation.error})`)
    else if (!calculation.value.monthlyWage || !calculation.value.basePay) missing.push('회사 임금표')
  }
  return missing
}
