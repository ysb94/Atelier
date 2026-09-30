import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  CHAT_MESSAGE_PAGE_SIZE,
  chatStorageUsage,
  listChatDirectory,
  listChatMessages,
  listChatRoomMembers,
  listMyChatRooms,
} from '@/lib/supabase/chat'

export const chatKeys = {
  all: ['chat'] as const,
  rooms: ['chat', 'rooms'] as const,
  directory: ['chat', 'directory'] as const,
  messages: (roomId: string, userId: string) =>
    ['chat', 'messages', roomId, userId] as const,
  members: (roomId: string) => ['chat', 'members', roomId] as const,
  usage: ['chat', 'usage'] as const,
}

export function useChatRooms(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.rooms,
    queryFn: listMyChatRooms,
    enabled,
  })
}

export function useChatDirectory(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.directory,
    queryFn: listChatDirectory,
    enabled,
  })
}

export function useChatMembers(roomId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.members(roomId ?? ''),
    queryFn: () => listChatRoomMembers(roomId ?? ''),
    enabled: enabled && Boolean(roomId),
  })
}

export function useChatMessages(roomId: string | null, userId: string | null) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(roomId ?? '', userId ?? ''),
    queryFn: ({ pageParam }) =>
      listChatMessages(roomId ?? '', userId ?? '', pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < CHAT_MESSAGE_PAGE_SIZE) return undefined
      return lastPage[lastPage.length - 1]?.createdAt
    },
    enabled: Boolean(roomId && userId),
  })
}

export function useChatStorageUsage(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.usage,
    queryFn: chatStorageUsage,
    enabled,
  })
}
