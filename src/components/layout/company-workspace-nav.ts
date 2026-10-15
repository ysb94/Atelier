import type { LucideIcon } from 'lucide-react'
import { canAccessBrandManagement, canAccessOperationsSupport, canManagePersonnel, isCompanyReviewer } from '../../lib/company/capabilities.ts'
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
  Video,
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
  { to: '/work', label: '내 업무', icon: ClipboardList },
  { to: '/settings/profile', label: '마이페이지', icon: UserRound },
  { to: '/operations', label: '운영 현황', icon: ChartColumn },
  { to: '/products', label: '전체 상품', icon: Shirt },
]

export const companyNavGroups: CompanyNavGroup[] = [
  {
    title: '회사',
    items: [
      { to: '/schedule', label: '일정', icon: CalendarDays },
      { to: '/meetings', label: '회의', icon: Video },
      { to: '/org-chart', label: '조직도', icon: Network },
    ],
  },
  {
    title: '기획',
    items: [
      { to: '/drafts', label: '기획안', icon: Lightbulb },
      { to: '/work-requests/planning', label: '작업 요청', icon: ClipboardList },
    ],
  },
  {
    title: '디자인',
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
      { to: '/logistics/invoices', label: '송장작업', icon: FileSpreadsheet },
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

export function companyNavGroupsForProfile(
  profile: Parameters<typeof canAccessOperationsSupport>[0],
) {
  const showOperationsSupport = canAccessOperationsSupport(profile)
  const showMembers = canManagePersonnel(profile) || isCompanyReviewer(profile)
  const showBrandManagement = canAccessBrandManagement(profile)
  return companyNavGroups.flatMap((group) => {
    if (group.title !== '운영지원') {
      const items = showBrandManagement
        ? group.items
        : group.items.filter(item => item.to !== '/brands')
      return items.length > 0 ? [{ ...group, items }] : []
    }
    const items = [
      ...(showOperationsSupport ? group.items : []),
      ...(showMembers ? [membersNavItem] : []),
    ]
    return items.length > 0 ? [{ ...group, items }] : []
  })
}

export function companyNavItemActive(to: string, pathname: string, end?: boolean) {
  if (end || to === '/') return pathname === '/' || pathname === ''
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function companyGroupIsActive(group: CompanyNavGroup, pathname: string) {
  return group.items.some((item) => companyNavItemActive(item.to, pathname))
}
