import type {
  CodeUsageTarget,
  CodeUsageTargetFolder,
  OutboundChannelType,
} from '@/lib/types'
import {
  buildFolderForest,
  descendantFolderIds,
  folderDepth,
  folderPath,
  type OutboundFolderNode,
} from '@/lib/codes/outbound-folder'
import {
  compactOutboundPartnerKey,
  countOutboundCompanies,
  groupOutboundPartnersInFolder,
  type OutboundCompanyInFolder,
} from '@/lib/codes/outbound-partner'

export const UNFILED_TAB_ID = '__unfiled'
export const ALL_CHILD_TAB_ID = '__all'

export type OutboundBrowserTabKind = 'folder' | 'unfiled'

export type OutboundBrowserTab = {
  id: string
  label: string
  kind: OutboundBrowserTabKind
  folderId: string | null
  companyCount: number
  unitCount: number
}

export type OutboundChildTab = {
  id: string
  label: string
  kind: 'all' | 'folder'
  folderId: string
  companyCount: number
  unitCount: number
}

export type OutboundUnitSection = {
  folderId: string | null
  pathLabel: string
  depth: number
  companies: OutboundCompanyInFolder[]
}

export function folderTreeCounts(
  folders: readonly CodeUsageTargetFolder[],
  folderId: string,
  cardsIn: (id: string | null) => CodeUsageTarget[],
): { companyCount: number; unitCount: number } {
  let companyCount = countOutboundCompanies(cardsIn(folderId))
  let unitCount = cardsIn(folderId).length
  descendantFolderIds(folders, folderId).forEach((id) => {
    companyCount += countOutboundCompanies(cardsIn(id))
    unitCount += cardsIn(id).length
  })
  return { companyCount, unitCount }
}

export function buildOutboundBrowserTabs(input: {
  forest: OutboundFolderNode[]
  folders: readonly CodeUsageTargetFolder[]
  cardsIn: (id: string | null) => CodeUsageTarget[]
  unfiled: readonly CodeUsageTarget[]
}): OutboundBrowserTab[] {
  const tabs: OutboundBrowserTab[] = input.forest.map((node) => ({
    id: node.id,
    label: node.name,
    kind: 'folder',
    folderId: node.id,
    ...folderTreeCounts(input.folders, node.id, input.cardsIn),
  }))
  tabs.push({
    id: UNFILED_TAB_ID,
    label: '미분류',
    kind: 'unfiled',
    folderId: null,
    companyCount: countOutboundCompanies(input.unfiled),
    unitCount: input.unfiled.length,
  })
  return tabs
}

export function outboundFolderTabs(
  node: OutboundFolderNode,
  folders: readonly CodeUsageTargetFolder[],
  cardsIn: (id: string | null) => CodeUsageTarget[],
): OutboundChildTab[] {
  if (node.children.length === 0) return []
  return [
    {
      id: ALL_CHILD_TAB_ID,
      label: '전체',
      kind: 'all',
      folderId: node.id,
      ...folderTreeCounts(folders, node.id, cardsIn),
    },
    ...node.children.map((child) => ({
      id: child.id,
      label: child.name,
      kind: 'folder' as const,
      folderId: child.id,
      ...folderTreeCounts(folders, child.id, cardsIn),
    })),
  ]
}

export function resolveOutboundTabId(
  tabs: readonly { id: string }[],
  requested: string | null,
): string | null {
  if (tabs.length === 0) return null
  if (requested && tabs.some((tab) => tab.id === requested)) return requested
  return tabs[0]?.id ?? null
}

export function findFolderNode(
  forest: readonly OutboundFolderNode[],
  id: string,
): OutboundFolderNode | null {
  for (const node of forest) {
    if (node.id === id) return node
    const hit = findFolderNode(node.children, id)
    if (hit) return hit
  }
  return null
}

export function outboundSectionPathLabel(
  folders: readonly CodeUsageTargetFolder[],
  ancestorId: string | null,
  folderId: string | null,
): string {
  if (!folderId) return '미분류'
  const path = folderPath(folders, folderId)
  if (!ancestorId) return path.map((folder) => folder.name).join(' / ')
  const index = path.findIndex((folder) => folder.id === ancestorId)
  const rest = index >= 0 ? path.slice(index + 1) : path
  if (rest.length === 0) return path[path.length - 1]?.name ?? ''
  return rest.map((folder) => folder.name).join(' / ')
}

