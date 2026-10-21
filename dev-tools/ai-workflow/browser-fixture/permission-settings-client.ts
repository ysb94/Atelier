const company = 'e0000000-0000-4000-8000-000000000001'
const original = [{ id:'self-manage',profileId:'fixture-user',permission:'permissions.manage',scopeKind:'company',scopeId:company }, { id:'old-assignment',profileId:'other-user',permission:'work.manage',scopeKind:'department',scopeId:'dept-logistics' }]
let grants = structuredClone(original), revision = 1
const audit: Record<string,unknown>[] = []
Object.assign(window,{ __permissionsFixture: { audit, original, grants: () => structuredClone(grants), conflict: () => { revision++ } } })
export function permissionFixtureRpc(name: string,args?: Record<string,unknown>) {
  if (!['permission_directory','set_permission_grant'].includes(name)) return undefined
  const failure = (message: string) => Promise.resolve({data:null,error:{message}})
  if (location.search.includes('identity=employee')) return failure('권한 지정 관리 권한이 필요합니다.')
  if (name === 'permission_directory') {
    if (location.search.includes('permissions-error')) return failure('권한 지정 내역 조회 실패')
    if (location.search.includes('identity=partner')) return Promise.resolve({error:null,data:{revision:String(revision),profiles:[{id:'fixture-user',name:'업체 담당',department:'디자인팀',status:'active'},{id:'other-user',name:'검증 직원',department:'물류팀',status:'active'}],scopes:[{kind:'partner',id:'partner-a',name:'검증 업체'}],grants:structuredClone(grants.filter(grant=>grant.permission==='partner.edit'))}})
    return Promise.resolve({error:null,data:{revision:String(revision),profiles:[{id:'fixture-user',name:'화면 검수',department:'디자인팀',position:'사원',status:'active'},{id:'other-user',name:'검증 직원',department:'물류팀',position:'사원',status:'active'}],scopes:[{kind:'company',id:company,name:'회사 전체'},{kind:'department',id:'dept-design',name:'디자인팀'},{kind:'department',id:'dept-logistics',name:'물류팀'}],grants:structuredClone(grants)}})
  }
  if (name === 'set_permission_grant' && args) {
    if (args.p_profile === 'fixture-user') return failure('본인 권한 변경 불가')
    if (args.p_revision !== String(revision)) return failure('다른 관리자가 지정 내역을 변경했습니다. 새로 불러온 뒤 확인해 주세요.')
    const matches = (grant: typeof grants[number]) => grant.profileId === args.p_profile && grant.permission === args.p_permission && grant.scopeKind === args.p_scope_kind && grant.scopeId === args.p_scope
    if (args.p_enabled && !grants.some(matches)) grants.push({id:'new-'+revision,profileId:String(args.p_profile),permission:String(args.p_permission),scopeKind:String(args.p_scope_kind),scopeId:String(args.p_scope)})
    if (!args.p_enabled) grants=grants.filter(grant=>!matches(grant))
    audit.push({...args}); revision++
    return Promise.resolve({error:null,data:null})
  }
  return undefined
}
