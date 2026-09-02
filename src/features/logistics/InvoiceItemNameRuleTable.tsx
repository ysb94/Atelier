import { useDeferredValue, useMemo, useState } from 'react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tabs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Search, X } from 'lucide-react'
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
import {
  getInvoiceItemNameRules,
  setInvoiceItemNameRuleActive,
} from '@/lib/api'
import {
  formatItemNameRuleResult,
  formatItemNameRuleStyleNos,
  itemNameRuleSearchText,
  listLookupKeyItemNameRules,
} from '@/lib/invoice/item-name-rule-manage'
import type { InvoiceItemNameRule } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { InvoiceTablePager } from './invoice-table-page'
import { useInvoiceTablePage } from './useInvoiceTablePage'
import { InvoiceItemNameRuleForm } from './InvoiceItemNameRuleForm'

export function InvoiceItemNameRuleTable({
  brandId,
}: {
  brandId: string
}) {
  const queryClient = useQueryClient()
  const queryKey = ['invoice-item-name-rules', brandId] as const
  const listQuery = useQuery({
    queryKey,
    queryFn: () => getInvoiceItemNameRules(brandId),
  })
  const tabActive = useWorkspaceTabActivity()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const lookupRules = useMemo(
    () => listLookupKeyItemNameRules(listQuery.data ?? []),
    [listQuery.data],
  )
  const indexedRules = useMemo(
    () =>
      lookupRules.map((rule) => ({
        rule,
        haystack: itemNameRuleSearchText(rule).toLocaleLowerCase('ko-KR'),
      })),
    [lookupRules],
  )
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLocaleLowerCase('ko-KR')
    const list = q
      ? indexedRules.filter((item) => item.haystack.includes(q))
      : indexedRules
    return list.map((item) => item.rule)
  }, [deferredSearch, indexedRules])
  const {
    page,
    setPage,
    pageCount,
    startIndex,
    pageItems,
  } = useInvoiceTablePage(filtered, deferredSearch.trim())

  const activeCount = lookupRules.filter((rule) => rule.isActive).length
  const pausedCount = lookupRules.length - activeCount
  const editing = lookupRules.find((rule) => rule.id === editingId) ?? null

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setInvoiceItemNameRuleActive(id, isActive),
    onSuccess: async () => {
      setActionError(null)
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (reason) => {
      setActionError(
        reason instanceof Error
          ? reason.message
          : '내품명 규칙 상태를 바꾸지 못했습니다.',
      )
    },
  })

  const listError =
    listQuery.error instanceof Error
      ? listQuery.error.message
      : listQuery.error
        ? '내품명 규칙을 불러오지 못했습니다.'
        : null

  function mainLabel(rule: InvoiceItemNameRule) {
    if (!rule.mainStyle) return '본품 없음'
    return `${rule.mainStyle.styleNo} · ${rule.mainStyle.name}`
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>조회 키별 내품명 규칙</CardTitle>
          <CardDescription className="mt-1">
            확정 본품과 조회 키가 같은 주문만 원본 내품명을 공식명칭으로 바꾸거나
            비웁니다. 한 번 저장하면 오늘 파일과 이후 작업에 다시 쓰입니다.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="success">사용중 {formatNumber(activeCount)}</Badge>
          <Badge variant="muted">중지 {formatNumber(pausedCount)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="조회 키·내품명·M번호·공식명 검색"
            className="pl-8"
            aria-label="내품명 규칙 검색"
          />
        </div>
        {listError ? <p className="text-sm text-danger">{listError}</p> : null}
        {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}
        {listQuery.isPending ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            {lookupRules.length === 0
              ? '저장된 조회 키 규칙이 없습니다. 오늘 작업의 내품명 변환에서 등록하거나 아래에서 엑셀로 올립니다.'
              : '검색과 맞는 조회 키 규칙이 없습니다.'}
          </p>
        ) : !tabActive ? (
          <p className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            {formatNumber(filtered.length)}건 · 이 탭이 다시 보이면 표를 표시합니다.
          </p>
        ) : (
          <div className="space-y-2">
          <div className="max-h-[36rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[1080px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-3 py-2 font-medium">조회 키</th>
                  <th className="px-3 py-2 font-medium">원본 내품명</th>
                  <th className="px-3 py-2 font-medium">확정 본품</th>
                  <th className="px-3 py-2 font-medium">결과 내품명</th>
                  <th className="px-3 py-2 font-medium">구성품 M번호</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium">작업</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((rule) => (
                  <tr
                    key={rule.id}
                    className={cn(
                      'border-t border-border',
                      editingId === rule.id && 'bg-primary/5',
                    )}
                  >
                    <td className="max-w-64 break-words px-3 py-2">
                      {rule.productLookupKey || '(조회 키 없음)'}
                    </td>
                    <td className="max-w-48 break-words px-3 py-2">
                      {rule.itemName}
                    </td>
                    <td className="max-w-52 truncate px-3 py-2">
                      {mainLabel(rule)}
                    </td>
                    <td className="max-w-56 break-words px-3 py-2">
                      {formatItemNameRuleResult(rule)}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                      {formatItemNameRuleStyleNos(rule)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={rule.isActive ? 'success' : 'muted'}>
                        {rule.isActive ? '사용중' : '중지'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditingId(
                              editingId === rule.id ? null : rule.id,
                            )
                          }
                        >
                          {editingId === rule.id ? (
                            <X className="size-3.5" />
                          ) : (
                            <Pencil className="size-3.5" />
                          )}
                          {editingId === rule.id ? '닫기' : '수정'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={toggleMutation.isPending}
                          onClick={() =>
                            toggleMutation.mutate({
                              id: rule.id,
                              isActive: !rule.isActive,
                            })
                          }
                        >
                          {rule.isActive ? '중지' : '재개'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InvoiceTablePager
            page={page}
            pageCount={pageCount}
            total={filtered.length}
            startIndex={startIndex}
            pageItemCount={pageItems.length}
            onPage={setPage}
          />
          </div>
        )}
        {editing ? (
          <div className="rounded-lg border border-border p-4">
            <p className="mb-1 text-sm font-medium">내품명 규칙 수정</p>
            <p className="mb-3 text-xs text-muted-foreground">
              조회 키·본품·원본 내품명은 그대로 두고, 비움 또는 구성품만
              바꿉니다. 중지된 규칙은 저장해도 중지 상태를 유지합니다.
            </p>
            <p className="mb-3 break-words text-xs">
              {editing.productLookupKey || '(조회 키 없음)'} · {editing.itemName}{' '}
              · {mainLabel(editing)}
            </p>
            <InvoiceItemNameRuleForm
              key={editing.id}
              brandId={brandId}
              itemName={editing.itemName}
              scope="lookup_key"
              existingRule={editing}
              lockedLookupRule={editing}
              submitLabel="수정 저장"
              onSaved={() => setEditingId(null)}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
