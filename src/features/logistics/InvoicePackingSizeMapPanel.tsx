import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, RefreshCw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  getBrandFields,
  getInvoicePackingSizeMaps,
  getInvoicePackingSizeSourceValues,
  saveInvoicePackingSizeMaps,
} from '@/lib/api'
import {
  mergeInvoicePackingSizeRows,
  normalizePackingSizeValue,
  packingSizeHasDisplayValue,
  PACKING_SIZE_SOURCE_FIELD_LABEL,
  type InvoicePackingSizeEditorRow,
} from '@/lib/invoice/packing-size-map'
import type { InvoicePackingSizeMap } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

type ViewFilter = 'all' | 'unmapped'

const MAP_QUERY_KEY = (brandId: string, fieldId: string) =>
  ['invoice-packing-size-maps', brandId, fieldId] as const

const SOURCE_QUERY_KEY = (brandId: string, fieldId: string) =>
  ['invoice-packing-size-source-values', brandId, fieldId] as const

export function InvoicePackingSizeMapPanel({
  brandId,
}: {
  brandId: string
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const fieldsQuery = useQuery({
    queryKey: ['brand-fields', brandId],
    queryFn: () => getBrandFields(brandId),
  })
  const targetLabelKey = normalizePackingSizeValue(
    PACKING_SIZE_SOURCE_FIELD_LABEL,
  )
  const field = fieldsQuery.data?.find(
    (item) => normalizePackingSizeValue(item.label) === targetLabelKey,
  )
  const fieldId = field?.id ?? ''

  const sourcesQuery = useQuery({
    queryKey: SOURCE_QUERY_KEY(brandId, fieldId),
    queryFn: () => getInvoicePackingSizeSourceValues(brandId, fieldId),
    enabled: Boolean(fieldId),
  })
  const mapsQuery = useQuery({
    queryKey: MAP_QUERY_KEY(brandId, fieldId),
    queryFn: () => getInvoicePackingSizeMaps(brandId, fieldId),
    enabled: Boolean(fieldId),
  })

  const rows = useMemo(
    () =>
      mergeInvoicePackingSizeRows(
        sourcesQuery.data ?? [],
        mapsQuery.data ?? [],
      ),
    [sourcesQuery.data, mapsQuery.data],
  )
  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    return rows.filter((row) => {
      if (
        viewFilter === 'unmapped' &&
        packingSizeHasDisplayValue(row.savedDisplayValue)
      ) {
        return false
      }
      if (!query) return true
      return `${row.sourceValue} ${row.savedDisplayValue}`
        .toLocaleLowerCase('ko-KR')
        .includes(query)
    })
  }, [rows, search, viewFilter])

  const currentRows = rows.filter((row) => row.isCurrent)
  const mappedCount = currentRows.filter((row) =>
    packingSizeHasDisplayValue(row.savedDisplayValue),
  ).length
  const unmappedCount = currentRows.length - mappedCount
  const styleCount = currentRows.reduce(
    (total, row) => total + row.styleCount,
    0,
  )
  const saveMutation = useMutation({
    mutationFn: (input: {
      row: InvoicePackingSizeEditorRow
      displayValue: string
    }) =>
      saveInvoicePackingSizeMaps(brandId, fieldId, [
        {
          sourceValue: input.row.sourceValue,
          displayValue: input.displayValue,
        },
      ]),
    onSuccess: (saved, input) => {
      queryClient.setQueryData<InvoicePackingSizeMap[]>(
        MAP_QUERY_KEY(brandId, fieldId),
        saved,
      )
      setEditingKey(null)
      setDraftValue('')
      setMessage(
        input.displayValue
          ? '간단 표시값을 저장했습니다.'
          : '간단 표시값을 지웠습니다.',
      )
    },
    onError: (reason) => {
      setMessage(
        reason instanceof Error
          ? reason.message
          : '포장 규격 매핑을 저장하지 못했습니다.',
      )
    },
  })

  function startEdit(row: InvoicePackingSizeEditorRow) {
    setMessage(null)
    setEditingKey(row.normalizedSourceValue)
    setDraftValue(row.savedDisplayValue)
  }

  function cancelEdit() {
    setEditingKey(null)
    setDraftValue('')
    setMessage(null)
  }

  function refresh() {
    setMessage(null)
    const requests: Array<Promise<unknown>> = [fieldsQuery.refetch()]
    if (fieldId) {
      requests.push(sourcesQuery.refetch(), mapsQuery.refetch())
    }
    void Promise.all(requests)
  }

  if (fieldsQuery.isPending) {
    return (
      <Card className="shadow-none">
        <CardContent className="p-6 text-sm text-muted-foreground">
          포장 규격 항목을 찾는 중...
        </CardContent>
      </Card>
    )
  }

  if (fieldsQuery.error) {
    return (
      <Card className="shadow-none">
        <CardContent className="space-y-3 p-6">
          <p className="text-sm text-danger">
            {fieldsQuery.error instanceof Error
              ? fieldsQuery.error.message
              : '브랜드 항목을 불러오지 못했습니다.'}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={refresh}>
            다시 시도
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!field) {
    return (
      <Card className="shadow-none">
        <CardContent className="space-y-2 p-6">
          <p className="text-sm font-medium">
            {PACKING_SIZE_SOURCE_FIELD_LABEL} 항목을 찾을 수 없습니다.
          </p>
          <p className="text-xs text-muted-foreground">
            업로드 항목에서 같은 이름의 물류 항목을 만든 뒤 다시 시도하세요.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={refresh}>
            다시 확인
          </Button>
        </CardContent>
      </Card>
    )
  }

  const loadError = sourcesQuery.error ?? mapsQuery.error
  const loading = sourcesQuery.isPending || mapsQuery.isPending

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>포장 사이즈 간단 표시값</CardTitle>
          <CardDescription className="mt-1">
            데이터 시트의 {field.label} 원본은 그대로 두고, 기준정보에서 사용할
            짧은 표시만 저장합니다. 송장작업과 출력에는 아직 적용하지 않습니다.
          </CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading || saveMutation.isPending}
          onClick={refresh}
        >
          <RefreshCw className="size-3.5" />
          새로고침
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <div className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-4">
            <p className="text-sm text-danger">
              {loadError instanceof Error
                ? loadError.message
                : '포장 규격 값을 불러오지 못했습니다.'}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={refresh}>
              다시 시도
            </Button>
          </div>
        ) : loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            포장 규격 고유값을 모으는 중...
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                고유값 {formatNumber(currentRows.length)}
              </Badge>
              <Badge variant="success">
                설정 {formatNumber(mappedCount)}
              </Badge>
              <Badge variant={unmappedCount > 0 ? 'warning' : 'muted'}>
                미설정 {formatNumber(unmappedCount)}
              </Badge>
              <Badge variant="muted">
                사용 상품 {formatNumber(styleCount)}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="원본 규격·간단 표시 검색"
                className="max-w-xs"
              />
              <Select
                value={viewFilter}
                onChange={(event) =>
                  setViewFilter(event.target.value as ViewFilter)
                }
              >
                <option value="all">전체 보기</option>
                <option value="unmapped">미설정만 보기</option>
              </Select>
            </div>

            {rows.length === 0 ? (
              <p className="rounded-lg border border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                입력된 포장 규격 값이 없습니다.
              </p>
            ) : filteredRows.length === 0 ? (
              <p className="rounded-lg border border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                조건에 맞는 포장 규격이 없습니다.
              </p>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {filteredRows.map((row) => {
                  const mapped = packingSizeHasDisplayValue(
                    row.savedDisplayValue,
                  )
                  const editing = editingKey === row.normalizedSourceValue
                  const busy = saveMutation.isPending && editing
                  return (
                    <div
                      key={row.normalizedSourceValue}
                      className={cn(
                        'rounded-xl border px-3.5 py-3 transition-colors',
                        editing
                          ? 'border-primary/40 bg-primary/5'
                          : mapped
                            ? 'border-border bg-muted/10 hover:bg-muted/25'
                            : 'border-warning/30 bg-warning/[0.04]',
                        !row.isCurrent && 'opacity-70',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium tabular-nums">
                            {row.sourceValue}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {row.isCurrent
                              ? `상품 ${formatNumber(row.styleCount)}개`
                              : '현재 상품 없음'}
                          </p>
                        </div>
                        {editing ? null : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 shrink-0 px-2"
                            disabled={saveMutation.isPending}
                            onClick={() => startEdit(row)}
                          >
                            <Pencil className="size-3.5" />
                            {mapped ? '수정' : '설정'}
                          </Button>
                        )}
                      </div>
                      <div className="mt-2.5 flex items-center gap-2 border-t border-border/70 pt-2.5">
                        {editing ? (
                          <>
                            <Input
                              value={draftValue}
                              placeholder="예: S, M, L"
                              aria-label={`${row.sourceValue} 간단 표시값`}
                              className="h-8 min-w-0 flex-1"
                              disabled={busy}
                              autoFocus
                              onChange={(event) => {
                                setMessage(null)
                                setDraftValue(event.target.value)
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 shrink-0 px-2.5"
                              disabled={
                                busy ||
                                draftValue.trim() ===
                                  row.savedDisplayValue.trim()
                              }
                              onClick={() =>
                                saveMutation.mutate({
                                  row,
                                  displayValue: draftValue.trim(),
                                })
                              }
                            >
                              <Save className="size-3.5" />
                              {busy ? '저장 중' : '저장'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 shrink-0 px-2"
                              disabled={busy}
                              onClick={cancelEdit}
                            >
                              취소
                            </Button>
                          </>
                        ) : mapped ? (
                          <span className="inline-flex min-h-7 items-center rounded-md bg-card px-2 text-sm font-semibold ring-1 ring-border">
                            {row.savedDisplayValue}
                          </span>
                        ) : (
                          <Badge variant="warning">미설정</Badge>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              미설정 규격이 위에 모입니다. 값을 비워 저장하면 해당 간단 표시
              매핑만 지워지고 상품 원본 규격은 바뀌지 않습니다.
            </p>

            {message ? (
              <p
                className={
                  saveMutation.isError
                    ? 'text-xs text-danger'
                    : 'text-xs text-success'
                }
              >
                {message}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
