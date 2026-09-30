/**
 * 채팅 파일 규칙. 서버 `begin_chat_attachment` 와 같은 목록을 쓴다.
 * 유료 전환 때 CHAT_FILE_MAX_BYTES 와 company-chat 버킷 file_size_limit 를
 * 함께 100MB(104857600)로 올린다.
 */

export const CHAT_FILE_MAX_BYTES = 50 * 1024 * 1024
export const CHAT_FILE_MAX_COUNT = 10
/** Free 플랜 저장 용량. 유료 전환 후 표시는 100GB로 바꾼다. */
export const CHAT_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024
export const CHAT_FILE_NAME_MAX_LENGTH = 180

export const CHAT_BLOCKED_EXTENSIONS = [
  'exe',
  'msi',
  'bat',
  'cmd',
  'ps1',
  'vbs',
  'js',
  'scr',
  'com',
  'cpl',
  'msc',
  'jar',
  'dll',
  'hta',
  'wsf',
  'gadget',
  'pif',
  'lnk',
  'reg',
] as const

export const CHAT_MACRO_EXTENSIONS = [
  'xls',
  'xlsm',
  'xlsb',
  'xltm',
  'xlam',
  'docm',
  'dotm',
  'pptm',
  'potm',
  'ppam',
] as const

const BLOCKED = new Set<string>(CHAT_BLOCKED_EXTENSIONS)
const MACRO = new Set<string>(CHAT_MACRO_EXTENSIONS)

/** 받은 파일은 올린 이름을 유지한다. Windows가 거부하는 문자만 바꾼다. */
export function chatDownloadFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned.slice(0, CHAT_FILE_NAME_MAX_LENGTH) || '파일'
}

export function chatFileExtension(name: string): string {
  const trimmed = name.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0 || dot === trimmed.length - 1) return ''
  return trimmed.slice(dot + 1).toLowerCase()
}

export function chatFileHasMacro(name: string): boolean {
  return MACRO.has(chatFileExtension(name))
}

export function chatFileBlockReason(file: {
  name: string
  size: number
}): string | null {
  const name = file.name.trim()
  if (!name || name.length > CHAT_FILE_NAME_MAX_LENGTH) {
    return '파일 이름은 1자에서 180자까지입니다.'
  }
  if (BLOCKED.has(chatFileExtension(name))) {
    return '실행 파일은 올릴 수 없습니다.'
  }
  if (file.size <= 0 || file.size > CHAT_FILE_MAX_BYTES) {
    return '파일은 1바이트에서 50MB까지 올릴 수 있습니다.'
  }
  return null
}

export function formatChatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0B'
  if (bytes < 1024) return `${Math.round(bytes)}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}
