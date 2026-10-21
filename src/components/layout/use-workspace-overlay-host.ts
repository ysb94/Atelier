import { useCallback, useEffect, useRef, useState } from 'react'

/** 고정 헤더뿐 아니라 native dialog의 top layer 위에서도 같은 패널 DOM을 유지한다. */
export function useWorkspaceOverlayHost(enabled: boolean) {
  const [container] = useState(() => {
    const element = document.createElement('div')
    element.dataset.workspaceOverlayRoot = ''
    if (typeof element.showPopover === 'function') element.popover = 'manual'
    Object.assign(element.style, {
      position: 'fixed', inset: '0', margin: '0', padding: '0', border: '0',
      width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none',
      background: 'transparent', overflow: 'visible', pointerEvents: 'none', zIndex: '200',
    })
    return element
  })
  const modalFocus = useRef<HTMLElement | null>(null)
  const modalHost = useRef<HTMLDialogElement | null>(null)

  const restoreFocus = useCallback((button: HTMLElement | null) => {
    const modal = modalHost.current?.matches(':modal') ? modalHost.current : [...document.querySelectorAll<HTMLDialogElement>('dialog:modal')].at(-1)
    const target = modal && !modal.contains(button)
      ? modalFocus.current?.isConnected && modal.contains(modalFocus.current)
        ? modalFocus.current
        : modal.querySelector<HTMLElement>('[autofocus],button,input,select,textarea,[tabindex]') ?? modal
      : button
    target?.focus()
  }, [])

  useEffect(() => {
    if (!enabled) return
    function syncHost() {
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const focusedModal = focused?.closest<HTMLDialogElement>('dialog:modal')
      // 채팅 자체의 확인 모달을 감싸려 하면 DOM 순환이 된다. 해당 확인 모달은 위에 유지한다.
      if (focusedModal && container.contains(focusedModal)) return
      const modals = [...document.querySelectorAll<HTMLDialogElement>('dialog:modal')].filter(dialog => !container.contains(dialog))
      const modal = focusedModal ?? modals.at(-1)
      modalHost.current = modal ?? null
      const host = modal ?? document.body
      if (container.parentElement !== host) {
        if (modal && focused && modal.contains(focused)) modalFocus.current = focused
        host.appendChild(container)
      }
      if (container.popover && !container.matches(':popover-open')) {
        try { container.showPopover() }
        catch (error) {
          console.warn('[workspace-overlay] 최상위 패널 표시 실패; 고정 레이어로 표시', { error })
          container.removeAttribute('popover')
        }
      }
    }
    syncHost()
    function rememberModalFocus(event: FocusEvent) {
      const target = event.target
      if (target instanceof HTMLElement && !container.contains(target) && target.closest('dialog:modal')) modalFocus.current = target
    }
    document.addEventListener('focusin', rememberModalFocus)
    const observer = new MutationObserver(records => {
      // 메시지·표 행 변경 때 전체 DOM을 조회하지 않고 모달의 열기/닫기/추가/제거만 반영한다.
      const changed = records.some(record => record.type === 'attributes'
        ? record.target instanceof HTMLDialogElement
        : [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('dialog') || Boolean(node.querySelector('dialog')))))
      if (changed) syncHost()
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
    return () => {
      document.removeEventListener('focusin', rememberModalFocus)
      observer.disconnect()
      if (container.popover && container.matches(':popover-open')) container.hidePopover()
      container.remove()
    }
  }, [container, enabled])

  return { container, restoreFocus }
}
