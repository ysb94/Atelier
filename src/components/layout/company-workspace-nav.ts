import type { LucideIcon } from 'lucide-react'
import {
  Boxes,
  Building2,
  CalendarDays,
  CalendarRange,
  Camera,
  ChartColumn,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Home,
  Images,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Network,
  Palette,
  PenLine,
  ScanBarcode,
  Settings,
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
  { to: '/operations', label: '운영 현황', icon: ChartColumn },
]

export const companyNavGroups: CompanyNavGroup[] = [
  {
    title: '회사',
    items: [
      { to: '/work', label: '내 업무', icon: ClipboardList },
      { to: '/schedule', label: '일정', icon: CalendarDays },
      { to: '/org-chart', label: '조직도', icon: Network },
    ],
  },
  {
    title: '상품',
    items: [{ to: '/products', label: '전체 상품', icon: Shirt }],
  },
  {
    title: '기획',
    items: [
      { to: '/drafts', label: '기획안', icon: Lightbulb },
      { to: '/product-work/planning', label: '상품 정보', icon: PenLine },
      { to: '/work-requests/planning', label: '작업 요청', icon: ClipboardList },
    ],
  },
  {
    title: '디자인',
    items: [
      { to: '/product-work/design', label: '상품 정보', icon: Palette },
      { to: '/work-requests/design', label: '작업 요청', icon: ClipboardList },
      { to: '/design/color-samples', label: '컬러샘플 촬영', icon: Camera },
      { to: '/design/file-manager', label: '이미지 업로드', icon: Images },
    ],
  },
  {
    title: 'MD',
    items: [
      { to: '/product-work/md', label: '상품 정보', icon: LayoutGrid },
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
      { to: '/logistics/warehouses', label: '창고 관리', icon: Warehouse },
    ],
  },
  {
    title: '중국팀',
    items: [
      { to: '/china/work-orders', label: '작업 지시서', icon: FileText },
    ],
  },
  {
    title: '데이터',
    items: [
      { to: '/data/all', label: '전체 상품', icon: Table2 },
      { to: '/data/upload', label: '일괄 업로드', icon: Upload },
      { to: '/barcodes', label: '88바코드 관리', icon: ScanBarcode },
      { to: '/usage-codes', label: '출고업체별 바코드', icon: Store },
      { to: '/partner-codes', label: '거래처 코드', icon: Building2 },
    ],
  },
  {
    title: '설정',
    items: [
      { to: '/settings/fields', label: '업로드 항목', icon: ListChecks },
      { to: '/settings/seasons', label: '출시 기획', icon: CalendarRange },
      { to: '/settings/usage-targets', label: '출고업체', icon: Store },
      { to: '/settings/ai', label: 'AI 설정', icon: Sparkles },
      { to: '/settings/brand', label: '브랜드 정보', icon: Settings },
      { to: '/settings/profile', label: '내 설정', icon: UserRound },
      { to: '/brands', label: '브랜드 관리', icon: Building2 },
    ],
  },
]

export const membersNavItem: CompanyNavItem = {
  to: '/members',
  label: '멤버·권한',
  icon: Users,
}

export function companyNavItemActive(to: string, pathname: string, end?: boolean) {
  if (end || to === '/') return pathname === '/' || pathname === ''
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function companyGroupIsActive(group: CompanyNavGroup, pathname: string) {
  return group.items.some((item) => companyNavItemActive(item.to, pathname))
}
