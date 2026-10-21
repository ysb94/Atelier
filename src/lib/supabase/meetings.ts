import type { MeetingDraft, MeetingPerson, MeetingPrepFile, MeetingRoom, MeetingSeries } from '@/features/meetings/meeting-schedule'
import { getSupabase } from './client'
import { quarterFromTime } from '@/features/meetings/meeting-slots'
import type { InboxNotification } from '@/lib/inbox/types'

const BUCKET='company-meetings'
function fail(action:string,error:{message:string}):never {
  console.warn('[meetings] '+action,{message:error.message})
  throw new Error(error.message)
}
async function checked<T>(request:PromiseLike<{data:unknown;error:{message:string}|null}>):Promise<T> {
  const {data,error}=await request
  if(error) fail('회의 DB 요청 실패',error)
  return data as T
}
export async function listCompanyMeetings():Promise<MeetingSeries[]> {
  const rows=await checked<MeetingSeries[]>(getSupabase().rpc('list_company_meetings'))
  return rows.map(series=>({...series,rounds:series.rounds.map(round=>({...round,quarterId:quarterFromTime(round.startsAt.slice(11,16))}))}))
}
export const listMeetingDirectory=()=>checked<MeetingPerson[]>(getSupabase().rpc('list_meeting_directory'))
export const listMeetingCalendar=(from:string,to:string)=>checked<MeetingDraft[]>(getSupabase().rpc('list_meeting_calendar',{p_from:from,p_to:to}))
export async function listMeetingRooms():Promise<MeetingRoom[]> {
  const {data,error}=await getSupabase().from('meeting_rooms').select('id,name').order('sort_order')
  if(error) fail('회의실 조회 실패',error)
  return data ?? []
}
export const saveCompanyMeeting=(series:MeetingSeries,revision:number)=>checked<number>(getSupabase().rpc('save_company_meeting',{p_series:series,p_revision:revision}))
export const confirmCompanyMeeting=(series:MeetingSeries,revision:number,round:string)=>checked<number>(getSupabase().rpc('confirm_company_meeting',{p_series:series,p_revision:revision,p_round:round}))
export const respondToMeeting=(round:string,version:number,status:'available'|'unavailable')=>checked<void>(getSupabase().rpc('respond_to_meeting',{p_round:round,p_version:version,p_status:status}))
export const listMeetingInvitations=()=>checked<InboxNotification[]>(getSupabase().rpc('list_my_meeting_invitations'))
export const readMeetingInvitation=(id:string|null)=>checked<void>(getSupabase().rpc('read_meeting_invitation',{p_id:id}))
export const openMeetingGroup=(id:string)=>checked<string>(getSupabase().rpc('open_meeting_group',{p_series:id}))
export async function deleteCompanyMeeting(series:MeetingSeries):Promise<void> {
  const paths=await checked<string[]>(getSupabase().rpc('delete_company_meeting',{p_id:series.id,p_revision:series.revision}))
  if(paths.length) {
    const {error}=await getSupabase().storage.from(BUCKET).remove(paths)
    if(error) fail('회의는 삭제되었지만 첨부파일 정리에 실패했습니다',error)
    await checked(getSupabase().rpc('finish_meeting_cleanup',{p_paths:paths}))
  }
}
export async function uploadMeetingFile(roundId:string,file:File,uploader:MeetingPerson):Promise<MeetingPrepFile> {
  if(file.size<1 || file.size>52428800 || /\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$/i.test(file.name)) {
    throw new Error('50MB 이하의 실행 파일이 아닌 자료만 올려 주세요.')
  }
  const pending=await checked<{id:string;path:string}>(getSupabase().rpc('begin_meeting_file',{p_round:roundId,p_name:file.name,p_type:file.type,p_size:file.size}))
  try {
    const {error}=await getSupabase().storage.from(BUCKET).upload(pending.path,file,{contentType:file.type||'application/octet-stream',upsert:false,cacheControl:'0'})
    if(error) fail('회의 자료 업로드 실패',error)
    await checked(getSupabase().rpc('finish_meeting_file',{p_id:pending.id}))
    return {id:pending.id,name:file.name,size:file.size,type:file.type,url:'',storagePath:pending.path,uploadedBy:uploader}
  }catch(error){
    try { await removeMeetingFile(pending.id) }
    catch(cleanupError){console.warn('[meetings] 미완료 업로드 정리 실패',{id:pending.id,error:cleanupError})}
    throw error
  }
}
export async function removeMeetingFile(id:string):Promise<void> {
  const path=await checked<string>(getSupabase().rpc('remove_meeting_file',{p_id:id}))
  const {error}=await getSupabase().storage.from(BUCKET).remove([path])
  if(error) fail('회의 자료 파일 정리 실패',error)
  await checked(getSupabase().rpc('finish_meeting_cleanup',{p_paths:[path]}))
}
export async function cleanupMeetingFiles():Promise<void> {
  const paths=await checked<string[]>(getSupabase().rpc('list_meeting_cleanup_paths'))
  if(!paths.length)return
  const {error}=await getSupabase().storage.from(BUCKET).remove(paths)
  if(error)fail('회의 파일 정리 실패',error)
  await checked(getSupabase().rpc('finish_meeting_cleanup',{p_paths:paths}))
}
export async function downloadMeetingFile(file:MeetingPrepFile):Promise<void> {
  if(!file.storagePath) throw new Error('저장된 파일 경로가 없습니다.')
  const {data,error}=await getSupabase().storage.from(BUCKET).download(file.storagePath,{cacheNonce:crypto.randomUUID()},{cache:'no-store'})
  if(error) fail('회의 자료 받기 실패',error)
  const url=URL.createObjectURL(data),link=document.createElement('a')
  link.href=url;link.download=file.name;link.click()
  window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}
