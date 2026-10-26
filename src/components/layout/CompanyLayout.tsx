import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Building2,
  ChevronDown,
  LogOut,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react'
import { CompanyAiAssistant } from '@/components/ai/CompanyAiAssistant'
import { useAuth } from '@/lib/supabase/auth'
import { useNavigationPreviewProfile } from '@/lib/company/developer-preview-context'
import { cn, emptyList } from '@/lib/utils'
import { RELEASE_HOME } from '@/lib/company/release-access'
import { listDepartments, type Department } from '@/lib/supabase/profiles'
import { ReleaseAccessProvider, useReleaseAccess } from './release-access-context'
import { ReleasePageGate } from './ReleasePageGate'
import {
  companyGroupIsActive,
  companyNavGroupsForProfile,
  companyNavItemActive,
  companyTopNavForProfile,
  insertMissingDepartmentGroups,
  type CompanyNavItem,
} from './company-workspace-nav'
import { WorkspaceHeaderActions } from './WorkspaceHeaderActions'
import { DeveloperPreviewBar, DeveloperPreviewProvider } from './DeveloperPreview'
import {
  WorkspaceTabBar,
  WorkspaceTabPanels,
  useWorkspaceTabs,
} from './workspace-tabs'

const SIDEBAR_COLLAPSED_KEY = 'atelier:sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function pageLayoutFor(pathname: string) {
  if (pathname.includes('/design/file-manager') || pathname.includes('/design/styled-cuts')) return 'full' as const
  if (
    pathname === '/drafts' ||
    /\/drafts\/all\/?$/.test(pathname) ||
    /\/drafts\/season\/[^/]+\/?$/.test(pathname)
  ) {
    return 'wide' as const
  }
  if (
    pathname.includes('/logistics/invoices') ||
    pathname.includes('/logistics/barcode-outbound-data-entry') ||
    pathname.includes('/logistics/bulk-outbound') ||
    pathname.includes('/logistics/finder') ||
    pathname.includes('/logistics/warehouses') ||
    pathname.includes('/logistics/temporary-warehouse') ||
    pathname.includes('/logistics/cargo-inbound')
  ) {
    return 'wide' as const
  }
  return 'default' as const
}

export function CompanyLayout() {
  return (
    <DeveloperPreviewProvider>
      <ReleaseAccessProvider><CompanyReleasedLayout /></ReleaseAccessProvider>
    </DeveloperPreviewProvider>
  )
}

function CompanyReleasedLayout() {
  const { scope } = useReleaseAccess()
  return (
    <div className="flex h-full min-h-0">
      <CompanySidebar />
      <CompanyWorkspaceMain />
      {scope.unrestricted && <CompanyAiAssistant />}
    </div>
  )
}

