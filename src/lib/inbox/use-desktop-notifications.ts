import { useEffect, useRef, useState } from 'react'
import type { InboxNotification } from './types'
import { claimDesktopEvent, desktopBody, desktopCandidates, desktopEventKey } from './desktop-notifications'

function permission(): NotificationPermission | 'unsupported' {
  return window.isSecureContext && 'Notification' in window && 'indexedDB' in window ? Notification.permission : 'unsupported'
}
function readPreference(key: string) {
  try { return localStorage.getItem(key) !== 'off' }
  catch (error) { console.warn('[desktop-notifications] PC 알림 설정 조회 실패', error); return false }
}

export function useDesktopNotifications(userId: string | undefined, items: readonly InboxNotification[], ready: boolean, onOpen: (item: InboxNotification) => void) {
  const preferenceKey = `atelier:desktop-enabled:${userId}`
  const [allowed, setAllowed] = useState(permission)
  const [enabled, setEnabled] = useState(() => readPreference(preferenceKey))
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = useRef({ userId, items, onOpen, enabled, allowed })
  latest.current = { userId, items, onOpen, enabled, allowed }
  const seen = useRef<Set<string> | null>(null)
  const notifications = useRef(new Map<string, Notification>())

  useEffect(() => {
    const activeNotifications = notifications.current
    seen.current = null
    setEnabled(readPreference(preferenceKey)); setDismissed(false); setError(null)
    return () => { for (const toast of activeNotifications.values()) toast.close(); activeNotifications.clear() }
  }, [preferenceKey])

  useEffect(() => {
    function sync() { setAllowed(permission()); setEnabled(readPreference(preferenceKey)) }
    window.addEventListener('focus', sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('focus', sync); window.removeEventListener('storage', sync) }
  }, [preferenceKey])

  useEffect(() => {
    for (const [key, toast] of notifications.current) {
      if (!enabled || allowed !== 'granted' || !items.some(item => desktopEventKey(item) === key && item.current !== false && !item.readAt)) {
        toast.close(); notifications.current.delete(key)
      }
    }
    if (!userId || !ready) return
    if (!seen.current) { seen.current = new Set(items.map(desktopEventKey)); return }
    const candidates = desktopCandidates(items, seen.current, document.visibilityState === 'hidden')
    if (!enabled || allowed !== 'granted') return
    for (const item of candidates) {
      const key = desktopEventKey(item)
      void claimDesktopEvent(userId, key, () => {
        const state = latest.current
        const current = state.items.find(row => desktopEventKey(row) === key)
        if (state.userId !== userId || !state.enabled || permission() !== 'granted' || document.visibilityState !== 'hidden' || !current || current.readAt || current.current === false) return false
        const toast = new Notification(`E&J · ${item.title}`, { body: desktopBody(item), icon: '/ej-icon-192.png', tag: key })
        notifications.current.set(key, toast)
        toast.onclose = () => { notifications.current.delete(key) }
        toast.onclick = () => {
          toast.close()
          const active = latest.current
          if (active.userId !== userId) return
          const target = active.items.find(row => desktopEventKey(row) === key && row.current !== false)
          window.focus()
          if (target) active.onOpen(target)
        }
        toast.onerror = () => console.warn('[desktop-notifications] OS 알림 표시 실패', { id: item.id })
        return true
      }).catch(failure => {
        console.warn('[desktop-notifications] PC 알림 전달 실패', failure)
        setError('PC 알림을 표시하지 못했습니다. 브라우저 알림 설정을 확인해 주세요.')
      })
    }
  }, [userId, items, ready, enabled, allowed])

  async function enable() {
    setBusy(true); setError(null)
    try {
      const result = permission() === 'default' ? await Notification.requestPermission() : permission()
      if (latest.current.userId !== userId) return
      setAllowed(result)
      if (result === 'granted') {
        localStorage.setItem(preferenceKey, 'on'); setEnabled(true); setDismissed(true)
      }
    } catch (failure) {
      console.warn('[desktop-notifications] PC 알림 허용 실패', failure)
      setError('알림 설정을 저장하지 못했습니다.')
    } finally { setBusy(false) }
  }
  function disable() {
    try { localStorage.setItem(preferenceKey, 'off'); setEnabled(false); setDismissed(true) }
    catch (failure) { console.warn('[desktop-notifications] PC 알림 끄기 실패', failure); setError('알림 설정을 저장하지 못했습니다.') }
  }
  function test() {
    try {
      const toast = new Notification('E&J PC 알림 테스트', { body: '새 업무 알림이 이곳에 표시됩니다.', icon: '/ej-icon-192.png', tag: 'atelier-desktop-test' })
      notifications.current.set('test', toast)
      toast.onclick = () => { toast.close(); window.focus() }
      toast.onclose = () => { notifications.current.delete('test') }
    } catch (failure) { console.warn('[desktop-notifications] 테스트 알림 실패', failure); setError('테스트 알림을 표시하지 못했습니다.') }
  }
  return { allowed, enabled, busy, error, enable, disable, test, dismiss: () => setDismissed(true), prompt: Boolean(userId && allowed === 'default' && enabled && !dismissed) }
}
