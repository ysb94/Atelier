import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  NavLink,
  useParams,
  Navigate,
  Link,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import {
  Boxes,
  Building2,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  FileSpreadsheet,
  Home,
  Images,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  LogOut,
  Package,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  ChevronLeft,
  ScanBarcode,
  Settings,
  Sparkles,
  Shirt,
  Store,
  Table2,
  Upload,
  UserRound,
  Users,
  Network,
  Warehouse,
} from 'lucide-react'
import { getBrandBySlug, getBrands } from '@/lib/api'
import { useAuth } from '@/lib/supabase/auth'
import { cn } from '@/lib/utils'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { BrandContext } from './brand-context'
import {
  WorkspaceTabBar,
  WorkspaceTabPanels,
  useWorkspaceTabs,
} from './workspace-tabs'

type NavItem = { to: string; label: string; icon: typeof Shirt }

const homeNavItem: NavItem = {
  to: '',
  label: '홈',
  icon: Home,
}

const profileNavItem: NavItem = {
  to: 'settings/profile',
  label: '내 설정',
  icon: UserRound,
}

const orgNavItem: NavItem = {
  to: 'org-chart',
  label: '조직도',
  icon: Network,
}

const topNavItems: NavItem[] = [homeNavItem, profileNavItem, orgNavItem]

const SIDEBAR_COLLAPSED_KEY = 'atelier:sidebar-collapsed'

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: '상품',
    items: [{ to: 'products', label: '전체 상품', icon: Shirt }],
  },
  {
    title: '기획',
    items: [
      { to: 'drafts', label: '기획안', icon: Lightbulb },
      { to: 'work/planning', label: '상품 정보', icon: PenLine },
      { to: 'work-requests/planning', label: '작업 요청', icon: ClipboardList },
    ],
  },
  {
    title: '디자인',
    items: [
      { to: 'work/design', label: '상품 정보', icon: Palette },
      { to: 'design/file-manager', label: '이미지 업로드', icon: Images },
      { to: 'work-requests/design', label: '작업 요청', icon: ClipboardList },
    ],
  },
  {
    title: 'MD',
    items: [
      { to: 'work/md', label: '상품 정보', icon: LayoutGrid },
      { to: 'work-requests/md', label: '작업 요청', icon: ClipboardList },
    ],
  },
  {
    title: '물류',
    items: [
      { to: 'work/logistics', label: '상품 정보', icon: Boxes },
      {
        to: 'logistics/invoices',
        label: '송장작업',
        icon: FileSpreadsheet,
      },
      {
        to: 'logistics/warehouses',
        label: '창고 관리',
        icon: Warehouse,
      },
      { to: 'work-requests/logistics', label: '작업 요청', icon: ClipboardList },
    ],
  },
  {
    title: '데이터',
    items: [
      { to: 'data/all', label: '전체 상품', icon: Table2 },
      { to: 'data/upload', label: '일괄 업로드', icon: Upload },
      { to: 'barcodes', label: '자사 바코드', icon: ScanBarcode },
      { to: 'usage-codes', label: '출고업체별 바코드', icon: Store },
      { to: 'partner-codes', label: '거래처 코드', icon: Building2 },
    ],
  },
  {
    title: '설정',
    items: [
      { to: 'settings/fields', label: '업로드 항목', icon: ListChecks },
      { to: 'settings/seasons', label: '출시 기획', icon: CalendarRange },
      { to: 'settings/usage-targets', label: '출고업체', icon: Store },
      { to: 'settings/members', label: '멤버', icon: Users },
      { to: 'settings/ai', label: 'AI 설정', icon: Sparkles },
      { to: 'settings/brand', label: '브랜드 정보', icon: Settings },
    ],
  },
]

const flatNavItems = navGroups.flatMap((group) =>
  group.items.map((item) => ({
    ...item,
    group: group.title,
    tip:
      group.title === item.label
        ? item.label
        : `${group.title} · ${item.label}`,
  })),
)

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function groupIsActive(
  group: { items: NavItem[] },
  pathname: string,
  brandSlug: string,
) {
  const prefix = `/b/${brandSlug}`
  return group.items.some((item) => {
    const href = item.to ? `${prefix}/${item.to}` : prefix
    if (!item.to) {
      return pathname === href || pathname === `${href}/`
    }
    return pathname === href || pathname.startsWith(`${href}/`)
  })
}

