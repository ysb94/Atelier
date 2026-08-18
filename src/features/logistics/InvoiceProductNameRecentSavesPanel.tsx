import { useMemo, useState } from 'react'
import { StylePicker, formatStyleRef } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatNumber } from '@/lib/utils'
import {
  InvoiceOptionExtrasEditor,
  type OptionExtraDraft,
} from './InvoiceOptionExtrasEditor'
import type {
  ProductMapHistoryEntry,
  ProductMapHistoryStatus,
} from './useInvoiceProductNameSaveQueue'
import type { StyleRef } from '@/lib/types'

const STATUS_LABEL: Record<
  ProductMapHistoryStatus,
  {
    label: string
    variant: 'default' | 'success' | 'warning' | 'danger' | 'outline'
  }
> = {
  queued: { label: '대기', variant: 'default' },
  saving: { label: '저장 중', variant: 'default' },
  saved: { label: '완료', variant: 'success' },
  failed: { label: '실패', variant: 'danger' },
  undoing: { label: '취소 중', variant: 'warning' },
  undone: { label: '취소됨', variant: 'outline' },
  undo_failed: { label: '취소 실패', variant: 'danger' },
}

type FilterMode = 'all' | 'needs_review'

function needsReview(entry: ProductMapHistoryEntry) {
  return entry.reviewReasons.length > 0
}

