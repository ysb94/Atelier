import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { OWNER_LABEL } from '@/lib/import/fields'
import {
  findStylesByStyleNos,
  parseStyleNoList,
} from '@/lib/products/department-work-set'
import type { FieldOwner, Style } from '@/lib/types'
import { formatNumber } from '@/lib/utils'

export function DepartmentProductLoadDialog({
  owner,
  styles,
  alreadyIds,
  loading,
  onClose,
  onAdd,
}: {
  owner: FieldOwner
  styles: readonly Style[]
  alreadyIds: ReadonlySet<string>
  loading: boolean
  onClose: () => void
  onAdd: (styleIds: readonly string[]) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [paste, setPaste] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase()
    if (!key) return styles
    return styles.filter((style) => {
      const hay = `${style.styleNo} ${style.name} ${style.category}`.toLowerCase()
      return hay.includes(key)
    })
  }, [keyword, styles])

  const pasted = useMemo(() => {
    const nos = parseStyleNoList(paste)
    if (nos.length === 0) {
      return { matched: [] as Style[], missing: [] as string[] }
    }
    return findStylesByStyleNos(styles, nos)
  }, [paste, styles])

  const selectedIds = useMemo(() => {
    const next = new Set(picked)
    pasted.matched.forEach((style) => next.add(style.id))
    alreadyIds.forEach((id) => next.delete(id))
    return [...next]
  }, [alreadyIds, pasted.matched, picked])

  function toggle(id: string) {
    if (alreadyIds.has(id)) return
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
        aria-labelledby="department-load-title"
        className="relative z-10 flex max-h-[min(92vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2
              id="department-load-title"
              className="text-base font-semibold tracking-tight"
            >
              {OWNER_LABEL[owner]} 상품 불러오기
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              지금 필요한 상품만 고르세요. 전체 목록이 이 화면에 깔리지는
              않습니다.
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

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <Input
            value={keyword}
            placeholder="품번, 상품명, 카테고리 검색"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Textarea
            rows={3}
            value={paste}
            placeholder="품번을 붙여넣어도 됩니다. 줄바꿈이나 쉼표로 여러 개를 넣으세요."
            onChange={(event) => setPaste(event.target.value)}
          />
          {pasted.missing.length > 0 ? (
            <p className="text-xs text-warning">
              없는 품번 {formatNumber(pasted.missing.length)}개 ·{' '}
              {pasted.missing.slice(0, 6).join(', ')}
              {pasted.missing.length > 6 ? ' …' : ''}
            </p>
          ) : null}

          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              상품 목록을 읽는 중...
            </p>
          ) : styles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              아직 등록된 상품이 없습니다. 전체 상품이나 가져오기에서 먼저
              등록하세요.
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              검색과 맞는 상품이 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {filtered.slice(0, 80).map((style) => {
                const already = alreadyIds.has(style.id)
                const checked = already || picked.has(style.id)
                return (
                  <li key={style.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-border"
                        checked={checked}
                        disabled={already}
                        onChange={() => toggle(style.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium tabular-nums">
                          {style.styleNo}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {style.name || '이름 없음'}
                          {style.category ? ` · ${style.category}` : ''}
                        </span>
                      </span>
                      {already ? (
                        <span className="text-xs text-muted-foreground">
                          이미 있음
                        </span>
                      ) : null}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {filtered.length > 80 ? (
            <p className="text-xs text-muted-foreground">
              앞 80개만 보여 줍니다. 검색이나 품번 붙여넣기로 줄이세요.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {selectedIds.length > 0
              ? `${formatNumber(selectedIds.length)}개 불러오기`
              : '고른 상품이 없습니다'}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              취소
            </Button>
            <Button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => {
                onAdd(selectedIds)
                onClose()
              }}
            >
              불러오기
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
