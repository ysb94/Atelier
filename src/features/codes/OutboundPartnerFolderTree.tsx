import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  canCreateChildFolder,
  folderCardCount,
  folderMoveOptions,
  type OutboundFolderNode,
} from '@/lib/codes/outbound-folder'
import {
  CodeUsageTargetStoreError,
  createCodeUsageTarget,
  createCodeUsageTargetFolder,
  deleteCodeUsageTargetFolder,
  updateCodeUsageTargetFolder,
} from '@/lib/api'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'
import { OutboundPartnerRow } from '@/features/codes/OutboundPartnerRow'
import type { AliasOwner } from '@/features/codes/OutboundPartnerEditForm'

const EMPTY_ALIASES: readonly string[] = []

const FOLDER_CHIP =
  'flex w-full flex-wrap items-center gap-1 rounded-md bg-muted/70 px-2 py-1.5'
const FOLDER_ACTION =
  '!h-6 !gap-1 !px-1.5 !text-[11px] font-medium text-muted-foreground'
const FOLDER_ICON = '!size-6 text-muted-foreground'

type TreeShared = {
  brandId: string
  folders: CodeUsageTargetFolder[]
  aliasesByTarget: Map<string, string[]>
  barcodeCounts: Map<string, number>
  ownerByKey: Map<string, AliasOwner>
  expandedPartnerId: string | null
  onTogglePartner: (id: string) => void
  onChanged: () => void | Promise<void>
  onError: (message: string | null) => void
}

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

