import {
  createContext,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Routes,
  useLocation,
  useNavigate,
  type Location,
} from 'react-router-dom'
import { Home, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { companyWorkspaceRoutes } from './company-routes'

const WorkspaceTabActivityContext = createContext(true)

/** KeepAlive 라우트가 현재 사용자에게 보이는 작업 탭인지 반환한다. */
export function useWorkspaceTabActivity() {
  return useContext(WorkspaceTabActivityContext)
}

/** 비활성 KeepAlive 탭의 전역 차단 레이어는 렌더하지 않는다. */
export function WorkspaceTabOverlay({ children }: { children: ReactNode }) {
  const active = useWorkspaceTabActivity()
  if (!active) return null
  return children
}

export type WorkspaceTab = {
  id: string
  label: string
  pathname: string
  search: string
}

const NAV_LABELS: {
  match: RegExp
  label: string | ((m: RegExpMatchArray) => string)
}[] = [
  { match: /^\/?$/, label: '홈' },
  { match: /^\/products(?:\/|$)/, label: '전체 상품' },
  { match: /^\/drafts\/new(?:\/|$)/, label: '기획안 추가' },
  { match: /^\/drafts\/[^/]+/, label: '기획안 편집' },
  { match: /^\/drafts(?:\/|$)/, label: '기획안' },
  { match: /^\/china\/work-orders(?:\/|$)/, label: '중국팀 · 작업 지시서' },
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
  { match: /^\/work(?:\/|$)/, label: '내 업무' },
  { match: /^\/product-work\/planning(?:\/|$)/, label: '기획 · 상품 정보' },
  { match: /^\/product-work\/design(?:\/|$)/, label: '디자인 · 상품 정보' },
  { match: /^\/design\/styled-cuts(?:\/|$)/, label: '디자인 · 연출 컷 제작' },
  { match: /^\/design\/file-manager(?:\/|$)/, label: '디자인 · 이미지 업로드' },
  { match: /^\/product-work\/md(?:\/|$)/, label: 'MD · 상품 정보' },
  { match: /^\/product-work\/logistics(?:\/|$)/, label: '물류 · 상품 정보' },
  { match: /^\/logistics\/invoices(?:\/|$)/, label: '물류 · 송장작업' },
  {
    match: /^\/logistics\/barcode-outbound-data-entry(?:\/|$)/,
    label: '물류 · (임시) 바코드 출고 데이터입력',
  },
  { match: /^\/logistics\/bulk-outbound(?:\/|$)/, label: '물류 · 바코드 출고' },
  { match: /^\/logistics\/warehouses(?:\/|$)/, label: '물류 · 창고 관리' },
  { match: /^\/logistics\/cargo-inbound(?:\/|$)/, label: '물류 · 화물 입고' },
  { match: /^\/barcodes(?:\/|$)/, label: '88바코드 관리' },
  { match: /^\/usage-codes(?:\/|$)/, label: '출고업체별 바코드' },
  { match: /^\/partner-codes(?:\/|$)/, label: '거래처 코드' },
  { match: /^\/settings\/profile(?:\/|$)/, label: '마이페이지' },
  { match: /^\/org-chart(?:\/|$)/, label: '조직도' },
  { match: /^\/meetings(?:\/|$)/, label: '회의' },
  { match: /^\/schedule(?:\/|$)/, label: '일정' },
  { match: /^\/members(?:\/|$)/, label: '멤버·권한' },
  { match: /^\/brands(?:\/|$)/, label: '브랜드 관리' },
  { match: /^\/operations(?:\/|$)/, label: '운영 현황' },
  { match: /^\/outbound-data(?:\/|$)/, label: '운영 현황' },
  { match: /^\/settings\/fields(?:\/|$)/, label: '업로드 항목' },
  { match: /^\/settings\/seasons(?:\/|$)/, label: '출시 기획' },
  { match: /^\/settings\/usage-targets(?:\/|$)/, label: '출고업체' },
  { match: /^\/settings\/import(?:\/|$)/, label: '가져오기' },
  { match: /^\/settings\/members(?:\/|$)/, label: '멤버' },
  { match: /^\/settings\/ai(?:\/|$)/, label: 'AI 설정' },
  { match: /^\/settings\/brand(?:\/|$)/, label: '브랜드 정보' },
]

/** 탭 구분용. 상품 상세 서랍은 목록 탭에 붙인다. 브랜드 필터는 같은 탭이다. */
function stripDetailPath(path: string): string {
  const productDetail = path.match(/^(\/products)\/[^/]+\/[^/]+\/?$/)
  if (productDetail) return productDetail[1]

  const workDetail = path.match(/^(\/product-work\/[^/]+)\/[^/]+\/[^/]+\/?$/)
  if (workDetail) return workDetail[1]

  const dataDetail = path.match(/^(\/data\/[^/]+)\/[^/]+\/[^/]+\/?$/)
  if (dataDetail) return dataDetail[1]

  return path.replace(/\/$/, '') || '/'
}

function tabIdFromPath(path: string): string {
  const stripped = stripDetailPath(path)
  if (stripped === '/') return 'home'
  return stripped.replace(/^\//, '')
}

function isHomeTabId(id: string) {
  return id === 'home'
}

function isFileManagerTabId(id: string) {
  return id === 'design/file-manager'
}

function isFillHeightTabId(id: string) {
  return isFileManagerTabId(id) || id === 'design/styled-cuts'
}

function labelFromPath(path: string): string {
  const normalized = stripDetailPath(path)
  for (const entry of NAV_LABELS) {
    const match = normalized.match(entry.match)
    if (match) {
      return typeof entry.label === 'function' ? entry.label(match) : entry.label
    }
  }
  return '화면'
}

export function resolveWorkspaceTab(
  location: Pick<Location, 'pathname' | 'search'>,
): WorkspaceTab | null {
  if (location.pathname.startsWith('/b/')) return null
  return {
    id: tabIdFromPath(location.pathname),
    label: labelFromPath(location.pathname),
    pathname: location.pathname,
    search: location.search,
  }
}

function homeTab(): WorkspaceTab {
  return {
    id: 'home',
    label: '홈',
    pathname: '/',
    search: '',
  }
}

function toTabLocation(tab: WorkspaceTab): Location {
  return {
    pathname: tab.pathname,
    search: tab.search,
    hash: '',
    state: null,
    key: tab.id,
  }
}

export function useWorkspaceTabs() {
  const location = useLocation()
  const navigate = useNavigate()
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [homeTab()])
  const closingTabRef = useRef<string | null>(null)
  const pathname = location.pathname
  const search = location.search
  const active = useMemo(
    () => resolveWorkspaceTab({ pathname, search }),
    [pathname, search],
  )

  useLayoutEffect(() => {
    if (!active) return
    if (closingTabRef.current === active.id) return
    closingTabRef.current = null
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
  const closingActive = active?.id === closingTabRef.current
  const displayTabs = useMemo(() => {
    if (active && !closingActive && !tabs.some((tab) => tab.id === active.id)) {
      return [...tabs, active]
    }
    let changed = false
    const next = tabs.map((tab) => {
      if (!active || tab.id !== active.id) return tab
      if (
        tab.pathname === active.pathname &&
        tab.search === active.search &&
        tab.label === active.label
      ) {
        return tab
      }
      changed = true
      return {
        ...tab,
        pathname: active.pathname,
        search: active.search,
        label: active.label,
      }
    })
    return changed ? next : tabs
  }, [active, closingActive, tabs])

  const openTab = useCallback(
    (tab: WorkspaceTab) => {
      navigate(`${tab.pathname}${tab.search}`)
    },
    [navigate],
  )

  const closeTab = useCallback(
    (tabId: string) => {
      if (tabs.length <= 1) return
      const index = tabs.findIndex((tab) => tab.id === tabId)
      if (index === -1) return
      const next = tabs.filter((tab) => tab.id !== tabId)
      closingTabRef.current = tabId
      if (tabId === activeId) {
        const fallback = next[Math.max(0, index - 1)] ?? next[0]
        if (fallback) navigate(`${fallback.pathname}${fallback.search}`)
      }
      setTabs(next)
    },
    [activeId, navigate, tabs],
  )

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
              {isHomeTabId(tab.id) ? (
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
                onClick={(event) => {
                  event.stopPropagation()
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

const WorkspaceTabPanel = memo(function WorkspaceTabPanel({
  tab,
  active,
}: {
  tab: WorkspaceTab
  active: boolean
}) {
  return (
    <WorkspaceTabActivityContext.Provider value={active}>
      <div
        hidden={!active}
        className={cn(
          active ? undefined : 'hidden',
          isFillHeightTabId(tab.id) && active && 'h-full min-h-0',
        )}
      >
        <Routes location={toTabLocation(tab)}>
          {companyWorkspaceRoutes}
        </Routes>
      </div>
    </WorkspaceTabActivityContext.Provider>
  )
})

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
  for (const id of [...activatedRef.current]) {
    if (isHomeTabId(id) && id !== activeId) {
      activatedRef.current.delete(id)
    }
  }

  return (
    <>
      {tabs.map((tab) => {
        const active = tab.id === activeId
        if (isHomeTabId(tab.id) && !active) return null
        if (!activatedRef.current.has(tab.id)) return null
        return <WorkspaceTabPanel key={tab.id} tab={tab} active={active} />
      })}
    </>
  )
}
