import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { ProductThumb } from '@/components/products/ProductThumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CargoInboundLineDraft } from '@/lib/cargo/inbound'
import { cargoLineHasContent } from '@/lib/cargo/inbound'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  LOGISTICS_IMAGE_KEY,
  PRODUCT_IMAGE_KEY,
  pickImageSources,
  ruleImageUrls,
} from '@/lib/products/product-image'
import { formatNumber } from '@/lib/utils'

type CargoInboundRequestDialogProps = {
  title: string
  brandName: string
  lines: CargoInboundLineDraft[]
  onClose: () => void
  onSave: (
    notes: Array<{ lineId: string; requestNote: string }>,
  ) => Promise<void>
}

function RequestPhoto({
  photo,
  styleNo,
  name,
}: {
  photo: string
  styleNo: string
  name: string
}) {
  const sources = useMemo(() => {
    const logistics = pickImageSources(photo, styleNo, LOGISTICS_IMAGE_KEY)
    const product = styleNo ? ruleImageUrls(styleNo, PRODUCT_IMAGE_KEY) : []
    const seen = new Set<string>()
    return [...logistics, ...product].filter((url) => {
      if (seen.has(url)) return false
      seen.add(url)
      return true
    })
  }, [photo, styleNo])

  return (
    <div className="flex items-center justify-center">
      <ProductThumb
        sources={sources}
        alt={name || styleNo || '상품 사진'}
        size={48}
      />
    </div>
  )
}

export function CargoInboundRequestDialog({
  title,
  brandName,
  lines,
  onClose,
  onSave,
}: CargoInboundRequestDialogProps) {
  useRenderWatch('CargoInboundRequestDialog')
  const rows = useMemo(
    () =>
      lines.filter(cargoLineHasContent).map((line, index) => ({
        key: line.id || `${line.styleNo || line.name || 'line'}-${index}`,
        lineId: line.id.trim(),
        no: line.no.trim() || String(index + 1),
        name: line.name.trim() || '-',
        photo: line.photo.trim(),
        styleNo: line.styleNo.trim(),
        qty: line.qty.trim() || '-',
        perBox: line.perBox.trim() || '-',
        boxes: line.boxes.trim() || '-',
        requestNote: line.requestNote,
      })),
    [lines],
  )
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.key, row.requestNote])),
  )
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dirtyRef = useRef(new Map<string, string>())
  const saveTimerRef = useRef<number | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  async function persistNotes(
    payload: Array<{ lineId: string; requestNote: string }>,
    message: string,
  ) {
    if (payload.length === 0) return
    setStatus(null)
    setSaving(true)
    try {
      await onSaveRef.current(payload)
      setStatus(message)
    } catch (error) {
      console.warn('[cargo-inbound] 요청 사항 저장 실패', { title, error })
      setStatus(
        error instanceof Error
          ? error.message
          : '요청 사항을 저장하지 못했습니다.',
      )
      throw error
    } finally {
      setSaving(false)
    }
  }

  async function flushDirty() {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const payload = Array.from(dirtyRef.current, ([lineId, requestNote]) => ({
      lineId,
      requestNote,
    }))
    if (payload.length === 0) return
    dirtyRef.current.clear()
    await persistNotes(payload, '요청 사항을 저장했습니다.')
  }

  function queueSave(lineId: string, requestNote: string) {
    if (!lineId) return
    dirtyRef.current.set(lineId, requestNote)
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushDirty().catch(() => {
        // persistNotes가 상태를 남긴다.
      })
    }, 500)
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  async function handleSave() {
    try {
      if (dirtyRef.current.size > 0) {
        await flushDirty()
        return
      }
      await persistNotes(
        rows
          .filter((row) => row.lineId)
          .map((row) => ({
            lineId: row.lineId,
            requestNote: notes[row.key] ?? '',
          })),
        '요청 사항을 저장했습니다.',
      )
    } catch {
      // persistNotes가 상태를 남긴다.
    }
  }

  async function handleClose() {
    try {
      await flushDirty()
      onClose()
    } catch {
      // 저장 실패면 닫지 않고 메시지를 보여 준다.
    }
  }

  return createPortal(
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
        <button
          type="button"
          aria-label="요청 사항 닫기"
          className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          onClick={() => void handleClose()}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cargo-inbound-request-title"
          className="relative z-10 flex max-h-[92vh] w-full max-w-[min(96vw,80rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
          onKeyDown={(event) => {
            if (event.key === 'Escape') void handleClose()
          }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2
                id="cargo-inbound-request-title"
                className="text-base font-semibold tracking-tight"
              >
                요청 사항
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                적으면 저장되고, 창고정리용 비고에 등록 비고 아래로 붙습니다.
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="요청 사항 닫기"
              onClick={() => void handleClose()}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <Badge variant="muted">{brandName}</Badge>
            <Badge variant="outline">{title}</Badge>
            <Badge variant={rows.length > 0 ? 'success' : 'muted'}>
              {formatNumber(rows.length)}종
            </Badge>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                요청할 상품이 없습니다.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <colgroup>
                  <col />
                  <col className="w-[4.25rem]" />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col className="w-[99%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-muted/90 text-xs text-muted-foreground">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">
                      품명
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-center font-medium">
                      사진
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">
                      M번호
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      총수량
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      박스 당
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      박스
                    </th>
                    <th className="w-[99%] px-3 py-2 font-medium">요청사항</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">
                        {row.name}
                      </td>
                      <td className="px-2 py-1.5">
                        <RequestPhoto
                          photo={row.photo}
                          styleNo={row.styleNo}
                          name={row.name}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold">
                        {row.styleNo || '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {row.qty}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {row.perBox}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {row.boxes}
                      </td>
                      <td className="w-[99%] px-2 py-1.5">
                        <Input
                          value={notes[row.key] ?? ''}
                          placeholder="요청 사항을 적으세요"
                          aria-label={`${row.name} 요청 사항`}
                          onChange={(event) => {
                            const value = event.target.value
                            setNotes((current) => ({
                              ...current,
                              [row.key]: value,
                            }))
                            queueSave(row.lineId, value)
                          }}
                          onBlur={() => {
                            if (dirtyRef.current.has(row.lineId)) {
                              void flushDirty().catch(() => {
                                // persistNotes가 상태를 남긴다.
                              })
                            }
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            {status ? (
              <p className="mr-auto text-xs text-muted-foreground" role="status">
                {status}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleClose()}
            >
              닫기
            </Button>
            <Button
              type="button"
              disabled={saving || rows.length === 0}
              onClick={() => void handleSave()}
            >
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      </div>
    </WorkspaceTabOverlay>,
    document.body,
  )
}
