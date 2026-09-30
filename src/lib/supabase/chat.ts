import { chatDownloadFileName } from '@/lib/chat/file-rules'
import { formatChatPerson } from '@/lib/inbox/format'
import type {
  ChatAttachment,
  ChatDirectoryPerson,
  ChatDownloadRecord,
  ChatMessage,
  ChatMessageKind,
  ChatRoom,
  ChatRoomListMember,
  ChatRoomMember,
} from '@/lib/inbox/types'
import { getSupabase } from '@/lib/supabase/client'

export const CHAT_MESSAGE_PAGE_SIZE = 50
export const CHAT_MESSAGE_MAX_LENGTH = 4_000

export class ChatStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatStoreError'
  }
}

type RoomRow = {
  room_id: string
  kind: 'direct' | 'group'
  name: string
  last_message_at: string | null
  last_message_preview: string
  unread_count: number
  peer_profile_id: string | null
  peer_display_name: string | null
  peer_position: string | null
  member_count: number
  members: unknown
  last_message_kind: string | null
  last_attachment_mime: string | null
}

type DirectoryRow = {
  profile_id: string
  display_name: string
  department_name: string | null
  position: string | null
}

type MemberRow = DirectoryRow & {
  joined_at: string
}

type MessageRow = {
  id: string
  room_id: string
  author_id: string | null
  author_name: string
  kind: 'text' | 'file' | 'system'
  body: string
  created_at: string
  deleted_at: string | null
  chat_attachments?: AttachmentRow[] | AttachmentRow | null
}

type AttachmentRow = {
  id: string
  message_id: string
  file_name: string
  mime_type: string
  size_bytes: number
  has_macro: boolean
  status: ChatAttachment['status']
  object_path: string
  thumb_path: string | null
}

function chatErrorMessage(error: { message: string }) {
  const text = error.message.trim()
  if (/jwt|not authenticated|permission denied|42501/i.test(text)) {
    return '채팅을 사용할 권한이 없습니다.'
  }
  return text.replace(/^PGRST\d+:\s*/i, '').replace(/^P0001:\s*/, '')
}

function fail(error: { message: string }, context: Record<string, unknown>): never {
  console.warn('[chat] 요청 실패', { ...context, message: error.message })
  throw new ChatStoreError(chatErrorMessage(error) || '채팅 요청에 실패했습니다.')
}

function isDuplicate(error: { message: string; code?: string }) {
  return error.code === '23505' || /duplicate key|already exists/i.test(error.message)
}

function toLastKind(value: string | null): ChatMessageKind | null {
  if (value === 'text' || value === 'file' || value === 'system') return value
  return null
}

