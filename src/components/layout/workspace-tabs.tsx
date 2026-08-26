import { useLayoutEffect, useRef, useState } from 'react'
import {
  Routes,
  useLocation,
  useNavigate,
  type Location,
} from 'react-router-dom'
import { Home, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BrandWorkspaceRouteTree } from './brand-routes'

export type WorkspaceTab = {
  id: string
  label: string
  /** 탭 클릭 시 복원할 전체 경로 (서랍 포함) */
  pathname: string
  search: string
}

const NAV_LABELS: {
  match: RegExp
  label: string | ((m: RegExpMatchArray) => string)
}[] = [
  { match: /^\/?$/, label: '홈' },
  { match: /^\/products(?:\/|$)/, label: '전체 상품' },
  { match: /^\/drafts\/all(?:\/|$)/, label: '기획안 · 전체' },
  {
    match: /^\/drafts\/season\/unassigned(?:\/|$)/,
    label: '기획안 · 출시 미정',
  },
  {
    match: /^\/drafts\/season\/([^/]+)/,
    label: (m) => `기획안 · ${decodeURIComponent(m[1])}`,
  },
  { match: /^\/drafts\/[^/]+/, label: '기획안 편집' },
  { match: /^\/drafts(?:\/|$)/, label: '기획안' },
  { match: /^\/data\/upload(?:\/|$)/, label: '데이터 · 일괄 업로드' },
  { match: /^\/data\/planning(?:\/|$)/, label: '데이터 · 기획' },
  { match: /^\/data\/design(?:\/|$)/, label: '데이터 · 디자인' },
  { match: /^\/data\/md(?:\/|$)/, label: '데이터 · MD' },
  { match: /^\/data\/logistics(?:\/|$)/, label: '데이터 · 물류' },
  { match: /^\/data\/all(?:\/|$)/, label: '데이터 · 전체 상품' },
  { match: /^\/data(?:\/|$)/, label: '데이터 · 전체 상품' },
  { match: /^\/work-requests\/planning(?:\/|$)/, label: '기획 · 작업 요청' },
  { match: /^\/work-requests\/design(?:\/|$)/, label: '디자인 · 작업 요청' },
  { match: /^\/work-requests\/md(?:\/|$)/, label: 'MD · 작업 요청' },
  { match: /^\/work-requests\/logistics(?:\/|$)/, label: '물류 · 작업 요청' },
  { match: /^\/work\/planning(?:\/|$)/, label: '기획 · 상품 정보' },
  { match: /^\/work\/design(?:\/|$)/, label: '디자인 · 상품 정보' },
  {
    match: /^\/design\/file-manager(?:\/|$)/,
    label: '디자인 · 이미지 업로드',
  },
  { match: /^\/work\/md(?:\/|$)/, label: 'MD · 상품 정보' },
  { match: /^\/work\/logistics(?:\/|$)/, label: '물류 · 상품 정보' },
  {
    match: /^\/logistics\/invoices(?:\/|$)/,
    label: '물류 · 송장작업',
  },
  {
    match: /^\/logistics\/warehouses(?:\/|$)/,
    label: '물류 · 창고 관리',
  },
  { match: /^\/barcodes(?:\/|$)/, label: '자사 바코드' },
  { match: /^\/usage-codes(?:\/|$)/, label: '사용처별 바코드' },
  { match: /^\/partner-codes(?:\/|$)/, label: '거래처 코드' },
  { match: /^\/settings\/profile(?:\/|$)/, label: '내 설정' },
  { match: /^\/org-chart(?:\/|$)/, label: '조직도' },
  { match: /^\/settings\/fields(?:\/|$)/, label: '업로드 항목' },
  { match: /^\/settings\/seasons(?:\/|$)/, label: '출시 기획' },
  { match: /^\/settings\/usage-targets(?:\/|$)/, label: '사용처' },
  { match: /^\/settings\/import(?:\/|$)/, label: '가져오기' },
  { match: /^\/settings\/members(?:\/|$)/, label: '멤버' },
  { match: /^\/settings\/ai(?:\/|$)/, label: 'AI 설정' },
  { match: /^\/settings\/brand(?:\/|$)/, label: '브랜드 정보' },
]

/** 탭 구분용. 상품 상세 서랍은 목록 탭에 붙인다. */
function stripDetailPath(rest: string): string {
  const productDetail = rest.match(/^(\/products)\/[^/]+\/?$/)
  if (productDetail) return productDetail[1]

  const workDetail = rest.match(/^(\/work\/[^/]+)\/[^/]+\/?$/)
  if (workDetail) return workDetail[1]

  const dataDetail = rest.match(/^(\/data\/[^/]+)\/[^/]+\/?$/)
  if (dataDetail) return dataDetail[1]

  return rest.replace(/\/$/, '') || '/'
}