function navItemActive(
  to: string,
  pathname: string,
  brandSlug: string,
): boolean {
  const href = to ? `/b/${brandSlug}/${to}` : `/b/${brandSlug}`
  if (!to) {
    return pathname === href || pathname === `${href}/`
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function BrandLayout() {
  const { brandSlug = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // 기본은 전부 접힘. 현재 경로가 속한 그룹만 자동으로 연다.
  const [openTitles, setOpenTitles] = useState<Set<string>>(() => new Set())
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const { email, profile, signOut } = useAuth()
  const brandQuery = useQuery({
    queryKey: ['brand', brandSlug],
    queryFn: () => getBrandBySlug(brandSlug),
    enabled: Boolean(brandSlug),
  })
  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: getBrands,
  })

  const { tabs, activeId, openTab, closeTab } = useWorkspaceTabs(brandSlug)

  useEffect(() => {
    const active = navGroups.find((group) =>
      groupIsActive(group, location.pathname, brandSlug),
    )
    if (!active) return
    setOpenTitles((prev) => {
      if (prev.has(active.title)) return prev
      const next = new Set(prev)
      next.add(active.title)
      return next
    })
  }, [location.pathname, brandSlug])

  if (brandQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        작업장을 불러오는 중...
      </div>
    )
  }

  if (!brandQuery.data) {
    return <Navigate to="/" replace />
  }

  const brand = brandQuery.data
  const brands = brandsQuery.data ?? []

  function toggleGroup(title: string) {
    setOpenTitles((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  return (
    <BrandContext.Provider value={{ brand, brandSlug }}>
      <div className="flex h-full min-h-0">
        <aside
          className={cn(
            'flex shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200',
            collapsed ? 'w-14' : 'w-60',
          )}
        >
          <div
            className={cn(
              'border-b border-white/10',
              collapsed ? 'px-2 py-3' : 'px-4 py-4',
            )}
          >
            {!collapsed ? (
              <Link
                to="/"
                className="mb-3 inline-flex items-center gap-1 text-xs text-white/50 hover:text-white/80"
              >
                <ChevronLeft className="size-3.5" />
                브랜드 선택
              </Link>
            ) : null}
            <div
              className={cn(
                'flex items-center',
                collapsed ? 'flex-col gap-2' : 'justify-between gap-2',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  if (collapsed) toggleCollapsed()
                }}
                className={cn(
                  'flex min-w-0 items-center gap-3 text-left',
                  collapsed && 'justify-center',
                )}
                title={collapsed ? `${brand.name} · 사이드바 펼치기` : undefined}
              >
                <BrandAvatar
                  brand={brand}
                  className={cn(
                    'shrink-0 rounded-lg',
                    collapsed ? 'size-8' : 'size-9',
                  )}
                  textClassName="text-xs"
                />
                {!collapsed ? (
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {brand.name}
                    </div>
                    <div className="truncate text-xs text-white/50">
                      {brand.nameKo} · est. {brand.foundedYear}
                    </div>
                  </div>
                ) : null}
              </button>
              <button
                type="button"
                onClick={toggleCollapsed}
                className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-sidebar-muted hover:text-white"
                aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
                title={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
            </div>
          </div>

          {!collapsed && brands.length > 1 ? (
            <div className="border-b border-white/10 px-3 py-3">
              <label className="mb-1.5 block px-1 text-[10px] font-medium uppercase tracking-wider text-white/40">
                브랜드 전환
              </label>
              <select
                className="w-full rounded-md border border-white/10 bg-sidebar-muted px-2 py-1.5 text-sm text-white outline-none"
                value={brand.slug}
                onChange={(e) => {
                  const next = e.target.value
                  if (next === brand.slug) return
                  navigate(`/b/${next}`)
                }}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.slug}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <nav className="flex flex-1 flex-col overflow-y-auto p-2">
            <div className="mb-2 flex flex-col gap-0.5">
              {topNavItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to || 'home'}
                  to={to ? `/b/${brand.slug}/${to}` : `/b/${brand.slug}`}
                  end={!to}
                  title={collapsed ? label : undefined}
                  className={() =>
                    cn(
                      'flex items-center rounded-md transition-colors',
                      collapsed
                        ? 'justify-center p-2.5'
                        : 'gap-2.5 px-2.5 py-2 text-sm',
                      navItemActive(to, location.pathname, brand.slug)
                        ? 'bg-sidebar-accent text-white'
                        : 'text-white/65 hover:bg-sidebar-muted hover:text-white',
                    )
                  }
                >
                  <Icon
                    className="size-4 shrink-0"
                    aria-label={collapsed ? label : undefined}
                  />
                  {collapsed ? null : label}
                </NavLink>
              ))}
            </div>
            {collapsed
              ? flatNavItems.map(({ to, label, icon: Icon, tip }) => (
                  <NavLink
                    key={`${tip}-${to || 'home'}`}
                    to={to ? `/b/${brand.slug}/${to}` : `/b/${brand.slug}`}
                    end={!to}
                    title={tip}
                    className={() =>
                      cn(
                        'mb-0.5 flex items-center justify-center rounded-md p-2.5 transition-colors',
                        navItemActive(to, location.pathname, brand.slug)
                          ? 'bg-sidebar-accent text-white'
                          : 'text-white/65 hover:bg-sidebar-muted hover:text-white',
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" aria-label={label} />
                  </NavLink>
                ))
              : navGroups.map((group, groupIndex) => {
                  const open = openTitles.has(group.title)
                  const active = groupIsActive(
                    group,
                    location.pathname,
                    brand.slug,
                  )
                  return (
                    <div
                      key={group.title}
                      className={cn(
                        'flex flex-col gap-0.5',
                        groupIndex > 0 && 'mt-2',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.title)}
                        aria-expanded={open}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider transition-colors',
                          active
                            ? 'text-white/70 hover:bg-sidebar-muted hover:text-white/90'
                            : 'text-white/40 hover:bg-sidebar-muted hover:text-white/70',
                        )}
                      >
                        {group.title}
                        <ChevronDown
                          className={cn(
                            'size-3.5 shrink-0 transition-transform',
                            open ? 'rotate-0' : '-rotate-90',
                          )}
                        />
                      </button>
                      {open
                        ? group.items.map(({ to, label, icon: Icon }) => (
                            <NavLink
                              key={to || 'home'}
                              to={
                                to
                                  ? `/b/${brand.slug}/${to}`
                                  : `/b/${brand.slug}`
                              }
                              end={!to}
                              className={() =>
                                cn(
                                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                                  navItemActive(
                                    to,
                                    location.pathname,
                                    brand.slug,
                                  )
                                    ? 'bg-sidebar-accent text-white'
                                    : 'text-white/65 hover:bg-sidebar-muted hover:text-white',
                                )
                              }
                            >
                              <Icon className="size-4 shrink-0" />
                              {label}
                            </NavLink>
                          ))
                        : null}
                    </div>
                  )
                })}
          </nav>

          {!collapsed ? (
            <div className="border-t border-white/10 px-4 py-3 text-xs text-white/40">
              <div className="flex items-center gap-2">
                <Package className="size-3.5" />
                Atelier Workspace
              </div>
              {profile?.displayName || email ? (
                <div
                  className="mt-2 truncate text-white/50"
                  title={email ?? undefined}
                >
                  {profile?.displayName || email}
                  {profile?.position ? ` · ${profile.position}` : ''}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-2 flex items-center gap-2 rounded-md px-1 py-1 text-white/50 transition-colors hover:bg-sidebar-muted hover:text-white"
              >
                <LogOut className="size-3.5" />
                로그아웃
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 border-t border-white/10 py-3 text-white/40">
              <Package className="size-3.5" />
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-sidebar-muted hover:text-white"
                aria-label="로그아웃"
                title="로그아웃"
              >
                <LogOut className="size-3.5" />
              </button>
            </div>
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceTabBar
            tabs={tabs}
            activeId={activeId}
            onOpen={openTab}
            onClose={closeTab}
          />
          {(() => {
            const pageLayout = location.pathname.includes('/design/file-manager')
              ? 'full'
              : location.pathname.includes('/logistics/invoices') ||
                  location.pathname.includes('/logistics/warehouses')
                ? 'wide'
                : 'default'
            return (
              <div
                className={cn(
                  'min-h-0 flex-1',
                  pageLayout === 'full' ? 'overflow-hidden' : 'overflow-auto',
                )}
              >
                <div
                  className={cn(
                    pageLayout === 'full' && 'h-full min-h-0',
                    pageLayout === 'wide' && 'w-full px-4 py-5 md:px-6 md:py-6',
                    pageLayout === 'default' &&
                      'mx-auto max-w-[1600px] p-6 md:p-8',
                  )}
                >
                  <WorkspaceTabPanels tabs={tabs} activeId={activeId} />
                </div>
              </div>
            )
          })()}
        </main>
      </div>
    </BrandContext.Provider>
  )
}
