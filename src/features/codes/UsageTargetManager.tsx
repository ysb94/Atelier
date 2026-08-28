import { useMemo, useState } from 'react'
import { ClipboardPaste, X } from 'lucide-react'
import type {
  CodeUsageAssignment,
  CodeUsageTarget,
  CodeUsageTargetAlias,
  CodeUsageTargetFolder,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  buildFolderForest,
  folderPath,
  matchesFolderSearch,
} from '@/lib/codes/outbound-folder'
import {
  compactOutboundPartnerKey,
  matchesOutboundPartnerSearch,
  outboundPartnerStatus,
} from '@/lib/codes/outbound-partner'
import { OutboundPartnerFolderTree } from '@/features/codes/OutboundPartnerFolderTree'
import { OutboundPartnerPastePanel } from '@/features/codes/OutboundPartnerPastePanel'
import type { AliasOwner } from '@/features/codes/OutboundPartnerEditForm'

type SharedProps = {
  brandId: string
  targets: CodeUsageTarget[]
  folders: CodeUsageTargetFolder[]
  aliases: CodeUsageTargetAlias[]
  assignments: CodeUsageAssignment[]
  onChanged: () => void | Promise<void>
}

const EMPTY_ALIASES: readonly string[] = []

function UsageTargetManagerContent({
  brandId,
  targets,
  folders,
  aliases,
  assignments,
  onChanged,
}: SharedProps) {
  const [keyword, setKeyword] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [hideInactive, setHideInactive] = useState(true)

  const aliasesByTarget = useMemo(() => {
    const map = new Map<string, string[]>()
    aliases.forEach((alias) => {
      const list = map.get(alias.targetId)
      if (list) list.push(alias.alias)
      else map.set(alias.targetId, [alias.alias])
    })
    return map
  }, [aliases])

  const barcodeCounts = useMemo(() => {
    const map = new Map<string, number>()
    assignments.forEach((assignment) => {
      map.set(
        assignment.usageTargetId,
        (map.get(assignment.usageTargetId) ?? 0) + 1,
      )
    })
    return map
  }, [assignments])

  const ownerByKey = useMemo(() => {
    const map = new Map<string, AliasOwner>()
    targets.forEach((target) => {
      const key =
        target.normalizedName || compactOutboundPartnerKey(target.name)
      if (key) {
        map.set(key, {
          targetId: target.id,
          targetName: target.name,
          kind: 'name',
        })
      }
    })
    aliases.forEach((alias) => {
      const owner = targets.find((target) => target.id === alias.targetId)
      if (!owner) return
      map.set(alias.normalizedAlias, {
        targetId: alias.targetId,
        targetName: owner.name,
        kind: 'alias',
      })
    })
    return map
  }, [aliases, targets])

  const visibleTargets = useMemo(() => {
    return targets.filter((target) => {
      if (hideInactive && outboundPartnerStatus(target) === 'archived') {
        return false
      }
      if (!keyword.trim()) return true
      const aliasesHere = aliasesByTarget.get(target.id) ?? EMPTY_ALIASES
      if (matchesOutboundPartnerSearch(keyword, target, aliasesHere)) {
        return true
      }
      const path = folderPath(folders, target.folderId)
      return path.some((folder) => matchesFolderSearch(keyword, folder))
    })
  }, [aliasesByTarget, folders, hideInactive, keyword, targets])

  const visibleFolders = useMemo(() => {
    if (!keyword.trim()) return folders
    const keep = new Set<string>()
    visibleTargets.forEach((target) => {
      if (!target.active) return
      folderPath(folders, target.folderId).forEach((folder) =>
        keep.add(folder.id),
      )
    })
    folders.forEach((folder) => {
      if (matchesFolderSearch(keyword, folder)) {
        keep.add(folder.id)
        folderPath(folders, folder.id).forEach((item) => keep.add(item.id))
      }
    })
    return folders.filter((folder) => keep.has(folder.id))
  }, [folders, keyword, visibleTargets])

  const forest = useMemo(
    () => buildFolderForest(visibleFolders),
    [visibleFolders],
  )

  const activeTargets = useMemo(
    () => visibleTargets.filter((target) => target.active),
    [visibleTargets],
  )
  const inactiveTargets = useMemo(
    () => visibleTargets.filter((target) => !target.active),
    [visibleTargets],
  )

  const cardsIn = useMemo(() => {
    const map = new Map<string | null, CodeUsageTarget[]>()
    activeTargets.forEach((target) => {
      const key = target.folderId
      const list = map.get(key)
      if (list) list.push(target)
      else map.set(key, [target])
    })
    return (folderId: string | null) => map.get(folderId) ?? []
  }, [activeTargets])

  const unfiled = cardsIn(null)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          아는 갈래만 폴더로 두고, 업체마다 다른 말은 카드에 적으세요.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 rounded border-border"
              checked={hideInactive}
              onChange={(event) => setHideInactive(event.target.checked)}
            />
            비활성 숨기기
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPasteOpen((prev) => !prev)}
          >
            <ClipboardPaste className="size-4" />
            붙여넣기
          </Button>
        </div>
      </div>

      {pasteOpen ? (
        <OutboundPartnerPastePanel
          brandId={brandId}
          targets={targets}
          folders={folders}
          onClose={() => setPasteOpen(false)}
          onChanged={onChanged}
        />
      ) : null}

      {targets.length > 3 || folders.length > 2 ? (
        <div className="relative">
          <Input
            value={keyword}
            placeholder="업체명, 별칭, 폴더 이름으로 검색"
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword ? (
            <button
              type="button"
              aria-label="검색어 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setKeyword('')}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}

      {keyword && visibleTargets.length === 0 && visibleFolders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          검색 결과가 없습니다.
        </p>
      ) : (
        <OutboundPartnerFolderTree
          brandId={brandId}
          forest={forest}
          folders={folders}
          unfiled={unfiled}
          inactive={inactiveTargets}
          showInactive={!hideInactive}
          cardsIn={cardsIn}
          aliasesByTarget={aliasesByTarget}
          barcodeCounts={barcodeCounts}
          ownerByKey={ownerByKey}
          expandedPartnerId={expandedId}
          onTogglePartner={(id) =>
            setExpandedId((prev) => (prev === id ? null : id))
          }
          onChanged={onChanged}
        />
      )}

      <p className="text-xs text-muted-foreground">
        비활성화해도 이미 등록된 바코드 연결 이력은 삭제되지 않습니다. 다시 켤
        때는 위치와 특징을 다시 적어야 합니다. 폴더를 지워도 업체는 미분류로
        남습니다.
      </p>
    </div>
  )
}

export function UsageTargetManagerPanel(props: SharedProps) {
  return <UsageTargetManagerContent {...props} />
}

export function UsageTargetManagerDialog({
  open,
  onClose,
  ...props
}: SharedProps & {
  open: boolean
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 max-h-[min(90vh,800px)] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              출고업체 관리
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              폴더로 일을 나누고, 맨 끝 카드에 그 업체만의 특징을 적습니다.
              비활성 업체는 다시 켤 때 위치부터 다시 정합니다.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="닫기"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="px-5 py-5">
          <UsageTargetManagerContent {...props} />
        </div>
      </div>
    </div>
  )
}