function toMembers(value: unknown): ChatRoomListMember[] {
  let raw = value
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value) as unknown
    } catch (error) {
      console.warn('[chat] 방 멤버 목록을 읽지 못함', {
        message: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  const members: ChatRoomListMember[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { profile_id?: unknown; display_name?: unknown }
    if (typeof row.profile_id !== 'string' || typeof row.display_name !== 'string') {
      continue
    }
    members.push({ profileId: row.profile_id, displayName: row.display_name })
  }
  return members
}

function toRoom(row: RoomRow): ChatRoom {
  const peerName = row.peer_display_name
  const mime = row.last_attachment_mime?.trim().toLowerCase() ?? ''
  return {
    id: row.room_id,
    kind: row.kind,
    name: row.name,
    title:
      row.kind === 'direct'
        ? formatChatPerson(peerName, row.peer_position)
        : row.name,
    lastMessage: row.last_message_preview,
    lastAt: row.last_message_at,
    unread: row.unread_count,
    peerProfileId: row.peer_profile_id,
    peerName,
    peerPosition: row.peer_position,
    members: toMembers(row.members),
    lastKind: toLastKind(row.last_message_kind),
    lastIsImage: mime.startsWith('image/'),
    memberCount: row.member_count,
  }
}

function toPerson(row: DirectoryRow): ChatDirectoryPerson {
  return {
    profileId: row.profile_id,
    displayName: row.display_name,
    departmentName: row.department_name,
    position: row.position,
  }
}

function toAttachment(row: AttachmentRow): ChatAttachment {
  return {
    id: row.id,
    messageId: row.message_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    hasMacro: row.has_macro,
    status: row.status,
    objectPath: row.object_path,
    thumbPath: row.thumb_path,
  }
}

function toMessage(row: MessageRow, userId: string): ChatMessage {
  const raw = row.chat_attachments
  const attachmentRow = Array.isArray(raw) ? raw[0] : raw
  return {
    id: row.id,
    roomId: row.room_id,
    authorId: row.author_id,
    authorName: row.author_name,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    mine: row.author_id === userId && row.kind !== 'system',
    attachment: attachmentRow ? toAttachment(attachmentRow) : null,
  }
}

export async function listMyChatRooms(): Promise<ChatRoom[]> {
  const { data, error } = await getSupabase().rpc('list_my_chat_rooms')
  if (error) fail(error, { fn: 'list_my_chat_rooms' })
  return ((data ?? []) as RoomRow[]).map(toRoom)
}

export async function listChatDirectory(): Promise<ChatDirectoryPerson[]> {
  const { data, error } = await getSupabase().rpc('list_chat_directory')
  if (error) fail(error, { fn: 'list_chat_directory' })
  return ((data ?? []) as DirectoryRow[]).map(toPerson)
}

export async function listChatRoomMembers(
  roomId: string,
): Promise<ChatRoomMember[]> {
  const { data, error } = await getSupabase().rpc('list_chat_room_members', {
    target_room_id: roomId,
  })
  if (error) fail(error, { fn: 'list_chat_room_members', roomId })
  return ((data ?? []) as MemberRow[]).map((row) => ({
    ...toPerson(row),
    joinedAt: row.joined_at,
  }))
}

export async function listChatMessages(
  roomId: string,
  userId: string,
  before?: string | null,
): Promise<ChatMessage[]> {
  let query = getSupabase()
    .from('chat_messages')
    .select(
      'id, room_id, author_id, author_name, kind, body, created_at, deleted_at, chat_attachments(id, message_id, file_name, mime_type, size_bytes, object_path, thumb_path, has_macro, status)',
    )
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(CHAT_MESSAGE_PAGE_SIZE)
  if (before) query = query.lt('created_at', before)
  const { data, error } = await query
  if (error) fail(error, { fn: 'list_chat_messages', roomId })
  return ((data ?? []) as MessageRow[]).map((row) => toMessage(row, userId))
}

export async function sendChatMessage(input: {
  id: string
  roomId: string
  body: string
}): Promise<void> {
  const { error } = await getSupabase()
    .from('chat_messages')
    .insert({
      id: input.id,
      room_id: input.roomId,
      kind: 'text',
      body: input.body,
    })
  if (error) {
    if (isDuplicate(error)) return
    fail(error, { fn: 'send_chat_message', roomId: input.roomId })
  }
}

export async function openDirectChat(otherProfileId: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('open_direct_chat', {
    other_profile_id: otherProfileId,
  })
  if (error) fail(error, { fn: 'open_direct_chat' })
  if (typeof data !== 'string' || !data) {
    throw new ChatStoreError('채팅방을 만들지 못했습니다.')
  }
  return data
}

export async function createGroupChat(
  roomName: string,
  memberIds: string[],
): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_group_chat', {
    room_name: roomName,
    member_ids: memberIds,
  })
  if (error) fail(error, { fn: 'create_group_chat' })
  if (typeof data !== 'string' || !data) {
    throw new ChatStoreError('채팅방을 만들지 못했습니다.')
  }
  return data
}

export async function addChatRoomMembers(
  roomId: string,
  memberIds: string[],
): Promise<void> {
  const { error } = await getSupabase().rpc('add_chat_room_members', {
    target_room_id: roomId,
    member_ids: memberIds,
  })
  if (error) fail(error, { fn: 'add_chat_room_members', roomId })
}

export async function renameChatRoom(
  roomId: string,
  roomName: string,
): Promise<void> {
  const { error } = await getSupabase().rpc('rename_chat_room', {
    target_room_id: roomId,
    room_name: roomName,
  })
  if (error) fail(error, { fn: 'rename_chat_room', roomId })
}

export async function leaveChatRoom(roomId: string): Promise<void> {
  const { error } = await getSupabase().rpc('leave_chat_room', {
    target_room_id: roomId,
  })
  if (error) fail(error, { fn: 'leave_chat_room', roomId })
}

export async function markChatRoomRead(roomId: string): Promise<void> {
  const { error } = await getSupabase().rpc('mark_chat_room_read', {
    target_room_id: roomId,
  })
  if (error) fail(error, { fn: 'mark_chat_room_read', roomId })
}

const CHAT_BUCKET = 'company-chat'
const SIGNED_URL_SECONDS = 60 * 60
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

type BegunAttachment = {
  attachment_id: string
  object_path: string
  thumb_path: string | null
}

function firstRow<T>(data: T | T[] | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null
  return data
}

export async function beginChatAttachment(input: {
  roomId: string
  fileName: string
  mimeType: string
  sizeBytes: number
}): Promise<{ attachmentId: string; objectPath: string; thumbPath: string | null }> {
  const { data, error } = await getSupabase().rpc('begin_chat_attachment', {
    target_room_id: input.roomId,
    file_name: input.fileName,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
  })
  if (error) fail(error, { fn: 'begin_chat_attachment', roomId: input.roomId })
  const row = firstRow(data as BegunAttachment | BegunAttachment[] | null)
  if (!row?.attachment_id || !row.object_path) {
    throw new ChatStoreError('파일 올리기를 시작하지 못했습니다.')
  }
  return {
    attachmentId: row.attachment_id,
    objectPath: row.object_path,
    thumbPath: row.thumb_path,
  }
}

export async function completeChatAttachment(
  attachmentId: string,
  hasThumb: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc('complete_chat_attachment', {
    target_attachment_id: attachmentId,
    has_thumb: hasThumb,
  })
  if (error) fail(error, { fn: 'complete_chat_attachment', attachmentId })
}