function descendantIdsInTreeOrder(
  folders: readonly CodeUsageTargetFolder[],
  parentId: string,
): string[] {
  const node = findFolderNode(buildFolderForest(folders), parentId)
  if (!node) return [...descendantFolderIds(folders, parentId)]

  function walk(current: OutboundFolderNode): string[] {
    return current.children.flatMap((child) => [child.id, ...walk(child)])
  }
  return walk(node)
}

export function collectOutboundUnitSections(input: {
  folders: readonly CodeUsageTargetFolder[]
  folderId: string | null
  cardsIn: (id: string | null) => CodeUsageTarget[]
  includeDescendants: boolean
}): OutboundUnitSection[] {
  const here = groupOutboundPartnersInFolder(input.cardsIn(input.folderId))
  const sections: OutboundUnitSection[] = [
    {
      folderId: input.folderId,
      pathLabel: '',
      depth: input.folderId ? folderDepth(input.folders, input.folderId) : 0,
      companies: here,
    },
  ]
  if (!input.includeDescendants || !input.folderId) return sections

  descendantIdsInTreeOrder(input.folders, input.folderId).forEach((id) => {
    const companies = groupOutboundPartnersInFolder(input.cardsIn(id))
    if (companies.length === 0) return
    sections.push({
      folderId: id,
      pathLabel: outboundSectionPathLabel(input.folders, input.folderId, id),
      depth: folderDepth(input.folders, id),
      companies,
    })
  })
  return sections
}

/** 검색 결과는 이름 옆에 경로를 붙이지 않고 폴더 단위로 묶는다. */
export function groupOutboundSearchSections(input: {
  folders: readonly CodeUsageTargetFolder[]
  hits: readonly CodeUsageTarget[]
}): OutboundUnitSection[] {
  const byFolder = new Map<string | null, CodeUsageTarget[]>()
  input.hits.forEach((target) => {
    const key = target.folderId
    const list = byFolder.get(key)
    if (list) list.push(target)
    else byFolder.set(key, [target])
  })

  const order: Array<string | null> = []
  function walk(nodes: readonly OutboundFolderNode[]) {
    nodes.forEach((node) => {
      order.push(node.id)
      walk(node.children)
    })
  }
  walk(buildFolderForest(input.folders))
  order.push(null)
  byFolder.forEach((_, folderId) => {
    if (!order.includes(folderId)) order.push(folderId)
  })

  return order.flatMap((folderId) => {
    const units = byFolder.get(folderId)
    if (!units?.length) return []
    return [
      {
        folderId,
        pathLabel: outboundSectionPathLabel(input.folders, null, folderId),
        depth: folderId ? folderDepth(input.folders, folderId) : 0,
        companies: groupOutboundPartnersInFolder(units),
      } satisfies OutboundUnitSection,
    ]
  })
}

export function findOutboundCompanyForUnit(
  sections: readonly OutboundUnitSection[],
  unitId: string,
): OutboundCompanyInFolder | null {
  for (const section of sections) {
    for (const company of section.companies) {
      if (company.units.some((unit) => unit.id === unitId)) return company
    }
  }
  return null
}

/** 폴더 경로에 온라인/오프라인이 있으면 그 채널을 쓴다. 탭에서 이미 정한 값이다. */
export function outboundChannelFromFolderPath(
  folders: readonly CodeUsageTargetFolder[],
  folderId: string | null,
): OutboundChannelType {
  const path = folderPath(folders, folderId)
  for (const folder of path) {
    const key = compactOutboundPartnerKey(folder.name)
    if (key === '온라인' || key === 'online') return 'online'
    if (key === '오프라인' || key === 'offline') return 'offline'
  }
  return 'unset'
}

export function flattenOutboundUnits(
  sections: readonly OutboundUnitSection[],
): CodeUsageTarget[] {
  return sections.flatMap((section) =>
    section.companies.flatMap((company) => company.units),
  )
}
