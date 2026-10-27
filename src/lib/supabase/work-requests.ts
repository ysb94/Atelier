import { getSupabase } from './client'
import type { WorkRequestRecord, WorkRequestMessage } from '@/features/work-requests/work-request-types'
import type { WorkRequestOwner } from '@/features/work-requests/work-request-form-config'

const BUCKET = 'company-work-requests'
type SavedFile = { id: string; requestId: string; name: string; path: string; type: string; size: number; deleted?: boolean }
export type WorkRequestSnapshot = { requests: WorkRequestRecord[]; files: SavedFile[]; timers: { requestId: string; profileId: string; accumulatedMs: number; mountedAt: string | null }[]; managerAvailable: boolean }
const fileRefs = new WeakMap<File, string>()
const downloads = new Map<string, File>()
let downloadActor: string | null = null
function fail(error: {message: string}): never { console.warn('[work-requests] 업무 저장소 요청 실패',error); throw new Error(error.message) }
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name,args)
  if (error) fail(error)
  return data as T
}
export function comparison(value: unknown) { return JSON.stringify(value,(_key,item: unknown)=>item instanceof File ? {name:item.name,size:item.size,lastModified:item.lastModified,ref:fileRefs.get(item)} : item) }
async function uploadFile(requestId: string, file: File): Promise<{fileRef: string}> {
  const ref=fileRefs.get(file)
  if (ref) return {fileRef:ref}
  if (file.size<1 || file.size>20*1024*1024 || /\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$/i.test(file.name)) throw new Error('20MB 이하의 실행 파일이 아닌 자료만 첨부할 수 있습니다.')
  const pending=await rpc<{id:string;path:string}>('begin_work_request_file',{p_request:requestId,p_name:file.name,p_type:file.type,p_size:file.size})
  try {
    const {error}=await getSupabase().storage.from(BUCKET).upload(pending.path,file,{contentType:file.type||'application/octet-stream',upsert:false})
    if(error)fail(error)
    await rpc('finish_work_request_file',{p_id:pending.id})
  } catch(error) {
    const cleanup=await getSupabase().storage.from(BUCKET).remove([pending.path])
    if(cleanup.error)console.warn('[work-requests] 미완료 업로드 정리 실패',{id:pending.id,error:cleanup.error})
    throw error
  }
  fileRefs.set(file,pending.id)
  return {fileRef:pending.id}
}
async function encode(value: unknown, requestId: string): Promise<unknown> {
  if(value instanceof File)return uploadFile(requestId,value)
  if(Array.isArray(value))return Promise.all(value.map(item=>encode(item,requestId)))
  if(value && typeof value==='object')return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key,item])=>[key,await encode(item,requestId)])))
  return value
}
function decode(value: unknown, files: Map<string,File>): unknown {
  if(Array.isArray(value))return value.map(item=>decode(item,files))
  if(value && typeof value==='object') {
    const object=value as Record<string,unknown>
    if(typeof object.fileRef==='string') { const file=files.get(object.fileRef);if(!file)throw new Error('첨부파일을 확인하지 못했습니다. 다시 조회해 주세요.');return file }
    return Object.fromEntries(Object.entries(object).map(([key,item])=>[key,decode(item,files)]))
  }
  return value
}
export async function listWorkRequests(actorId: string, owner?: WorkRequestOwner): Promise<WorkRequestSnapshot> {
  const snapshot=await rpc<WorkRequestSnapshot | null>('list_work_requests',{p_owner:owner??null})
  if(!snapshot)throw new Error('직원 세션을 확인해 주세요.')
  if(downloadActor!==actorId){downloads.clear();downloadActor=actorId}
  const allFiles=new Map<string,File>()
  const deletedFiles=snapshot.files.filter(file=>file.deleted)
  for(const requestId of new Set(deletedFiles.map(file=>file.requestId))){
    const {error}=await getSupabase().storage.from(BUCKET).remove(deletedFiles.filter(file=>file.requestId===requestId).map(file=>file.path))
    if(error)console.warn('[work-requests] 삭제 첨부 재정리 실패',{requestId,error})
    else try{await rpc('finish_work_request_delete',{p_id:requestId})}catch(error){console.warn('[work-requests] 삭제 기록 정리 실패',{requestId,error})}
  }
  // Hydrate only files referenced by a visible record. Unpublished uploads are never displayed.
  const serialized=JSON.stringify(snapshot.requests)
  for(const meta of snapshot.files) {
    if(!serialized.includes(meta.id))continue
    const key=actorId+':'+meta.id
    let file=downloads.get(key)
    if(!file){const {data,error}=await getSupabase().storage.from(BUCKET).download(meta.path);if(error||!data)fail(error??{message:'첨부파일을 받지 못했습니다.'});file=new File([data],meta.name,{type:meta.type});fileRefs.set(file,meta.id);if(downloadActor===actorId)downloads.set(key,file)}
    allFiles.set(meta.id,file)
  }
  snapshot.requests=snapshot.requests.map(raw=>({brandDecidedAt:'',brandDecidedBy:'',managerPriority:'',assignee:'',assignedBy:'',assignedAt:'',collaborators:[],confirmedDueDate:'',plannedStart:'',plannedEnd:'',completedAt:'',completionRequestedAt:'',completionRejectCount:0,...decode(raw,allFiles) as Partial<WorkRequestRecord>}) as WorkRequestRecord)
  return snapshot
}
const PATCH_FIELDS = ['values','brandId','status','managerPriority','assignee','collaborators','confirmedDueDate','plannedStart','plannedEnd','completionResult'] as const
export async function saveWorkRequestChange(before: WorkRequestRecord | undefined, next: WorkRequestRecord, revision?: number): Promise<number> {
  let expected=revision??before?.revision??1
  if(!before)expected=await rpc<number>('begin_work_request',{p_id:next.id,p_owner:next.owner})
  const patch: Record<string,unknown>={}
  for(const key of PATCH_FIELDS)if((before ? comparison(before[key])!==comparison(next[key]) : ['values','brandId','status'].includes(key)) && next[key]!==undefined)patch[key]=await encode(next[key],next.id)
  if(Object.keys(patch).length)expected=await rpc<number>('save_work_request',{p_id:next.id,p_revision:expected,p_patch:patch,p_command:crypto.randomUUID()})
  for(const message of next.messages)if(!before?.messages.some(item=>item.id===message.id))await sendWorkRequestMessage(next.id,message)
  return expected
}
export async function sendWorkRequestMessage(requestId: string,message: WorkRequestMessage) { return rpc('send_work_request_message',{p_id:requestId,p_room:message.roomId,p_body:message.body,p_command:message.id}) }
export async function deleteWorkRequest(request: WorkRequestRecord, revision?: number) {
  const paths=await rpc<string[]>('delete_work_request',{p_id:request.id,p_revision:revision??request.revision})
  if(paths.length){const {error}=await getSupabase().storage.from(BUCKET).remove(paths);if(error){console.warn('[work-requests] 삭제 첨부 정리 실패',{requestId:request.id,error});throw new Error('요청은 삭제되었습니다. 첨부 정리는 다음 조회 때 다시 시도합니다.')}await rpc('finish_work_request_delete',{p_id:request.id})}
}
export async function setActiveWorkRequest(requestId: string | null) { return rpc('set_active_work_request',{p_id:requestId}) }