function FolderNodeView({
  node,
  cards,
  shared,
}: {
  node: OutboundFolderNode
  cards: (folderId: string | null) => CodeUsageTarget[]
  shared: TreeShared
}) {
  const [open, setOpen] = useState(true)
  const [creating, setCreating] = useState<'folder' | 'partner' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [rename, setRename] = useState(node.name)
  const [moving, setMoving] = useState(false)
  const here = cards(node.id)
  const total = folderCardCount(shared.folders, node.id, (id) =>
    id ? cards(id).length : 0,
  )
  const canNest = canCreateChildFolder(shared.folders, node.id)
  const moveOptions = folderMoveOptions(shared.folders, { disableId: node.id })

  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      createCodeUsageTargetFolder(shared.brandId, {
        name,
        parentId: node.id,
      }),
    onSuccess: async () => {
      setCreating(null)
      shared.onError(null)
      await shared.onChanged()
    },
    onError: showError,
  })

  const createPartnerMutation = useMutation({
    mutationFn: (name: string) =>
      createCodeUsageTarget(shared.brandId, {
        name,
        folderId: node.id,
      }),
    onSuccess: async () => {
      setCreating(null)
      shared.onError(null)
      await shared.onChanged()
    },
    onError: showError,
  })

  const renameMutation = useMutation({
    mutationFn: () => updateCodeUsageTargetFolder(node.id, { name: rename }),
    onSuccess: async () => {
      setRenaming(false)
      shared.onError(null)
      await shared.onChanged()
    },
    onError: showError,
  })

  const moveMutation = useMutation({
    mutationFn: (parentId: string | null) =>
      updateCodeUsageTargetFolder(node.id, { parentId }),
    onSuccess: async () => {
      setMoving(false)
      shared.onError(null)
      await shared.onChanged()
    },
    onError: showError,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteCodeUsageTargetFolder(node.id),
    onSuccess: async () => {
      shared.onError(null)
      await shared.onChanged()
    },
    onError: showError,
  })

  function showError(err: unknown) {
    shared.onError(
      err instanceof CodeUsageTargetStoreError
        ? err.message
        : '폴더를 저장하지 못했습니다.',
    )
  }

  const pending =
    createFolderMutation.isPending ||
    createPartnerMutation.isPending ||
    renameMutation.isPending ||
    moveMutation.isPending ||
    deleteMutation.isPending

  return (
    <section className="space-y-2">
      <div className={FOLDER_CHIP}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={FOLDER_ICON}
          aria-label={open ? '폴더 접기' : '폴더 펼치기'}
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </Button>
        <button
          type="button"
          className="inline-flex h-6 min-w-0 shrink-0 items-center px-1.5 text-left"
          onClick={() => setOpen((prev) => !prev)}
        >
          <span className="text-lg font-semibold leading-none">
            {node.name}
          </span>
          <span className="ml-1.5 text-xs leading-none text-muted-foreground">
            {total}곳
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={FOLDER_ACTION}
          disabled={!canNest || pending}
          onClick={() => {
            setOpen(true)
            setCreating('folder')
          }}
        >
          <FolderPlus className="size-3" />
          폴더
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={FOLDER_ACTION}
          disabled={pending}
          onClick={() => {
            setOpen(true)
            setCreating('partner')
          }}
        >
          <Plus className="size-3" />
          업체
        </Button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={FOLDER_ICON}
            aria-label="폴더 이름 바꾸기"
            disabled={pending}
            onClick={() => {
              setRename(node.name)
              setRenaming(true)
            }}
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={FOLDER_ICON}
            aria-label="폴더 삭제"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  `"${node.name}" 폴더를 지울까요?\n안의 업체는 미분류로 돌아갑니다. 안쪽 폴더가 있으면 지울 수 없습니다.`,
                )
              ) {
                return
              }
              deleteMutation.mutate()
            }}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {renaming || moving ? (
        <div className="ml-8 space-y-2">
          {renaming ? (
            <form
              className="flex gap-2"
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
          {moving ? (
            <div className="flex gap-2">
              <Select
                className="h-8 w-full"
                defaultValue={node.parentId ?? ''}
                disabled={pending}
                onChange={(event) => {
                  const next =
                    event.target.value === '' ? null : event.target.value
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
            </div>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="ml-4 space-y-2 border-l border-border pl-3">
          {creating === 'folder' ? (
            <NameForm
              placeholder="하위 폴더 이름"
              pending={createFolderMutation.isPending}
              onSubmit={(name) => createFolderMutation.mutate(name)}
              onCancel={() => setCreating(null)}
            />
          ) : null}
          {creating === 'partner' ? (
            <NameForm
              placeholder="이 폴더에 넣을 업체 이름"
              pending={createPartnerMutation.isPending}
              onSubmit={(name) => createPartnerMutation.mutate(name)}
              onCancel={() => setCreating(null)}
            />
          ) : null}
          {node.children.map((child) => (
            <FolderNodeView key={child.id} node={child} cards={cards} shared={shared} />
          ))}
          {here.length > 0 ? (
            <ul className="space-y-2">
              {here.map((target) => (
                <OutboundPartnerRow
                  key={target.id}
                  target={target}
                  aliases={shared.aliasesByTarget.get(target.id) ?? EMPTY_ALIASES}
                  folders={shared.folders}
                  barcodeCount={shared.barcodeCounts.get(target.id) ?? 0}
                  expanded={shared.expandedPartnerId === target.id}
                  ownerByKey={shared.ownerByKey}
                  onToggleExpand={() => shared.onTogglePartner(target.id)}
                  onChanged={shared.onChanged}
                />
              ))}
            </ul>
          ) : node.children.length === 0 && !creating ? (
            <p className="text-xs text-muted-foreground">
              아직 업체가 없습니다. 업체를 넣거나 하위 폴더를 만드세요.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function OutboundPartnerFolderTree({
  brandId,
  forest,
  folders,
  unfiled,
  inactive,
  showInactive,
  cardsIn,
  aliasesByTarget,
  barcodeCounts,
  ownerByKey,
  expandedPartnerId,
  onTogglePartner,
  onChanged,
}: {
  brandId: string
  forest: OutboundFolderNode[]
  folders: CodeUsageTargetFolder[]
  unfiled: CodeUsageTarget[]
  inactive: CodeUsageTarget[]
  showInactive: boolean
  cardsIn: (folderId: string | null) => CodeUsageTarget[]
  aliasesByTarget: Map<string, string[]>
  barcodeCounts: Map<string, number>
  ownerByKey: Map<string, AliasOwner>
  expandedPartnerId: string | null
  onTogglePartner: (id: string) => void
  onChanged: () => void | Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [creatingRoot, setCreatingRoot] = useState(false)
  const [creatingUnfiled, setCreatingUnfiled] = useState(false)

  const createRootMutation = useMutation({
    mutationFn: (name: string) =>
      createCodeUsageTargetFolder(brandId, { name, parentId: null }),
    onSuccess: async () => {
      setCreatingRoot(false)
      setError(null)
      await onChanged()
    },
    onError: (err) =>
      setError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '폴더를 만들지 못했습니다.',
      ),
  })

  const createUnfiledMutation = useMutation({
    mutationFn: (name: string) =>
      createCodeUsageTarget(brandId, { name, folderId: null }),
    onSuccess: async () => {
      setCreatingUnfiled(false)
      setError(null)
      await onChanged()
    },
    onError: (err) =>
      setError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '업체를 저장하지 못했습니다.',
      ),
  })

  const shared: TreeShared = {
    brandId,
    folders,
    aliasesByTarget,
    barcodeCounts,
    ownerByKey,
    expandedPartnerId,
    onTogglePartner,
    onChanged,
    onError: setError,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          폴더가 분류입니다. 카드를 다른 폴더로 옮기면 분류가 바뀝니다.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCreatingRoot(true)}
        >
          <FolderPlus className="size-3.5" />
          맨 위 폴더
        </Button>
      </div>

      {creatingRoot ? (
        <NameForm
          placeholder="예: 온라인, 오프라인"
          pending={createRootMutation.isPending}
          onSubmit={(name) => createRootMutation.mutate(name)}
          onCancel={() => setCreatingRoot(false)}
        />
      ) : null}

      {forest.length === 0 && unfiled.length === 0 && inactive.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          폴더를 먼저 만들거나, 이름만 넣어 미분류로 두세요.
        </p>
      ) : null}

      <div className="space-y-4">
        {forest.map((node) => (
          <FolderNodeView key={node.id} node={node} cards={cardsIn} shared={shared} />
        ))}
      </div>

      <section className="space-y-2">
        <div className={FOLDER_CHIP}>
          <h3 className="px-1.5 text-sm font-semibold text-muted-foreground">
            미분류 · {unfiled.length}곳
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={FOLDER_ACTION}
            onClick={() => setCreatingUnfiled(true)}
          >
            <Plus className="size-3" />
            업체
          </Button>
        </div>
        {creatingUnfiled ? (
          <NameForm
            placeholder="새 출고업체 이름"
            pending={createUnfiledMutation.isPending}
            onSubmit={(name) => createUnfiledMutation.mutate(name)}
            onCancel={() => setCreatingUnfiled(false)}
          />
        ) : null}
        {unfiled.length > 0 ? (
          <ul className="space-y-2">
            {unfiled.map((target) => (
              <OutboundPartnerRow
                key={target.id}
                target={target}
                aliases={aliasesByTarget.get(target.id) ?? EMPTY_ALIASES}
                folders={folders}
                barcodeCount={barcodeCounts.get(target.id) ?? 0}
                expanded={expandedPartnerId === target.id}
                ownerByKey={ownerByKey}
                onToggleExpand={() => onTogglePartner(target.id)}
                onChanged={onChanged}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            아직 폴더에 넣지 않은 업체가 여기 모입니다.
          </p>
        )}
      </section>

      {showInactive ? (
        <section className="space-y-2">
          <h3 className={`${FOLDER_CHIP} text-sm font-semibold text-muted-foreground`}>
            비활성 · {inactive.length}곳
          </h3>
          {inactive.length > 0 ? (
            <ul className="space-y-2">
              {inactive.map((target) => (
                <OutboundPartnerRow
                  key={target.id}
                  target={target}
                  aliases={aliasesByTarget.get(target.id) ?? EMPTY_ALIASES}
                  folders={folders}
                  barcodeCount={barcodeCounts.get(target.id) ?? 0}
                  expanded={false}
                  ownerByKey={ownerByKey}
                  onToggleExpand={() => undefined}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              예전에 보냈지만 지금은 안 보내는 업체가 여기 모입니다. 다시 켤
              때는 위치와 특징을 다시 적습니다.
            </p>
          )}
        </section>
      ) : null}

      {error ? (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
