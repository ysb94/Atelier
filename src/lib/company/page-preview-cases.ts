import type { Profile } from '../supabase/profiles'
import type { PreviewSettings } from './profile-preview'
import { PERMISSION_CATALOG, type PermissionCode } from './permissions'
import { previewPermissionGrants } from './permission-preview'
import { isWorkRequestOwner, WORK_REQUEST_CONFIG } from '../../features/work-requests/work-request-form-config'
import type { WorkCapability } from './capabilities'

export type PreviewGroup = 'role' | 'request' | 'meeting' | 'chat'
export type PreviewRole = 'all' | 'employee' | 'manager' | 'other-employee' | 'other-manager'
export type PagePreviewCase = { id: string; label: string; group: PreviewGroup; settings: PreviewSettings }
type Screen = { permissions: PermissionCode[]; roles?: PreviewRole[]; departmental?: boolean; departmentName?: string }
const basicRoles: PreviewRole[] = ['all','employee','manager']
const editRoles: PreviewRole[] = ['employee','manager']

/** 현재 화면의 표시 분기만 선택한다. 실제 권한 판정·저장은 변경하지 않는다. */
function screen(path: string, part: string): Screen | null {
  const owner = /^\/work-requests\/([^/]+)$/.exec(path)?.[1]
  if (owner && isWorkRequestOwner(owner)) return { permissions:['work.manage'], departmental:true, departmentName:WORK_REQUEST_CONFIG[owner].teamName }
  if (path==='/') return { permissions:['work.manage','personnel.manage','org.manage','approvers.manage'] }
  if (path==='/work' || path==='/settings/profile') {
    if (part==='department-notice') return { permissions:['notice.department.write','notice.department.delete'], departmental:true }
    if (part==='meetings') return { permissions:['meeting.manage','attendance.manage'] }
    return { permissions:['work.manage','attendance.manage'] }
  }
  if (path==='/members') return { permissions:['personnel.manage'] }
  if (path==='/operations-support') return { permissions:part==='notices'?['notice.company.write']:['company.review'] }
  if (path==='/settings/permissions') return { permissions:['approvers.manage'] }
  if (path==='/brands') return { permissions:['brand.edit'] }
  if (path==='/settings/ai') return { permissions:['ai.manage'], roles:editRoles }
  if (path==='/idea-contest') return { permissions:[], roles:['all','employee'] }
  if (path==='/usage-codes') return { permissions:['partner.edit'] }
  if (path==='/meetings') return { permissions:['meeting.manage'], roles:editRoles }
  if (path==='/org-chart') return { permissions:['org.manage'], roles:editRoles }
  if (path==='/drafts') return { permissions:['drafts.read'], roles:editRoles }
  return null
}

export function pagePreviewCases(pathname: string, real: Profile, search=''): PagePreviewCase[] {
  const path=pathname.replace(/\/$/,'') || '/'
  const config=screen(path,new URLSearchParams(search).get('part') ?? '')
  if (!config) return []
  const departmentName=config.departmentName ?? real.departmentName ?? '디자인팀'
  const roles=config.departmental?['all','employee','manager','other-employee','other-manager'] as const:config.roles ?? basicRoles
  return roles.map(role=>{
    const other=role.startsWith('other-'), manager=role==='manager'||role==='other-manager'
    const codes=role==='all'?PERMISSION_CATALOG.map(([code])=>code):manager?config.permissions:[]
    const label=role==='all'?'전체 관리':`${config.departmental?other?'타부서 · ':'해당 부서 · ':''}${manager?'담당자':'일반'}`
    return { id:role,label,group:'role',settings:{
      departmentId:other?null:real.departmentId, departmentName:other?(departmentName.includes('물류')?'기획팀':'물류팀'):departmentName,
      departmentPersonnelScope:null,position:'사원',jobGrade:'사원',status:'active',isAdmin:false,
      capabilities:codes.filter(code=>code.startsWith('data.')).map(code=>code.slice(5) as WorkCapability),memberships:[],
      permissionGrants:previewPermissionGrants(codes,real.companyId ?? '',role==='all'?null:{id:real.departmentId,name:departmentName}),
    }}
  })
}