function tabIdFromRest(rest: string): string {
  const path = stripDetailPath(rest)
  if (path === '/') return 'home'
  return path.replace(/^\//, '')
}

function labelFromRest(rest: string): string {
  const path = stripDetailPath(rest)
  const normalized = path === '' ? '/' : path
  for (const entry of NAV_LABELS) {
    const m = normalized.match(entry.match)
    if (m) {
      return typeof entry.label === 'function' ? entry.label(m) : entry.label
    }
  }
  return '화면'
}

export function resolveWorkspaceTab(
  brandSlug: string,
  location: Pick<Location, 'pathname' | 'search'>,
): WorkspaceTab | null {
  const base = `/b/${brandSlug}`
  if (location.pathname !== base && !location.pathname.startsWith(`${base}/`)) {
    return null
  }

  const rest =
    location.pathname === base
      ? '/'
      : location.pathname.slice(base.length) || '/'

  return {
    id: tabIdFromRest(rest),
    label: labelFromRest(rest),
    pathname: location.pathname,
    search: location.search,
  }
}

function homeTab(brandSlug: string): WorkspaceTab {
  return {
    id: 'home',
    label: '홈',
    pathname: `/b/${brandSlug}`,
    search: '',
  }
}

/**
 * 이 Routes는 /b/:brandSlug/* 부모 라우트 안에 있으므로 전체 경로가 필요하다.
 * 상대 경로를 넘기면 React Router의 부모 경로 검증에 실패한다.
 */
function toTabLocation(tab: WorkspaceTab): Location {
  return {
    pathname: tab.pathname,
    search: tab.search,
    hash: '',
    state: null,
    key: tab.id,
  }
}

export function useWorkspaceTabs(brandSlug: string) {
  const location = useLocation()
  const navigate = useNavigate()
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [homeTab(brandSlug)])
  const brandRef = useRef(brandSlug)

  useLayoutEffect(() => {
    if (brandRef.current === brandSlug) return
    brandRef.current = brandSlug
    setTabs([homeTab(brandSlug)])
  }, [brandSlug])

  const active = resolveWorkspaceTab(brandSlug, location)

  useLayoutEffect(() => {
    if (!active) return
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === active.id)
      if (index === -1) return [...prev, active]
      const current = prev[index]
      if (
        current.pathname === active.pathname &&
        current.search === active.search &&
        current.label === active.label
      ) {
        return prev
      }
      const next = [...prev]
      next[index] = active
      return next
    })
  }, [active])

  const activeId = active?.id ?? 'home'

  const displayTabs =
    active && !tabs.some((tab) => tab.id === active.id)
      ? [...tabs, active]
      : tabs.map((tab) =>
          active && tab.id === active.id
            ? {
                ...tab,
                pathname: active.pathname,
                search: active.search,
                label: active.label,
              }
            : tab,
        )

  function openTab(tab: WorkspaceTab) {
    navigate(`${tab.pathname}${tab.search}`)
  }

  function closeTab(tabId: string) {
    setTabs((prev) => {
      if (prev.length <= 1) return prev
      const index = prev.findIndex((tab) => tab.id === tabId)
      if (index === -1) return prev
      const next = prev.filter((tab) => tab.id !== tabId)

      if (tabId === activeId) {
        const fallback = next[Math.max(0, index - 1)] ?? next[0]
        if (fallback) {
          navigate(`${fallback.pathname}${fallback.search}`)
        }
      }
      return next
    })
  }

  return {
    tabs: displayTabs,
    activeId,
    openTab,
    closeTab,
  }
}

export function WorkspaceTabBar({
  tabs,
  activeId,
  onOpen,
  onClose,
}: {
  tabs: WorkspaceTab[]
  activeId: string
  onOpen: (tab: WorkspaceTab) => void
  onClose: (tabId: string) => void
}) {
  return (
    <div className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted/40 px-2 pt-2">
      {tabs.map((tab) => {
        const selected = tab.id === activeId
        const closable = tabs.length > 1
        return (
          <div
            key={tab.id}
            className={cn(
              'group flex max-w-[14rem] shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2.5 py-1.5 text-sm transition-colors',
              selected
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground',
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(tab)}
              className="flex min-w-0 items-center gap-1.5"
              title={tab.label}
            >
              {tab.id === 'home' ? (
                <Home className="size-3.5 shrink-0 opacity-70" />
              ) : null}
              <span className="truncate">{tab.label}</span>
            </button>
            {closable ? (
              <button
                type="button"
                aria-label={`${tab.label} 탭 닫기`}
                className={cn(
                  'rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100',
                  selected && 'opacity-60',
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * 탭마다 Routes location을 고정해, 숨긴 화면의 필터·스크롤·입력 상태를 유지한다.
 * 홈만 비활성 시 언마운트해서, 다시 들어오면 일정 필터가 전체 보기로 초기화된다.
 */
export function WorkspaceTabPanels({
  tabs,
  activeId,
}: {
  tabs: WorkspaceTab[]
  activeId: string
}) {
  const activatedRef = useRef(new Set<string>([activeId]))
  if (!activatedRef.current.has(activeId)) {
    activatedRef.current.add(activeId)
  }
  for (const id of [...activatedRef.current]) {
    if (!tabs.some((tab) => tab.id === id)) {
      activatedRef.current.delete(id)
    }
  }
  // 홈은 KeepAlive에서 제외한다.
  if (activeId !== 'home') {
    activatedRef.current.delete('home')
  }

  return (
    <>
      {tabs.map((tab) => {
        const active = tab.id === activeId
        if (tab.id === 'home' && !active) return null
        if (!activatedRef.current.has(tab.id)) return null
        return (
          <div
            key={tab.id}
            hidden={!active}
            className={cn(
              active ? undefined : 'hidden',
              tab.id === 'design/file-manager' && active && 'h-full min-h-0',
            )}
          >
            <Routes location={toTabLocation(tab)}>
              {BrandWorkspaceRouteTree()}
            </Routes>
          </div>
        )
      })}
    </>
  )
}
