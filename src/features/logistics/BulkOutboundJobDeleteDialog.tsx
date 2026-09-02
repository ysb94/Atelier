import { useMemo, useState } from 'react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatNumber } from '@/lib/utils'

export function deleteConfirmPhrase(title: string) {
  return title.trim() || '삭제'
}

export function BulkOutboundJobDeleteDialog({
  title,
  backup,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  title: string
  backup: { kinds: number; qty: number } | null
  saving: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const phrase = useMemo(() => deleteConfirmPhrase(title), [title])
  const canDelete = acknowledged && typed.trim() === phrase && !saving

  return (
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/40"
          aria-label="닫기"
          disabled={saving}
          onClick={() => {
            if (saving) return
            onClose()
          }}
        />
        <div
          role="dialog"
          aria-modal="true"
          className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        >
          <h2 className="text-base font-semibold text-danger">작업 건 삭제</h2>
          <p className="mt-2 text-sm">
            <span className="font-medium">「{title}」</span> 건을 삭제합니다.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            올린 엑셀·보관 파일과, 이 건으로 저장한 출고 데이터도 함께
            지워집니다. 되돌릴 수 없습니다.
          </p>
          <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {backup == null
              ? '출고 데이터를 확인하는 중…'
              : backup.kinds === 0
                ? '이 건으로 저장된 출고 데이터는 아직 없습니다.'
                : `출고 데이터 ${formatNumber(backup.kinds)}종 · ${formatNumber(backup.qty)}개가 함께 삭제됩니다.`}
          </p>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acknowledged}
              disabled={saving}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>출고 데이터까지 삭제되는 것을 확인했습니다.</span>
          </label>
          <label className="mt-3 block space-y-1 text-sm">
            <span className="text-muted-foreground">
              삭제하려면 작업 이름을 그대로 입력하세요.
            </span>
            <Input
              value={typed}
              disabled={saving}
              autoComplete="off"
              placeholder={phrase}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                if (canDelete) onConfirm()
              }}
            />
          </label>
          {error ? (
            <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={!canDelete}
              onClick={onConfirm}
            >
              {saving ? '삭제 중…' : '삭제'}
            </Button>
          </div>
        </div>
      </div>
    </WorkspaceTabOverlay>
  )
}
