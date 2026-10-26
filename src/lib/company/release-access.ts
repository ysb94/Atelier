/** 1차 직원 공개 범위. 실제 조회·수정·승인 권한을 부여하는 규칙이 아니다. */
export type ReleaseProfile = {
  id?: string | null; companyId?: string | null; departmentId?: string | null
  status?: string | null; email?: string | null; departmentName?: string | null
}
export const RELEASE_COMPANY_ID = 'e0000000-0000-4000-8000-000000000001'
export const RELEASE_OPERATIONS_ID = '2e49ef43-75b9-4c89-b42d-9fd50ad9087b'
export const RELEASE_LOGISTICS_ID = 'c5d4cfca-97ce-4ca7-b30a-6beed842cf1e'
/** 실제 부서 UUID로 화면을 연결한다. 부서 이름은 빈 탭의 표시 용도로만 쓴다. */
export const RELEASE_DEPARTMENT_SITES = [
  { id: 'ced99f89-ea80-4eeb-8f03-272bf72f5db1', title: '기획', pages: ['/drafts', '/work-requests/planning'] },
  { id: '919b2c44-afb6-4d7e-a5b8-b7203df9cef9', title: 'MD', pages: ['/product-work/md', '/md/price-compare', '/work-requests/md'] },
  { id: 'bf926822-910c-422f-9c17-5fd3d8ddb3ba', title: '중국팀', pages: ['/china/work-orders'] },
  { id: RELEASE_OPERATIONS_ID, title: '운영지원', pages: [] },
  { id: RELEASE_LOGISTICS_ID, title: '물류', pages: [] },
] as const
export const RELEASE_EXCEPTION_IDS = [
  'd0000000-0000-4000-8000-000000000001', // 개발자
  'a5afdd00-4a61-44dc-a1a3-082fa8a1345d', // 윤설빈
  '56074867-fdc2-4ce5-8e97-cea431decc36', // 김준영
] as const
export const RELEASE_HOME = '/settings/profile'
export const RELEASE_LOGISTICS_PAGES = [
  '/product-work/logistics', '/work-requests/logistics', '/logistics/invoices',
  '/logistics/barcode-outbound-data-entry', '/logistics/bulk-outbound', '/logistics/finder',
  '/logistics/warehouses', '/logistics/temporary-warehouse', '/logistics/cargo-inbound',
] as const

export function releaseAccess(profile: ReleaseProfile | null | undefined) {
  const active = profile?.status === 'active' && profile.companyId === RELEASE_COMPANY_ID
  const site = active ? RELEASE_DEPARTMENT_SITES.find(site => site.id === profile.departmentId) : undefined
  const departmentTitle = active && profile.departmentId
    ? site?.title ?? profile.departmentName?.replace(/team/gi, '').replace(/팀/g, '').replace(/\s+/g, ' ').trim() ?? null
    : null
  return {
    unrestricted: Boolean(active && profile.email !== 'ui-preview@example.invalid' && RELEASE_EXCEPTION_IDS.some(id => id === profile.id)),
    operations: Boolean(active && profile.departmentId === RELEASE_OPERATIONS_ID),
    logistics: Boolean(active && profile.departmentId === RELEASE_LOGISTICS_ID),
    departmentTitle,
    departmentSite: site ?? null,
  }
}
export function releasePersonalPart(profile: ReleaseProfile | null | undefined, part: string | null, approver = false) {
  return releaseAccess(profile).unrestricted || !part || part === 'my-attendance' || part === 'overtime' || part === 'meetings' || (part === 'approvals' && approver)
}
const under = (path: string, root: string) => path === root || path.startsWith(root + '/')

/** 미공개는 null. 기존 상세 링크는 비공개 부모 화면을 열지 않고 공개 경로로 연결한다. */
export function releaseHref(profile: ReleaseProfile | null | undefined, href: string, approver = false): string | null {
  let url: URL
  try { url = new URL(href, 'https://atelier.invalid') } catch { return null /* 잘못된 링크는 화면 진입 경로로 취급하지 않는다. */ }
  if (url.origin !== 'https://atelier.invalid' || !href.startsWith('/') || href.startsWith('//')) return null
  const scope = releaseAccess(profile)
  if (scope.unrestricted) return href
  const path = url.pathname.replace(/\/$/, '') || '/'
  if (path === RELEASE_HOME) return releasePersonalPart(profile, url.searchParams.get('part'), approver) ? href : null
  if (/^\/chat\/room\/[^/]+$/.test(path)) return href
  if (path === '/meetings') { url.pathname = RELEASE_HOME; url.searchParams.set('part', 'meetings'); return url.pathname + url.search }
  if (scope.operations && ['/operations-support', '/members', '/settings/permissions'].includes(path)) return href
  if (scope.operations && path === '/org-chart') return '/operations-support?part=org'
  if (scope.departmentSite?.pages.some(root => under(path, root))) return href
  if (scope.departmentSite?.title === 'MD') {
    if (path === '/md') return '/product-work/md' + url.search
    if (/^\/products\/[^/]+\/[^/]+$/.test(path)) return path.replace('/products/', '/product-work/md/') + url.search
  }
  if (scope.logistics) {
    if (RELEASE_LOGISTICS_PAGES.some(root => under(path, root))) return href
    if (path === '/logistics') return '/product-work/logistics' + url.search
    if (path === '/logistics/invoice-data-entry') return '/logistics/invoices' + url.search
    if (/^\/products\/[^/]+\/[^/]+$/.test(path)) return path.replace('/products/', '/product-work/logistics/') + url.search
  }
  return null
}
