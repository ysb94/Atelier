import assert from 'node:assert/strict'
import type { Profile } from '../supabase/profiles'
import { canPreviewProfile, initialPreview, previewDepartment, previewProfile } from './profile-preview'
import { canEditOrgAssignment, canManagePersonnel, canViewDraftsByOwner } from './capabilities'
const real = { id:'same-user',email:'staff@invalid',status:'active',companyId:'company',position:'사원',isAdmin:false,capabilities:[],memberships:[],permissionGrants:[{permission:'preview.use',scopeKind:'company',scopeId:'company'}] } as unknown as Profile
for (const position of ['사원','팀장','이사','대표이사']) assert.equal(canPreviewProfile({...real,position},real.email),true)
assert.equal(canPreviewProfile({...real,permissionGrants:[],isAdmin:true,email:'dev@atelier.local',position:'대표이사'},'dev@atelier.local'),false,'이메일·대표·관리자 예외 금지')
assert.equal(canPreviewProfile(real,'different@invalid'),false)
assert.equal(canPreviewProfile({...real,status:'disabled'},real.email),false)
const settings = initialPreview(real)
settings.permissionGrants=[]
const displayed=previewProfile(real,{...settings,...previewDepartment({id:'ops',name:'운영지원팀',personnelScope:'leaders'} as never),position:'팀장'})
assert.equal(displayed.id,real.id)
assert.equal(canEditOrgAssignment(displayed),false)
assert.equal(canManagePersonnel(displayed),false)
assert.equal(canViewDraftsByOwner(displayed),false)
assert.equal(real.permissionGrants!.length,1,'실제 프로필 지정 내역 보존')
console.log('profile-preview: 지정된 화면 테스트 권한·동일 세션·직책 독립·표시 격리 통과')
