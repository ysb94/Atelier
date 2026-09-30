import { useDeferredValue, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  CODE_FINDER_PAGE_SIZE,
  codeComponentSummary,
} from '@/lib/codes/code-usage'
import type { CodeUsageStatus, ProductCode } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

type FinderFilter = 'all' | 'unregistered'

export function UsageCodeFinder({
  targetLabel,
  usageTargetId,
  codes,
  searchTextById,
  styleNames,
  existingByCodeId,
  saving,
  canRegister,
  onRegister,
}: {
  targetLabel: string
  usageTargetId: string | null
  codes: ProductCode[]
  searchTextById: ReadonlyMap<string, string>
  styleNames: ReadonlyMap<string, string>
  existingByCodeId: ReadonlyMap<string, CodeUsageStatus>
  saving: boolean
  canRegister: boolean
  onRegister: (productCodeIds: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FinderFilter>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [visibleCount, setVisibleCount] = useState(CODE_FINDER_PAGE_SIZE)
  const deferredSearch = useDeferredValue(search)
  const keyword = deferredSearch.trim().toLowerCase()
  const [seenTargetId, setSeenTargetId] = useState(usageTargetId)
  const [seenListKey, setSeenListKey] = useState(`${keyword}:${filter}`)
  if (usageTargetId !== seenTargetId) {
    setSeenTargetId(usageTargetId)
    setSelected([])
    setVisibleCount(CODE_FINDER_PAGE_SIZE)
  } else if (`${keyword}:${filter}` !== seenListKey) {
    setSeenListKey(`${keyword}:${filter}`)
    setVisibleCount(CODE_FINDER_PAGE_SIZE)
  }

  const selectableSelected = selected.filter(
    (id) => existingByCodeId.get(id) !== 'active',
  )
  if (
    usageTargetId === seenTargetId &&
    selectableSelected.length !== selected.length
  ) {
    setSelected(selectableSelected)
  }

  const matches = useMemo(() => {
    return codes.filter((code) => {
      if (filter === 'unregistered' && existingByCodeId.get(code.id) === 'active') {
        return false
      }
      if (!keyword) return true
      return (searchTextById.get(code.id) ?? '').includes(keyword)
    })
  }, [codes, existingByCodeId, filter, keyword, searchTextById])

  const visible = matches.slice(0, visibleCount)
  const remaining = matches.length - visible.length
  const selectedSet = new Set(selectableSelected)

  function toggle(id: string) {
    if (existingByCodeId.get(id) === 'active') return
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  function registerExactBarcode() {
    const typed = search.trim()
    if (!/^\d{13}$/.test(typed) || !canRegister) return
    const match = codes.find((code) => code.code === typed)
    if (!match || existingByCodeId.get(match.id) === 'active') return
    onRegister([match.id])
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    registerExactBarcode()
  }

  return (
    <Card className="flex max-h-[70vh] min-h-[280px] flex-col overflow-hidden xl:h-full xl:max-h-none xl:min-h-0">
      <div className="space-y-2 border-b border-border px-3 py-3">
        <div>
          <div className="text-sm font-medium">88코드 찾기</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {canRegister
              ? `${targetLabel}에 등록합니다.`
              : '업체를 먼저 선택하세요.'}
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            placeholder="M번호, 상품명, 바코드"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ['all', '전체'],
              ['unregistered', '미등록만'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors',
                filter === id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatNumber(matches.length)}건
          </span>
        </div>
      </div>

      {matches.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {keyword ? '검색 결과가 없습니다.' : '등록할 88코드가 없습니다.'}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {visible.map((code) => {
            const status = existingByCodeId.get(code.id)
            const locked = status === 'active'
            return (
              <li key={code.id} className="flex items-start gap-2 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-1 size-3.5 accent-primary"
                  checked={locked || selectedSet.has(code.id)}
                  disabled={locked || !canRegister}
                  aria-label={`${code.code} 선택`}
                  onChange={() => toggle(code.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium tabular-nums">{code.code}</span>
                    <span className="break-words text-muted-foreground">
                      {code.name}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {codeComponentSummary(code, styleNames)}
                  </p>
                </div>
                {locked ? (
                  <Badge variant="success">등록됨</Badge>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canRegister || saving}
                    onClick={() => onRegister([code.id])}
                  >
                    {status === 'paused' ? (
                      '다시 사용'
                    ) : (
                      <>
                        <Plus className="size-3.5" />
                        등록
                      </>
                    )}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {remaining > 0 || selectableSelected.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          {remaining > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setVisibleCount((current) => current + CODE_FINDER_PAGE_SIZE)
              }
            >
              더 보기 (남은 {formatNumber(remaining)}건)
            </Button>
          ) : (
            <span />
          )}
          {selectableSelected.length > 0 ? (
            <Button
              type="button"
              size="sm"
              disabled={!canRegister || saving}
              onClick={() => onRegister(selectableSelected)}
            >
              선택 {formatNumber(selectableSelected.length)}건 등록
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
