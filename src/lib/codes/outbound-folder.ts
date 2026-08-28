import type { CodeUsageTargetFolder } from '@/lib/types'
import { compactOutboundPartnerKey } from '@/lib/codes/outbound-partner'

/** 온라인 > 직접배송 > 사방넷 > (한 단 더) 까지만 허용한다. */
export const OUTBOUND_FOLDER_MAX_DEPTH = 4

export type OutboundFolderNode = CodeUsageTargetFolder & {
  children: OutboundFolderNode[]
  depth: number
}

export type OutboundFolderOption = {
  id: string | null
  label: string
  depth: number
  disabled?: boolean
}

function byOrder(a: CodeUsageTargetFolder, b: CodeUsageTargetFolder) {
  return a.order - b.order || a.name.localeCompare(b.name, 'ko')
}

/** 부모를 잃은 폴더는 루트로 올려 화면이 비지 않게 한다. */
export function buildFolderForest(
  folders: readonly CodeUsageTargetFolder[],
): OutboundFolderNode[] {
  const ids = new Set(folders.map((folder) => folder.id))
  const children = new Map<string | null, CodeUsageTargetFolder[]>()

  folders.forEach((folder) => {
    const parentId =
      folder.parentId && ids.has(folder.parentId) ? folder.parentId : null
    const list = children.get(parentId)
    if (list) list.push(folder)
    else children.set(parentId, [folder])
  })

  function branch(
    parentId: string | null,
    depth: number,
  ): OutboundFolderNode[] {
    return (children.get(parentId) ?? [])
      .slice()
      .sort(byOrder)
      .map((folder) => ({
        ...folder,
        depth,
        children: branch(folder.id, depth + 1),
      }))
  }

  return branch(null, 1)
}

export function folderById(
  folders: readonly CodeUsageTargetFolder[],
  id: string | null | undefined,
): CodeUsageTargetFolder | null {
  if (!id) return null
  return folders.find((folder) => folder.id === id) ?? null
}

export function folderPath(
  folders: readonly CodeUsageTargetFolder[],
  id: string | null | undefined,
): CodeUsageTargetFolder[] {
  const map = new Map(folders.map((folder) => [folder.id, folder]))
  const path: CodeUsageTargetFolder[] = []
  let current = id ? map.get(id) : undefined
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? map.get(current.parentId) : undefined
  }
  return path
}

export function folderPathLabel(
  folders: readonly CodeUsageTargetFolder[],
  id: string | null | undefined,
): string {
  const path = folderPath(folders, id)
  return path.length > 0 ? path.map((folder) => folder.name).join(' / ') : '미분류'
}

export function folderDepth(
  folders: readonly CodeUsageTargetFolder[],
  id: string | null | undefined,
): number {
  return folderPath(folders, id).length
}

export function descendantFolderIds(
  folders: readonly CodeUsageTargetFolder[],
  id: string,
): Set<string> {
  const ids = new Set<string>()
  function walk(parentId: string) {
    folders.forEach((folder) => {
      if (folder.parentId === parentId && !ids.has(folder.id)) {
        ids.add(folder.id)
        walk(folder.id)
      }
    })
  }
  walk(id)
  return ids
}

/** 자기 자신이나 하위 폴더로는 옮기지 못한다. */
export function wouldCreateFolderCycle(
  folders: readonly CodeUsageTargetFolder[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false
  if (newParentId === folderId) return true
  return descendantFolderIds(folders, folderId).has(newParentId)
}

export function canCreateChildFolder(
  folders: readonly CodeUsageTargetFolder[],
  parentId: string | null,
): boolean {
  if (!parentId) return true
  return folderDepth(folders, parentId) < OUTBOUND_FOLDER_MAX_DEPTH
}

export function folderCardCount(
  folders: readonly CodeUsageTargetFolder[],
  folderId: string,
  cardsIn: (id: string | null) => number,
): number {
  let total = cardsIn(folderId)
  descendantFolderIds(folders, folderId).forEach((id) => {
    total += cardsIn(id)
  })
  return total
}

/** 이동 대상. 맨 위는 미분류다. */
export function folderMoveOptions(
  folders: readonly CodeUsageTargetFolder[],
  options?: { disableId?: string },
): OutboundFolderOption[] {
  const forest = buildFolderForest(folders)
  const disabled = options?.disableId
    ? new Set([
        options.disableId,
        ...descendantFolderIds(folders, options.disableId),
      ])
    : new Set<string>()
  const rows: OutboundFolderOption[] = [
    { id: null, label: '미분류', depth: 0 },
  ]

  function walk(nodes: OutboundFolderNode[]) {
    nodes.forEach((node) => {
      rows.push({
        id: node.id,
        label: folderPathLabel(folders, node.id),
        depth: node.depth,
        disabled: disabled.has(node.id),
      })
      walk(node.children)
    })
  }
  walk(forest)
  return rows
}

export function matchesFolderSearch(
  keyword: string,
  folder: Pick<CodeUsageTargetFolder, 'name' | 'normalizedName'>,
): boolean {
  const key = compactOutboundPartnerKey(keyword)
  if (!key) return true
  const hay = folder.normalizedName || compactOutboundPartnerKey(folder.name)
  return hay.includes(key)
}

/** 사방넷 신규 사이트 등록 시 기본 위치. */
export const DEFAULT_SABANGNET_FOLDER_PATH = '온라인 / 사방넷'

export function findDefaultSabangnetFolderId(
  folders: readonly CodeUsageTargetFolder[],
): string | null {
  const exact = folders.find(
    (folder) => folderPathLabel(folders, folder.id) === DEFAULT_SABANGNET_FOLDER_PATH,
  )
  if (exact) return exact.id
  const sabang = folders.find(
    (folder) =>
      compactOutboundPartnerKey(folder.name) ===
      compactOutboundPartnerKey('사방넷'),
  )
  return sabang?.id ?? null
}