export async function cancelChatAttachment(attachmentId: string): Promise<void> {
  const { error } = await getSupabase().rpc('cancel_chat_attachment', {
    target_attachment_id: attachmentId,
  })
  if (error) fail(error, { fn: 'cancel_chat_attachment', attachmentId })
}

export async function removeChatObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await getSupabase().storage.from(CHAT_BUCKET).remove(paths)
  if (error) fail(error, { fn: 'remove_chat_objects' })
}

export async function chatStorageUsage(): Promise<{
  usedBytes: number
  fileCount: number
}> {
  const { data, error } = await getSupabase().rpc('chat_storage_usage')
  if (error) fail(error, { fn: 'chat_storage_usage' })
  const row = firstRow(
    data as { used_bytes: number; file_count: number } | { used_bytes: number; file_count: number }[] | null,
  )
  return {
    usedBytes: Number(row?.used_bytes ?? 0),
    fileCount: Number(row?.file_count ?? 0),
  }
}

async function signedChatUrl(path: string, downloadName?: string): Promise<string> {
  const key = downloadName ? `${path}\n${downloadName}` : path
  const cached = signedUrlCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.url
  const { data, error } = await getSupabase()
    .storage.from(CHAT_BUCKET)
    .createSignedUrl(
      path,
      SIGNED_URL_SECONDS,
      downloadName ? { download: downloadName } : undefined,
    )
  if (error || !data?.signedUrl) {
    fail(error ?? { message: '주소를 만들지 못했습니다.' }, {
      fn: 'chat_signed_url',
    })
  }
  signedUrlCache.set(key, {
    url: data.signedUrl,
    expiresAt: Date.now() + 50 * 60 * 1000,
  })
  return data.signedUrl
}

export async function createChatThumbUrl(path: string): Promise<string> {
  return signedChatUrl(path)
}

export async function downloadChatAttachment(attachment: {
  id: string
  fileName: string
  objectPath: string
}): Promise<void> {
  const { error } = await getSupabase().rpc('record_chat_attachment_download', {
    target_attachment_id: attachment.id,
  })
  if (error) fail(error, { fn: 'record_chat_attachment_download', attachmentId: attachment.id })
  const url = await signedChatUrl(attachment.objectPath)
  let response: Response
  try {
    response = await fetch(url)
  } catch (caught) {
    console.warn('[chat] 파일 받기 실패', {
      attachmentId: attachment.id,
      message: caught instanceof Error ? caught.message : String(caught),
    })
    throw new ChatStoreError('파일을 받지 못했습니다.')
  }
  if (!response.ok) {
    console.warn('[chat] 파일 받기 실패', {
      attachmentId: attachment.id,
      status: response.status,
    })
    throw new ChatStoreError('파일을 받지 못했습니다.')
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = chatDownloadFileName(attachment.fileName)
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}

export async function trashChatAttachment(attachmentId: string): Promise<void> {
  const { error } = await getSupabase().rpc('trash_chat_attachment', {
    target_attachment_id: attachmentId,
  })
  if (error) fail(error, { fn: 'trash_chat_attachment', attachmentId })
}

export async function restoreChatAttachment(attachmentId: string): Promise<void> {
  const { error } = await getSupabase().rpc('restore_chat_attachment', {
    target_attachment_id: attachmentId,
  })
  if (error) fail(error, { fn: 'restore_chat_attachment', attachmentId })
}

export async function listChatAttachmentDownloads(
  attachmentId: string,
): Promise<ChatDownloadRecord[]> {
  const { data, error } = await getSupabase().rpc(
    'list_chat_attachment_downloads',
    { target_attachment_id: attachmentId },
  )
  if (error) fail(error, { fn: 'list_chat_attachment_downloads', attachmentId })
  return (
    (data ?? []) as {
      profile_id: string
      display_name: string
      downloaded_at: string
    }[]
  ).map((row) => ({
    profileId: row.profile_id,
    displayName: row.display_name,
    downloadedAt: row.downloaded_at,
  }))
}

export async function purgeChatAttachment(attachment: {
  id: string
  objectPath: string
  thumbPath: string | null
}): Promise<void> {
  const { error } = await getSupabase().rpc('purge_chat_attachment', {
    target_attachment_id: attachment.id,
  })
  if (error) fail(error, { fn: 'purge_chat_attachment', attachmentId: attachment.id })
  const paths = [attachment.objectPath, attachment.thumbPath].filter(
    (path): path is string => Boolean(path),
  )
  await removeChatObjects(paths).catch((removeError: unknown) => {
    console.warn('[chat] 영구 삭제 뒤 저장소 정리 실패', {
      attachmentId: attachment.id,
      message:
        removeError instanceof Error ? removeError.message : String(removeError),
    })
  })
}

export async function deleteChatMessage(messageId: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_chat_message', {
    target_message_id: messageId,
  })
  if (error) fail(error, { fn: 'delete_chat_message', messageId })
}

