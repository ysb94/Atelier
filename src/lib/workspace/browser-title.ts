import { companyNavGroups, companyTopNav, membersNavItem } from '../../components/layout/company-workspace-nav.ts'
import type { ChatRoom, InboxNotification } from '../inbox/types.ts'

export const SITE_NAME = 'E&J'

const PERSONAL_TITLES: Record<string, string> = {
  work: '작업 요청', 'my-attendance': 'My Schedule', profile: '내 정보', overtime: '야근',
  approvals: '승인할 신청', 'company-notice': '회사 공지', 'department-notice': '부서 공지',
  meetings: '회의', attendance: '담당 부서 출근시간',
}
const OPERATIONS_TITLES: Record<string, string> = {
  org: '조직도', attendance: '근태', leave: '연차관리', documents: '서류 출력',
  hours: '회사운영 시간', notices: '공지',
}
const LEAVE_TITLES: Record<string, string> = {
  requests: '신청 현황', balance: '연차 현황', alarm: '연차 소진 알람',
}
const NAV_TITLES = [
  ...companyTopNav.map(item => ({ path: item.to, title: item.label })),
  ...companyNavGroups.flatMap(group => group.items.map(item => ({
    path: item.to, title: item.label === group.title ? item.label : `${item.label} · ${group.title}`,
  }))),
  { path: membersNavItem.to, title: membersNavItem.label },
].sort((a, b) => b.path.length - a.path.length)

/** Resolve the active URL only. Hidden KeepAlive pages never write the browser title. */
export function browserPageTitle(pathname: string, search = ''): string {
  const path = pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(search)
  if (path === '/') return '홈'
  if (path === '/settings/profile') return PERSONAL_TITLES[params.get('part') ?? ''] ?? 'My Schedule'
  if (path === '/operations-support') {
    const part = params.get('part') ?? 'org'
    const title = part === 'leave'
      ? LEAVE_TITLES[params.get('leaveView') ?? 'requests'] ?? '신청 현황'
      : OPERATIONS_TITLES[part] ?? '조직도'
    return `${title} · 운영지원`
  }
  if (path.startsWith('/chat/room/')) return '채팅'
  if (path === '/drafts/new') return '기획안 추가'
  if (path.startsWith('/drafts/')) return '기획안 상세'
  if (/^\/(?:products\/[^/]+\/[^/]+|product-work\/[^/]+\/[^/]+\/[^/]+|data\/[^/]+\/[^/]+\/[^/]+)$/.test(path)) return '상품 상세'
  return NAV_TITLES.find(item => path === item.path || (item.path !== '/' && path.startsWith(`${item.path}/`)))?.title ?? ''
}

export function browserEnvironment(hostname: string, development: boolean): string {
  if (development || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) return '[로컬] '
  if (hostname === 'test.atelier-6yy.pages.dev') return '[TEST] '
  return ''
}

export function browserDocumentTitle(page: string, unread = 0, environment = ''): string {
  const count = Number.isFinite(unread) ? Math.max(0, Math.floor(unread)) : 0
  return `${environment}${count > 0 ? `(${count > 99 ? '99+' : count}) ` : ''}${page ? `${page} · ` : ''}${SITE_NAME}`
}

/** Read state comes from the existing server-backed inbox and chat caches, not pending actions. */
export function browserUnreadCount(notifications: readonly InboxNotification[], rooms: readonly ChatRoom[]): number {
  const notices = new Set(notifications.filter(item => item.current !== false && !item.readAt).map(item => item.id)).size
  const messages = new Map(rooms.map(room => [room.id, Number.isFinite(room.unread) ? Math.max(0, Math.floor(room.unread)) : 0]))
  return notices + [...messages.values()].reduce((sum, count) => sum + count, 0)
}
