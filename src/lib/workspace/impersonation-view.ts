const KEY = 'atelier:impersonation-view'
const MAX_AGE = 5 * 60_000
type Point = { path: number[]; tag: string; id: string; classes: string; top: number; left: number }
export type ImpersonationView = { href: string; points: Point[] }
type PendingView = ImpersonationView & { v: 1; profileId: string; savedAt: number }

export function clearImpersonationView() {
  try { sessionStorage.removeItem(KEY) }
  catch (error) { console.warn('[impersonation] 비교 위치 정리 실패', error) }
}
function currentHref() { return window.location.pathname + window.location.search + window.location.hash }
function rootElement() { return document.querySelector<HTMLElement>('[data-brand-page-scroll]') }
function elementPath(root: HTMLElement, element: HTMLElement) {
  const path: number[] = []
  for (let node: HTMLElement | null = element; node && node !== root; node = node.parentElement) {
    if (!node.parentElement || path.length >= 32) return null
    path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node))
  }
  return path
}
export function captureImpersonationView(): ImpersonationView {
  const root = typeof document === 'undefined' ? null : rootElement()
  const points: Point[] = []
  if (root) for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (!(element.scrollTop || element.scrollLeft) || !element.getClientRects().length) continue
    const path = elementPath(root, element)
    if (path) points.push({ path, tag: element.tagName, id: element.id, classes: element.className, top: element.scrollTop, left: element.scrollLeft })
    if (points.length >= 128) break
  }
  return { href: currentHref(), points }
}
/** Full reload replaces the previous actor's mounted pages and query cache. */
export function reloadImpersonationView(view: ImpersonationView, profileId: string) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...view, v: 1, profileId, savedAt: Date.now() } satisfies PendingView)) }
  catch (error) { console.warn('[impersonation] 비교 위치 보관 실패; 현재 주소만 유지합니다.', error) }
  window.history.replaceState(null, '', view.href)
  window.location.reload()
}
function readView(): PendingView | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as PendingView
    if (value.v !== 1 || typeof value.profileId !== 'string' || typeof value.href !== 'string'
      || !value.href.startsWith('/') || value.href.startsWith('//') || !Number.isFinite(value.savedAt)
      || value.savedAt > Date.now() || Date.now() - value.savedAt > MAX_AGE
      || !Array.isArray(value.points) || value.points.length > 128
      || value.points.some(p => !p || !Array.isArray(p.path) || p.path.length > 32 || p.path.some(n => !Number.isInteger(n) || n < 0)
        || typeof p.tag !== 'string' || typeof p.id !== 'string' || typeof p.classes !== 'string'
        || !Number.isFinite(p.top) || p.top < 0 || !Number.isFinite(p.left) || p.left < 0)) throw Error('잘못되거나 만료된 비교 위치')
    return value
  } catch (error) { console.warn('[impersonation] 비교 위치를 읽지 못했습니다.', error); clearImpersonationView(); return null }
}
/** Called only after authentication, attendance and route access checks have passed. */
export function restoreImpersonationView(profileId: string) {
  const view = readView()
  if (!view) return
  if (view.profileId !== profileId || view.href !== currentHref()) { clearImpersonationView(); return }
  const deadline = Date.now() + 5_000
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const stop = (consume: boolean) => {
    stopped = true; clearTimeout(timer)
    for (const event of ['wheel', 'touchstart', 'pointerdown']) window.removeEventListener(event, cancel, true)
    window.removeEventListener('keydown', keydown, true)
    if (consume) clearImpersonationView()
  }
  const cancel = () => stop(true)
  const keydown = (event: KeyboardEvent) => { if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(event.key)) cancel() }
  const attempt = () => {
    if (stopped) return
    const root = rootElement()
    let complete = Boolean(root)
    for (const point of view.points) {
      let element = root
      for (const index of point.path) element = element?.children.item(index) as HTMLElement | null
      if (!element || element.tagName !== point.tag || element.id !== point.id || element.className !== point.classes || !element.getClientRects().length) { complete = false; continue }
      // Small/empty loading placeholders must not consume the final scroll position.
      element.scrollTo({ top: point.top, left: point.left, behavior: 'instant' })
      if (Math.abs(element.scrollTop - point.top) > 1 || Math.abs(element.scrollLeft - point.left) > 1) complete = false
    }
    if (complete || Date.now() >= deadline) { stop(true); return }
    timer = setTimeout(attempt, 100)
  }
  for (const event of ['wheel', 'touchstart', 'pointerdown']) window.addEventListener(event, cancel, { capture: true, passive: true })
  window.addEventListener('keydown', keydown, true)
  // Leave the snapshot until completion so React StrictMode's effect replay can restart safely.
  timer = setTimeout(attempt, 0)
  return () => stop(false)
}
