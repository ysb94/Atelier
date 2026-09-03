import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { folderPathLabel } from '@/lib/codes/outbound-folder'
import { outboundChannelFromFolderPath } from '@/lib/codes/outbound-partner-browser'
import {
  keepsHeadquartersOnFirstBranch,
  outboundPartnerDeleteBlockedMessage,
  outboundPartnerDisplayName,
  remainingActiveInGroup,
  shouldCollapseRemainingToCompany,
  synthesizeOutboundPartnerName,
  type OutboundCompanyInFolder,
} from '@/lib/codes/outbound-partner'
import {
  CodeUsageTargetStoreError,
  createCodeUsageTarget,
  createOutboundPartnerGroup,
  deleteCodeUsageTarget,
  getCodeUsageTargetLinkLabels,
  updateCodeUsageTarget,
} from '@/lib/api'
import type {
  CodeUsageTarget,
  CodeUsageTargetFolder,
  OutboundPartnerGroup,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { OutboundPartnerActivateDialog } from '@/features/codes/OutboundPartnerActivateDialog'
import {
  OutboundPartnerEditForm,
  type AliasOwner,
} from '@/features/codes/OutboundPartnerEditForm'
import { OutboundPartnerIdentity } from '@/features/codes/OutboundPartnerIdentity'
import { BranchCreateForm } from '@/features/codes/OutboundPartnerCompanyNode'

export function OutboundPartnerDetailPanel({
  brandId,
  target,
  targets,
  company,
  aliases,
  folders,
  groups,
  barcodeCount,
  ownerByKey,
  onChanged,
  onDeleted,
  onError,
}: {
  brandId: string
  target: CodeUsageTarget | null
  targets: CodeUsageTarget[]
  company: OutboundCompanyInFolder | null
  aliases: readonly string[]
  folders: readonly CodeUsageTargetFolder[]
  groups: readonly OutboundPartnerGroup[]
  barcodeCount: number
  ownerByKey: Map<string, AliasOwner>
  onChanged: () => void | Promise<void>
  onDeleted?: () => void
  onError: (message: string | null) => void
}) {
  const [addingBranch, setAddingBranch] = useState(false)
  const [activateOpen, setActivateOpen] = useState(false)
  const [formNonce, setFormNonce] = useState(0)

  const addBranchMutation = useMutation({
    mutationFn: async (draft: { siteName: string }) => {
      if (!company || !target) {
        throw new CodeUsageTargetStoreError(
          '출고 단위를 먼저 고르세요.',
          'invalid',
        )
      }
      if (!company.groupId) {
        throw new CodeUsageTargetStoreError(
          '먼저 업체로 정리하세요.',
          'invalid',
        )
      }
      const channelType = outboundChannelFromFolderPath(
        folders,
        company.folderId,
      )
      const group =
        groups.find((item) => item.id === company.groupId) ??
        (await createOutboundPartnerGroup(brandId, company.groupName))
      return createCodeUsageTarget(brandId, {
        name: synthesizeOutboundPartnerName({
          groupName: group.name,
          siteName: draft.siteName,
          channelType,
        }),
        groupId: group.id,
        siteName: draft.siteName,
        channelType,
        folderId: company.folderId,
      })
    },
    onSuccess: async () => {
      setAddingBranch(false)
      onError(null)
      await onChanged()
    },
    onError: (err) =>
      onError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '지점을 추가하지 못했습니다.',
      ),
  })

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('출고 단위를 먼저 고르세요.')
      const remaining = remainingActiveInGroup(targets, target)
      await updateCodeUsageTarget(target.id, { active: false })
      if (
        shouldCollapseRemainingToCompany(remaining.length) &&
        remaining[0]
      ) {
        await updateCodeUsageTarget(remaining[0].id, { siteName: '' })
      }
    },
    onSuccess: async () => {
      onError(null)
      await onChanged()
    },
    onError: (err) =>
      onError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '업체를 비활성화하지 못했습니다.',
      ),
  })

  const linksQuery = useQuery({
    queryKey: ['outbound-partner-links', target?.id],
    queryFn: () => getCodeUsageTargetLinkLabels(target!.id),
    enabled: Boolean(target),
  })
  const deleteHint =
    outboundPartnerDeleteBlockedMessage(linksQuery.data ?? []) ??
    (linksQuery.isError
      ? '연결 이력을 확인하지 못했습니다. 잠시 후 다시 시도하세요.'
      : null)
  const canDelete = linksQuery.isSuccess && (linksQuery.data?.length ?? 0) === 0

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('출고 단위를 먼저 고르세요.')
      await deleteCodeUsageTarget(target.id)
    },
    onSuccess: async () => {
      onError(null)
      onDeleted?.()
      await onChanged()
    },
    onError: (err) =>
      onError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '업체를 삭제하지 못했습니다.',
      ),
  })

  if (!target) return null

  const inactive = !target.active
  const canAddBranch = !inactive && company !== null && company.mode !== 'legacy'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            <OutboundPartnerIdentity
              target={target}
              asCompany={company?.mode === 'company-as-unit'}
              variant={company?.mode === 'branched' ? 'unit' : 'full'}
            />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {folderPathLabel(folders, target.folderId)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAddBranch ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={addBranchMutation.isPending}
              onClick={() => setAddingBranch((prev) => !prev)}
            >
              <Plus className="size-3.5" />
              지점
            </Button>
          ) : null}
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
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={deactivateMutation.isPending}
              onClick={() => {
                const remaining = remainingActiveInGroup(targets, target)
                const collapse = shouldCollapseRemainingToCompany(
                  remaining.length,
                )
                const label = outboundPartnerDisplayName(target)
                const message = collapse
                  ? `"${label}"을 비활성화할까요?\n남은 출고 단위는 지점 없는 업체로 돌아갑니다. 기존 바코드 ${formatNumber(barcodeCount)}건의 연결 이력은 유지됩니다.`
                  : `"${label}"을 비활성화할까요?\n지금은 안 보내도, 나중에 위치와 특징을 다시 적으면 켤 수 있습니다. 기존 바코드 ${formatNumber(barcodeCount)}건의 연결 이력은 유지됩니다.`
                if (!window.confirm(message)) return
                deactivateMutation.mutate()
              }}
            >
              비활성화
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-danger"
            disabled={
              deleteMutation.isPending ||
              linksQuery.isPending ||
              !canDelete
            }
            title={deleteHint ?? undefined}
            onClick={() => {
              const label = outboundPartnerDisplayName(target)
              if (
                !window.confirm(
                  `"${label}"을 삭제할까요?\n별칭도 함께 지워집니다. 연결된 바코드·출고 이력이 있으면 지울 수 없습니다.`,
                )
              ) {
                return
              }
              deleteMutation.mutate()
            }}
          >
            삭제
          </Button>
        </div>
      </div>

      {addingBranch && canAddBranch ? (
        <BranchCreateForm
          pending={addBranchMutation.isPending}
          keepHeadquarters={keepsHeadquartersOnFirstBranch(company)}
          onSubmit={(draft) => addBranchMutation.mutate(draft)}
          onCancel={() => setAddingBranch(false)}
        />
      ) : null}

      {inactive ? (
        <p className="text-sm text-muted-foreground">
          다시 켤 때 위치와 특징을 다시 적습니다. 바코드 연결과 출고 이력은
          그대로입니다.
        </p>
      ) : (
        <OutboundPartnerEditForm
          key={`${target.id}:${target.updatedAt}:${formNonce}`}
          target={target}
          aliases={aliases}
          folders={folders}
          groups={groups}
          companyMode={company?.mode ?? 'legacy'}
          ownerByKey={ownerByKey}
          onClose={() => setFormNonce((prev) => prev + 1)}
          onChanged={onChanged}
        />
      )}

      {activateOpen ? (
        <OutboundPartnerActivateDialog
          target={target}
          aliases={aliases}
          folders={folders}
          groups={groups}
          ownerByKey={ownerByKey}
          onClose={() => setActivateOpen(false)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  )
}
