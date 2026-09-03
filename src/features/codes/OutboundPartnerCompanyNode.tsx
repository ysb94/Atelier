import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeOutboundPartnerName } from '@/lib/codes/outbound-partner'
import type { OutboundCompanyInFolder } from '@/lib/codes/outbound-partner'
import {
  CodeUsageTargetStoreError,
  updateOutboundPartnerGroup,
} from '@/lib/api'
import { OutboundPartnerUnitItem } from '@/features/codes/OutboundPartnerUnitItem'
import { TreeBranch, TreeLeaf } from '@/features/codes/OutboundPartnerTree'

export function BranchCreateForm({
  pending,
  keepHeadquarters = false,
  onSubmit,
  onCancel,
}: {
  pending: boolean
  keepHeadquarters?: boolean
  onSubmit: (draft: { siteName: string }) => void
  onCancel: () => void
}) {
  const [siteName, setSiteName] = useState('')

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (siteName.trim()) onSubmit({ siteName })
      }}
    >
      {keepHeadquarters ? (
        <p className="text-xs text-muted-foreground">
          지금 이 줄은 본사로 남고, 별칭과 바코드 연결도 그대로입니다.
        </p>
      ) : null}
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">지점명</span>
        <Input
          autoFocus
          value={siteName}
          placeholder="예: 제주점"
          disabled={pending}
          onChange={(event) => setSiteName(event.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" disabled={!siteName.trim() || pending}>
          <Plus className="size-3.5" />
          지점 추가
        </Button>
      </div>
    </form>
  )
}

export function CompanyCreateForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean
  onSubmit: (draft: { groupName: string }) => void
  onCancel: () => void
}) {
  const [groupName, setGroupName] = useState('')

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (groupName.trim()) onSubmit({ groupName })
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">업체명</span>
        <Input
          autoFocus
          value={groupName}
          placeholder="예: 신라면세점"
          disabled={pending}
          onChange={(event) => setGroupName(event.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          <X className="size-3.5" />
          취소
        </Button>
        <Button type="submit" disabled={!groupName.trim() || pending}>
          <Plus className="size-3.5" />
          업체 추가
        </Button>
      </div>
    </form>
  )
}

export function OutboundPartnerCompanyNode({
  company,
  selectedId,
  last = false,
  root = false,
  onSelect,
  onRenamed,
  onError,
}: {
  company: OutboundCompanyInFolder
  selectedId: string | null
  last?: boolean
  root?: boolean
  onSelect: (id: string) => void
  onRenamed?: () => void | Promise<void>
  onError?: (message: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(company.groupName)
  const skipCommit = useRef(false)
  const submitted = useRef(false)

  const renameMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!company.groupId) {
        throw new CodeUsageTargetStoreError(
          '먼저 업체로 정리하세요.',
          'invalid',
        )
      }
      return updateOutboundPartnerGroup(company.groupId, name)
    },
    onSuccess: async () => {
      setEditing(false)
      onError?.(null)
      await onRenamed?.()
    },
    onError: (err) => {
      submitted.current = false
      onError?.(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '업체 이름을 바꾸지 못했습니다.',
      )
    },
  })

  function startRename() {
    if (!company.groupId) return
    skipCommit.current = false
    submitted.current = false
    setDraft(company.groupName)
    setEditing(true)
  }

  function cancelRename() {
    skipCommit.current = true
    setEditing(false)
  }

  function commitRename() {
    if (skipCommit.current || submitted.current) return
    const next = normalizeOutboundPartnerName(draft)
    if (!next || next === company.groupName) {
      setEditing(false)
      return
    }
    submitted.current = true
    renameMutation.mutate(next)
  }

  const header = editing ? (
    <form
      className="flex w-full items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        commitRename()
      }}
    >
      <Input
        autoFocus
        className="h-7 text-xs font-semibold"
        value={draft}
        disabled={renameMutation.isPending}
        aria-label="업체명"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitRename}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelRename()
          }
        }}
      />
      <span className="shrink-0 text-xs font-normal text-muted-foreground">
        {company.units.length}곳
      </span>
    </form>
  ) : (
    <div
      className="w-full truncate px-1 text-xs font-semibold"
      title="클릭해서 접기 · 더블클릭해서 이름 바꾸기"
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        startRename()
      }}
    >
      {company.groupName}
      <span className="ml-1 font-normal text-muted-foreground">
        {company.units.length}곳
      </span>
    </div>
  )

  if (company.mode !== 'branched') {
    const unit = company.units[0]
    if (!unit) return null
    return (
      <TreeLeaf last={last} root={root}>
        <OutboundPartnerUnitItem
          target={unit}
          selected={selectedId === unit.id}
          identityVariant="full"
          asCompany
          onSelect={() => onSelect(unit.id)}
        />
      </TreeLeaf>
    )
  }

  return (
    <TreeBranch last={last} root={root} label={header}>
      {company.units.map((unit, index) => (
        <TreeLeaf
          key={unit.id}
          last={index === company.units.length - 1}
        >
          <OutboundPartnerUnitItem
            target={unit}
            selected={selectedId === unit.id}
            identityVariant="unit"
            onSelect={() => onSelect(unit.id)}
          />
        </TreeLeaf>
      ))}
    </TreeBranch>
  )
}
