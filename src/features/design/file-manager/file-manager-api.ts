import { UPLOAD_WORKER_BASE } from './file-manager-config'
import type { HistoryLogEntry, ServerFileItem, UploadConflictResult } from './types'
import {
  buildEmbedKeyForUpload,
  buildUploadUrl,
  buildWorkerAssetUrl,
  getItemStorageKey,
  getListWorkerBase,
  getUploadJobKey,
  isVideoFileName,
} from './file-manager-utils'

const serverListCache = new Map<string, ServerFileItem[]>()

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${UPLOAD_WORKER_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  let data: T | { error?: string } | null = null
  try {
    data = (await response.json()) as T
  } catch {
    // 빈 응답은 허용한다.
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String(data.error)
        : `HTTP ${response.status}`
    throw new Error(message)
  }
  return data as T
}

export function apiDelete(key: string): Promise<unknown> {
  const encodedKey = String(key)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return apiRequest(`/${encodedKey}`, { method: 'DELETE' })
}

export function apiMove(from: string, to: string): Promise<unknown> {
  return apiRequest('/move', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  })
}

export function apiMkdir(path: string): Promise<unknown> {
  return apiRequest('/mkdir', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export function apiRmdir(prefix: string): Promise<unknown> {
  return apiRequest('/rmdir', {
    method: 'POST',
    body: JSON.stringify({ prefix }),
  })
}

export function apiMvdir(from: string, to: string): Promise<unknown> {
  return apiRequest('/mvdir', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  })
}

export async function fetchTopLevelFolders(): Promise<string[]> {
  const response = await fetch(`${getListWorkerBase()}/folders`)
  if (response.status === 404 || response.status === 405) {
    throw new Error('FOLDERS_API_NOT_READY')
  }
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  const data = (await response.json()) as { folders?: unknown }
  if (!Array.isArray(data?.folders)) throw new Error('INVALID_RESPONSE')
  return data.folders.filter((folder): folder is string => typeof folder === 'string')
}

export async function fetchServerFiles(type: string): Promise<ServerFileItem[]> {
  const listWorkerBase = getListWorkerBase()
  const response = await fetch(
    `${listWorkerBase}/list?type=${encodeURIComponent(type)}`,
  )
  if (response.status === 404 || response.status === 405) {
    throw new Error('LIST_API_NOT_READY')
  }
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  const data = (await response.json()) as { items?: unknown }
  if (!Array.isArray(data?.items)) throw new Error('INVALID_RESPONSE')
  const items = data.items as ServerFileItem[]
  serverListCache.set(`${listWorkerBase}::${type}`, items)
  return items
}

export function setServerListCache(type: string, items: ServerFileItem[]): void {
  serverListCache.set(`${getListWorkerBase()}::${type}`, items)
}

export function getCachedServerList(type: string): ServerFileItem[] | undefined {
  return serverListCache.get(`${getListWorkerBase()}::${type}`)
}

export function invalidateServerListCache(type?: string): void {
  if (type) {
    serverListCache.delete(`${getListWorkerBase()}::${type}`)
  } else {
    serverListCache.clear()
  }
}

export function lookupEmbedExistsInCache(embedKey: string): boolean | null {
  const cacheKey = `${getListWorkerBase()}::embed`
  const items = serverListCache.get(cacheKey)
  if (!items) return null
  const embedName = embedKey.startsWith('embed/')
    ? embedKey.slice('embed/'.length)
    : embedKey
  return items.some((item) => {
    const key = item.key || `embed/${item.name || ''}`
    return key === embedKey || item.name === embedName
  })
}

export async function checkEmbedExists(embedKey: string): Promise<boolean> {
  if (lookupEmbedExistsInCache(embedKey) === true) return true
  try {
    return (await fetch(buildWorkerAssetUrl(embedKey), { method: 'HEAD' })).ok
  } catch {
    return false
  }
}

export function lookupExistsInListCache(
  targetPath: string,
  fileName: string,
): boolean | null {
  const type = targetPath.split('/')[0]
  if (!type) return null
  const items = serverListCache.get(`${getListWorkerBase()}::${type}`)
  if (!items) return null
  const storageKey = `${targetPath}/${fileName}`
  return items.some((item) => getItemStorageKey(item, type) === storageKey)
}

export async function checkUploadExists(
  targetPath: string,
  fileName: string,
): Promise<boolean> {
  if (lookupExistsInListCache(targetPath, fileName) === true) return true
  try {
    return (await fetch(buildUploadUrl(targetPath, fileName), { method: 'HEAD' })).ok
  } catch {
    return false
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker),
  )
  return results
}

export async function classifyUploadConflict(
  job: { targetPath: string; file: File },
): Promise<'file' | 'embed' | 'none'> {
  if (await checkUploadExists(job.targetPath, job.file.name)) return 'file'
  if (!isVideoFileName(job.file.name)) return 'none'
  const embedKey = buildEmbedKeyForUpload(job.targetPath, job.file.name)
  return embedKey && (await checkEmbedExists(embedKey)) ? 'embed' : 'none'
}

export async function findUploadConflicts<T extends { targetPath: string; file: File }>(
  jobs: T[],
): Promise<UploadConflictResult<T>> {
  const conflicts = await mapWithConcurrency(jobs, 20, classifyUploadConflict)
  return {
    fileDuplicates: jobs.filter((_, index) => conflicts[index] === 'file'),
    embedDuplicates: jobs.filter((_, index) => conflicts[index] === 'embed'),
    duplicateKeys: new Set(
      jobs
        .filter((_, index) => conflicts[index] !== 'none')
        .map(getUploadJobKey),
    ),
  }
}

export async function fetchLogMonths(): Promise<string[]> {
  const response = await fetch(`${UPLOAD_WORKER_BASE}/logs/months`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = (await response.json()) as { months?: unknown }
  return Array.isArray(data.months)
    ? data.months.filter((month): month is string => typeof month === 'string')
    : []
}

export async function fetchLogMonth(month: string): Promise<HistoryLogEntry[]> {
  const response = await fetch(
    `${UPLOAD_WORKER_BASE}/logs?month=${encodeURIComponent(month)}`,
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = (await response.json()) as { entries?: unknown }
  return Array.isArray(data.entries) ? (data.entries as HistoryLogEntry[]) : []
}

export function uploadFilePut(
  file: File,
  targetPath: string,
  forceOverwrite = false,
): Promise<Response> {
  return fetch(buildUploadUrl(targetPath, file.name, forceOverwrite), {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
}
