import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_BROWSE_TYPES, GLOBAL_SEARCH_KEY, GRID_BATCH_SIZE, GRID_SORT_KEY,
  GRID_VIEW_KEY, PREVIEW_MAX_WIDTH, PREVIEW_MIN_WIDTH, PREVIEW_WIDTH_KEY,
  ROOT_FOLDER, TAG_PANEL_HEIGHT_KEY, TAG_PANEL_MAX_HEIGHT, TAG_PANEL_MIN_HEIGHT,
} from './file-manager-config'
import {
  apiDelete, apiMkdir, apiMove, apiMvdir, apiRmdir, fetchLogMonth, fetchLogMonths,
  fetchServerFiles, fetchTopLevelFolders, findUploadConflicts, getCachedServerList,
  invalidateServerListCache, uploadFilePut,
} from './file-manager-api'
import type { AccumulatedTag, ContextMenuItem, FolderGroup, GridSortMode, GridViewMode, HistoryLogEntry, PreviewSelection, SelectionEntry, ServerFileItem, UiDialogConfig, UploadQueueItem } from './types'
import {
  buildFolderPrefix, buildMediaTag, copyText, ensureTagBreak, findQueueInternalDuplicateKeys,
  findQueueInternalEmbedDuplicateKeys, formatLogSentenceParts, getCurrentMonthKey,
  getFolderDisplayName, getItemKey, getItemPublicUrl, getItemStorageKey,
  getParentFolderPath, getUploadJobKey, groupItemsByFolder, itemMatchesSearch,
  sanitizeNameInput, sortGlobalSearchMatches, sortItemsForGrid,
} from './file-manager-utils'

export interface GlobalSearchMatch { item: ServerFileItem; type: string; locationLabel: string }
export type ContextMenuState = { x: number; y: number; items: ContextMenuItem[] } | null
type DialogRequest = { config: UiDialogConfig; resolve: (value: string | boolean | undefined | null) => void }

