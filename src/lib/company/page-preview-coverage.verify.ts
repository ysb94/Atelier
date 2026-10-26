import assert from 'node:assert/strict'
import { completePagePreviewCases, previewUsageAccess } from './page-preview-coverage'
import { previewProfile } from './profile-preview'
import { hasPermission } from './permissions'
import { canManagePersonnel, canEditOrgAssignment, canAccessOperationsSupport, canAccessBrandManagement, canAccessMamamIdeaInbox } from './capabilities'
import { previewRequestIsSelf, previewMeetingActor } from './relationship-preview'
import { canDeleteMeetingSeries, filterSeriesForViewer, type MeetingSeries } from '../../features/meetings/meeting-schedule'
import type { Profile } from '../supabase/profiles'
const real={companyId:'company',id:'developer',email:'dev@atelier.local',status:'active',isAdmin:true,departmentId:'design',departmentName:'디자인팀',capabilities:[],memberships:[],permissionGrants:[]} as unknown as Profile
const snapshot=JSON.stringify(real)
const cases=(path:string,search='')=>completePagePreviewCases(path,real,search)
function profile(path:string,id:string){const item=cases(path).find(item=>item.id===id)!;assert.ok(item);return previewProfile(real,item.settings)}
for(const path of ['/','/members','/settings/profile','/work','/drafts','/operations-support','/brands','/settings/ai','/idea-contest','/usage-codes','/chat/room/test']){
 const items=cases(path)
 assert.equal(new Set(items.map(item=>item.id)).size,items.length)
 assert.ok(items.filter(item=>item.group==='role').length<=4)
 assert.ok(items.every(item=>item.settings.status==='active'))
 assert.ok(items.filter(item=>item.group==='role').every(item=>!item.facts?.requestOwner&&!item.facts?.meetingRole&&!item.facts?.chatRole))
}
for(const [id,manage,org] of [['all',true,true],['manager',true,false],['employee',false,false]] as const){assert.equal(canManagePersonnel(profile('/members',id)),manage);assert.equal(canEditOrgAssignment(profile('/members',id)),org)}
assert.equal(canAccessOperationsSupport(profile('/operations-support','manager')),true)
assert.equal(canEditOrgAssignment(profile('/operations-support','manager')),false)
assert.equal(canAccessOperationsSupport(profile('/operations-support','employee')),false)
assert.equal(canAccessBrandManagement(profile('/brands','manager')),true)
assert.equal(hasPermission(profile('/brands','manager'),'brand.manage'),false)
assert.equal(canAccessBrandManagement(profile('/brands','employee')),false)
assert.equal(canAccessMamamIdeaInbox(profile('/idea-contest','all')),true)
assert.equal(canAccessMamamIdeaInbox(profile('/idea-contest','employee')),false)
assert.equal(hasPermission(profile('/settings/ai','manager'),'ai.manage'),true)
assert.equal(hasPermission(profile('/settings/ai','employee'),'ai.manage'),false)
assert.equal(cases('/settings/profile','?part=work').filter(item=>item.group==='request'||item.group==='meeting').length,0)
assert.deepEqual(cases('/settings/profile','?part=approvals').filter(item=>item.group==='request').map(item=>item.label),['본인 신청','다른 사람 신청'])
assert.equal(cases('/operations-support','?part=leave').filter(item=>item.group==='request').length,0,'조회 전용 연차관리에는 승인 관계 선택 없음')
assert.equal(cases('/settings/profile','?part=meetings').filter(item=>item.group==='meeting').length,4)
assert.equal(cases('/settings/profile','?part=approvals').filter(item=>item.group==='meeting').length,0)
assert.equal(cases('/chat/room/test').filter(item=>item.group==='chat').length,2,'별도 채팅 창은 같은 화면인 전체 관리 버튼을 중복 표시하지 않음')
assert.equal(cases('/').filter(item=>item.group==='chat').length,3)
const actual=Object.freeze({canEdit:false,canManage:false})
assert.equal(previewUsageAccess(actual),actual)
assert.deepEqual(cases('/usage-codes').filter(item=>item.group==='role').map(item=>{const p=previewUsageAccess(actual,item.facts?.usageAccess);return [p.canEdit,p.canManage]}),[[true,true],[false,false],[true,false]])
const host={id:'host',name:'주최자'},member={id:'member',name:'참여자'}
const series=[{host,members:[member],rounds:[{prepMaterials:[]}]}] as unknown as MeetingSeries[]
assert.equal(canDeleteMeetingSeries(series[0],previewMeetingActor(host,series,'host')),true)
assert.equal(filterSeriesForViewer(series,previewMeetingActor(host,series,'outsider'),false).length,0)
assert.deepEqual([previewRequestIsSelf(false,'self'),previewRequestIsSelf(true,'other'),previewRequestIsSelf(true)],[true,false,true])
assert.equal(JSON.stringify(real),snapshot)
console.log('page-preview-coverage: 기능별 표시 차이·신청/회의 관계 분리·채팅 범위·실제 권한/데이터 보존 통과')
