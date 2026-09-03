import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Check,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  buildFolderForest,
  canCreateChildFolder,
  folderMoveOptions,
  folderPath,
  matchesFolderSearch,
} from '@/lib/codes/outbound-folder'
import {
  ALL_CHILD_TAB_ID,
  buildOutboundBrowserTabs,
  collectOutboundUnitSections,
  findFolderNode,
  findOutboundCompanyForUnit,
  flattenOutboundUnits,
  groupOutboundSearchSections,
  outboundChannelFromFolderPath,
  outboundFolderTabs,
  resolveOutboundTabId,
  type OutboundUnitSection,
} from '@/lib/codes/outbound-partner-browser'
import {
  groupOutboundPartnersInFolder,
  matchesOutboundPartnerSearch,
  outboundFolderCountLabel,
  synthesizeOutboundPartnerName,
} from '@/lib/codes/outbound-partner'
import {
  CodeUsageTargetStoreError,
  createCodeUsageTarget,
  createCodeUsageTargetFolder,
  createOutboundPartnerGroup,
  deleteCodeUsageTargetFolder,
  updateCodeUsageTargetFolder,
} from '@/lib/api'
import type {
  CodeUsageTarget,
  CodeUsageTargetFolder,
  OutboundPartnerGroup,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { CompanyCreateForm, OutboundPartnerCompanyNode } from '@/features/codes/OutboundPartnerCompanyNode'
import { OutboundPartnerDetailPanel } from '@/features/codes/OutboundPartnerDetailPanel'
import { TreeBranch } from '@/features/codes/OutboundPartnerTree'
import type { AliasOwner } from '@/features/codes/OutboundPartnerEditForm'

const EMPTY_ALIASES: readonly string[] = []
const TAB_ACTION =
  '!h-6 !gap-1 !px-1.5 !text-[11px] font-medium text-muted-foreground'

function NameForm({
  placeholder,
  pending,
  onSubmit,
  onCancel,
}: {
  placeholder: string
  pending: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) onSubmit(name)
      }}
    >
      <Input
        autoFocus
        className="h-8"
        value={name}
        placeholder={placeholder}
        disabled={pending}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        type="submit"
        size="icon"
        disabled={!name.trim() || pending}
        aria-label="확인"
      >
        <Check className="size-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" onClick={onCancel}>
        <X className="size-3.5" />
      </Button>
    </form>
  )
}

function TabButton({
  selected,
  label,
  count,
  onClick,
}: {
  selected: boolean
  label: string
  count: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        '-mb-px border-b-2 px-3 py-1.5 text-sm',
        selected
          ? 'border-foreground font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
      onClick={onClick}
    >
      {label}
      <span className="ml-1 text-xs font-normal text-muted-foreground">
        {count}
      </span>
    </button>
  )
}

function SectionList({
  sections,
  selectedId,
  onSelect,
  onRenamed,
  onError,
}: {
  sections: readonly OutboundUnitSection[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRenamed?: () => void | Promise<void>
  onError?: (message: string | null) => void
}) {
  const visible = sections.filter(
    (section, index) =>
      section.companies.length > 0 ||
      (index === 0 && sections.length === 1),
  )
  if (visible.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        아직 업체가 없습니다.
      </p>
    )
  }
  if (visible.length === 1 && visible[0]?.companies.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        아직 업체가 없습니다. 업체를 넣거나 하위 폴더를 만드세요.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {visible.map((section) => (
        <div key={section.folderId ?? 'unfiled'}>
          {section.pathLabel ? (
            <TreeBranch
              root
              label={
                <p className="truncate px-1 text-xs font-semibold text-muted-foreground">
                  {section.pathLabel}
                </p>
              }
            >
              {section.companies.map((company, index) => (
                <OutboundPartnerCompanyNode
                  key={company.key}
                  company={company}
                  selectedId={selectedId}
                  last={index === section.companies.length - 1}
                  onSelect={onSelect}
                  onRenamed={onRenamed}
                  onError={onError}
                />
              ))}
            </TreeBranch>
          ) : (
            section.companies.map((company, index) => (
              <OutboundPartnerCompanyNode
                key={company.key}
                company={company}
                selectedId={selectedId}
                last={index === section.companies.length - 1}
                root
                onSelect={onSelect}
                onRenamed={onRenamed}
                onError={onError}
              />
            ))
          )}
        </div>
      ))}
    </div>
  )
}

