/** My home and the bell must consume the same records, never separate read copies. */
export type MyHomeNotificationTab = 'meetings' | 'my-attendance' | 'approvals' | 'overtime' | 'holiday-work'

export type MyHomeNotificationSource = 'meeting' | 'leave-notice' | 'late-statement' | 'request' | 'checkout'

export type MyHomeNotificationTarget = {
  source: MyHomeNotificationSource
  entityId: string
  /** Identifies the displayed event, not merely its business entity. */
  eventVersion: string
  tab: MyHomeNotificationTab
  href: string
}

export type MyHomeNotificationRecord = {
  id: string
  target: MyHomeNotificationTarget
  title: string
  body: string
  createdAt: string
  readAt: string | null
  /** Retired events remain available in history, but do not demand attention. */
  current: boolean
  action: { key: string; label: string } | null
}

type NotificationState = Pick<MyHomeNotificationRecord,'readAt'> & Partial<Pick<MyHomeNotificationRecord,'current'|'action'|'target'>>

export function notificationNeedsAttention(record: NotificationState): boolean {
  return record.current !== false && (record.readAt === null || Boolean(record.action))
}

export function myHomeNotificationSummary(records: readonly NotificationState[], tab?: MyHomeNotificationTab) {
  const relevant = records.filter(record => record.current !== false && (!tab || record.target?.tab === tab))
  return {
    unread: relevant.filter(record => record.readAt === null).length,
    pending: new Set(relevant.flatMap(record => record.action ? [record.action.key] : [])).size,
  }
}

/** Reject a completion reported by a drawer displaying an older event version. */
export function sameNotificationEvent(a: MyHomeNotificationTarget, b: MyHomeNotificationTarget): boolean {
  return a.source === b.source && a.entityId === b.entityId && a.eventVersion === b.eventVersion
}