export function InvoiceProductNameRecentSavesPanel({
  brandId,
  history,
  onCorrect,
  onUndo,
}: {
  brandId: string
  history: ProductMapHistoryEntry[]
  onCorrect: (input: {
    historyId: string
    lookupKey: string
    style: StyleRef
    extras: OptionExtraDraft[]
  }) => void
  onUndo: (historyId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLookupKey, setEditLookupKey] = useState('')
  const [editStyle, setEditStyle] = useState<StyleRef | null>(null)
  const [editExtras, setEditExtras] = useState<OptionExtraDraft[]>([])
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const sorted = useMemo(() => {
    const list = [...history].sort((a, b) => {
      const aNeed = needsReview(a) ? 1 : 0
      const bNeed = needsReview(b) ? 1 : 0
      if (filter === 'needs_review') {
        if (aNeed !== bNeed) return bNeed - aNeed
      } else if (aNeed !== bNeed && (aNeed === 1 || bNeed === 1)) {
        // 확인 필요는 전체에서도 위로
        if (aNeed !== bNeed) return bNeed - aNeed
      }
      return b.createdAt - a.createdAt
    })
    if (filter === 'needs_review') {
      return list.filter(needsReview)
    }
    return list
  }, [filter, history])

  const needsReviewCount = useMemo(
    () => history.filter(needsReview).length,
    [history],
  )

  if (history.length === 0) return null

  function startEdit(entry: ProductMapHistoryEntry) {
    setEditingId(entry.id)
    setEditLookupKey(entry.lookupKey)
    setEditStyle(entry.style)
    setEditExtras(entry.extras)
    setConfirmUndoId(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditLookupKey('')
    setEditStyle(null)
    setEditExtras([])
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((current) => !current)}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            이번 파일 등록 내역 {formatNumber(history.length)}개
            {needsReviewCount > 0
              ? ` · 확인 필요 ${formatNumber(needsReviewCount)}개`
              : ''}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            저장은 계속 진행됩니다. 펼쳐서 조회 키·M번호를 고치거나 실행을
            취소할 수 있습니다.
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost">
          {open ? '접기' : '펼치기'}
        </Button>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-border p-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={filter === 'all' ? 'default' : 'outline'}
              onClick={() => setFilter('all')}
            >
              전체 {formatNumber(history.length)}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={filter === 'needs_review' ? 'default' : 'outline'}
              onClick={() => setFilter('needs_review')}
            >
              확인 필요 {formatNumber(needsReviewCount)}
            </Button>
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              확인이 필요한 항목이 없습니다.
            </p>
          ) : (
            <ul className="space-y-2">
              {sorted.map((entry) => {
                const status = STATUS_LABEL[entry.status]
                const editing = editingId === entry.id
                const confirmingUndo = confirmUndoId === entry.id
                const busy = busyId === entry.id
                return (
                  <li
                    key={entry.id}
                    className="rounded-md border border-border bg-background p-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {entry.productName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          내품명 {entry.itemName || '없음'}
                          {entry.mallName ? ` · ${entry.mallName}` : ''}
                        </p>
                      </div>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>

                    {entry.reviewReasons.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {entry.reviewReasons.map((reason) => (
                          <Badge key={reason} variant="warning">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    {editing ? (
                      <div className="mt-2 space-y-2">
                        <div>
                          <label className="mb-1 block text-[11px] text-muted-foreground">
                            조회 키
                          </label>
                          <Input
                            value={editLookupKey}
                            onChange={(event) =>
                              setEditLookupKey(event.target.value)
                            }
                            disabled={busy}
                          />
                        </div>
                        <StylePicker
                          brandId={brandId}
                          value={editStyle}
                          onChange={setEditStyle}
                          placeholder="본품 M번호"
                        />
                        <InvoiceOptionExtrasEditor
                          brandId={brandId}
                          extras={editExtras}
                          onChange={setEditExtras}
                          compact
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              busy ||
                              !editLookupKey.trim() ||
                              !editStyle ||
                              editExtras.some((item) => !item.style)
                            }
                            onClick={() => {
                              if (!editStyle || !editLookupKey.trim()) return
                              onCorrect({
                                historyId: entry.id,
                                lookupKey: editLookupKey.trim(),
                                style: editStyle,
                                extras: editExtras,
                              })
                              cancelEdit()
                            }}
                          >
                            수정 저장
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={cancelEdit}
                          >
                            닫기
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        <p className="truncate" title={entry.lookupKey}>
                          조회 키 ·{' '}
                          <span className="text-foreground">
                            {entry.lookupKey || '-'}
                          </span>
                        </p>
                        <p className="truncate" title={formatStyleRef(entry.style)}>
                          M번호 ·{' '}
                          <span className="text-foreground">
                            {formatStyleRef(entry.style)}
                          </span>
                        </p>
                        {entry.extras.length > 0 ? (
                          <p
                            className="truncate"
                            title={entry.extras
                              .map((item) =>
                                item.style
                                  ? `${formatStyleRef(item.style)}×${item.quantity}`
                                  : '',
                              )
                              .filter(Boolean)
                              .join(', ')}
                          >
                            구성 ·{' '}
                            <span className="text-foreground">
                              {entry.extras
                                .filter((item) => item.style)
                                .map(
                                  (item) =>
                                    `${item.style!.styleNo}×${item.quantity}`,
                                )
                                .join(', ')}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    )}

                    {entry.error ? (
                      <p className="mt-1.5 text-xs text-danger">{entry.error}</p>
                    ) : null}

                    {!editing ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {entry.status === 'saved' ||
                        entry.status === 'failed' ||
                        entry.status === 'undo_failed' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => startEdit(entry)}
                          >
                            수정
                          </Button>
                        ) : null}
                        {entry.status === 'saved' ? (
                          confirmingUndo ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="danger"
                                disabled={busy}
                                onClick={async () => {
                                  setBusyId(entry.id)
                                  try {
                                    await onUndo(entry.id)
                                    setConfirmUndoId(null)
                                  } catch {
                                    // 오류는 이력 행에 표시
                                  } finally {
                                    setBusyId(null)
                                  }
                                }}
                              >
                                {busy ? '취소 중...' : '정말 취소'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => setConfirmUndoId(null)}
                              >
                                닫기
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                setConfirmUndoId(entry.id)
                                setEditingId(null)
                              }}
                            >
                              실행 취소
                            </Button>
                          )
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
