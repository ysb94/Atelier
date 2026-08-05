import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, Pencil, Plus, RotateCcw, X } from 'lucide-react'
import {
  CodeUsageTargetStoreError,
  createCodeUsageTarget,
  updateCodeUsageTarget,
} from '@/lib/api'
import type { CodeUsageAssignment, CodeUsageTarget } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatNumber } from '@/lib/utils'

type SharedProps = {
  brandId: string
  targets: CodeUsageTarget[]
  assignments: CodeUsageAssignment[]
  onChanged: () => void | Promise<void>
}

function TargetList({
  title,
  targets,
  editingId,
  editingName,
  pending,
  usageCount,
  onEditingName,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleActive,
}: {
  title: string
  targets: CodeUsageTarget[]
  editingId: string | null
  editingName: string
  pending: boolean
  usageCount: (id: string) => number
  onEditingName: (name: string) => void
  onEdit: (target: CodeUsageTarget) => void
  onCancelEdit: () => void
  onSaveEdit: (id: string) => void
  onToggleActive: (target: CodeUsageTarget) => void
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {targets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          아직 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {targets.map((target) => {
            const editing = editingId === target.id
            return (
              <li key={target.id} className="flex items-center gap-2 px-3 py-2.5">
                {editing ? (
                  <>
                    <Input
                      className="h-8"
                      value={editingName}
                      autoFocus
                      disabled={pending}
                      onChange={(event) => onEditingName(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!editingName.trim() || pending}
                      onClick={() => onSaveEdit(target.id)}
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={onCancelEdit}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {target.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        연결된 바코드 {formatNumber(usageCount(target.id))}건
                      </div>
                    </div>
                    {!target.active ? (
                      <Badge variant="muted">사용 종료</Badge>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => onEdit(target)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onToggleActive(target)}
                    >
                      {target.active ? (
                        '사용 종료'
                      ) : (
                        <>
                          <RotateCcw className="size-3.5" />
                          다시 사용
                        </>
                      )}
                    </Button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function UsageTargetManagerContent({
  brandId,
  targets,
  assignments,
  onChanged,
}: SharedProps) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () => createCodeUsageTarget(brandId, { name: newName }),
    onSuccess: async () => {
      setNewName('')
      setError(null)
      await onChanged()
    },
    onError: showError,
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<CodeUsageTarget, 'name' | 'active'>>
    }) => updateCodeUsageTarget(id, patch),
    onSuccess: async () => {
      setEditingId(null)
      setEditingName('')
      setError(null)
      await onChanged()
    },
    onError: showError,
  })

  function showError(err: unknown) {
    setError(
      err instanceof CodeUsageTargetStoreError
        ? err.message
        : '사용처를 저장하지 못했습니다.',
    )
  }

  function usageCount(targetId: string) {
    return assignments.filter((a) => a.usageTargetId === targetId).length
  }

  const activeTargets = targets.filter((t) => t.active)
  const inactiveTargets = targets.filter((t) => !t.active)

  return (
    <div className="space-y-5">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (newName.trim()) createMutation.mutate()
        }}
      >
        <Input
          value={newName}
          placeholder="새 사용처 이름"
          onChange={(event) => {
            setNewName(event.target.value)
            setError(null)
          }}
        />
        <Button
          type="submit"
          className="shrink-0"
          disabled={!newName.trim() || createMutation.isPending}
        >
          <Plus className="size-4" />
          추가
        </Button>
      </form>

      <TargetList
        title={`사용 중 · ${activeTargets.length}곳`}
        targets={activeTargets}
        editingId={editingId}
        editingName={editingName}
        pending={updateMutation.isPending}
        usageCount={usageCount}
        onEditingName={setEditingName}
        onEdit={(target) => {
          setEditingId(target.id)
          setEditingName(target.name)
        }}
        onCancelEdit={() => setEditingId(null)}
        onSaveEdit={(id) =>
          updateMutation.mutate({ id, patch: { name: editingName } })
        }
        onToggleActive={(target) => {
          if (
            target.active &&
            !window.confirm(
              `"${target.name}" 사용을 종료할까요?\n기존 바코드 ${formatNumber(usageCount(target.id))}건의 연결 이력은 유지됩니다.`,
            )
          ) {
            return
          }
          updateMutation.mutate({
            id: target.id,
            patch: { active: !target.active },
          })
        }}
      />

      {inactiveTargets.length > 0 ? (
        <TargetList
          title={`사용 종료 · ${inactiveTargets.length}곳`}
          targets={inactiveTargets}
          editingId={editingId}
          editingName={editingName}
          pending={updateMutation.isPending}
          usageCount={usageCount}
          onEditingName={setEditingName}
          onEdit={(target) => {
            setEditingId(target.id)
            setEditingName(target.name)
          }}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={(id) =>
            updateMutation.mutate({ id, patch: { name: editingName } })
          }
          onToggleActive={(target) =>
            updateMutation.mutate({
              id: target.id,
              patch: { active: !target.active },
            })
          }
        />
      ) : null}

      {error ? (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        사용 종료해도 이미 등록된 바코드 연결 이력은 삭제되지 않습니다.
      </p>
    </div>
  )
}

export function UsageTargetManagerPanel({
  brandId,
  targets,
  assignments,
  onChanged,
}: SharedProps) {
  return (
    <UsageTargetManagerContent
      brandId={brandId}
      targets={targets}
      assignments={assignments}
      onChanged={onChanged}
    />
  )
}

export function UsageTargetManagerDialog({
  open,
  brandId,
  targets,
  assignments,
  onClose,
  onChanged,
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
        className="relative z-10 max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              사용처 관리
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              면세점, 무신사, 오프라인처럼 바코드를 등록할 곳을 관리합니다.
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
          <UsageTargetManagerContent
            brandId={brandId}
            targets={targets}
            assignments={assignments}
            onChanged={onChanged}
          />
        </div>
      </div>
    </div>
  )
}