function CompanySidebar() {
  const location = useLocation()
  const { email, profile, signOut } = useAuth()
  const { scope } = useReleaseAccess()
  const navigationProfile = useNavigationPreviewProfile(profile)
  const companyTopNav = useMemo(() => companyTopNavForProfile(navigationProfile), [navigationProfile])
  const [openTitles, setOpenTitles] = useState<Set<string>>(() => new Set())
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
    enabled: scope.unrestricted,
  })
  useEffect(() => {
    if (departmentsQuery.error) console.warn('[sidebar] 부서 목록 조회 실패', departmentsQuery.error)
  }, [departmentsQuery.error])
  const departments = departmentsQuery.data ?? emptyList<Department>()
  const navGroups = useMemo(() => {
    const groups = companyNavGroupsForProfile(navigationProfile)
    if (!scope.unrestricted) return groups
    return insertMissingDepartmentGroups(groups, departments)
  }, [navigationProfile, scope.unrestricted, departments])
  const flatNavItems = useMemo(
    () => [
      ...companyTopNav.map((item) => ({ ...item, tip: item.label })),
      ...navGroups.flatMap((group) =>
        group.items.map((item) => ({
          ...item,
          tip:
            group.title === item.label
              ? item.label
              : `${group.title} · ${item.label}`,
        })),
      ),
    ],
    [navGroups, companyTopNav],
  )

  useEffect(() => {
    const active = navGroups.find((group) =>
      companyGroupIsActive(group, location.pathname),
    )
    if (!active) return
    setOpenTitles((prev) => {
      if (prev.has(active.title)) return prev
      const next = new Set(prev)
      next.add(active.title)
      return next
    })
  }, [location.pathname, navGroups])

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
            title={collapsed ? 'E&J · 사이드바 펼치기' : undefined}
          >
            <span
              className={cn(
                'flex shrink-0 items-center justify-center rounded-lg bg-white/10',
                collapsed ? 'size-8' : 'size-9',
              )}
            >
              <Building2 className="size-4" />
            </span>
            {!collapsed ? (
              <div className="min-w-0">
                <div className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
                  Company
                </div>
                <div className="truncate text-sm font-semibold">E&J</div>
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

      <nav className="flex flex-1 flex-col overflow-y-auto p-2">
        <div className="mb-2 flex flex-col gap-0.5">
          {companyTopNav.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              collapsed={collapsed}
              pathname={location.pathname}
            />
          ))}
        </div>
        {collapsed
          ? flatNavItems
              .filter((item) => !companyTopNav.some((top) => top.to === item.to))
              .map((item) => (
                <NavLink
                  key={`${item.tip}-${item.to}`}
                  to={item.to}
                  end={item.end}
                  title={item.tip}
                  className={() =>
                    cn(
                      'mb-0.5 flex items-center justify-center rounded-md p-2.5 transition-colors',
                      companyNavItemActive(item.to, location.pathname, item.end)
                        ? 'relative bg-sidebar-accent text-white before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary'
                        : 'text-white/65 hover:bg-sidebar-muted hover:text-white',
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" aria-label={item.label} />
                </NavLink>
              ))
          : navGroups.map((group, groupIndex) => {
              const open = openTitles.has(group.title)
              const active = companyGroupIsActive(group, location.pathname)
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
                  {open && group.items.length === 0 ? (
                    <p className="px-2.5 py-2 text-xs text-white/35">준비 중</p>
                  ) : null}
                  {open
                    ? group.items.map((item) => (
                        <NavItem
                          key={item.to}
                          item={item}
                          collapsed={false}
                          pathname={location.pathname}
                        />
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
            E&J Workspace
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
          <Settings className="size-3.5" />
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
  )
}

function CompanyWorkspaceMain() {
  const location = useLocation()
  const { tabs, activeId, openTab, closeTab } = useWorkspaceTabs()
  const { href, approvals, scope } = useReleaseAccess()
  const visibleTabs = useMemo(() => tabs.filter(tab => href(tab.pathname + tab.search) === tab.pathname + tab.search
    || (!scope.unrestricted && tab.pathname === RELEASE_HOME && new URLSearchParams(tab.search).get('part') === 'approvals' && (approvals.loading || Boolean(approvals.error)))), [tabs, href, scope.unrestricted, approvals.loading, approvals.error])
  const pageLayout = pageLayoutFor(location.pathname)

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="relative z-20 flex shrink-0 items-end border-b border-border bg-muted/40">
        <WorkspaceTabBar
          tabs={visibleTabs}
          activeId={activeId}
          onOpen={openTab}
          onClose={closeTab}
        />
        <WorkspaceHeaderActions />
      </div>
      <DeveloperPreviewBar />
      <div
        data-brand-page-scroll
        className={cn(
          'relative min-h-0 flex-1',
          pageLayout === 'full' ? 'overflow-hidden' : 'overflow-auto',
        )}
      >
        <div
          className={cn(
            pageLayout === 'full' && 'h-full min-h-0',
            pageLayout === 'wide' && 'w-full px-4 py-5 md:px-6 md:py-6',
            pageLayout === 'default' && 'mx-auto max-w-[1600px] p-6 md:p-8',
          )}
        >
          <ReleasePageGate>
            <WorkspaceTabPanels tabs={visibleTabs} activeId={activeId} />
          </ReleasePageGate>
        </div>
      </div>
    </main>
  )
}

function NavItem({
  item,
  collapsed,
  pathname,
}: {
  item: CompanyNavItem
  collapsed: boolean
  pathname: string
}) {
  const Icon = item.icon
  const active = companyNavItemActive(item.to, pathname, item.end)
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={() =>
        cn(
          'flex items-center rounded-md transition-colors',
          collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-2.5 py-2 text-sm',
          active
            ? 'relative bg-sidebar-accent text-white before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary'
            : 'text-white/65 hover:bg-sidebar-muted hover:text-white',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-label={collapsed ? item.label : undefined} />
      {collapsed ? null : item.label}
    </NavLink>
  )
}
