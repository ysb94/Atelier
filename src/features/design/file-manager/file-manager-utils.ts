import {
  CDN_BASE,
  DEFAULT_FILE_ICON_META,
  DEFAULT_LIST_WORKER_BASE,
  FILE_TYPE_ICON_META,
  LIST_WORKER_STORAGE_KEY,
  R2_BRAND_ROOT,
  ROOT_FOLDER,
  UPLOAD_WORKER_BASE,
  VIDEO_UPLOAD_EXTENSIONS,
} from './file-manager-config'
import type {
  FolderGroup,
  FormattedLogSentence,
  GridSortMode,
  HistoryLogEntry,
  ServerFileItem,
} from './types'

export function sanitizeNameInput(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/[/\\]/g, '')
}

export function normalizeWorkerBase(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function getListWorkerBase(): string {
  const saved =
    typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(LIST_WORKER_STORAGE_KEY)
  return normalizeWorkerBase(saved || DEFAULT_LIST_WORKER_BASE)
}

function encodeStorageKey(key: string): string {
  return String(key)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

export function buildPublicUrl(storageKey: string): string {
  return `${CDN_BASE}/${encodeStorageKey(storageKey)}`
}

export function buildWorkerAssetUrl(storageKey: string): string {
  return `${UPLOAD_WORKER_BASE}/${encodeStorageKey(storageKey)}`
}

export function buildUploadUrl(
  targetPath: string,
  fileName: string,
  forceOverwrite = false,
): string {
  let url = `${UPLOAD_WORKER_BASE}/${encodeStorageKey(targetPath)}/${encodeURIComponent(fileName)}`
  if (forceOverwrite) url += '?overwrite=true'
  return url
}

export function getItemStorageKey(
  item: ServerFileItem,
  type: string,
  activeFolder?: string | null,
  activeBrowseType?: string | null,
): string {
  if (item.key) return item.key

  const relative = item.relativePath || item.name || item.displayName || ''
  if (relative.includes('/')) return `${type}/${relative}`
  if (activeFolder && activeBrowseType === type) {
    return `${type}/${activeFolder}/${relative}`
  }
  return `${type}/${relative}`
}

export function getItemKey(item: ServerFileItem, type: string): string {
  return item.key || `${type}/${item.relativePath || item.name || ''}`
}

export function getItemPublicUrl(
  item: ServerFileItem,
  type: string,
  activeFolder?: string | null,
  activeBrowseType?: string | null,
): string {
  return buildPublicUrl(
    getItemStorageKey(item, type, activeFolder, activeBrowseType),
  )
}

export function getItemDisplayUrl(
  item: ServerFileItem,
  type: string,
  activeFolder?: string | null,
  activeBrowseType?: string | null,
): string {
  const key = getItemStorageKey(item, type, activeFolder, activeBrowseType)
  return isVideoItem(item, type) ? buildWorkerAssetUrl(key) : buildPublicUrl(key)
}

export function getRelativePath(item: ServerFileItem, type: string): string {
  const source = item.key || `${type}/${item.name || ''}`
  for (const prefix of [`${R2_BRAND_ROOT}/${type}/`, `${type}/`]) {
    if (source.startsWith(prefix)) return source.slice(prefix.length)
  }
  return item.name || source
}

export function splitFolderAndFile(relativePath: string): {
  folder: string
  fileName: string
} {
  const lastSlash = relativePath.lastIndexOf('/')
  if (lastSlash === -1) return { folder: ROOT_FOLDER, fileName: relativePath }
  return {
    folder: relativePath.slice(0, lastSlash),
    fileName: relativePath.slice(lastSlash + 1),
  }
}

export function groupItemsByFolder(
  items: ServerFileItem[],
  type: string,
): FolderGroup[] {
  const groups = new Map<string, ServerFileItem[]>()
  const ensureGroup = (folder: string) => {
    if (!groups.has(folder)) groups.set(folder, [])
  }

  for (const item of items) {
    const relativePath = getRelativePath(item, type)
    if (relativePath.endsWith('/')) {
      const folderName = relativePath.replace(/\/+$/, '')
      if (folderName) ensureGroup(folderName)
      continue
    }

    const { folder, fileName } = splitFolderAndFile(relativePath)
    ensureGroup(folder)
    groups.get(folder)?.push({ ...item, displayName: fileName, relativePath })
  }

  return [...groups.keys()]
    .sort((a, b) => {
      if (a === ROOT_FOLDER) return 1
      if (b === ROOT_FOLDER) return -1
      return a.localeCompare(b, 'ko')
    })
    .map((folder) => ({
      folder,
      items: (groups.get(folder) || []).sort((a, b) =>
        (a.displayName || '').localeCompare(b.displayName || '', 'ko'),
      ),
    }))
}

export function getFolderDisplayName(folder: string): string {
  if (folder === ROOT_FOLDER) return '루트'
  const slash = folder.lastIndexOf('/')
  return slash === -1 ? folder : folder.slice(slash + 1)
}

export function getParentFolderPath(folder: string): string | null {
  if (!folder) return null
  const slash = folder.lastIndexOf('/')
  return slash === -1 ? null : folder.slice(0, slash)
}

export function buildFolderPrefix(type: string, folder: string): string {
  return folder === ROOT_FOLDER ? `${type}/` : `${type}/${folder}/`
}

export function getFolderSelectionKey(folder: string, type: string): string {
  return `folder::${type}::${folder}`
}

export function parseFolderSelectionKey(
  key: string,
): { type: string; folder: string } | null {
  if (!key.startsWith('folder::')) return null
  const body = key.slice(8)
  const splitAt = body.indexOf('::')
  if (splitAt === -1) return null
  return { type: body.slice(0, splitAt), folder: body.slice(splitAt + 2) }
}

export function getBrowseTypeSelectionKey(browseType: string): string {
  return `browse::${browseType}`
}

export function getImmediateChildFolders(
  groups: FolderGroup[],
  parentFolder: string | null,
  rootFolder = ROOT_FOLDER,
): string[] {
  const children = new Set<string>()
  for (const group of groups) {
    if (group.folder === rootFolder) continue
    if (!parentFolder) {
      const slash = group.folder.indexOf('/')
      children.add(slash === -1 ? group.folder : group.folder.slice(0, slash))
      continue
    }
    if (group.folder === parentFolder) continue
    const prefix = `${parentFolder}/`
    if (!group.folder.startsWith(prefix)) continue
    const child = group.folder.slice(prefix.length).split('/')[0]
    if (child) children.add(`${parentFolder}/${child}`)
  }
  return [...children].sort((a, b) => a.localeCompare(b, 'ko'))
}

export function isVideoFileName(name: string): boolean {
  const dot = String(name).lastIndexOf('.')
  return dot !== -1 && VIDEO_UPLOAD_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

export function isVideoItem(item: ServerFileItem, type: string): boolean {
  return type === 'video' || /\.(mp4|webm|mov)$/i.test(getItemFileName(item))
}

export function isImageItem(item: ServerFileItem, type: string): boolean {
  return (
    type === 'image' ||
    type === 'spin360' ||
    /\.(jpg|jpeg|png|gif|webp)$/i.test(getItemFileName(item))
  )
}

export function isGifItem(item: ServerFileItem): boolean {
  return /\.gif$/i.test(getItemFileName(item))
}

export function buildEmbedKeyForUpload(
  _targetPath: string,
  fileName: string,
): string | null {
  const dot = fileName.lastIndexOf('.')
  if (!fileName || dot === -1) return null
  return `embed/${fileName.slice(0, dot)}.html`
}

export function buildMediaTag(
  type: string,
  url: string,
  item: ServerFileItem | null = null,
): string {
  return item && isVideoItem(item, type) || type === 'video'
    ? `<video src="${url}" controls></video>`
    : `<img src="${url}">`
}

export function ensureTagBreak(tag: string): string {
  return tag.endsWith('<br>') ? tag : `${tag}<br>`
}

export function formatFileSize(bytes?: number): string {
  if (bytes == null || Number.isNaN(bytes)) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatUploadedDate(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ko-KR')
}

export function itemMatchesSearch(item: ServerFileItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  return `${item.displayName || ''} ${item.relativePath || ''} ${item.name || ''}`
    .toLowerCase()
    .includes(normalizedQuery)
}

export function sortItemsForGrid(
  items: ServerFileItem[],
  mode: GridSortMode = 'name',
): ServerFileItem[] {
  const list = [...items]
  const byName = (a: ServerFileItem, b: ServerFileItem) =>
    (a.displayName || '').localeCompare(b.displayName || '', 'ko')
  if (mode === 'name-desc') return list.sort((a, b) => byName(b, a))
  if (mode === 'date') {
    return list.sort(
      (a, b) => new Date(b.uploaded || 0).getTime() - new Date(a.uploaded || 0).getTime(),
    )
  }
  if (mode === 'date-desc') {
    return list.sort(
      (a, b) => new Date(a.uploaded || 0).getTime() - new Date(b.uploaded || 0).getTime(),
    )
  }
  return list.sort(byName)
}

export function sortGlobalSearchMatches<
  T extends { item: ServerFileItem },
>(matches: T[], mode: GridSortMode = 'name'): T[] {
  return sortItemsForGrid(
    matches.map((entry) => entry.item),
    mode,
  ).map((item) => matches.find((entry) => entry.item === item) as T)
}

export function getItemFileName(item?: ServerFileItem | null): string {
  if (!item) return ''
  for (const field of ['displayName', 'name', 'relativePath', 'key'] as const) {
    const value = item[field]
    if (typeof value === 'string' && value.trim()) {
      const base = value.split('/').pop() || value
      if (!base.endsWith('/')) return base
    }
  }
  return ''
}

export function getItemExtension(item?: ServerFileItem | null): string {
  const fileName = getItemFileName(item)
  const dot = fileName.lastIndexOf('.')
  return dot <= 0 || dot === fileName.length - 1
    ? ''
    : fileName.slice(dot + 1).toLowerCase()
}

export function getFileTypeIconMetaByExtension(ext: string) {
  return (
    FILE_TYPE_ICON_META[ext as keyof typeof FILE_TYPE_ICON_META] ||
    DEFAULT_FILE_ICON_META
  )
}

export function getListTypeIconMeta(
  item?: ServerFileItem | null,
  type?: string | null,
  kind: 'file' | 'folder' | 'parent' | 'browse' = 'file',
) {
  if (kind === 'parent') return { icon: '↩', title: '상위 폴더' }
  if (kind === 'folder') return { icon: '📁', title: '폴더' }
  if (kind === 'browse') return { icon: '📁', title: `${type || '타입'} 폴더` }
  return getFileTypeIconMetaByExtension(getItemExtension(item))
}

export async function copyText(text: string): Promise<boolean> {
  if (!globalThis.isSecureContext || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function stripTrailingSlash(path: string): string {
  return String(path || '').replace(/\/+$/, '')
}

export function getPathFolder(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function getPathBaseName(path: string): string {
  const clean = stripTrailingSlash(path)
  const slash = clean.lastIndexOf('/')
  return slash === -1 ? clean : clean.slice(slash + 1)
}

export function formatLogTimestamp(ts?: string): string {
  try {
    return new Date(ts || '')
      .toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })
      .replace('T', ' ')
  } catch {
    return ts || ''
  }
}

export function formatLogSentenceParts(entry: HistoryLogEntry): FormattedLogSentence {
  const text = (value: unknown) => ({ kind: 'text' as const, value: String(value) })
  const quote = (value: unknown) => ({ kind: 'quote' as const, value: String(value || '') })
  switch (entry.action) {
    case 'upload':
      return { type: 'upload', parts: [quote(getPathFolder(entry.path || '')), text(' 폴더에 '), quote(getPathBaseName(entry.path || '')), text(' 파일을 추가했습니다.')] }
    case 'delete':
      return { type: 'delete', parts: [quote(getPathFolder(entry.path || '')), text(' 폴더에서 '), quote(getPathBaseName(entry.path || '')), text(' 파일을 삭제했습니다.')] }
    case 'rename':
      return { type: 'rename', parts: [quote(entry.from), text(' 파일 이름을 '), quote(entry.to), text('(으)로 변경했습니다.')] }
    case 'mkdir':
      return { type: 'mkdir', parts: [quote(stripTrailingSlash(entry.path || '')), text(' 폴더를 생성했습니다.')] }
    case 'rmdir':
      return { type: 'rmdir', parts: [quote(stripTrailingSlash(entry.path || '')), text(` 폴더와 안의 항목 ${entry.count || 0}개를 삭제했습니다.`)] }
    case 'mvdir':
      return { type: 'mvdir', parts: [quote(stripTrailingSlash(entry.from || '')), text(' 폴더를 '), quote(stripTrailingSlash(entry.to || '')), text(`(으)로 이동했습니다. (${entry.count || 0}개)`)] }
    default:
      return { type: entry.action, parts: [text(JSON.stringify(entry))] }
  }
}

export function getUploadJobKey(job: {
  targetPath: string
  file: { name: string }
}): string {
  return `${job.targetPath}/${job.file.name}`
}

export function findQueueInternalDuplicateKeys(
  jobs: Array<{ targetPath: string; file: { name: string } }>,
): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const job of jobs) {
    const key = getUploadJobKey(job)
    if (seen.has(key)) duplicates.add(key)
    else seen.add(key)
  }
  return [...duplicates]
}

export function findQueueInternalEmbedDuplicateKeys(
  jobs: Array<{ targetPath: string; file: { name: string } }>,
): string[] {
  const seen = new Map<string, string>()
  const duplicates = new Set<string>()
  for (const job of jobs) {
    if (!isVideoFileName(job.file.name)) continue
    const embedKey = buildEmbedKeyForUpload(job.targetPath, job.file.name)
    if (!embedKey) continue
    const uploadKey = getUploadJobKey(job)
    const previous = seen.get(embedKey)
    if (previous && previous !== uploadKey) {
      duplicates.add(`${previous}\n${uploadKey}\n→ ${embedKey}`)
    } else {
      seen.set(embedKey, uploadKey)
    }
  }
  return [...duplicates]
}

export function getCurrentMonthKey(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}