const readNumber = (key: string, fallback: number) => {
  const value = Number(localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function useDesignFileManager() {
  const [browseTypes, setBrowseTypes] = useState<string[]>(DEFAULT_BROWSE_TYPES)
  const [activeBrowseType, setActiveBrowseType] = useState<string | null>(null)
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [currentGroups, setCurrentGroups] = useState<FolderGroup[]>([])
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectionEntry>>(new Map())
  const [selectedPreview, setSelectedPreview] = useState<PreviewSelection | null>(null)
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [globalSearchEnabled, setGlobalSearchEnabled] = useState(() => localStorage.getItem(GLOBAL_SEARCH_KEY) === 'true')
  const [globalSearchMatches, setGlobalSearchMatches] = useState<GlobalSearchMatch[]>([])
  const [globalSearching, setGlobalSearching] = useState(false)
  const [gridSortMode, setGridSortModeState] = useState<GridSortMode>(() => (localStorage.getItem(GRID_SORT_KEY) as GridSortMode) || 'name')
  const [gridViewMode, setGridViewModeState] = useState<GridViewMode>(() => (localStorage.getItem(GRID_VIEW_KEY) as GridViewMode) || 'normal')
  const [gridVisibleLimit, setGridVisibleLimit] = useState(GRID_BATCH_SIZE)
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([])
  const [accumulatedTags, setAccumulatedTags] = useState<AccumulatedTag[]>([])
  const [activeTagUid, setActiveTagUid] = useState<number | null>(null)
  const [busyCount, setBusyCount] = useState(0)
  const [busyMessage, setBusyMessage] = useState('작업 처리 중...')
  const [sidebarStatus, setSidebarStatus] = useState({ message: '타입을 선택하세요.', kind: 'info' })
  const [previewWidth, setPreviewWidthState] = useState(() => Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, readNumber(PREVIEW_WIDTH_KEY, PREVIEW_MAX_WIDTH))))
  const [tagPanelHeight, setTagPanelHeightState] = useState(() => Math.min(TAG_PANEL_MAX_HEIGHT, Math.max(TAG_PANEL_MIN_HEIGHT, readNumber(TAG_PANEL_HEIGHT_KEY, 160))))
  const [dialogs, setDialogs] = useState<DialogRequest[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<HistoryLogEntry[]>([])
  const [historyMonths, setHistoryMonths] = useState<string[]>([])
  const [historyMonthIndex, setHistoryMonthIndex] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const tagUid = useRef(0)
  const searchRequest = useRef(0)

  const withBusy = useCallback(async <T,>(message: string, action: () => Promise<T>) => {
    setBusyCount((count) => count + 1); setBusyMessage(message)
    try { return await action() } finally { setBusyCount((count) => Math.max(0, count - 1)) }
  }, [])
  const uiDialog = useCallback((config: UiDialogConfig) => new Promise<string | boolean | undefined | null>((resolve) => setDialogs((queue) => [...queue, { config, resolve }])), [])
  const closeDialog = useCallback((value: string | boolean | undefined | null) => setDialogs((queue) => {
    const current = queue[0]; current?.resolve(value); return queue.slice(1)
  }), [])
  const uiAlert = useCallback((message: string, options: Partial<UiDialogConfig> = {}) => uiDialog({ mode: 'alert', message, title: '알림', ...options }), [uiDialog])
  const uiConfirm = useCallback(async (message: string, options: Partial<UiDialogConfig> = {}) => Boolean(await uiDialog({ mode: 'confirm', message, title: '확인', ...options })), [uiDialog])
  const uiPrompt = useCallback(async (message: string, defaultValue = '', options: Partial<UiDialogConfig> = {}) => {
    const result = await uiDialog({ mode: 'prompt', message, defaultValue, title: '입력', ...options })
    return typeof result === 'string' ? result : null
  }, [uiDialog])
  const clearSelection = useCallback(() => { setSelectedItems(new Map()); setSelectedPreview(null); setLastSelectedKey(null) }, [])
  const loadBrowseTypes = useCallback(async () => {
    try {
      const folders = await fetchTopLevelFolders()
      setBrowseTypes([...DEFAULT_BROWSE_TYPES, ...folders.filter((x) => x && x !== 'logs' && !DEFAULT_BROWSE_TYPES.includes(x))])
    } catch { setBrowseTypes(DEFAULT_BROWSE_TYPES) }
  }, [])
  const busyCountRef = useRef(0)
  busyCountRef.current = busyCount
  const refreshServerFiles = useCallback(async (force = false) => {
    if (!activeBrowseType) return
    const type = activeBrowseType
    const load = async () => {
      setSidebarStatus({ message: '서버 파일 목록을 불러오는 중...', kind: 'loading' })
      try {
        const items = !force ? getCachedServerList(type) ?? await fetchServerFiles(type) : await fetchServerFiles(type)
        const groups = groupItemsByFolder(items, type)
        setCurrentGroups(groups); clearSelection()
        const count = groups.reduce((sum, group) => sum + group.items.length, 0)
        setSidebarStatus({ message: groups.length ? `${count}개 파일 · ${groups.filter((g) => g.folder !== ROOT_FOLDER).length}개 폴더` : `masmarulez/${type}에 파일이 없습니다.`, kind: 'info' })
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        setSidebarStatus({ message: message === 'LIST_API_NOT_READY' ? '목록 API가 아직 준비되지 않았습니다. Worker에 GET /list?type=... 를 추가해주세요.' : '목록을 불러오지 못했습니다. 네트워크 또는 CORS를 확인해주세요.', kind: 'error' })
      }
    }
    return busyCountRef.current > 0 ? load() : withBusy('서버 파일 목록을 불러오는 중...', load)
  }, [activeBrowseType, clearSelection, withBusy])
  const selectBrowseType = useCallback((type: string | null) => {
    setActiveBrowseType(type); setActiveFolder(null); setGridVisibleLimit(GRID_BATCH_SIZE); clearSelection()
    if (!type) { setCurrentGroups([]); setSidebarStatus({ message: '타입을 선택하세요.', kind: 'info' }) }
  }, [clearSelection])
  useEffect(() => { if (activeBrowseType) void refreshServerFiles() }, [activeBrowseType, refreshServerFiles])
  const selectFolder = useCallback((folder: string | null) => { setActiveFolder(folder); setGridVisibleLimit(GRID_BATCH_SIZE); clearSelection() }, [clearSelection])
  const currentUploadPath = activeBrowseType ? (activeFolder ? `${activeBrowseType}/${activeFolder}` : activeBrowseType) : null
  const setGridSortMode = useCallback((mode: GridSortMode) => { localStorage.setItem(GRID_SORT_KEY, mode); setGridSortModeState(mode) }, [])
  const setGridViewMode = useCallback((mode: GridViewMode) => { localStorage.setItem(GRID_VIEW_KEY, mode); setGridViewModeState(mode) }, [])
  const setGlobalSearch = useCallback((value: boolean) => { localStorage.setItem(GLOBAL_SEARCH_KEY, String(value)); setGlobalSearchEnabled(value); setGridVisibleLimit(GRID_BATCH_SIZE) }, [])
  useEffect(() => {
    if (!globalSearchEnabled || !searchQuery.trim()) { setGlobalSearchMatches([]); return }
    const request = ++searchRequest.current; setGlobalSearching(true)
    void Promise.all(browseTypes.map(async (type) => {
      try { return { type, items: getCachedServerList(type) ?? await fetchServerFiles(type) } } catch { return { type, items: [] as ServerFileItem[] } }
    })).then((lists) => {
      if (request !== searchRequest.current) return
      const matches = lists.flatMap(({ type, items }) =>
        groupItemsByFolder(items, type).flatMap((group) =>
          group.items
            .filter((item) => itemMatchesSearch(item, searchQuery))
            .map((item) => ({
              item,
              type,
              locationLabel: `${type}/${item.relativePath || item.name || ''}`,
            })),
        ),
      )
      setGlobalSearchMatches(sortGlobalSearchMatches(matches, gridSortMode))
    }).finally(() => { if (request === searchRequest.current) setGlobalSearching(false) })
  }, [browseTypes, globalSearchEnabled, gridSortMode, searchQuery])
  const selectEntry = useCallback((key: string, entry: SelectionEntry, modifiers: { toggle?: boolean; append?: boolean } = {}) => {
    setSelectedItems((old) => {
      const next = modifiers.append || modifiers.toggle ? new Map(old) : new Map<string, SelectionEntry>()
      if (modifiers.toggle && next.has(key)) { next.delete(key); setSelectedPreview((preview) => preview && getItemKey(preview.item, preview.type) === key ? null : preview); return next }
      next.set(key, entry); return next
    })
    setLastSelectedKey(key)
    if (entry.kind === 'file') setSelectedPreview({ item: entry.item, type: entry.type })
  }, [])
  const selectRange = useCallback((entries: Array<{ key: string; entry: SelectionEntry }>, target: string) => {
    const anchor = lastSelectedKey ?? target; const a = entries.findIndex((x) => x.key === anchor); const b = entries.findIndex((x) => x.key === target)
    if (a < 0 || b < 0) return
    const range = entries.slice(Math.min(a, b), Math.max(a, b) + 1)
    setSelectedItems(new Map(range.map(({ key, entry }) => [key, entry])))
    setLastSelectedKey(target)
    const file = [...range].reverse().find((x) => x.entry.kind === 'file')?.entry
    if (file?.kind === 'file') setSelectedPreview({ item: file.item, type: file.type })
  }, [lastSelectedKey])
  const selectAllVisible = useCallback((entries: Array<{ key: string; entry: SelectionEntry }>) => {
    if (!entries.length) return
    setSelectedItems(new Map(entries.map(({ key, entry }) => [key, entry])))
    setLastSelectedKey(entries[entries.length - 1]?.key ?? null)
    const file = [...entries].reverse().find((x) => x.entry.kind === 'file')?.entry
    if (file?.kind === 'file') setSelectedPreview({ item: file.item, type: file.type })
    else setSelectedPreview(null)
  }, [])
  const enqueueFiles = useCallback(async (files: FileList | File[], targetPath = currentUploadPath) => {
    if (!targetPath) { await uiAlert('업로드할 폴더를 먼저 선택하세요. (왼쪽 사이드바에서 폴더를 열어주세요)'); return }
    setUploadQueue((queue) => [...queue, ...Array.from(files).map((file) => ({ id: crypto.randomUUID(), file, targetPath, status: 'pending' as const }))])
  }, [currentUploadPath, uiAlert])
  const uploadSingle = useCallback(async (job: UploadQueueItem, forceOverwrite = false, suppressConfirm = false): Promise<'success' | 'failed' | 'skipped'> => {
    setUploadQueue((queue) => queue.map((x) => x.id === job.id ? { ...x, status: 'uploading' } : x))
    try {
      const response = await uploadFilePut(job.file, job.targetPath, forceOverwrite)
      if (response.status === 409 && !forceOverwrite && !suppressConfirm) {
        const body = await response.text(); const embed = body.includes('Embed')
        const overwrite = await uiConfirm(embed
          ? `[태그(embed HTML) 중복]\n\n"${job.file.name}" 원본 파일명은 현재 업로드 폴더에서 중복이 아닐 수 있지만,\niframe용 HTML을 embed 폴더에 만들 때 같은 태그 파일명이 이미 있습니다.\n\n생성 예정 태그 파일:\nembed/${job.file.name.replace(/\.[^.]+$/, '')}.html\n\n덮어쓰면 기존 iframe 태그 HTML이 교체됩니다.\n취소 후 파일명을 바꿔 다시 넣을 수 있습니다.\n\n덮어쓸까요?`
          : `[원본 파일 중복]\n\n업로드하려는 현재 폴더 안에 같은 파일명이 이미 있습니다.\n\n기존 파일:\n${job.targetPath}/${job.file.name}\n\n덮어쓰면 해당 폴더의 기존 파일이 교체됩니다.\n\n덮어쓸까요?`, { title: embed ? '태그 중복' : '파일 중복' })
        return overwrite ? uploadSingle(job, true) : 'skipped'
      }
      if (!response.ok) throw new Error(String(response.status))
      setUploadQueue((queue) => queue.map((x) => x.id === job.id ? { ...x, status: 'completed' } : x))
      invalidateServerListCache(job.targetPath.split('/')[0])
      if (currentUploadPath === job.targetPath) await refreshServerFiles(true)
      return 'success'
    } catch {
      setUploadQueue((queue) => queue.map((x) => x.id === job.id ? { ...x, status: 'failed' } : x))
      if (!suppressConfirm) await uiAlert(`업로드 중 오류 발생: ${job.file.name}`)
      return 'failed'
    }
  }, [currentUploadPath, refreshServerFiles, uiAlert, uiConfirm])
  const uploadAllPending = useCallback(async () => {
    const jobs = uploadQueue.filter((x) => x.status !== 'completed')
    if (!jobs.length) { await uiAlert('업로드할 파일이 없습니다.'); return }
    const duplicates = findQueueInternalDuplicateKeys(jobs)
    if (duplicates.length) { await uiAlert(`[대기열 내부 중복]\n\n아직 서버와 비교하기 전 단계에서, 업로드 대기열 안에 같은 업로드 경로와 파일명이 중복되어 있습니다.\n같은 파일이 두 번 올라가지 않도록 중복 항목을 정리한 뒤 다시 시도해주세요.\n\n중복 경로:\n${duplicates.slice(0, 10).join('\n')}`); return }
    if (findQueueInternalEmbedDuplicateKeys(jobs).length) { await uiAlert('[대기열 내부 태그(embed HTML) 중복]\n\n서로 다른 업로드 경로의 비디오가 같은 embed HTML 태그 파일을 만들려고 합니다.\n이 상태로 올리면 iframe용 태그 파일이 서로 덮어써질 수 있으니, 파일명을 바꾸거나 중복 항목을 정리한 뒤 다시 시도해주세요.'); return }
    const conflicts = await withBusy('중복 검사 중...', () => findUploadConflicts(jobs))
    if (conflicts.duplicateKeys.size && !(await uiConfirm(`중복 파일 ${conflicts.duplicateKeys.size}개가 있습니다.\n\n${[...conflicts.duplicateKeys].slice(0, 10).join('\n')}\n\n모두 덮어쓸까요?`, { title: '업로드 덮어쓰기 확인' }))) return
    let success = 0; let failed = 0
    await withBusy('업로드 중...', async () => {
      for (const job of jobs) {
        const result = await uploadSingle(
          job,
          conflicts.duplicateKeys.has(getUploadJobKey(job)),
          true,
        )
        if (result === 'success') success += 1
        else failed += 1
      }
    })
    setUploadQueue((queue) => queue.filter((x) => x.status !== 'completed')); await uiAlert(`일괄 업로드 완료\n성공: ${success}개\n실패: ${failed}개`)
  }, [uiAlert, uiConfirm, uploadQueue, uploadSingle, withBusy])
  const refreshAfterCrud = useCallback(async (reload = false) => { invalidateServerListCache(activeBrowseType ?? undefined); clearSelection(); if (reload) await loadBrowseTypes(); if (activeBrowseType) await refreshServerFiles(true) }, [activeBrowseType, clearSelection, loadBrowseTypes, refreshServerFiles])
  const createFolder = useCallback(async () => { const name = sanitizeNameInput(await uiPrompt('새 폴더 이름을 입력하세요.')); if (!name) return; const path = currentUploadPath ? `${currentUploadPath}/${name}/` : `${name}/`; await withBusy('폴더 생성 중...', async () => { await apiMkdir(path); await refreshAfterCrud(!activeBrowseType) }) }, [activeBrowseType, currentUploadPath, refreshAfterCrud, uiPrompt, withBusy])
  const renameFile = useCallback(async (item: ServerFileItem, type: string) => { const old = getItemStorageKey(item, type, activeFolder, activeBrowseType); const name = sanitizeNameInput(await uiPrompt('새 파일 이름을 입력하세요.', item.displayName || item.name || '')); if (!name) return; await withBusy('파일 이름 변경 중...', async () => { await apiMove(old, `${old.slice(0, old.lastIndexOf('/') + 1)}${name}`); await refreshAfterCrud() }) }, [activeBrowseType, activeFolder, refreshAfterCrud, uiPrompt, withBusy])
  const deleteFile = useCallback(async (item: ServerFileItem, type: string, options: { skipConfirm?: boolean } = {}) => {
    const name = item.displayName || item.name || '파일'
    if (!options.skipConfirm && !(await uiConfirm(`"${name}" 파일을 삭제할까요?`, { title: '파일 삭제', danger: true }))) return
    await withBusy('파일 삭제 중...', async () => {
      await apiDelete(getItemStorageKey(item, type, activeFolder, activeBrowseType))
      await refreshAfterCrud()
    })
  }, [activeBrowseType, activeFolder, refreshAfterCrud, uiConfirm, withBusy])
  const renameFolder = useCallback(async (type: string, folder: string) => { if (folder === ROOT_FOLDER) return void await uiAlert('루트 폴더 이름은 변경할 수 없습니다.'); const name = sanitizeNameInput(await uiPrompt('새 폴더 이름을 입력하세요.', getFolderDisplayName(folder))); if (!name) return; const parent = folder.includes('/') ? `${folder.slice(0, folder.lastIndexOf('/') + 1)}` : ''; await withBusy('폴더 이름 변경 중...', async () => { await apiMvdir(buildFolderPrefix(type, folder), buildFolderPrefix(type, `${parent}${name}`)); await refreshAfterCrud() }) }, [refreshAfterCrud, uiAlert, uiPrompt, withBusy])
  const deleteFolder = useCallback(async (type: string, folder: string, options: { skipConfirm?: boolean } = {}) => {
    if (folder === ROOT_FOLDER) return void await uiAlert('루트 폴더는 삭제할 수 없습니다.')
    const name = getFolderDisplayName(folder)
    if (!options.skipConfirm && !(await uiConfirm(`"${name}" 폴더와 안의 모든 파일을 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`, { title: '폴더 삭제', danger: true }))) return
    await withBusy('폴더 삭제 중...', async () => {
      await apiRmdir(buildFolderPrefix(type, folder))
      if (activeFolder === folder) setActiveFolder(null)
      await refreshAfterCrud()
    })
  }, [activeFolder, refreshAfterCrud, uiAlert, uiConfirm, withBusy])
  const deleteBrowseType = useCallback(async (browseType: string, options: { skipConfirm?: boolean } = {}) => {
    if (!options.skipConfirm && !(await uiConfirm(`"${browseType}" 폴더와 안의 모든 파일을 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`, { title: '폴더 삭제', danger: true }))) return
    await withBusy('폴더 삭제 중...', async () => {
      await apiRmdir(`${browseType}/`)
      if (activeBrowseType === browseType) {
        setActiveBrowseType(null)
        setActiveFolder(null)
      }
      await refreshAfterCrud(true)
    })
  }, [activeBrowseType, refreshAfterCrud, uiConfirm, withBusy])
  const addSelectedToTags = useCallback(() => setAccumulatedTags((tags) => [...tags, ...[...selectedItems.values()].flatMap((entry) => entry.kind === 'file' ? [{ uid: ++tagUid.current, item: entry.item, type: entry.type, url: getItemPublicUrl(entry.item, entry.type, activeFolder, activeBrowseType), tag: ensureTagBreak(buildMediaTag(entry.type, getItemPublicUrl(entry.item, entry.type, activeFolder, activeBrowseType), entry.item)) }] : [])]), [activeBrowseType, activeFolder, selectedItems])
  const copySelectedUrl = useCallback(async () => { if (!selectedPreview) return; await uiAlert(await copyText(getItemPublicUrl(selectedPreview.item, selectedPreview.type, activeFolder, activeBrowseType)) ? 'URL이 복사되었습니다.' : '복사에 실패했습니다. 브라우저 권한을 확인해주세요.') }, [activeBrowseType, activeFolder, selectedPreview, uiAlert])
  const copySelectedTag = useCallback(async () => { if (!selectedPreview) return; const url = getItemPublicUrl(selectedPreview.item, selectedPreview.type, activeFolder, activeBrowseType); await uiAlert(await copyText(ensureTagBreak(buildMediaTag(selectedPreview.type, url, selectedPreview.item))) ? '태그가 복사되었습니다.' : '복사에 실패했습니다. 브라우저 권한을 확인해주세요.') }, [activeBrowseType, activeFolder, selectedPreview, uiAlert])
  const openHistory = useCallback(async () => {
    setHistoryOpen(true)
    setHistoryEntries([])
    setHistoryMonthIndex(0)
    setHistoryLoading(true)
    try {
      const months = await fetchLogMonths()
      const nextMonths = months.length ? months : [getCurrentMonthKey()]
      setHistoryMonths(nextMonths)
      const month = nextMonths[0]
      if (month) {
        const rows = await fetchLogMonth(month)
        setHistoryEntries(
          [...rows].sort(
            (a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime(),
          ),
        )
        setHistoryMonthIndex(1)
      }
    } catch {
      setHistoryMonths([])
      setHistoryEntries([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])
  const loadMoreHistory = useCallback(async () => { const month = historyMonths[historyMonthIndex]; if (!month || historyLoading) return; setHistoryLoading(true); try { const rows = await fetchLogMonth(month); setHistoryEntries((old) => [...old, ...rows].sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime())); setHistoryMonthIndex((x) => x + 1) } finally { setHistoryLoading(false) } }, [historyLoading, historyMonthIndex, historyMonths])
  useEffect(() => { void loadBrowseTypes() }, [loadBrowseTypes])
  const visibleFiles = useMemo(() => sortItemsForGrid(
    (activeFolder
      ? currentGroups.find((group) => group.folder === activeFolder)?.items ?? []
      : currentGroups.find((group) => group.folder === ROOT_FOLDER)?.items ?? []
    ).filter((item) => itemMatchesSearch(item, searchQuery)),
    gridSortMode,
  ), [activeFolder, currentGroups, gridSortMode, searchQuery])
  return { browseTypes, activeBrowseType, activeFolder, currentGroups, selectedItems, selectedPreview, searchQuery, setSearchQuery, globalSearchEnabled, setGlobalSearch, globalSearchMatches, globalSearching, gridSortMode, setGridSortMode, gridViewMode, setGridViewMode, gridVisibleLimit, setGridVisibleLimit, uploadQueue, setUploadQueue, accumulatedTags, setAccumulatedTags, activeTagUid, setActiveTagUid, busyCount, busyMessage, sidebarStatus, previewWidth, setPreviewWidth: (x: number) => { const value = Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, x)); localStorage.setItem(PREVIEW_WIDTH_KEY, String(value)); setPreviewWidthState(value) }, tagPanelHeight, setTagPanelHeight: (x: number) => { const value = Math.min(TAG_PANEL_MAX_HEIGHT, Math.max(TAG_PANEL_MIN_HEIGHT, x)); localStorage.setItem(TAG_PANEL_HEIGHT_KEY, String(value)); setTagPanelHeightState(value) }, dialogs, closeDialog, contextMenu, setContextMenu, historyOpen, setHistoryOpen, historyEntries, historyLoading, historyMonthIndex, historyMonths, loadMoreHistory, openHistory, loadBrowseTypes, selectBrowseType, selectFolder, refreshServerFiles, enqueueFiles, uploadSingle, uploadAllPending, createFolder, renameFile, deleteFile, renameFolder, deleteFolder, deleteBrowseType, clearSelection, selectEntry, selectRange, selectAllVisible, addSelectedToTags, copySelectedTag, copySelectedUrl, uiAlert, uiConfirm, uiPrompt, currentUploadPath, visibleFiles, getParentFolderPath, formatLogSentenceParts }
}
