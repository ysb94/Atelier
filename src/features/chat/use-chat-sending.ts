import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sendChatFile } from '@/lib/chat/send-file'
import type { ChatReplyPreview } from '@/lib/inbox/types'
import { deleteChatMessage, sendChatMessage } from '@/lib/supabase/chat'
import type { ChatUploadItem } from './ChatComposer'
import type { OutgoingChatMessage } from './outgoing'
import { chatKeys } from './use-chat'

export type ChatUploadJob = ChatUploadItem & { roomId: string }

function newMessageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useChatSending(userId: string) {
  const queryClient = useQueryClient()
  const [outgoing, setOutgoing] = useState<OutgoingChatMessage[]>([])
  const [uploads, setUploads] = useState<ChatUploadJob[]>([])
  const [actionError, setActionError] = useState<string | null>(null)

  const ack = useCallback((messageIds: ReadonlySet<string>) => {
    setOutgoing((current) => {
      const next = current.filter((item) => !messageIds.has(item.id))
      return next.length === current.length ? current : next
    })
  }, [])

  const deliver = useCallback(
    (roomId: string, messageId: string, body: string, replyTo: ChatReplyPreview | null) => {
      const createdAt = new Date().toISOString()
      setOutgoing((current) => {
        const without = current.filter((item) => item.id !== messageId)
        return [
          ...without,
          { id: messageId, roomId, body, replyToMessageId: replyTo?.id ?? null, replyTo, createdAt, state: 'pending' },
        ]
      })
      void sendChatMessage({ id: messageId, roomId, body, replyToMessageId: replyTo?.id })
        .then(() => {
          void queryClient.invalidateQueries({
            queryKey: chatKeys.messages(roomId, userId),
          })
          void queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
        })
        .catch((caught: unknown) => {
          console.warn('[chat] 메시지 전송 실패', {
            roomId,
            message: caught instanceof Error ? caught.message : String(caught),
          })
          setOutgoing((current) =>
            current.map((item) =>
              item.id === messageId ? { ...item, state: 'failed' } : item,
            ),
          )
        })
    },
    [queryClient, userId],
  )

  const send = useCallback(
    (roomId: string, body: string, replyTo: ChatReplyPreview | null = null) => {
      deliver(roomId, newMessageId(), body, replyTo)
    },
    [deliver],
  )

  const sendFiles = useCallback(
    (roomId: string, files: File[]) => {
      for (const file of files) {
        const id = newMessageId()
        setUploads((current) => [
          ...current,
          { id, roomId, name: file.name, ratio: 0, error: null },
        ])
        void sendChatFile({
          roomId,
          file,
          onProgress: (ratio) => {
            setUploads((current) =>
              current.map((item) => (item.id === id ? { ...item, ratio } : item)),
            )
          },
        })
          .then(async () => {
            setUploads((current) => current.filter((item) => item.id !== id))
            await queryClient.invalidateQueries({
              queryKey: chatKeys.messages(roomId, userId),
            })
            await queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
            await queryClient.invalidateQueries({ queryKey: chatKeys.usage })
          })
          .catch((caught: unknown) => {
            const message =
              caught instanceof Error ? caught.message : '파일을 보내지 못했습니다.'
            setUploads((current) =>
              current.map((item) =>
                item.id === id ? { ...item, error: message } : item,
              ),
            )
          })
      }
    },
    [queryClient, userId],
  )

  const retry = useCallback(
    (messageId: string) => {
      const item = outgoing.find((message) => message.id === messageId)
      if (!item) return
      deliver(item.roomId, item.id, item.body, item.replyTo)
    },
    [deliver, outgoing],
  )

  const remove = useCallback(
    async (roomId: string, messageId: string) => {
      if (outgoing.some((item) => item.id === messageId)) {
        setOutgoing((current) => current.filter((item) => item.id !== messageId))
        return
      }
      setActionError(null)
      try {
        await deleteChatMessage(messageId)
        await queryClient.invalidateQueries({
          queryKey: chatKeys.messages(roomId, userId),
        })
        await queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
      } catch (caught) {
        console.warn('[chat] 메시지 삭제 실패', {
          roomId,
          messageId,
          message: caught instanceof Error ? caught.message : String(caught),
        })
        setActionError(
          caught instanceof Error ? caught.message : '메시지를 삭제하지 못했습니다.',
        )
      }
    },
    [outgoing, queryClient, userId],
  )

  return {
    outgoing,
    uploads,
    actionError,
    setActionError,
    ack,
    send,
    sendFiles,
    retry,
    remove,
  }
}
