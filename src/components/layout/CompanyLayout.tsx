import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
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
import { isCompanyManager } from '@/lib/company/capabilities'
import { cn } from '@/lib/utils'
import {
  companyGroupIsActive,
  companyNavGroups,
  companyNavItemActive,
  companyTopNav,
  membersNavItem,
  type CompanyNavGroup,
  type CompanyNavItem,
} from './company-workspace-nav'
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

function withMembers(groups: readonly CompanyNavGroup[], showMembers: boolean) {
  if (!showMembers) return groups
  return groups.map((group) =>
    group.title === '회사'
      ? { ...group, items: [...group.items, membersNavItem] }
      : group,
  )
}

function pageLayoutFor(pathname: string) {
  if (pathname.includes('/design/file-manager') || pathname.includes('/design/styled-cuts')) return 'full' as const
  if (
    pathname.includes('/logistics/invoices') ||
    pathname.includes('/logistics/barcode-outbound-data-entry') ||
    pathname.includes('/logistics/bulk-outbound') ||
    pathname.includes('/logistics/finder') ||
    pathname.includes('/logistics/warehouses') ||
    pathname.includes('/logistics/cargo-inbound')
  ) {
    return 'wide' as const
  }
  return 'default' as const
}

export function CompanyLayout() {
  return (
    <div className="flex h-full min-h-0">
      <CompanySidebar />
      <CompanyWorkspaceMain />
      <CompanyAiAssistant />
    </div>
  )
}

function CompanySidebar() {
  const location = useLocation()
  const { email, profile, signOut } = useAuth()
  const [openTitles, setOpenTitles] = useState<Set<string>>(() => new Set())
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const showMembers = isCompanyManager({
    status: profile?.status,
    isAdmin: profile?.isAdmin,
    position: profile?.position,
  })
  const navGroups = useMemo(
    () => withMembers(companyNavGroups, showMembers),
    [showMembers],
  )
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
    [navGroups],
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
                <div className="truncate text-xs text-white/50">
                  전 브랜드 작업
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
                        ? 'bg-sidebar-accent text-white'
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
  const pageLayout = pageLayoutFor(location.pathname)

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <WorkspaceTabBar
        tabs={tabs}
        activeId={activeId}
        onOpen={openTab}
        onClose={closeTab}
      />
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
          <WorkspaceTabPanels tabs={tabs} activeId={activeId} />
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
            ? 'bg-sidebar-accent text-white'
            : 'text-white/65 hover:bg-sidebar-muted hover:text-white',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-label={collapsed ? item.label : undefined} />
      {collapsed ? null : item.label}
    </NavLink>
  )
}
