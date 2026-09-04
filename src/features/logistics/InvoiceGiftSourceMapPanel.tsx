import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Pencil, Plus, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { saveInvoiceGiftSourceMap } from '@/lib/api'
import type {
  InvoiceGiftSourceAssignmentMode,
  InvoiceGiftSourceMap,
  StyleRef,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { InvoiceGiftSourceMapForm } from './InvoiceGiftSourceMapForm'

const MODE_LABEL: Record<InvoiceGiftSourceAssignmentMode, string> = {
  fixed: '고정 1종',
  balanced_random: '균등 랜덤',
}

export function InvoiceGiftSourceMapPanel({
  brandId,
  maps,
  loading,
  error,
}: {
  brandId: string
  maps: InvoiceGiftSourceMap[]
  loading: boolean
  error: string | null
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>(
    'all',
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const activeCount = maps.filter((map) => map.isActive).length
  const inactiveCount = maps.length - activeCount

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    const list = [...maps]
      .filter((map) => {
        if (statusFilter === 'active') return map.isActive
        if (statusFilter === 'inactive') return !map.isActive
        return true
      })
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.productName.localeCompare(right.productName, 'ko-KR'),
      )
    if (!query) return list
    return list.filter((map) =>
      [
        map.mallName,
        map.productName,
        MODE_LABEL[map.assignmentMode],
        ...map.poolStyles.flatMap((style) => [style.styleNo, style.name]),
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(query),
    )
  }, [maps, search, statusFilter])

  function invalidate() {
    return queryClient.invalidateQueries({
      queryKey: ['invoice-gift-source-maps', brandId],
    })
  }

  const saveMutation = useMutation({
    mutationFn: (input: {
      map: InvoiceGiftSourceMap
      assignmentMode: InvoiceGiftSourceAssignmentMode
      poolStyles: StyleRef[]
      isActive: boolean
    }) =>
      saveInvoiceGiftSourceMap(
        brandId,
        {
          mallName: input.map.mallName,
          productName: input.map.productName,
          assignmentMode: input.assignmentMode,
          styleIds: input.poolStyles.map((style) => style.styleId),
          uniquePerRecipient: true,
          isActive: input.isActive,
          note: input.map.note,
        },
        input.map.id,
      ),
    onSuccess: async () => {
      await invalidate()
      setEditingId(null)
      setRowError(null)
    },
    onError: (reason) => {
      setRowError(
        reason instanceof Error ? reason.message : '매핑을 저장하지 못했습니다.',
      )
    },
  })

  const editing = editingId
    ? maps.find((map) => map.id === editingId)
    : undefined

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>품목명 대체 매핑</CardTitle>
          <CardDescription className="mt-1">
            오늘 작업 품목명에서 「다음 주문에도 자동 적용」으로 저장한 규칙입니다.
            쇼핑몰명과 원본 품목명이 같으면 제자리에서 M번호로 바꿉니다. 같은
            파일의 받는분은 업체·행 추가와 관계없이 가능한 한 서로 다른
            M번호를 받습니다. 사은품 행을 추가하는 위 요청 건과는 별개입니다.
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusCountFilter
            active={statusFilter === 'all'}
            variant="muted"
            onClick={() => setStatusFilter('all')}
          >
            전체 {formatNumber(maps.length)}
          </StatusCountFilter>
          <StatusCountFilter
            active={statusFilter === 'active'}
            variant="success"
            onClick={() => setStatusFilter('active')}
          >
            사용중 {formatNumber(activeCount)}
          </StatusCountFilter>
          <StatusCountFilter
            active={statusFilter === 'inactive'}
            variant="muted"
            onClick={() => setStatusFilter('inactive')}
          >
            중지 {formatNumber(inactiveCount)}
          </StatusCountFilter>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="쇼핑몰·원본 품목명·M번호 검색"
              className="pl-8"
            />
          </div>
          {search ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSearch('')}
            >
              <X className="size-3.5" />
              검색 지우기
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={creating ? 'outline' : 'default'}
            onClick={() => {
              setEditingId(null)
              setCreating((current) => !current)
            }}
          >
            {creating ? (
              <>
                <X className="size-3.5" />
                등록 닫기
              </>
            ) : (
              <>
                <Plus className="size-4" />
                매핑 등록
              </>
            )}
          </Button>
        </div>

        {creating ? (
          <div className="rounded-lg border border-border bg-muted/10 p-4">
            <p className="mb-3 text-sm font-medium">새 품목명 대체 매핑</p>
            <InvoiceGiftSourceMapForm
              brandId={brandId}
              existingMaps={maps}
              onDone={() => setCreating(false)}
            />
          </div>
        ) : null}

        {editing ? (
          <div className="rounded-lg border border-primary/40 bg-muted/10 p-4">
            <p className="mb-3 text-sm font-medium">
              매핑 수정 · {editing.productName}
            </p>
            <InvoiceGiftSourceMapForm
              key={editing.id}
              brandId={brandId}
              editing={editing}
              existingMaps={maps}
              onDone={() => setEditingId(null)}
            />
          </div>
        ) : null}

        {loading ? (
          <p className="rounded-lg border border-border px-4 py-12 text-center text-xs text-muted-foreground">
            Supabase에서 품목명 대체 매핑을 불러오고 있습니다.
          </p>
        ) : error ? (
          <p className="rounded-lg border border-border px-4 py-12 text-center text-xs text-danger">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-12 text-center text-xs text-muted-foreground">
            {maps.length === 0
              ? '저장된 품목명 대체 매핑이 없습니다. 오늘 작업 품목명 변환에서 사은품 처리 후 「다음 주문에도 자동 적용」을 고르면 여기에 나타납니다.'
              : statusFilter !== 'all' && !search.trim()
                ? '해당 상태의 매핑이 없습니다.'
                : '검색 결과가 없습니다.'}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((map) => {
              const expanded = expandedId === map.id
              return (
                <div
                  key={map.id}
                  className={cn(
                    'rounded-lg border border-border',
                    !map.isActive && 'bg-muted/20',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() =>
                        setExpandedId(expanded ? null : map.id)
                      }
                      aria-expanded={expanded}
                    >
                      {expanded ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {map.productName}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {map.mallName}
                          {` · ${MODE_LABEL[map.assignmentMode]}`}
                          {` · ${map.poolStyles
                            .map((style) => style.styleNo)
                            .join(', ')}`}
                        </span>
                      </span>
                    </button>
                    <Badge variant={map.isActive ? 'success' : 'muted'}>
                      {map.isActive ? '사용중' : '중지'}
                    </Badge>
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saveMutation.isPending}
                        onClick={() =>
                          saveMutation.mutate({
                            map,
                            assignmentMode: map.assignmentMode,
                            poolStyles: map.poolStyles,
                            isActive: !map.isActive,
                          })
                        }
                      >
                        {map.isActive ? '중지' : '다시 사용'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCreating(false)
                          setEditingId(map.id)
                        }}
                      >
                        <Pencil className="size-3.5" />
                        수정
                      </Button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="space-y-1 border-t border-border px-4 py-3 text-xs">
                      <p className="text-muted-foreground">
                        {map.mallName} · {MODE_LABEL[map.assignmentMode]}
                        {map.note ? ` · ${map.note}` : ''}
                      </p>
                      {map.poolStyles.map((style) => (
                        <p key={style.styleId}>
                          {style.styleNo} · {style.name}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {rowError ? <p className="text-xs text-danger">{rowError}</p> : null}
      </CardContent>
    </Card>
  )
}

function StatusCountFilter({
  active,
  variant,
  onClick,
  children,
}: {
  active: boolean
  variant: 'muted' | 'success'
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        variant === 'success' && 'bg-success/15 text-success',
        variant === 'muted' && 'bg-muted text-muted-foreground',
        active && 'ring-1 ring-foreground/40',
      )}
    >
      {children}
    </button>
  )
}
