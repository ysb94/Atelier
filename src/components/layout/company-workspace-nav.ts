import { hasPermission } from '../../lib/company/permissions.ts'
import { showAccessIpMenu } from '../../lib/company/access-ip.ts'
import { releaseAccess, releaseHref, type ReleaseProfile } from '../../lib/company/release-access.ts'
import type { LucideIcon } from 'lucide-react'
import {
  canAccessBrandManagement,
  canAccessMamamIdeaInbox,
  canAccessOperationsSupport,
  canViewMembers,
} from '../../lib/company/capabilities.ts'
import {
  Boxes,
  Building2,
  CalendarDays,
  Camera,
  ChartColumn,
  ClipboardList,
  FlaskConical,
  FileSpreadsheet,
  FileText,
  FolderTree,
  Hash,
  Headset,
  Home,
  Images,
  Inbox,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Network,
  PackagePlus,
  PenLine,
  ScanBarcode,
  Search,
  Shirt,
  Sparkles,
  Store,
  Table2,
  Truck,
  Upload,
  UserRound,
  Users,
  Warehouse,
} from 'lucide-react'

export type CompanyNavItem = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export type CompanyNavGroup = {
  title: string
  items: CompanyNavItem[]
}

export const companyTopNav: CompanyNavItem[] = [
  { to: '/', label: 'E&J 홈', icon: Home, end: true },
  { to: '/settings/profile', label: 'My home', icon: UserRound },
  { to: '/operations', label: '운영 현황', icon: ChartColumn },
  { to: '/products', label: '전체 상품', icon: Shirt },
  { to: '/schedule', label: '일정', icon: CalendarDays },
  { to: '/org-chart', label: '조직도', icon: Network },
]

export const companyNavGroups: CompanyNavGroup[] = [
  {
    title: '기획',
    items: [
      { to: '/drafts', label: '기획안', icon: Lightbulb },
      { to: '/work-requests/planning', label: '작업 요청', icon: ClipboardList },
    ],
  },
  {
    title: 'Visual',
    items: [
      { to: '/work-requests/design', label: '작업 요청', icon: ClipboardList },
      { to: '/design/styled-cuts', label: '연출 컷 제작', icon: Camera },
      { to: '/design/file-manager', label: '이미지 업로드', icon: Images },
    ],
  },
  {
    title: 'MD',
    items: [
      { to: '/product-work/md', label: '상품 정보', icon: LayoutGrid },
      { to: '/md/price-compare', label: '가격 비교', icon: ChartColumn },
      { to: '/work-requests/md', label: '작업 요청', icon: ClipboardList },
    ],
  },
  {
    title: '물류',
    items: [
      { to: '/product-work/logistics', label: '상품 정보', icon: Boxes },
      { to: '/work-requests/logistics', label: '작업 요청', icon: ClipboardList },
      { to: '/logistics/invoices', label: '온라인 송장작업', icon: FileSpreadsheet },
      {
        to: '/logistics/barcode-outbound-data-entry',
        label: '(임시) 바코드 출고 데이터입력',
        icon: PenLine,
      },
      { to: '/logistics/bulk-outbound', label: '바코드 출고', icon: Truck },
      { to: '/logistics/finder', label: '창고 파인더', icon: Search },
      { to: '/logistics/warehouses', label: '창고 관리', icon: Warehouse },
      {
        to: '/logistics/temporary-warehouse',
        label: '임시 창고관리',
        icon: FlaskConical,
      },
      { to: '/logistics/cargo-inbound', label: '화물 입고', icon: PackagePlus },
    ],
  },
  {
    title: '중국팀',
    items: [
      { to: '/china/work-orders', label: '작업 지시서', icon: FileText },
    ],
  },
  {
    title: '운영지원',
    items: [
      { to: '/operations-support', label: '운영지원', icon: Headset },
      { to: '/settings/permissions', label: '권한·담당자 설정', icon: Users },
    ],
  },
  {
    title: '데이터',
    items: [
      { to: '/data/all', label: '상품 데이터', icon: Table2 },
      { to: '/data/upload', label: '일괄 업로드', icon: Upload },
      { to: '/barcodes', label: '88바코드 관리', icon: ScanBarcode },
      { to: '/sabangnet-codes', label: '사방넷 코드 관리', icon: Hash },
      { to: '/usage-codes', label: '업체별 코드 관리', icon: Store },
      { to: '/partner-codes', label: '거래처 코드', icon: Building2 },
      {
        to: '/settings/product-categories',
        label: '카테고리 관리',
        icon: FolderTree,
      },
    ],
  },
  {
    title: '설정',
    items: [
      { to: '/settings/access-ip', label: '접속·출근 IP 기록', icon: Network },
      { to: '/settings/fields', label: '업로드 항목', icon: ListChecks },
      { to: '/settings/usage-targets', label: '출고업체', icon: Store },
      { to: '/settings/ai', label: 'AI 설정', icon: Sparkles },
      { to: '/brands', label: '브랜드 관리', icon: Building2 },
    ],
  },
]

