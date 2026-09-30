const CHAT_WINDOW_WIDTH = 440
const CHAT_WINDOW_HEIGHT = 720
const CHAT_WINDOW_STAGGER = 28
const CHAT_WINDOW_STAGGER_STEPS = 6
const CHAT_WINDOW_MIN_SCREEN = 768

let staggerStep = 0

export function chatWindowName(roomId: string) {
  return `atelier-chat-${roomId}`
}

export function chatWindowPath(roomId: string) {
  return `/chat/room/${encodeURIComponent(roomId)}`
}

/** 좁은 화면에서는 새 창이 새 탭이 되므로 패널 안에서 연다. */
export function canUseChatWindows() {
  return window.innerWidth >= CHAT_WINDOW_MIN_SCREEN
}

function windowHref(popup: Window) {
  try {
    return popup.location.href
  } catch (error) {
    console.warn('[chat] 채팅 창 주소를 확인하지 못했습니다', {
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function nextPlacement() {
  const offset = staggerStep * CHAT_WINDOW_STAGGER
  const left = Math.max(
    0,
    window.screenX + window.outerWidth - CHAT_WINDOW_WIDTH - 16 - offset,
  )
  const top = Math.max(0, window.screenY + 40 + offset)
  const features = [
    'popup=yes',
    `width=${CHAT_WINDOW_WIDTH}`,
    `height=${CHAT_WINDOW_HEIGHT}`,
    `left=${left}`,
    `top=${top}`,
  ].join(',')
  return {
    features,
    left,
    top,
    commit() {
      staggerStep = (staggerStep + 1) % CHAT_WINDOW_STAGGER_STEPS
    },
  }
}

/**
 * 같은 방 창이 있으면 새로고침 없이 앞으로 가져온다.
 * 팝업이 막히면 false.
 */
export function openChatWindow(roomId: string): boolean {
  const name = chatWindowName(roomId)
  const placement = nextPlacement()
  let popup: Window | null = null
  try {
    popup = window.open('', name, placement.features)
  } catch (error) {
    console.warn('[chat] 채팅 창을 열지 못했습니다', {
      roomId,
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  }
  if (!popup) return false

  const href = windowHref(popup)
  const unused = href === 'about:blank' || href === ''
  if (unused) {
    placement.commit()
    popup.location.href = new URL(chatWindowPath(roomId), window.location.origin).href
    try {
      popup.resizeTo(CHAT_WINDOW_WIDTH, CHAT_WINDOW_HEIGHT)
      popup.moveTo(placement.left, placement.top)
    } catch (error) {
      console.warn('[chat] 채팅 창 크기를 맞추지 못했습니다', {
        roomId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  try {
    popup.focus()
  } catch (error) {
    console.warn('[chat] 채팅 창을 앞으로 가져오지 못했습니다', {
      roomId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
  return true
}
