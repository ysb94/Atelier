/** 1차 직원 공개 범위. 실제 조회·수정·승인 권한을 부여하는 규칙이 아니다. */
export type ReleaseProfile = {
  id?: string | null; companyId?: string | null; departmentId?: string | null
  status?: string | null; email?: string | null
}
export const RELEASE_COMPANY_ID = 'e0000000-0000-4000-8000-000000000001'
export const RELEASE_OPERATIONS_ID = '2e49ef43-75b9-4c89-b42d-9fd50ad9087b'
export const RELEASE_LOGISTICS_ID = 'c5d4cfca-97ce-4ca7-b30a-6beed842cf1e'
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
  return {
    unrestricted: Boolean(active && profile.email !== 'ui-preview@example.invalid' && RELEASE_EXCEPTION_IDS.some(id => id === profile.id)),
    operations: Boolean(active && profile.departmentId === RELEASE_OPERATIONS_ID),
    logistics: Boolean(active && profile.departmentId === RELEASE_LOGISTICS_ID),
  }
}
export function releasePersonalPart(profile: ReleaseProfile | null | undefined, part: string | null, approver = false) {
  return releaseAccess(profile).unrestricted || !part || part === 'my-attendance' || part === 'meetings' || (part === 'approvals' && approver)
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
  if (scope.logistics) {
    if (RELEASE_LOGISTICS_PAGES.some(root => under(path, root))) return href
    if (path === '/logistics') return '/product-work/logistics' + url.search
    if (path === '/logistics/invoice-data-entry') return '/logistics/invoices' + url.search
    if (/^\/products\/[^/]+\/[^/]+$/.test(path)) return path.replace('/products/', '/product-work/logistics/') + url.search
  }
  return null
}
