import type { Profile } from '../supabase/profiles'
import { initialPreview } from './profile-preview'
import { pagePreviewCases, type PagePreviewCase } from './page-preview-cases'

export type PreviewFacts = {
  usageAccess?: 'manager' | 'editor' | 'viewer'
  brandLead?: boolean
  chatRole?: 'all' | 'manager' | 'employee'
  departmentApprover?: boolean
  meetingRole?: 'host' | 'participant' | 'outsider' | 'uploader'
  requestOwner?: 'self' | 'other'
}
export type CompletePreviewCase = PagePreviewCase & { facts?: PreviewFacts }

/** 역할과 신청·회의 관계를 분리하고, 표시 차이가 있는 화면에서만 제공한다. */
export function completePagePreviewCases(pathname: string, real: Profile, search=''): CompletePreviewCase[] {
  const path=pathname.replace(/\/$/,'') || '/', part=new URLSearchParams(search).get('part') ?? ''
  const cases: CompletePreviewCase[]=pagePreviewCases(path,real,search).map(item=>{
    const managing=item.id==='all'||item.id==='manager'
    const facts: PreviewFacts={}
    if (path==='/usage-codes') facts.usageAccess=item.id==='all'?'manager':managing?'editor':'viewer'
    if (path==='/settings/profile' || path==='/work') facts.departmentApprover=managing
    return {...item,facts}
  })
  const add=(id:string,label:string,group:PagePreviewCase['group'],facts:PreviewFacts)=>cases.push({id,label,group,settings:initialPreview(real),facts})
  if (path==='/settings/profile' && part==='approvals') {
    add('request-self','본인 신청','request',{requestOwner:'self'})
    add('request-other','다른 사람 신청','request',{requestOwner:'other'})
  }
  if (path==='/meetings' || (path==='/settings/profile' && part==='meetings')) {
    add('meeting-host','주최자','meeting',{meetingRole:'host'})
    add('meeting-participant','참여자','meeting',{meetingRole:'participant'})
    add('meeting-outsider','비참여자','meeting',{meetingRole:'outsider'})
    add('meeting-uploader','자료 등록자','meeting',{meetingRole:'uploader'})
  }
  // 별도 채팅 창에는 파일 사용량 관리 UI가 없어 전체 관리와 담당자가 같은 화면이다.
  if (!path.startsWith('/chat/room/')) add('chat-all','전체 관리','chat',{chatRole:'all'})
  add('chat-employee','일반','chat',{chatRole:'employee'})
  add('chat-manager','담당자','chat',{chatRole:'manager'})
  return cases
}

/** API 조회 결과를 캐시에 덮어쓰지 않고 화면에만 적용한다. 실제 저장은 원래 권한으로 검사한다. */
export function previewUsageAccess<T extends { canEdit: boolean; canManage: boolean }>(actual: T, mode?: PreviewFacts['usageAccess']): T {
  return mode ? { ...actual, canEdit: mode !== 'viewer', canManage: mode === 'manager' } : actual
}
