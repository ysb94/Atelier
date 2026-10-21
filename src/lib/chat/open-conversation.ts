export const OPEN_CONVERSATION_EVENT = 'atelier:open-conversation'
export type RequestedConversation = { id: string; title: string; sequence: number }

/** 다른 업무 화면에서도 기존 공통 채팅 패널을 연다. */
export function openConversation(id: string, title: string) {
  window.dispatchEvent(new CustomEvent<RequestedConversation>(OPEN_CONVERSATION_EVENT, {
    detail: { id, title, sequence: performance.now() },
  }))
}
