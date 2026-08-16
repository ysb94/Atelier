import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppLoadingOverlay } from './components/AppLoadingOverlay'
import { ContextMenu } from './components/ContextMenu'
import { ExplorerTopbar } from './components/ExplorerTopbar'
import { FileGrid } from './components/FileGrid'
import { GridToolbar } from './components/GridToolbar'
import { HistoryModal } from './components/HistoryModal'
import { PreviewPanel } from './components/PreviewPanel'
import { ServerTreeSidebar } from './components/ServerTreeSidebar'
import { TagPanel } from './components/TagPanel'
import { UiDialog } from './components/UiDialog'
import { UploadQueuePanel } from './components/UploadQueuePanel'
import {
  getBrowseTypeSelectionKey,
  getFolderSelectionKey,
  getItemKey,
  getItemPublicUrl,
  getImmediateChildFolders,
} from './file-manager-utils'
import type { SelectionEntry, ServerFileItem } from './types'
import { useDesignFileManager } from './useDesignFileManager'

export function DesignFileManagerPage() {
  const manager = useDesignFileManager()
  const [dropping, setDropping] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const href = `${import.meta.env.BASE_URL}design-file-manager.css`
    const existing = document.querySelector(
      `link[data-design-file-manager-css="1"]`,
    )
    if (existing) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.designFileManagerCss = '1'
    document.head.appendChild(link)
  }, [])

  const fileCount = useMemo(
    () =>
      [...manager.selectedItems.values()].filter((x) => x.kind === 'file')
        .length,
    [manager.selectedItems],
  )

  const selectableEntries = useMemo(() => {
    const entries: Array<{ key: string; entry: SelectionEntry }> = []
    if (!manager.activeBrowseType) {
      for (const type of manager.browseTypes) {
        entries.push({
          key: getBrowseTypeSelectionKey(type),
          entry: { kind: 'browse', browseType: type },
        })
      }
      return entries
    }
    const folders = getImmediateChildFolders(
      manager.currentGroups,
      manager.activeFolder,
    )
    for (const folder of folders) {
      entries.push({
        key: getFolderSelectionKey(folder, manager.activeBrowseType),
        entry: {
          kind: 'folder',
          folder,
          type: manager.activeBrowseType,
        },
      })
    }
    const files =
      manager.globalSearchMatches.length > 0
        ? manager.globalSearchMatches
        : manager.visibleFiles.map((item) => ({
            item,
            type: manager.activeBrowseType!,
          }))
    for (const row of files.slice(0, manager.gridVisibleLimit)) {
      entries.push({
        key: getItemKey(row.item, row.type),
        entry: { kind: 'file', item: row.item, type: row.type },
      })
    }
    return entries
  }, [
    manager.activeBrowseType,
    manager.activeFolder,
    manager.browseTypes,
    manager.currentGroups,
    manager.globalSearchMatches,
    manager.gridVisibleLimit,
    manager.visibleFiles,
  ])

  const select = useCallback(
    (key: string, entry: SelectionEntry, event: React.MouseEvent) => {
      if (event.shiftKey) {
        manager.selectRange(selectableEntries, key)
        return
      }
      manager.selectEntry(key, entry, {
        toggle: event.ctrlKey || event.metaKey,
        append: event.ctrlKey || event.metaKey,
      })
    },
    [manager, selectableEntries],
  )

  const selectAll = useCallback(() => {
    manager.selectAllVisible(selectableEntries)
  }, [manager, selectableEntries])

  const menu = useCallback(
    (
      event: React.MouseEvent,
      item?: ServerFileItem,
      type?: string,
      folder?: string,
    ) => {
      event.preventDefault()
      event.stopPropagation()
      if (item && type) {
        manager.setContextMenu({
          x: event.clientX,
          y: event.clientY,
          items: [
            {
              label: '이름 변경',
              action: () => manager.renameFile(item, type),
            },
            { separator: true, label: '', action: () => undefined },
            {
              label: '삭제',
              danger: true,
              action: () => manager.deleteFile(item, type),
            },
          ],
        })
        return
      }
      if (folder && type) {
        manager.setContextMenu({
          x: event.clientX,
          y: event.clientY,
          items: [
            {
              label: '이름 변경',
              action: () => manager.renameFolder(type, folder),
            },
            { separator: true, label: '', action: () => undefined },
            {
              label: '삭제',
              danger: true,
              action: () => manager.deleteFolder(type, folder),
            },
          ],
        })
        return
      }
      manager.setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [{ label: '새 폴더', action: () => void manager.createFolder() }],
      })
    },
    [manager],
  )

  const deleteSelected = async () => {
    const entries = [...manager.selectedItems.values()]
    if (!entries.length) return
    const names = entries.map((x) =>
      x.kind === 'file'
        ? x.item.displayName || x.item.name || '파일'
        : x.kind === 'folder'
          ? x.folder
          : x.browseType,
    )
    const preview = names.slice(0, 10).join('\n')
    const extra = names.length > 10 ? `\n... 외 ${names.length - 10}개` : ''
    if (
      !(await manager.uiConfirm(
        `선택한 ${entries.length}개 항목을 삭제할까요?\n\n${preview}${extra}\n\n이 작업은 되돌릴 수 없습니다.`,
        { title: '선택 항목 삭제', danger: true },
      ))
    ) {
      return
    }
    for (const entry of entries) {
      if (entry.kind === 'file')
        await manager.deleteFile(entry.item, entry.type, { skipConfirm: true })
      else if (entry.kind === 'folder')
        await manager.deleteFolder(entry.type, entry.folder, {
          skipConfirm: true,
        })
      else if (entry.kind === 'browse')
        await manager.deleteBrowseType(entry.browseType, { skipConfirm: true })
    }
  }

  const copyAll = async () => {
    if (!manager.accumulatedTags.length) {
      await manager.uiAlert('복사할 태그가 없습니다.')
      return
    }
    try {
      await navigator.clipboard.writeText(
        manager.accumulatedTags.map((x) => x.tag).join('\n'),
      )
      await manager.uiAlert('누적 태그가 복사되었습니다!')
    } catch {
      await manager.uiAlert(
        '복사에 실패했습니다. 브라우저 권한을 확인해주세요.',
      )
    }
  }

  const clearAll = async () => {
    if (!manager.accumulatedTags.length) {
      await manager.uiAlert('삭제할 태그가 없습니다.')
      return
    }
    if (
      await manager.uiConfirm(
        `누적 태그 ${manager.accumulatedTags.length}개를 모두 삭제하시겠습니까?`,
        { title: '태그 일괄 삭제', danger: true },
      )
    ) {
      manager.setAccumulatedTags([])
    }
  }

  const open = () => {
    if (!manager.selectedPreview) return
    window.open(
      getItemPublicUrl(
        manager.selectedPreview.item,
        manager.selectedPreview.type,
        manager.activeFolder,
        manager.activeBrowseType,
      ),
      '_blank',
      'noopener',
    )
  }

  const hasExternalFiles = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types)
    if (!types.includes('Files')) return false
    if (types.includes('text/html') || types.includes('text/uri-list'))
      return false
    return true
  }

  return (
    <div
      className={`design-file-manager${manager.busyCount ? ' app-busy' : ''}`}
      style={
        {
          '--preview-width': `${manager.previewWidth}px`,
          '--tag-panel-height': `${manager.tagPanelHeight}px`,
        } as React.CSSProperties
      }
    >
      <div className="app-layout">
        <ServerTreeSidebar
          browseTypes={manager.browseTypes}
          activeType={manager.activeBrowseType}
          activeFolder={manager.activeFolder}
          groups={manager.currentGroups}
          busy={!!manager.busyCount}
          status={manager.sidebarStatus}
          selectType={manager.selectBrowseType}
          selectFolder={manager.selectFolder}
          refresh={() => void manager.refreshServerFiles(true)}
          menu={(event, type, folder) =>
            menu(event, undefined, type, folder)
          }
        />
        <main className="main-content">
          <ExplorerTopbar
            activeType={manager.activeBrowseType}
            activeFolder={manager.activeFolder}
            search={manager.searchQuery}
            global={manager.globalSearchEnabled}
            busy={!!manager.busyCount}
            onSearch={manager.setSearchQuery}
            onGlobal={manager.setGlobalSearch}
            onHistory={() => void manager.openHistory()}
          />
          <div
            className={`workspace-area${dropping ? ' drop-active' : ''}`}
            onDragEnter={(event) => {
              if (!hasExternalFiles(event)) return
              event.preventDefault()
              depth.current += 1
              setDropping(true)
            }}
            onDragOver={(event) => {
              if (!hasExternalFiles(event)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={() => {
              depth.current -= 1
              if (depth.current <= 0) {
                depth.current = 0
                setDropping(false)
              }
            }}
            onDrop={(event) => {
              if (!hasExternalFiles(event)) return
              event.preventDefault()
              depth.current = 0
              setDropping(false)
              void manager.enqueueFiles(event.dataTransfer.files)
            }}
          >
            <div className="upload-toolbar">
              <span className="upload-hint">
                파일을 이 영역에 드래그하면 현재 폴더로 업로드 대기열에
                추가됩니다.
              </span>
            </div>
            <GridToolbar
              selectedCount={manager.selectedItems.size}
              fileCount={fileCount}
              canOpen={!!manager.selectedPreview}
              busy={!!manager.busyCount}
              sort={manager.gridSortMode}
              view={manager.gridViewMode}
              onSort={manager.setGridSortMode}
              onView={manager.setGridViewMode}
              onTags={manager.addSelectedToTags}
              onDelete={() => void deleteSelected()}
              onFolder={() => void manager.createFolder()}
              onOpen={open}
              onAll={selectAll}
            />
            <FileGrid
              browseTypes={manager.browseTypes}
              type={manager.activeBrowseType}
              folder={manager.activeFolder}
              groups={manager.currentGroups}
              files={manager.visibleFiles}
              global={manager.globalSearchMatches}
              searching={manager.globalSearching}
              selected={manager.selectedItems}
              preview={manager.selectedPreview}
              view={manager.gridViewMode}
              limit={manager.gridVisibleLimit}
              onMore={() =>
                manager.setGridVisibleLimit(manager.gridVisibleLimit + 60)
              }
              onFolder={manager.selectFolder}
              onType={manager.selectBrowseType}
              onSelect={select}
              onContext={menu}
            />
            <UploadQueuePanel
              queue={manager.uploadQueue}
              busy={!!manager.busyCount}
              upload={(job) => void manager.uploadSingle(job)}
              remove={(id) =>
                manager.setUploadQueue(
                  manager.uploadQueue.filter((x) => x.id !== id),
                )
              }
              uploadAll={() => void manager.uploadAllPending()}
            />
            <TagPanel
              tags={manager.accumulatedTags}
              active={manager.activeTagUid}
              setActive={manager.setActiveTagUid}
              setTags={manager.setAccumulatedTags}
              copyAll={() => void copyAll()}
              clearAll={() => void clearAll()}
              resize={manager.setTagPanelHeight}
            />
          </div>
        </main>
        <PreviewPanel
          selection={manager.selectedPreview}
          onTag={() => void manager.copySelectedTag()}
          onUrl={() => void manager.copySelectedUrl()}
          onOpen={open}
          resize={manager.setPreviewWidth}
        />
      </div>
      <ContextMenu
        menu={manager.contextMenu}
        close={() => manager.setContextMenu(null)}
      />
      <AppLoadingOverlay
        busy={!!manager.busyCount}
        message={manager.busyMessage}
      />
      <UiDialog request={manager.dialogs[0]} onClose={manager.closeDialog} />
      <HistoryModal
        open={manager.historyOpen}
        entries={manager.historyEntries}
        loading={manager.historyLoading}
        more={manager.historyMonthIndex < manager.historyMonths.length}
        onMore={() => void manager.loadMoreHistory()}
        onClose={() => manager.setHistoryOpen(false)}
      />
    </div>
  )
}
