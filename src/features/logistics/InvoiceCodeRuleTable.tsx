import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Save, Search, X } from 'lucide-react'
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
import { updateInvoiceNameRule } from '@/lib/api'
import type { InvoiceNameRule, InvoiceNameRuleAction } from '@/lib/types'
import { cn } from '@/lib/utils'

function formatDateOnly(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** <input type="date"> 값(YYYY-MM-DD)과 비교하기 위해 자정 기준 로컬 날짜만 남긴다. */
function toDayStart(iso: string): number {
  const date = new Date(iso)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function parseDayInput(value: string): number | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  return date.getTime()
}

/** <input type="date">용 YYYY-MM-DD (로컬 날짜). */
function toDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultDateRange() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  return {
    from: toDateInputValue(weekAgo),
    to: toDateInputValue(today),
  }
}

type EditDraft = {
  action: InvoiceNameRuleAction
  officialProductName: string
  note: string
  isActive: boolean
}

function draftFromRule(rule: InvoiceNameRule): EditDraft {
  return {
    action: rule.action,
    officialProductName: rule.targetName ?? '',
    note: rule.note,
    isActive: rule.isActive,
  }
}

export function InvoiceCodeRuleTable({
  brandId,
  rules,
  loading,
  error,
}: {
  brandId: string
  rules: InvoiceNameRule[]
  loading: boolean
  error: string | null
}) {
  const queryClient = useQueryClient()
  const defaultDates = useMemo(() => defaultDateRange(), [])
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState(defaultDates.from)
  const [dateTo, setDateTo] = useState(defaultDates.to)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const hasCustomFilter =
    Boolean(search.trim()) ||
    dateFrom !== defaultDates.from ||
    dateTo !== defaultDates.to

  const codeRules = useMemo(
    () =>
      rules
        .filter((rule) => rule.matchType === 'own_product_code' && !rule.isTest)
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        ),
    [rules],
  )

  const filteredRules = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    const fromMs = parseDayInput(dateFrom)
    const toMs = parseDayInput(dateTo)

    return codeRules.filter((rule) => {
      if (query) {
        const haystack =
          `${rule.sourceValue} ${rule.targetName ?? ''} ${rule.note}`.toLocaleLowerCase(
            'ko-KR',
          )
        if (!haystack.includes(query)) return false
      }
      const createdMs = toDayStart(rule.createdAt)
      if (fromMs !== null && createdMs < fromMs) return false
      if (toMs !== null && createdMs > toMs) return false
      return true
    })
  }, [codeRules, dateFrom, dateTo, search])

  const renamedCount = codeRules.filter(
    (rule) => rule.action === 'rename' && rule.isActive,
  ).length
  const exceptionCount = codeRules.filter(
    (rule) => rule.action === 'exception' && rule.isActive,
  ).length
  const pausedCount = codeRules.filter((rule) => !rule.isActive).length

  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: EditDraft }) =>
      updateInvoiceNameRule(id, {
        action: input.action,
        officialProductName: input.officialProductName,
        note: input.note,
        isActive: input.isActive,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-name-rules', brandId],
      })
      setEditingId(null)
      setDraft(null)
      setRowError(null)
    },
    onError: (mutationError) => {
      setRowError(
        mutationError instanceof Error
          ? mutationError.message
          : '수정하지 못했습니다. 다시 시도해주세요.',
      )
    },
  })

  function startEdit(rule: InvoiceNameRule) {
    setEditingId(rule.id)
    setDraft(draftFromRule(rule))
    setRowError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(null)
    setRowError(null)
  }

  function saveEdit(id: string) {
    if (!draft) return
    setRowError(null)
    mutation.mutate({ id, input: draft })
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>자체품번코드 기준</CardTitle>
            <Badge variant="outline">등록 {codeRules.length}건</Badge>
            {codeRules.length > 0 ? (
              <>
                <Badge variant="success">공식명 {renamedCount}건</Badge>
                <Badge variant="muted">예외 {exceptionCount}건</Badge>
                {pausedCount > 0 ? (
                  <Badge variant="danger">중지 {pausedCount}건</Badge>
                ) : null}
              </>
            ) : null}
          </div>
          <CardDescription className="mt-1">
            자체품번코드에 상품업체 공식 상품명을 연결하거나 원본명을 유지할
            예외 코드로 등록합니다. 등록일로 조회하고, 행을 눌러 바로 고칠 수
            있습니다.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="코드·공식명·메모 검색"
              className="pl-8"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              등록일 시작
            </label>
            <Input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-40"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              등록일 끝
            </label>
            <Input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-40"
            />
          </div>
          {hasCustomFilter ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch('')
                setDateFrom(defaultDates.from)
                setDateTo(defaultDates.to)
              }}
            >
              <X className="size-3.5" />
              필터 지우기
            </Button>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-220 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2.5 font-medium">자체품번코드</th>
                <th className="px-3 py-2.5 font-medium">등록일</th>
                <th className="px-3 py-2.5 font-medium">처리</th>
                <th className="px-3 py-2.5 font-medium">공식 상품명</th>
                <th className="px-3 py-2.5 font-medium">메모</th>
                <th className="px-3 py-2.5 font-medium">상태</th>
                <th className="px-3 py-2.5 font-medium">관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td
                    colSpan={7}
                    className="px-4 py-16 text-center text-muted-foreground"
                  >
                    Supabase에서 자체품번코드 기준을 불러오는 중입니다.
                  </td>
                </tr>
              ) : error ? (
                <tr className="border-t border-border">
                  <td
                    colSpan={7}
                    className="px-4 py-16 text-center text-danger"
                  >
                    {error}
                  </td>
                </tr>
              ) : filteredRules.length === 0 ? (
                <tr className="border-t border-border">
                  <td
                    colSpan={7}
                    className="px-4 py-16 text-center text-muted-foreground"
                  >
                    {codeRules.length === 0
                      ? '등록된 자체품번코드 기준이 없습니다. 위 입력란이나 사방넷 변환 화면에서 처음 기준을 등록하세요.'
                      : '이 조건에 맞는 기준이 없습니다.'}
                  </td>
                </tr>
              ) : (
                filteredRules.map((rule) => {
                  const isEditing = editingId === rule.id
                  const rowDraft = isEditing ? draft : null
                  const busy = mutation.isPending && editingId === rule.id

                  return (
                    <tr
                      key={rule.id}
                      className={cn(
                        'border-t border-border align-top',
                        isEditing && 'bg-primary/5',
                      )}
                    >
                      <td className="max-w-56 px-3 py-3 font-medium">
                        {rule.sourceValue}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                        {formatDateOnly(rule.createdAt)}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing && rowDraft ? (
                          <div className="flex gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant={
                                rowDraft.action === 'rename'
                                  ? 'default'
                                  : 'outline'
                              }
                              onClick={() =>
                                setDraft({ ...rowDraft, action: 'rename' })
                              }
                            >
                              공식명
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={
                                rowDraft.action === 'exception'
                                  ? 'default'
                                  : 'outline'
                              }
                              onClick={() =>
                                setDraft({ ...rowDraft, action: 'exception' })
                              }
                            >
                              예외
                            </Button>
                          </div>
                        ) : (
                          <Badge
                            variant={
                              rule.action === 'rename' ? 'success' : 'muted'
                            }
                          >
                            {rule.action === 'rename' ? '공식명 변경' : '예외'}
                          </Badge>
                        )}
                      </td>
                      <td className="max-w-80 px-3 py-3">
                        {isEditing && rowDraft ? (
                          <Input
                            value={rowDraft.officialProductName}
                            disabled={rowDraft.action === 'exception'}
                            placeholder={
                              rowDraft.action === 'exception'
                                ? '예외 처리 (품목명 유지)'
                                : '공식 상품명'
                            }
                            className="h-8"
                            onChange={(event) =>
                              setDraft({
                                ...rowDraft,
                                officialProductName: event.target.value,
                              })
                            }
                          />
                        ) : (
                          (rule.targetName ?? '-')
                        )}
                      </td>
                      <td className="max-w-80 px-3 py-3 text-muted-foreground">
                        {isEditing && rowDraft ? (
                          <Input
                            value={rowDraft.note}
                            placeholder="메모 (선택)"
                            className="h-8"
                            onChange={(event) =>
                              setDraft({
                                ...rowDraft,
                                note: event.target.value,
                              })
                            }
                          />
                        ) : (
                          rule.note || '-'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {isEditing && rowDraft ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setDraft({
                                ...rowDraft,
                                isActive: !rowDraft.isActive,
                              })
                            }
                          >
                            {rowDraft.isActive ? '사용중' : '중지'}
                          </Button>
                        ) : (
                          <Badge variant={rule.isActive ? 'success' : 'muted'}>
                            {rule.isActive ? '사용중' : '중지'}
                          </Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {isEditing ? (
                          <div className="flex gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              disabled={busy}
                              onClick={() => saveEdit(rule.id)}
                            >
                              <Save className="size-3.5" />
                              {busy ? '저장 중' : '저장'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={cancelEdit}
                            >
                              취소
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(rule)}
                          >
                            <Pencil className="size-3.5" />
                            수정
                          </Button>
                        )}
                        {isEditing && rowError ? (
                          <p className="mt-1.5 text-[11px] text-danger">
                            {rowError}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
