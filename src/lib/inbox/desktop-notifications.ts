import type { InboxNotification } from './types'

/** Delivery identity is separate from the server's business read state. */
export function desktopEventKey(item: InboxNotification): string {
  return JSON.stringify([item.id, item.target?.eventVersion ?? item.createdAt, item.meeting?.scheduleVersion ?? null])
}

export function desktopCandidates(items: readonly InboxNotification[], seen: Set<string>, hidden: boolean) {
  const fresh = items.filter(item => !seen.has(desktopEventKey(item)))
  for (const item of items) seen.add(desktopEventKey(item))
  return hidden ? fresh.filter(item => item.current !== false && !item.readAt) : []
}

export function desktopBody(item: InboxNotification): string {
  // Free-text reasons and decision comments stay inside the authenticated site.
  return item.action?.label ? `${item.action.label} · 자세한 내용은 Atelier에서 확인하세요.` : '새 업무 알림입니다. 자세한 내용은 Atelier에서 확인하세요.'
}

export function desktopBackgroundEnabled(userId?: string): boolean {
  try {
    return Boolean(userId && window.isSecureContext && 'Notification' in window && 'indexedDB' in window && Notification.permission === 'granted' && localStorage.getItem(`atelier:desktop-enabled:${userId}`) !== 'off')
  } catch (error) { console.warn('[desktop-notifications] PC 알림 설정 조회 실패', error); return false }
}

/** Atomic browser delivery cache; never a source for business records or read state. */
export async function claimDesktopEvent(userId: string, key: string, deliver: () => boolean) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('atelier-desktop-delivery', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('deliveries', { keyPath: 'id' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('deliveries', 'readwrite')
      const store = transaction.objectStore('deliveries')
      const request = store.get([userId, key])
      request.onsuccess = () => {
        try {
          const now = Date.now()
          if (request.result && now - request.result.sentAt < 7 * 86400_000) return
          if (!deliver()) return
          store.put({ id: [userId, key], sentAt: now })
          const all = store.getAll()
          all.onsuccess = () => {
            const entries = (all.result as { id: string[]; sentAt: number }[]).sort((a, b) => b.sentAt - a.sentAt)
            for (const [index, entry] of entries.entries()) {
              if (index >= 500 || now - entry.sentAt >= 7 * 86400_000) store.delete(entry.id)
            }
          }
        } catch (error) { transaction.abort(); reject(error) }
      }
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('PC 알림 전달 기록을 저장하지 못했습니다.'))
      transaction.onerror = () => reject(transaction.error)
    })
  } finally { db.close() }
}
