import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Pencil, RotateCcw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { folderPathLabel } from '@/lib/codes/outbound-folder'
import {
  OUTBOUND_PARTNER_STATUS_LABEL,
  normalizeOutboundPartnerName,
  outboundPartnerStatus,
} from '@/lib/codes/outbound-partner'
import { CodeUsageTargetStoreError, updateCodeUsageTarget } from '@/lib/api'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { OutboundPartnerActivateDialog } from '@/features/codes/OutboundPartnerActivateDialog'
import {
  OutboundPartnerEditForm,
  type AliasOwner,
} from '@/features/codes/OutboundPartnerEditForm'

function notePreview(note: string) {
  const line = note.trim().split(/\r?\n/).find((part) => part.trim())
  return line?.trim() ?? ''
}

export function OutboundPartnerRow({
  target,
  aliases,
  folders,
  barcodeCount,
  expanded,
  ownerByKey,
  onToggleExpand,
  onChanged,
}: {
  target: CodeUsageTarget
  aliases: readonly string[]
  folders: readonly CodeUsageTargetFolder[]
  barcodeCount: number
  expanded: boolean
  ownerByKey: Map<string, AliasOwner>
  onToggleExpand: () => void
  onChanged: () => void | Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [activateOpen, setActivateOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [rename, setRename] = useState(target.name)
  const status = outboundPartnerStatus(target)
  const preview = notePreview(target.note)
  const inactive = !target.active
  const previousPath = inactive ? folderPathLabel(folders, target.folderId) : ''
  const nextName = normalizeOutboundPartnerName(rename)

  const renameMutation = useMutation({
    mutationFn: () => updateCodeUsageTarget(target.id, { name: nextName }),
    onSuccess: async () => {
      setRenaming(false)
      setError(null)
      await onChanged()
    },
    onError: (err) =>
      setError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '업체 이름을 바꾸지 못했습니다.',
      ),
  })

  const deactivateMutation = useMutation({
    mutationFn: () => updateCodeUsageTarget(target.id, { active: false }),
    onSuccess: async () => {
      setError(null)
      await onChanged()
    },
    onError: (err) =>
      setError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '업체를 비활성화하지 못했습니다.',
      ),
  })

  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        {inactive ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={expanded ? '접기' : '펼쳐서 편집'}
            aria-expanded={expanded}
            onClick={onToggleExpand}
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        )}

        {renaming && !inactive ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (nextName) renameMutation.mutate()
            }}
          >
            <Input
              autoFocus
              className="h-8"
              value={rename}
              disabled={renameMutation.isPending}
              aria-label="업체 이름"
              onChange={(event) => setRename(event.target.value)}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!nextName || renameMutation.isPending}
              aria-label="이름 저장"
            >
              <Check className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={renameMutation.isPending}
              aria-label="이름 수정 취소"
              onClick={() => {
                setRenaming(false)
                setRename(target.name)
              }}
            >
              <X className="size-3.5" />
            </Button>
          </form>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                className="truncate text-left text-sm font-medium"
                onClick={() => {
                  if (inactive) setActivateOpen(true)
                  else onToggleExpand()
                }}
              >
                {target.name}
              </button>
              {status !== 'ongoing' ? (
                <Badge variant={status === 'archived' ? 'muted' : 'warning'}>
                  {OUTBOUND_PARTNER_STATUS_LABEL[status]}
                </Badge>
              ) : null}
              {!inactive ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="!size-6 text-muted-foreground"
                  aria-label="업체 이름 바꾸기"
                  onClick={() => {
                    setRename(target.name)
                    setRenaming(true)
                  }}
                >
                  <Pencil className="size-3" />
                </Button>
              ) : null}
            </div>
            <button
              type="button"
              className="mt-0.5 block text-left text-xs text-muted-foreground"
              onClick={() => {
                if (inactive) setActivateOpen(true)
                else onToggleExpand()
              }}
            >
              {inactive ? (
                <>이전 위치 · {previousPath}</>
              ) : (
                <>
                  별칭 {formatNumber(aliases.length)}개 · 연결된 바코드{' '}
                  {formatNumber(barcodeCount)}건
                  {preview ? ` · ${preview}` : ''}
                </>
              )}
            </button>
          </div>
        )}

        {inactive ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setActivateOpen(true)}
          >
            <RotateCcw className="size-3.5" />
            다시 활성화
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={deactivateMutation.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  `"${target.name}"을 비활성화할까요?\n지금은 안 보내도, 나중에 위치와 특징을 다시 적으면 켤 수 있습니다. 기존 바코드 ${formatNumber(barcodeCount)}건의 연결 이력은 유지됩니다.`,
                )
              ) {
                return
              }
              deactivateMutation.mutate()
            }}
          >
            비활성화
          </Button>
        )}
      </div>

      {error ? (
        <p className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {expanded && !inactive ? (
        <OutboundPartnerEditForm
          target={target}
          aliases={aliases}
          folders={folders}
          ownerByKey={ownerByKey}
          onClose={onToggleExpand}
          onChanged={onChanged}
        />
      ) : null}

      {activateOpen ? (
        <OutboundPartnerActivateDialog
          target={target}
          aliases={aliases}
          folders={folders}
          ownerByKey={ownerByKey}
          onClose={() => setActivateOpen(false)}
          onChanged={onChanged}
        />
      ) : null}
    </li>
  )
}