export const membersNavItem: CompanyNavItem = {
  to: '/members',
  label: '멤버·권한',
  icon: Users,
}

const mamamInboxGroup: CompanyNavGroup = {
  title: '아이디어 공모전',
  items: [{ to: '/idea-contest', label: '접수 리스트', icon: Inbox }],
}

export function companyNavGroupsForProfile(
  profile: (NonNullable<Parameters<typeof canAccessOperationsSupport>[0]> & ReleaseProfile) | null,
) {
  const scope = releaseAccess(profile)
  const showOperationsSupport = canAccessOperationsSupport(profile) || scope.operations
  const showMembers = canViewMembers(profile) || scope.operations
  const showBrandManagement = canAccessBrandManagement(profile)
  const visibleGroups = companyNavGroups.flatMap((group) => {
    if (group.title !== '운영지원') {
      const items = showBrandManagement
        ? group.items
        : group.items.filter(item => item.to !== '/brands')
      const allowedItems = items.filter(item => (!item.to.startsWith('/work-requests/') || scope.unrestricted || scope.departmentSite?.pages.some(path=>path===item.to) || (scope.logistics && item.to==='/work-requests/logistics')) && releaseHref(profile, item.to) !== null && (item.to !== '/settings/access-ip' || showAccessIpMenu(profile)))
      return allowedItems.length > 0 ? [{ ...group, items: allowedItems }] : []
    }
    const showPermissions = scope.operations || hasPermission(profile, 'permissions.manage') || hasPermission(profile, 'approvers.manage') || hasPermission(profile, 'partner.manage')
    const items = [
      ...group.items.filter(item => releaseHref(profile, item.to) !== null && (item.to !== '/settings/permissions' ? showOperationsSupport : showPermissions)),
      ...(showMembers && releaseHref(profile, membersNavItem.to) !== null ? [membersNavItem] : []),
    ]
    return items.length > 0 ? [{ ...group, items }] : []
  })
  const departmentGroups = !scope.unrestricted && scope.departmentTitle
    && !visibleGroups.some(group => group.title === scope.departmentTitle)
    ? [...visibleGroups, { title: scope.departmentTitle, items: [] }]
    : visibleGroups
  return canAccessMamamIdeaInbox(profile) && scope.unrestricted
    ? [...departmentGroups, mamamInboxGroup]
    : departmentGroups
}

export function companyTopNavForProfile(profile: ReleaseProfile | null) {
  return companyTopNav.filter(item => releaseHref(profile, item.to) !== null)
}

export function companyNavItemActive(to: string, pathname: string, end?: boolean) {
  if (end || to === '/') return pathname === '/' || pathname === ''
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function companyGroupIsActive(group: CompanyNavGroup, pathname: string) {
  return group.items.some((item) => companyNavItemActive(item.to, pathname))
}

/** 사이드바 표시 이름. 부서 이름의 팀·Team은 빼 둔다. */
export function departmentSidebarLabel(name: string) {
  return name.replace(/team/gi, '').replace(/팀/g, '').replace(/\s+/g, ' ').trim()
}

/** 사이드바에 따로 두지 않는 부서. */
const HIDDEN_DEPARTMENT_LABELS = new Set(['운영진'])

/** 이미 같은 이름 메뉴가 있는 부서는 빼고, 화면만 있는 빈 메뉴를 만든다. */
export function missingDepartmentNavGroups(
  departments: { name: string }[],
  groups: CompanyNavGroup[],
): CompanyNavGroup[] {
  const taken = new Set(groups.map((group) => departmentSidebarLabel(group.title).toLocaleLowerCase('ko')))
  const seen = new Set<string>()
  const missing: CompanyNavGroup[] = []
  for (const department of departments) {
    const title = departmentSidebarLabel(department.name)
    const key = title.toLocaleLowerCase('ko')
    if (!title || HIDDEN_DEPARTMENT_LABELS.has(title) || taken.has(key) || seen.has(key)) continue
    seen.add(key)
    missing.push({ title, items: [] })
  }
  return missing
}

export function insertMissingDepartmentGroups(
  groups: CompanyNavGroup[],
  departments: { name: string }[],
) {
  const missing = missingDepartmentNavGroups(departments, groups)
  if (missing.length === 0) return groups
  const index = groups.findIndex((group) => group.title === '데이터')
  if (index < 0) return [...groups, ...missing]
  return [...groups.slice(0, index), ...missing, ...groups.slice(index)]
}