export function OutboundPartnerBrowser({
  layout,
  brandId,
  targets,
  folders,
  groups,
  keyword,
  aliasesByTarget,
  barcodeCounts,
  ownerByKey,
  selectedId,
  onSelect,
  onChanged,
}: {
  layout: 'wide' | 'compact'
  brandId: string
  targets: CodeUsageTarget[]
  folders: CodeUsageTargetFolder[]
  groups: OutboundPartnerGroup[]
  keyword: string
  aliasesByTarget: Map<string, string[]>
  barcodeCounts: Map<string, number>
  ownerByKey: Map<string, AliasOwner>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChanged: () => void | Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [requestedRootTabId, setRequestedRootTabId] = useState<string | null>(
    null,
  )
  const [requestedChildTabId, setRequestedChildTabId] = useState<string | null>(
    ALL_CHILD_TAB_ID,
  )
  const [creatingRoot, setCreatingRoot] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [creatingPartner, setCreatingPartner] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [rename, setRename] = useState('')
  const [moving, setMoving] = useState(false)

  const searching = Boolean(keyword.trim())
  const forest = useMemo(() => buildFolderForest(folders), [folders])
  const cardsIn = useMemo(() => {
    const map = new Map<string | null, CodeUsageTarget[]>()
    targets.forEach((target) => {
      const key = target.folderId
      const list = map.get(key)
      if (list) list.push(target)
      else map.set(key, [target])
    })
    return (folderId: string | null) => map.get(folderId) ?? []
  }, [targets])

  const unfiled = cardsIn(null)
  const rootTabs = useMemo(
    () =>
      buildOutboundBrowserTabs({
        forest,
        folders,
        cardsIn,
        unfiled,
      }),
    [cardsIn, forest, folders, unfiled],
  )
  const rootTabId = resolveOutboundTabId(rootTabs, requestedRootTabId)
  const rootTab = rootTabs.find((tab) => tab.id === rootTabId) ?? null
  const rootNode = useMemo(() => {
    if (rootTab?.kind !== 'folder' || !rootTab.folderId) return null
    return findFolderNode(forest, rootTab.folderId)
  }, [forest, rootTab])
  const childTabs = useMemo(
    () => (rootNode ? outboundFolderTabs(rootNode, folders, cardsIn) : []),
    [cardsIn, folders, rootNode],
  )
  const childTabId = resolveOutboundTabId(childTabs, requestedChildTabId)

  const scopedFolderId = useMemo(() => {
    if (!rootTab || rootTab.kind !== 'folder') return null
    const child = childTabs.find((tab) => tab.id === childTabId)
    if (!child || child.kind === 'all') return rootTab.folderId
    return child.folderId
  }, [childTabId, childTabs, rootTab])

  const includeDescendants =
    rootTab?.kind === 'folder' &&
    (childTabs.length === 0 || childTabId === ALL_CHILD_TAB_ID || Boolean(childTabId))

  const sections = useMemo(() => {
    if (rootTab?.kind === 'unfiled') {
      return collectOutboundUnitSections({
        folders,
        folderId: null,
        cardsIn,
        includeDescendants: false,
      })
    }
    if (!rootTab || rootTab.kind !== 'folder' || !scopedFolderId) return []
    return collectOutboundUnitSections({
      folders,
      folderId: scopedFolderId,
      cardsIn,
      includeDescendants,
    })
  }, [
    cardsIn,
    folders,
    includeDescendants,
    rootTab,
    scopedFolderId,
  ])

  const searchHits = useMemo(() => {
    if (!searching) return []
    return targets.filter((target) => {
      const aliasesHere = aliasesByTarget.get(target.id) ?? EMPTY_ALIASES
      if (matchesOutboundPartnerSearch(keyword, target, aliasesHere)) {
        return true
      }
      return folderPath(folders, target.folderId).some((folder) =>
        matchesFolderSearch(keyword, folder),
      )
    })
  }, [aliasesByTarget, folders, keyword, searching, targets])

  const searchSections = useMemo<OutboundUnitSection[]>(() => {
    if (!searching) return []
    return groupOutboundSearchSections({ folders, hits: searchHits })
  }, [folders, searchHits, searching])

  const visibleSections = searching ? searchSections : sections
  const visibleUnitIdSet = flattenOutboundUnits(visibleSections)
    .map((unit) => unit.id)
    .sort()
    .join('|')

  useEffect(() => {
    if (!selectedId) return
    if (!visibleUnitIdSet.split('|').includes(selectedId)) {
      onSelect(null)
    }
  }, [onSelect, selectedId, visibleUnitIdSet])

  const selectedTarget =
    targets.find((target) => target.id === selectedId) ?? null
  const selectedCompany = selectedTarget
    ? findOutboundCompanyForUnit(visibleSections, selectedTarget.id) ??
      groupOutboundPartnersInFolder(
        targets.filter((target) =>
          selectedTarget.groupId
            ? target.groupId === selectedTarget.groupId &&
              target.folderId === selectedTarget.folderId &&
              target.active === selectedTarget.active
            : target.id === selectedTarget.id,
        ),
      )[0] ??
      null
    : null

  const activeFolderId =
    rootTab?.kind === 'folder' ? scopedFolderId : rootTab?.kind === 'unfiled'
      ? null
      : undefined
  const activeFolder =
    activeFolderId != null ? findFolderNode(forest, activeFolderId) : null
  const canNest =
    activeFolderId === null
      ? true
      : activeFolderId
        ? canCreateChildFolder(folders, activeFolderId)
        : false
  const moveOptions = activeFolder
    ? folderMoveOptions(folders, { disableId: activeFolder.id })
    : []

  const createRootMutation = useMutation({
    mutationFn: (name: string) =>
      createCodeUsageTargetFolder(brandId, { name, parentId: null }),
    onSuccess: async (folder) => {
      setCreatingRoot(false)
      setError(null)
      await onChanged()
      setRequestedRootTabId(folder.id)
      setRequestedChildTabId(ALL_CHILD_TAB_ID)
    },
    onError: showFolderError,
  })

  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      createCodeUsageTargetFolder(brandId, {
        name,
        parentId: activeFolderId ?? null,
      }),
    onSuccess: async () => {
      setCreatingFolder(false)
      setError(null)
      await onChanged()
    },
    onError: showFolderError,
  })

  const createPartnerMutation = useMutation({
    mutationFn: async (draft: { groupName: string }) => {
      const channelType = outboundChannelFromFolderPath(
        folders,
        activeFolderId ?? null,
      )
      const group = await createOutboundPartnerGroup(brandId, draft.groupName)
      return createCodeUsageTarget(brandId, {
        name: synthesizeOutboundPartnerName({
          groupName: group.name,
          channelType,
        }),
        groupId: group.id,
        siteName: '',
        channelType,
        folderId: activeFolderId ?? null,
      })
    },
    onSuccess: async (created) => {
      setCreatingPartner(false)
      setError(null)
      await onChanged()
      onSelect(created.id)
    },
    onError: (err) =>
      setError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '업체를 저장하지 못했습니다.',
      ),
  })

  const renameMutation = useMutation({
    mutationFn: () => {
      if (!activeFolder) throw new Error('폴더를 먼저 고르세요.')
      return updateCodeUsageTargetFolder(activeFolder.id, { name: rename })
    },
    onSuccess: async () => {
      setRenaming(false)
      setError(null)
      await onChanged()
    },
    onError: showFolderError,
  })

  const moveMutation = useMutation({
    mutationFn: (parentId: string | null) => {
      if (!activeFolder) throw new Error('폴더를 먼저 고르세요.')
      return updateCodeUsageTargetFolder(activeFolder.id, { parentId })
    },
    onSuccess: async () => {
      setMoving(false)
      setError(null)
      await onChanged()
    },
    onError: showFolderError,
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!activeFolder) throw new Error('폴더를 먼저 고르세요.')
      return deleteCodeUsageTargetFolder(activeFolder.id)
    },
    onSuccess: async () => {
      setError(null)
      await onChanged()
      if (childTabId && childTabId !== ALL_CHILD_TAB_ID) {
        setRequestedChildTabId(ALL_CHILD_TAB_ID)
      }
    },
    onError: showFolderError,
  })

  function showFolderError(err: unknown) {
    setError(
      err instanceof CodeUsageTargetStoreError
        ? err.message
        : '폴더를 저장하지 못했습니다.',
    )
  }

  const pending =
    createRootMutation.isPending ||
    createFolderMutation.isPending ||
    createPartnerMutation.isPending ||
    renameMutation.isPending ||
    moveMutation.isPending ||
    deleteMutation.isPending

  const canEditFolder = Boolean(activeFolder)
  const canAddPartner = !searching

  const listPane = searching ? (
    searchHits.length === 0 ? (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        검색 결과가 없습니다.
      </p>
    ) : (
      <SectionList
        sections={searchSections}
        selectedId={selectedId}
        onSelect={(id) => onSelect(id === selectedId ? null : id)}
        onRenamed={onChanged}
        onError={setError}
      />
    )
  ) : (
    <SectionList
      sections={sections}
      selectedId={selectedId}
      onSelect={(id) => onSelect(id === selectedId ? null : id)}
      onRenamed={onChanged}
      onError={setError}
    />
  )

  const renderFolderActions = () => (
      <div
        className="mb-0.5 flex flex-wrap items-center justify-end gap-1"
        aria-label="폴더 작업"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={TAB_ACTION}
          disabled={pending}
          onClick={() => setCreatingRoot(true)}
        >
          <FolderPlus className="size-3" />
          폴더 추가
        </Button>
        {canEditFolder && canNest ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={TAB_ACTION}
            disabled={pending}
            onClick={() => {
              setCreatingFolder(true)
              setCreatingPartner(false)
            }}
          >
            <FolderPlus className="size-3" />
            하위 폴더
          </Button>
        ) : null}
        {canAddPartner ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={TAB_ACTION}
            disabled={pending}
            onClick={() => {
              setCreatingPartner(true)
              setCreatingFolder(false)
            }}
          >
            <Plus className="size-3" />
            업체 추가
          </Button>
        ) : null}
        {canEditFolder ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="!size-6 text-muted-foreground"
              aria-label="폴더 이름 바꾸기"
              disabled={pending}
              onClick={() => {
                setRename(activeFolder?.name ?? '')
                setRenaming(true)
              }}
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="!size-6 text-muted-foreground"
              aria-label="폴더 삭제"
              disabled={pending}
              onClick={() => {
                if (!activeFolder) return
                if (
                  !window.confirm(
                    `"${activeFolder.name}" 폴더를 지울까요?\n안의 업체는 미분류로 돌아갑니다. 안쪽 폴더가 있으면 지울 수 없습니다.`,
                  )
                ) {
                  return
                }
                deleteMutation.mutate()
              }}
            >
              <Trash2 className="size-3" />
            </Button>
          </>
        ) : null}
      </div>
    )

  const listComposer = searching ? null : (
    <>
      {creatingFolder ? (
        <div className="mb-2">
          <NameForm
            placeholder="하위 폴더 이름"
            pending={createFolderMutation.isPending}
            onSubmit={(name) => createFolderMutation.mutate(name)}
            onCancel={() => setCreatingFolder(false)}
          />
        </div>
      ) : null}
      {creatingPartner ? (
        <div className="mb-2">
          <CompanyCreateForm
            pending={createPartnerMutation.isPending}
            onSubmit={(draft) => createPartnerMutation.mutate(draft)}
            onCancel={() => setCreatingPartner(false)}
          />
        </div>
      ) : null}
      {renaming && activeFolder ? (
        <form
          className="mb-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (rename.trim()) renameMutation.mutate()
          }}
        >
          <Input
            autoFocus
            className="h-8"
            value={rename}
            disabled={pending}
            onChange={(event) => setRename(event.target.value)}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!rename.trim() || pending}
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMoving(true)}
          >
            이동
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setRenaming(false)
              setMoving(false)
            }}
          >
            <X className="size-3.5" />
          </Button>
        </form>
      ) : null}
      {moving && activeFolder ? (
        <Select
          className="mb-2 h-8 w-full"
          defaultValue={activeFolder.parentId ?? ''}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value === '' ? null : event.target.value
            moveMutation.mutate(next)
          }}
        >
          {moveOptions.map((option) => (
            <option
              key={option.id ?? 'root'}
              value={option.id ?? ''}
              disabled={option.disabled}
            >
              {option.id
                ? `${'\u00a0'.repeat(Math.max(0, option.depth - 1) * 2)}${option.label}`
                : '맨 위'}
            </option>
          ))}
        </Select>
      ) : null}
    </>
  )

  const detailPane = (
    <OutboundPartnerDetailPanel
      brandId={brandId}
      target={selectedTarget}
      targets={targets}
      company={selectedCompany}
      aliases={
        selectedTarget
          ? (aliasesByTarget.get(selectedTarget.id) ?? EMPTY_ALIASES)
          : EMPTY_ALIASES
      }
      folders={folders}
      groups={groups}
      barcodeCount={
        selectedTarget ? (barcodeCounts.get(selectedTarget.id) ?? 0) : 0
      }
      ownerByKey={ownerByKey}
      onChanged={onChanged}
      onDeleted={() => onSelect(null)}
      onError={setError}
    />
  )

  return (
    <div className="space-y-4">
      {searching ? null : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
            <div className="flex flex-wrap" aria-label="출고 폴더">
              {rootTabs.map((tab) => (
                <TabButton
                  key={tab.id}
                  selected={tab.id === rootTabId}
                  label={tab.label}
                  count={outboundFolderCountLabel(
                    tab.companyCount,
                    tab.unitCount,
                  )}
                  onClick={() => {
                    setRequestedRootTabId(tab.id)
                    setRequestedChildTabId(ALL_CHILD_TAB_ID)
                    setCreatingFolder(false)
                    setCreatingPartner(false)
                    setRenaming(false)
                    setMoving(false)
                  }}
                />
              ))}
            </div>
            {renderFolderActions()}
          </div>

          {childTabs.length > 0 ? (
            <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
              <div aria-label="하위 폴더" className="flex flex-wrap">
                {childTabs.map((tab) => (
                  <TabButton
                    key={tab.id}
                    selected={tab.id === childTabId}
                    label={tab.label}
                    count={outboundFolderCountLabel(
                      tab.companyCount,
                      tab.unitCount,
                    )}
                    onClick={() => {
                      setRequestedChildTabId(tab.id)
                      setCreatingFolder(false)
                      setCreatingPartner(false)
                      setRenaming(false)
                      setMoving(false)
                    }}
                  />
                ))}
              </div>
              {renderFolderActions()}
            </div>
          ) : null}

          {creatingRoot ? (
            <NameForm
              placeholder="예: 온라인, 오프라인"
              pending={createRootMutation.isPending}
              onSubmit={(name) => createRootMutation.mutate(name)}
              onCancel={() => setCreatingRoot(false)}
            />
          ) : null}
        </>
      )}

      {forest.length === 0 && unfiled.length === 0 && !searching ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          폴더를 먼저 만들거나, 이름만 넣어 미분류로 두세요.
        </p>
      ) : layout === 'wide' ? (
        <div className="grid min-h-[28rem] grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] gap-4">
          <div className="min-h-0 overflow-y-auto pr-1">
            {listComposer}
            {listPane}
          </div>
          <div className="min-w-0 border-l border-border pl-4">{detailPane}</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="max-h-64 overflow-y-auto">
            {listComposer}
            {listPane}
          </div>
          {detailPane}
        </div>
      )}

      {error ? (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
