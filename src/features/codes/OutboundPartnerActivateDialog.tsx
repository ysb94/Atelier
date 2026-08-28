import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { folderMoveOptions, folderPathLabel } from '@/lib/codes/outbound-folder'
import {
  activateFolderSelectValue,
  canActivateOutboundPartner,
  compactOutboundPartnerKey,
  normalizeOutboundPartnerName,
  outboundPartnerActivateGaps,
  parseActivateFolderValue,
} from '@/lib/codes/outbound-partner'
import { CodeUsageTargetStoreError, updateCodeUsageTarget } from '@/lib/api'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'
import type { AliasOwner } from '@/features/codes/OutboundPartnerEditForm'

/**
 * 비활성 업체를 다시 켤 때만 연다.
 * 이전 폴더는 힌트일 뿐이고, 위치와 특징을 다시 채워야 저장된다.
 */
export function OutboundPartnerActivateDialog({
  target,
  aliases,
  folders,
  ownerByKey,
  onClose,
  onChanged,
}: {
  target: CodeUsageTarget
  aliases: readonly string[]
  folders: readonly CodeUsageTargetFolder[]
  ownerByKey: Map<string, AliasOwner>
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [name, setName] = useState(target.name)
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined)
  const [isOneTime, setIsOneTime] = useState(target.isOneTime)
  const [note, setNote] = useState(target.note)
  const [aliasList, setAliasList] = useState<string[]>([...aliases])
  const [keepPreviousName, setKeepPreviousName] = useState(true)
  const [aliasInput, setAliasInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const nameChanged =
    compactOutboundPartnerKey(name) !== compactOutboundPartnerKey(target.name)
  const moveOptions = useMemo(() => folderMoveOptions(folders), [folders])
  const previousPath = folderPathLabel(folders, target.folderId)
  const draft = { name, folderId, note }
  const gaps = outboundPartnerActivateGaps(draft)
  const canSave = canActivateOutboundPartner(draft)

  const aliasWarning = useMemo(() => {
    const value = normalizeOutboundPartnerName(aliasInput)
    if (!value) return null
    const key = compactOutboundPartnerKey(value)
    if (!key) return '글자나 숫자가 있어야 합니다.'
    if (key === compactOutboundPartnerKey(name)) {
      return '정식명과 같습니다. 별칭으로 넣지 않아도 검색됩니다.'
    }
    if (aliasList.some((alias) => compactOutboundPartnerKey(alias) === key)) {
      return '이미 추가한 별칭입니다.'
    }
    const owner = ownerByKey.get(key)
    if (owner && owner.targetId !== target.id) {
      return owner.kind === 'name'
        ? `"${owner.targetName}"의 정식명입니다.`
        : `"${owner.targetName}"에 이미 등록된 별칭입니다.`
    }
    return null
  }, [aliasInput, aliasList, name, ownerByKey, target.id])

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!canActivateOutboundPartner({ name, folderId, note })) {
        throw new CodeUsageTargetStoreError(
          '업체명, 둘 위치, 이 업체의 특징을 모두 채워야 다시 켤 수 있습니다.',
          'invalid',
        )
      }
      const nextAliases = [...aliasList]
      if (nameChanged && keepPreviousName) {
        const previous = normalizeOutboundPartnerName(target.name)
        const previousKey = compactOutboundPartnerKey(previous)
        const taken = nextAliases.some(
          (alias) => compactOutboundPartnerKey(alias) === previousKey,
        )
        if (previous && previousKey && !taken) nextAliases.push(previous)
      }
      return updateCodeUsageTarget(target.id, {
        name,
        folderId: folderId ?? null,
        isOneTime,
        note,
        aliases: nextAliases,
        active: true,
      })
    },
    onSuccess: async () => {
      setError(null)
      await onChanged()
      onClose()
    },
    onError: (err) =>
      setError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : '업체를 다시 켜지 못했습니다.',
      ),
  })

  const pending = saveMutation.isPending
  const canAddAlias = Boolean(
    normalizeOutboundPartnerName(aliasInput) && !aliasWarning,
  )

  function addAlias() {
    const value = normalizeOutboundPartnerName(aliasInput)
    if (!value || aliasWarning) return
    setAliasList((prev) => [...prev, value])
    setAliasInput('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        disabled={pending}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="outbound-activate-title"
        className="relative z-10 max-h-[min(92vh,760px)] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card px-5 py-4">
          <div>
            <h2
              id="outbound-activate-title"
              className="text-base font-semibold tracking-tight"
            >
              다시 활성화
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              예전에 어디에 있었는지는 참고만 합니다. 지금 둘 위치와 특징을
              다시 적어야 저장됩니다.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="닫기"
            disabled={pending}
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            이전 위치 · {previousPath}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                업체명
              </span>
              <Input
                value={name}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                둘 위치
              </span>
              <Select
                className="w-full"
                value={activateFolderSelectValue(folderId)}
                disabled={pending}
                onChange={(event) =>
                  setFolderId(parseActivateFolderValue(event.target.value))
                }
              >
                <option value="" disabled>
                  어디에 둘지 고르세요
                </option>
                {moveOptions.map((option) => (
                  <option
                    key={option.id ?? 'unfiled'}
                    value={option.id ?? '__unfiled'}
                    disabled={option.disabled}
                  >
                    {`${'\u00a0'.repeat(Math.max(0, option.depth - 1) * 2)}${option.label}`}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              별칭
            </span>
            {aliasList.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {aliasList.map((alias) => (
                  <li key={alias}>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs">
                      {alias}
                      <button
                        type="button"
                        aria-label={`${alias} 별칭 삭제`}
                        className="text-muted-foreground hover:text-danger"
                        disabled={pending}
                        onClick={() =>
                          setAliasList((prev) =>
                            prev.filter((item) => item !== alias),
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                부서나 발주 사이트마다 다르게 부르는 이름을 넣으면 그 이름으로도
                검색됩니다.
              </p>
            )}
            <div className="flex gap-2">
              <Input
                className="h-8"
                value={aliasInput}
                placeholder="별칭을 적고 Enter"
                disabled={pending}
                onChange={(event) => setAliasInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addAlias()
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="별칭 추가"
                disabled={!canAddAlias || pending}
                onClick={addAlias}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
            {aliasWarning ? (
              <p className="text-xs text-warning">{aliasWarning}</p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-border"
              checked={isOneTime}
              disabled={pending}
              onChange={(event) => setIsOneTime(event.target.checked)}
            />
            단발성 거래로 표시
          </label>

          {nameChanged ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-border"
                checked={keepPreviousName}
                disabled={pending}
                onChange={(event) => setKeepPreviousName(event.target.checked)}
              />
              이전 이름 &quot;{target.name}&quot;을 별칭으로 남기기
            </label>
          ) : null}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              이 업체의 특징
            </span>
            <Textarea
              rows={4}
              value={note}
              placeholder="담당 MD, 주문 통로, 선구매인지 위탁인지, 출고 형태, 포장 주의처럼 이 줄만의 이야기를 적습니다."
              disabled={pending}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {gaps.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              아직 채울 칸: {gaps.join(', ')}
            </p>
          ) : null}

          {error ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onClose}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={!canSave || pending}
              onClick={() => saveMutation.mutate()}
            >
              <Check className="size-4" />
              활성화하고 저장
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
