import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type {
  CodeUsageAssignment,
  CodeUsageTarget,
  CodeUsageTargetAlias,
  CodeUsageTargetFolder,
  OutboundPartnerGroup,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  compactOutboundPartnerKey,
  outboundPartnerDisplayName,
} from '@/lib/codes/outbound-partner'
import { OutboundPartnerBrowser } from '@/features/codes/OutboundPartnerBrowser'
import type { AliasOwner } from '@/features/codes/OutboundPartnerEditForm'

type SharedProps = {
  brandId: string
  targets: CodeUsageTarget[]
  folders: CodeUsageTargetFolder[]
  groups: OutboundPartnerGroup[]
  aliases: CodeUsageTargetAlias[]
  assignments: CodeUsageAssignment[]
  onChanged: () => void | Promise<void>
}

function UsageTargetManagerContent({
  layout,
  brandId,
  targets,
  folders,
  groups,
  aliases,
  assignments,
  onChanged,
}: SharedProps & { layout: 'wide' | 'compact' }) {
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
          targetName: outboundPartnerDisplayName(target),
          kind: 'name',
        })
      }
    })
    aliases.forEach((alias) => {
      const owner = targets.find((target) => target.id === alias.targetId)
      if (!owner) return
      map.set(alias.normalizedAlias, {
        targetId: alias.targetId,
        targetName: outboundPartnerDisplayName(owner),
        kind: 'alias',
      })
    })
    return map
  }, [aliases, targets])

  return (
    <div className="space-y-5">
      {targets.length > 3 || folders.length > 2 ? (
        <div className="relative">
          <Input
            value={keyword}
            placeholder="업체 그룹, 지점, 채널, 별칭, 폴더로 검색"
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

      <OutboundPartnerBrowser
        layout={layout}
        brandId={brandId}
        targets={targets}
        folders={folders}
        groups={groups}
        keyword={keyword}
        aliasesByTarget={aliasesByTarget}
        barcodeCounts={barcodeCounts}
        ownerByKey={ownerByKey}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChanged={onChanged}
      />

      <p className="text-xs text-muted-foreground">
        비활성화하거나 업체·지점으로 정리해도 바코드 연결과 출고 이력은
        유지됩니다. 잘못 만든 업체는 연결된 이력이 없을 때만 삭제할 수
        있습니다.
      </p>
    </div>
  )
}

export function UsageTargetManagerPanel(props: SharedProps) {
  return <UsageTargetManagerContent {...props} layout="wide" />
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
              폴더 아래 업체와 지점을 관리합니다. 지점이 없으면 업체가 곧 출고
              단위입니다.
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
          <UsageTargetManagerContent {...props} layout="compact" />
        </div>
      </div>
    </div>
  )
}
