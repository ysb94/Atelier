import type { MeetingDraft, MeetingPerson, MeetingPrepFile, MeetingRoom, MeetingSeries } from '@/features/meetings/meeting-schedule'
import { getSupabase } from './client'
import { quarterFromTime } from '@/features/meetings/meeting-slots'
import type { InboxNotification } from '@/lib/inbox/types'
import type { MeetingAvailability } from '@/features/meetings/meeting-availability'
import type { MeetingParticipationRow } from '@/features/meetings/meeting-participation'
import { diagnosticQuery } from './diagnostic-query'
import { diagnosticOperation, startWorkflow, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'

const BUCKET='company-meetings'
function fail(action:string,error:{message:string}):never {
  startWorkflow('meeting', 'attachment').fail(error, { scope: /정리/.test(action) ? 'cleanup' : 'file' })
  throw new Error(error.message, { cause: error })
}
async function checked<T>(action:string,request:PromiseLike<{data:unknown;error:{message:string}|null}>,context?:DiagnosticContext):Promise<T> {
  return diagnosticQuery<T>('meeting', action, request, context)
}
export async function listCompanyMeetings():Promise<MeetingSeries[]> {
  const rows=await checked<MeetingSeries[]>('list_company_meetings',getSupabase().rpc('list_company_meetings'))
  return rows.map(series=>({...series,rounds:series.rounds.map(round=>({...round,quarterId:quarterFromTime(round.startsAt.slice(11,16))}))}))
}
export const listMeetingDirectory=()=>checked<MeetingPerson[]>('list_meeting_directory',getSupabase().rpc('list_meeting_directory'))
export const listMeetingParticipation=()=>checked<MeetingParticipationRow[]>('list_meeting_member_participation',getSupabase().rpc('list_meeting_member_participation'))
export const listMeetingCalendar=(from:string,to:string)=>checked<MeetingDraft[]>('list_meeting_calendar',getSupabase().rpc('list_meeting_calendar',{p_from:from,p_to:to}))
export const listMeetingAvailability=(seriesId:string,date:string,people:string[],roundId?:string)=>checked<MeetingAvailability[]>('list_meeting_availability_with_todos',getSupabase().rpc('list_meeting_availability_with_todos',{p_series:seriesId,p_date:date,p_people:people,p_exclude_round:roundId ?? null}))
export async function listMeetingRooms():Promise<MeetingRoom[]> {
  const {data,error}=await getSupabase().from('meeting_rooms').select('id,name').order('sort_order')
  if(error) fail('회의실 조회 실패',error)
  return data ?? []
}
async function requireMeetingKindStorage(context?:DiagnosticContext) {
  // DB 적용 전 구 서버가 새 성격 값을 무시하고 프로젝트로 저장하는 것을 막는다.
  try { await checked('check_kind_schema',getSupabase().from('meeting_series').select('kind').limit(0),context) }
  catch(error) { throw new Error('회의 DB 업데이트를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.',{cause:error}) }
}
export async function saveCompanyMeeting(series:MeetingSeries,revision:number,context?:DiagnosticContext) {
  return diagnosticOperation('meeting','save',async trace=>{
    await trace.run('check_schema',current=>requireMeetingKindStorage(current))
    return trace.run('save_series',current=>checked<number>('save_company_meeting',getSupabase().rpc('save_company_meeting',{p_series:series,p_revision:revision}),current))
  },context)
}
export async function confirmCompanyMeeting(series:MeetingSeries,revision:number,round:string,context?:DiagnosticContext) {
  return diagnosticOperation('meeting','confirm',async trace=>{
    await trace.run('check_schema',current=>requireMeetingKindStorage(current))
    return trace.run('confirm_round',current=>checked<number>('confirm_company_meeting',getSupabase().rpc('confirm_company_meeting',{p_series:series,p_revision:revision,p_round:round}),current))
  },context)
}
export const respondToMeeting=(round:string,version:number,status:'available'|'unavailable',context?:DiagnosticContext)=>checked<void>('respond_to_meeting',getSupabase().rpc('respond_to_meeting',{p_round:round,p_version:version,p_status:status}),context)
export const manuallyConfirmMeetingRound=(round:string,revision:number,version:number,excluded:string[],context?:DiagnosticContext)=>checked<number>('manually_confirm_meeting_round',getSupabase().rpc('manually_confirm_meeting_round',{p_round:round,p_revision:revision,p_version:version,p_excluded:excluded}),context)
export const listMeetingInvitations=()=>checked<InboxNotification[]>('list_my_meeting_invitations',getSupabase().rpc('list_my_meeting_invitations'))
export const readMeetingInvitation=(id:string|null)=>checked<void>('read_meeting_invitation',getSupabase().rpc('read_meeting_invitation',{p_id:id}))
export const openMeetingGroup=(id:string,context?:DiagnosticContext)=>checked<string>('open_meeting_group',getSupabase().rpc('open_meeting_group',{p_series:id}),context)
export async function deleteCompanyMeeting(series:MeetingSeries,context?:DiagnosticContext):Promise<void> {
  const paths=await checked<string[]>('delete_company_meeting',getSupabase().rpc('delete_company_meeting',{p_id:series.id,p_revision:series.revision}),context)
  if(paths.length) {
    const {error}=await getSupabase().storage.from(BUCKET).remove(paths)
    if(error) fail('회의는 삭제되었지만 첨부파일 정리에 실패했습니다',error)
    await checked('finish_meeting_cleanup',getSupabase().rpc('finish_meeting_cleanup',{p_paths:paths}))
  }
}
export async function uploadMeetingFile(roundId:string,file:File,uploader:MeetingPerson):Promise<MeetingPrepFile> {
  if(file.size<1 || file.size>52428800 || /\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$/i.test(file.name)) {
    throw new Error('50MB 이하의 실행 파일이 아닌 자료만 올려 주세요.')
  }
  const pending=await checked<{id:string;path:string}>('begin_meeting_file',getSupabase().rpc('begin_meeting_file',{p_round:roundId,p_name:file.name,p_type:file.type,p_size:file.size}))
  try {
    const {error}=await getSupabase().storage.from(BUCKET).upload(pending.path,file,{contentType:file.type||'application/octet-stream',upsert:false,cacheControl:'0'})
    if(error) fail('회의 자료 업로드 실패',error)
    await checked('finish_meeting_file',getSupabase().rpc('finish_meeting_file',{p_id:pending.id}))
    return {id:pending.id,name:file.name,size:file.size,type:file.type,url:'',storagePath:pending.path,uploadedBy:uploader}
  }catch(error){
    try { await removeMeetingFile(pending.id) }
    catch(cleanupError){console.warn('[meetings] 미완료 업로드 정리 실패',{id:pending.id,error:cleanupError})}
    throw error
  }
}
export async function removeMeetingFile(id:string):Promise<void> {
  const path=await checked<string>('remove_meeting_file',getSupabase().rpc('remove_meeting_file',{p_id:id}))
  const {error}=await getSupabase().storage.from(BUCKET).remove([path])
  if(error) fail('회의 자료 파일 정리 실패',error)
  await checked('finish_meeting_cleanup',getSupabase().rpc('finish_meeting_cleanup',{p_paths:[path]}))
}
export async function cleanupMeetingFiles():Promise<void> {
  const paths=await checked<string[]>('list_meeting_cleanup_paths',getSupabase().rpc('list_meeting_cleanup_paths'))
  if(!paths.length)return
  const {error}=await getSupabase().storage.from(BUCKET).remove(paths)
  if(error)fail('회의 파일 정리 실패',error)
  await checked('finish_meeting_cleanup',getSupabase().rpc('finish_meeting_cleanup',{p_paths:paths}))
}
export async function downloadMeetingFile(file:MeetingPrepFile):Promise<void> {
  if(!file.storagePath) throw new Error('저장된 파일 경로가 없습니다.')
  const {data,error}=await getSupabase().storage.from(BUCKET).download(file.storagePath,{cacheNonce:crypto.randomUUID()},{cache:'no-store'})
  if(error) fail('회의 자료 받기 실패',error)
  const url=URL.createObjectURL(data),link=document.createElement('a')
  link.href=url;link.download=file.name;link.click()
  window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export const setMeetingRoundPeople=(round:string,revision:number,people:{id:string;role:string}[])=>checked<number>('set_meeting_round_people',getSupabase().rpc('set_meeting_round_people',{p_round:round,p_revision:revision,p_people:people}))
export const publishMeetingResult=(round:string,revision:number)=>checked<number>('publish_meeting_result',getSupabase().rpc('publish_meeting_result',{p_round:round,p_revision:revision}))
export const readMeetingRoundNotice=(id:string,created:string,context?:DiagnosticContext)=>checked<void>('read_meeting_round_notice',getSupabase().rpc('read_meeting_round_notice',{p_id:id,p_created:created}),context)
