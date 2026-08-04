import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  Check,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Upload,
  X,
} from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  CodeUsageAssignmentStoreError,
  CodeUsageTargetStoreError,
  applyBulkUsageAssignments,
  createCodeUsageAssignments,
  createCodeUsageTarget,
  getCodeUsageAssignments,
  getCodeUsageTargets,
  getProductCodes,
  getStylesByBrand,
  updateCodeUsageAssignmentStatus,
  updateCodeUsageTarget,
} from '@/lib/api'
import {
  downloadUsageCodeTemplate,
  prepareUsageRows,
  type PreparedUsageRow,
} from '@/lib/codes/usage-import'
import { parseFile } from '@/lib/import/parse'
import {
  CODE_USAGE_STATUS_LABEL,
  type CodeUsageAssignment,
  type CodeUsageStatus,
  type CodeUsageTarget,
  type ProductCode,
  type Style,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

type StatusFilter = 'all' | CodeUsageStatus
type AddMode = 'search' | 'bulk' | null

export function UsageCodePage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [listSearch, setListSearch] = useState('')
  const [addMode, setAddMode] = useState<AddMode>(null)
  const [managerOpen, setManagerOpen] = useState(false)

  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })
  const codesQuery = useQuery({
    queryKey: ['productCodes', brand.id, 'own'],
    queryFn: () => getProductCodes(brand.id, 'own'),
  })
  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'usage-codes'],
    queryFn: () => getStylesByBrand(brand.id),
  })
  const assignmentsQuery = useQuery({
    queryKey: ['codeUsageAssignments', brand.id],
    queryFn: () => getCodeUsageAssignments(brand.id),
  })

  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data])
  const codes = useMemo(() => codesQuery.data ?? [], [codesQuery.data])
  const styles = useMemo(() => stylesQuery.data ?? [], [stylesQuery.data])
  const assignments = useMemo(
    () => assignmentsQuery.data ?? [],
    [assignmentsQuery.data],
  )

  const codeMap = useMemo(
    () => new Map(codes.map((code) => [code.id, code])),
    [codes],
  )
  const styleMap = useMemo(
    () => new Map(styles.map((style) => [style.id, style])),
    [styles],
  )

  // 사용 중인 사용처를 우선, 없으면 첫 사용처 자동 선택
  const activeTargets = targets.filter((t) => t.active)
  const selectedTarget =
    targets.find((t) => t.id === selectedTargetId) ??
    activeTargets[0] ??
    targets[0] ??
    null

  const targetAssignments = useMemo(() => {
    if (!selectedTarget) return []
    return assignments.filter(
      (row) => row.usageTargetId === selectedTarget.id,
    )
  }, [assignments, selectedTarget])

  const filteredAssignments = useMemo(() => {
    const keyword = listSearch.trim().toLowerCase()
    return targetAssignments.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (!keyword) return true
      const code = codeMap.get(row.productCodeId)
      if (!code) return false
      if (code.code.toLowerCase().includes(keyword)) return true
      if (code.name.toLowerCase().includes(keyword)) return true
      return code.components.some(
        (c) =>
          c.styleNo.toLowerCase().includes(keyword) ||
          (styleMap.get(c.styleId)?.name ?? '')
            .toLowerCase()
            .includes(keyword),
      )
    })
  }, [targetAssignments, statusFilter, listSearch, codeMap, styleMap])

  function countForTarget(targetId: string, status?: CodeUsageStatus) {
    return assignments.filter(
      (row) =>
        row.usageTargetId === targetId &&
        (!status || row.status === status),
    ).length
  }

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['codeUsageAssignments', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargets', brand.id],
      }),
    ])
  }

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string
      status: CodeUsageStatus
    }) => updateCodeUsageAssignmentStatus(id, status),
    onSuccess: () => invalidate(),
  })

  return (
    <div>
      <PageHeader
        title="사용처별 바코드"
        description="자사 바코드를 판매처·납품처에 등록하고, 사용중/일시중지를 관리합니다. 바코드 자체는 자사 바코드 메뉴에서 등록합니다."
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => setManagerOpen(true)}
          >
            사용처 관리
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            사용처
          </div>
          {targetsQuery.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              불러오는 중...
            </p>
          ) : targets.length === 0 ? (
            <div className="space-y-3 px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                등록된 사용처가 없습니다.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => setManagerOpen(true)}
              >
                <Plus className="size-3.5" />
                사용처 추가
              </Button>
            </div>
          ) : (
            <ul className="max-h-[min(70vh,560px)] overflow-y-auto p-2">
              {targets.map((target) => {
                const active = selectedTarget?.id === target.id
                const total = countForTarget(target.id)
                const paused = countForTarget(target.id, 'paused')
                return (
                  <li key={target.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTargetId(target.id)
                        setAddMode(null)
                        setListSearch('')
                        setStatusFilter('all')
                      }}
                      className={cn(
                        'flex w-full items-start justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted',
                        !target.active && !active && 'opacity-60',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {target.name}
                        </span>
                        {!target.active ? (
                          <span
                            className={cn(
                              'text-[11px]',
                              active ? 'text-white/70' : 'text-muted-foreground',
                            )}
                          >
                            사용 종료
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                          active ? 'bg-white/20' : 'bg-muted',
                        )}
                      >
                        {formatNumber(total)}
                        {paused > 0 ? ` · 중지 ${paused}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          {!selectedTarget ? (
            <Card>
              <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
                왼쪽에서 사용처를 선택하거나 먼저 사용처를 추가하세요.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">
                    {selectedTarget.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    등록 {formatNumber(targetAssignments.length)}건 · 사용중{' '}
                    {formatNumber(countForTarget(selectedTarget.id, 'active'))}
                    건 · 일시중지{' '}
                    {formatNumber(countForTarget(selectedTarget.id, 'paused'))}
                    건
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={addMode === 'search' ? 'default' : 'outline'}
                    onClick={() =>
                      setAddMode((prev) => (prev === 'search' ? null : 'search'))
                    }
                  >
                    <Plus className="size-4" />
                    바코드 추가
                  </Button>
                  <Button
                    type="button"
                    variant={addMode === 'bulk' ? 'default' : 'outline'}
                    onClick={() =>
                      setAddMode((prev) => (prev === 'bulk' ? null : 'bulk'))
                    }
                  >
                    <Upload className="size-4" />
                    일괄 등록
                  </Button>
                </div>
              </div>

              {addMode === 'search' ? (
                <SearchAddPanel
                  brandId={brand.id}
                  usageTargetId={selectedTarget.id}
                  codes={codes}
                  styles={styles}
                  existingByCodeId={
                    new Map(
                      targetAssignments.map((a) => [
                        a.productCodeId,
                        a.status,
                      ]),
                    )
                  }
                  onAdded={async () => {
                    await invalidate()
                    setAddMode(null)
                  }}
                  onClose={() => setAddMode(null)}
                />
              ) : null}

              {addMode === 'bulk' ? (
                <BulkAddPanel
                  brandName={brand.name}
                  brandId={brand.id}
                  usageTarget={selectedTarget}
                  codes={codes}
                  existingByCodeId={
                    new Map(
                      targetAssignments.map((a) => [
                        a.productCodeId,
                        a.status,
                      ]),
                    )
                  }
                  onApplied={async () => {
                    await invalidate()
                    setAddMode(null)
                  }}
                  onClose={() => setAddMode(null)}
                />
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-wrap gap-1 rounded-md bg-muted/60 p-1">
                  {(
                    [
                      ['all', '전체'],
                      ['active', '사용중'],
                      ['paused', '일시중지'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setStatusFilter(id)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-sm transition-colors',
                        statusFilter === id
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Input
                  className="sm:max-w-sm"
                  placeholder="바코드, 코드명, 품번, 상품명 검색..."
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                />
                <div className="text-sm text-muted-foreground sm:ml-auto">
                  {formatNumber(filteredAssignments.length)}건
                </div>
              </div>

              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">바코드</th>
                        <th className="px-4 py-3 font-medium">코드명</th>
                        <th className="px-4 py-3 font-medium">구성</th>
                        <th className="px-4 py-3 font-medium">상태</th>
                        <th className="px-4 py-3 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {assignmentsQuery.isLoading ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-10 text-center text-muted-foreground"
                          >
                            불러오는 중...
                          </td>
                        </tr>
                      ) : filteredAssignments.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-12 text-center text-muted-foreground"
                          >
                            {targetAssignments.length === 0
                              ? '이 사용처에 등록된 바코드가 없습니다. 위에서 추가하세요.'
                              : '조건에 맞는 바코드가 없습니다.'}
                          </td>
                        </tr>
                      ) : (
                        filteredAssignments.map((row) => {
                          const code = codeMap.get(row.productCodeId)
                          const totalQty =
                            code?.components.reduce(
                              (sum, c) => sum + c.qty,
                              0,
                            ) ?? 0
                          return (
                            <tr
                              key={row.id}
                              className="border-b border-border last:border-0"
                            >
                              <td className="px-4 py-3 font-medium tabular-nums">
                                {code?.code ?? '—'}
                              </td>
                              <td className="px-4 py-3">
                                {code?.name ?? '삭제된 바코드'}
                              </td>
                              <td className="px-4 py-3">
                                {code ? (
                                  <div className="space-y-0.5">
                                    <Badge variant="muted">
                                      {code.components.length}종 ·{' '}
                                      {formatNumber(totalQty)}개
                                    </Badge>
                                    <div className="text-xs text-muted-foreground">
                                      {code.components
                                        .map(
                                          (c) =>
                                            `${c.styleNo}${c.qty > 1 ? `×${c.qty}` : ''}`,
                                        )
                                        .join(', ')}
                                    </div>
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <Badge
                                  variant={
                                    row.status === 'active'
                                      ? 'success'
                                      : 'muted'
                                  }
                                >
                                  {CODE_USAGE_STATUS_LABEL[row.status]}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-right">
                                {row.status === 'active' ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={statusMutation.isPending}
                                    onClick={() =>
                                      statusMutation.mutate({
                                        id: row.id,
                                        status: 'paused',
                                      })
                                    }
                                  >
                                    <Pause className="size-3.5" />
                                    일시중지
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={statusMutation.isPending}
                                    onClick={() =>
                                      statusMutation.mutate({
                                        id: row.id,
                                        status: 'active',
                                      })
                                    }
                                  >
                                    <Play className="size-3.5" />
                                    다시 사용
                                  </Button>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      <UsageTargetManagerInline
        open={managerOpen}
        brandId={brand.id}
        targets={targets}
        assignments={assignments}
        onClose={() => setManagerOpen(false)}
        onChanged={invalidate}
      />
    </div>
  )
}

function SearchAddPanel({
  brandId,
  usageTargetId,
  codes,
  styles,
  existingByCodeId,
  onAdded,
  onClose,
}: {
  brandId: string
  usageTargetId: string
  codes: ProductCode[]
  styles: Style[]
  existingByCodeId: Map<string, CodeUsageStatus>
  onAdded: () => void | Promise<void>
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const styleMap = useMemo(
    () => new Map(styles.map((s) => [s.id, s])),
    [styles],
  )

  const results = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return []
    return codes
      .filter((code) => {
        if (code.code.toLowerCase().includes(keyword)) return true
        if (code.name.toLowerCase().includes(keyword)) return true
        return code.components.some(
          (c) =>
            c.styleNo.toLowerCase().includes(keyword) ||
            (styleMap.get(c.styleId)?.name ?? '')
              .toLowerCase()
              .includes(keyword),
        )
      })
      .slice(0, 20)
  }, [codes, search, styleMap])

  const addMutation = useMutation({
    mutationFn: () =>
      createCodeUsageAssignments(brandId, selected, usageTargetId, 'active'),
    onSuccess: async () => {
      setSelected([])
      setSearch('')
      setError(null)
      await onAdded()
    },
    onError: (err) => {
      setError(
        err instanceof CodeUsageAssignmentStoreError
          ? err.message
          : '바코드를 추가하지 못했습니다.',
      )
    },
  })

  function toggle(id: string) {
    const existing = existingByCodeId.get(id)
    if (existing === 'active') return
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">바코드 검색 후 추가</div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="바코드, 코드명, 품번, 상품명..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {search.trim() && results.length === 0 ? (
          <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p>
        ) : null}
        {results.length > 0 ? (
          <ul className="max-h-56 overflow-y-auto divide-y divide-border rounded-lg border border-border">
            {results.map((code) => {
              const existing = existingByCodeId.get(code.id)
              const checked = selected.includes(code.id)
              const locked = existing === 'active'
              return (
                <li key={code.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm',
                      locked && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={checked || locked}
                      disabled={locked}
                      onChange={() => toggle(code.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium tabular-nums">
                          {code.code}
                        </span>
                        <span className="text-muted-foreground">{code.name}</span>
                        {existing === 'active' ? (
                          <Badge variant="success">이미 사용중</Badge>
                        ) : null}
                        {existing === 'paused' ? (
                          <Badge variant="muted">일시중지 → 다시 사용</Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {code.components
                          .map(
                            (c) =>
                              `${c.styleNo}${c.qty > 1 ? `×${c.qty}` : ''}${
                                styleMap.get(c.styleId)
                                  ? ` ${styleMap.get(c.styleId)!.name}`
                                  : ''
                              }`,
                          )
                          .join(' · ')}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        ) : null}
        {error ? (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            disabled={selected.length === 0 || addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            {addMutation.isPending
              ? '추가 중...'
              : `${formatNumber(selected.length)}건 추가`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function BulkAddPanel({
  brandName,
  brandId,
  usageTarget,
  codes,
  existingByCodeId,
  onApplied,
  onClose,
}: {
  brandName: string
  brandId: string
  usageTarget: CodeUsageTarget
  codes: ProductCode[]
  existingByCodeId: Map<string, CodeUsageStatus>
  onApplied: () => void | Promise<void>
  onClose: () => void
}) {
  const [prepared, setPrepared] = useState<PreparedUsageRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = (prepared ?? [])
        .filter((row) => row.statusLabel === 'ok' && row.productCodeId)
        .map((row) => ({
          productCodeId: row.productCodeId!,
          status: row.status,
        }))
      if (rows.length === 0) {
        throw new Error('반영할 행이 없습니다.')
      }
      return applyBulkUsageAssignments(brandId, usageTarget.id, rows)
    },
    onSuccess: async () => {
      setError(null)
      await onApplied()
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : '일괄 등록에 실패했습니다.',
      )
    },
  })

  async function handleFile(file: File) {
    setError(null)
    try {
      const sheets = await parseFile(file)
      const sheet = sheets[0]
      if (!sheet) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      setPrepared(
        prepareUsageRows({
          rows: sheet.rows,
          ownCodes: codes,
          existingByCodeId,
        }),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    }
  }

  const okCount = prepared?.filter((r) => r.statusLabel === 'ok').length ?? 0
  const errorCount =
    prepared?.filter((r) => r.statusLabel === 'error').length ?? 0

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">
              {usageTarget.name} 일괄 등록
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              양식의 88코드 열에 자사 바코드 마스터에 있는 코드만 넣으세요.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true)
              try {
                await downloadUsageCodeTemplate({
                  brandName,
                  usageTargetName: usageTarget.name,
                })
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : '양식을 내려받지 못했습니다.',
                )
              } finally {
                setDownloading(false)
              }
            }}
          >
            <Download className="size-4" />
            양식 다운로드
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
                event.target.value = ''
              }}
            />
            <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
              <Upload className="size-4" />
              파일 선택
            </span>
          </label>
        </div>

        {prepared ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">행</th>
                  <th className="px-3 py-2 font-medium">88코드</th>
                  <th className="px-3 py-2 font-medium">코드명</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {prepared.map((row) => (
                  <tr
                    key={`${row.lineNo}-${row.code}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {row.lineNo}
                    </td>
                    <td className="px-3 py-2 font-medium tabular-nums">
                      {row.code || '—'}
                    </td>
                    <td className="px-3 py-2">
                      {row.productCodeName ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {CODE_USAGE_STATUS_LABEL[row.status]}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'text-xs',
                          row.statusLabel === 'error' && 'text-danger',
                          row.statusLabel === 'warn' && 'text-warning',
                          row.statusLabel === 'ok' && 'text-muted-foreground',
                        )}
                      >
                        {row.message}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {prepared ? (
          <p className="text-xs text-muted-foreground">
            반영 가능 {formatNumber(okCount)}건 · 오류{' '}
            {formatNumber(errorCount)}건
          </p>
        ) : null}

        {error ? (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            disabled={okCount === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending
              ? '등록 중...'
              : `${formatNumber(okCount)}건 반영`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function UsageTargetManagerInline({
  open,
  brandId,
  targets,
  assignments,
  onClose,
  onChanged,
}: {
  open: boolean
  brandId: string
  targets: CodeUsageTarget[]
  assignments: CodeUsageAssignment[]
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () => createCodeUsageTarget(brandId, { name: newName }),
    onSuccess: async () => {
      setNewName('')
      setError(null)
      await onChanged()
    },
    onError: showError,
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<CodeUsageTarget, 'name' | 'active'>>
    }) => updateCodeUsageTarget(id, patch),
    onSuccess: async () => {
      setEditingId(null)
      setEditingName('')
      setError(null)
      await onChanged()
    },
    onError: showError,
  })

  function showError(err: unknown) {
    setError(
      err instanceof CodeUsageTargetStoreError
        ? err.message
        : '사용처를 저장하지 못했습니다.',
    )
  }

  function usageCount(targetId: string) {
    return assignments.filter((a) => a.usageTargetId === targetId).length
  }

  if (!open) return null

  const activeTargets = targets.filter((t) => t.active)
  const inactiveTargets = targets.filter((t) => !t.active)

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
        className="relative z-10 max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              사용처 관리
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              면세점, 무신사, 오프라인처럼 바코드를 등록할 곳을 관리합니다.
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

        <div className="space-y-5 px-5 py-5">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (newName.trim()) createMutation.mutate()
            }}
          >
            <Input
              value={newName}
              placeholder="새 사용처 이름"
              onChange={(event) => {
                setNewName(event.target.value)
                setError(null)
              }}
            />
            <Button
              type="submit"
              className="shrink-0"
              disabled={!newName.trim() || createMutation.isPending}
            >
              <Plus className="size-4" />
              추가
            </Button>
          </form>

          <TargetList
            title={`사용 중 · ${activeTargets.length}곳`}
            targets={activeTargets}
            editingId={editingId}
            editingName={editingName}
            pending={updateMutation.isPending}
            usageCount={usageCount}
            onEditingName={setEditingName}
            onEdit={(target) => {
              setEditingId(target.id)
              setEditingName(target.name)
            }}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={(id) =>
              updateMutation.mutate({ id, patch: { name: editingName } })
            }
            onToggleActive={(target) => {
              if (
                target.active &&
                !window.confirm(
                  `"${target.name}" 사용을 종료할까요?\n기존 바코드 ${formatNumber(usageCount(target.id))}건의 연결 이력은 유지됩니다.`,
                )
              ) {
                return
              }
              updateMutation.mutate({
                id: target.id,
                patch: { active: !target.active },
              })
            }}
          />

          {inactiveTargets.length > 0 ? (
            <TargetList
              title={`사용 종료 · ${inactiveTargets.length}곳`}
              targets={inactiveTargets}
              editingId={editingId}
              editingName={editingName}
              pending={updateMutation.isPending}
              usageCount={usageCount}
              onEditingName={setEditingName}
              onEdit={(target) => {
                setEditingId(target.id)
                setEditingName(target.name)
              }}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={(id) =>
                updateMutation.mutate({ id, patch: { name: editingName } })
              }
              onToggleActive={(target) =>
                updateMutation.mutate({
                  id: target.id,
                  patch: { active: !target.active },
                })
              }
            />
          ) : null}

          {error ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            사용 종료해도 이미 등록된 바코드 연결 이력은 삭제되지 않습니다.
          </p>
        </div>
      </div>
    </div>
  )
}

function TargetList({
  title,
  targets,
  editingId,
  editingName,
  pending,
  usageCount,
  onEditingName,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleActive,
}: {
  title: string
  targets: CodeUsageTarget[]
  editingId: string | null
  editingName: string
  pending: boolean
  usageCount: (id: string) => number
  onEditingName: (name: string) => void
  onEdit: (target: CodeUsageTarget) => void
  onCancelEdit: () => void
  onSaveEdit: (id: string) => void
  onToggleActive: (target: CodeUsageTarget) => void
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {targets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          아직 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {targets.map((target) => {
            const editing = editingId === target.id
            return (
              <li key={target.id} className="flex items-center gap-2 px-3 py-2.5">
                {editing ? (
                  <>
                    <Input
                      className="h-8"
                      value={editingName}
                      autoFocus
                      disabled={pending}
                      onChange={(event) => onEditingName(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!editingName.trim() || pending}
                      onClick={() => onSaveEdit(target.id)}
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={onCancelEdit}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {target.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        연결된 바코드 {formatNumber(usageCount(target.id))}건
                      </div>
                    </div>
                    {!target.active ? (
                      <Badge variant="muted">사용 종료</Badge>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => onEdit(target)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onToggleActive(target)}
                    >
                      {target.active ? (
                        '사용 종료'
                      ) : (
                        <>
                          <RotateCcw className="size-3.5" />
                          다시 사용
                        </>
                      )}
                    </Button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
