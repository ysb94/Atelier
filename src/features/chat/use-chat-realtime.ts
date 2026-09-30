import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/lib/supabase/client'
import { chatKeys } from './use-chat'

/**
 * 앱 전체에서 채팅 Realtime 채널은 하나만 연다.
 * 끊겼다가 다시 붙으면 방 목록과 열린 대화를 다시 읽는다.
 */
export function useChatRealtime(enabled: boolean) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    const supabase = getSupabase()
    let dropped = false
    let seenSubscribed = false
    let timer = 0

    function refresh() {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: chatKeys.all })
      }, 300)
    }

    const channel = supabase
      .channel('company-chat')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        () => refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_room_members' },
        () => refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_attachments' },
        () => refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_message_reactions' },
        () => refresh(),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (seenSubscribed && dropped) {
            void queryClient.invalidateQueries({ queryKey: chatKeys.all })
          }
          seenSubscribed = true
          dropped = false
          return
        }
        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          dropped = true
          console.warn('[chat] Realtime 구독이 끊겼습니다', { status })
        }
      })

    return () => {
      window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [enabled, queryClient])
}
