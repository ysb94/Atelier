import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pause, Play, Plus, Search, Upload, X } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { UsageBulkUploadPanel } from '@/features/codes/UsageBulkUploadPanel'
import { UsageTargetManagerDialog } from '@/features/codes/UsageTargetManager'
import {
  CodeUsageAssignmentStoreError,
  createCodeUsageAssignments,
  getCodeUsageAssignments,
  getCodeUsageTargetAliases,
  getCodeUsageTargetFolders,
  getCodeUsageTargets,
  getProductCodes,
  getStylesByBrand,
  updateCodeUsageAssignmentStatus,
} from '@/lib/api'
import {
  CODE_USAGE_STATUS_LABEL,
  type CodeUsageStatus,
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
  const aliasesQuery = useQuery({
    queryKey: ['codeUsageTargetAliases', brand.id],
    queryFn: () => getCodeUsageTargetAliases(brand.id),
  })
  const foldersQuery = useQuery({
    queryKey: ['codeUsageTargetFolders', brand.id],
    queryFn: () => getCodeUsageTargetFolders(brand.id),
  })

  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data])
  const aliases = useMemo(() => aliasesQuery.data ?? [], [aliasesQuery.data])
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
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

  // 거래중인 업체를 우선, 없으면 첫 업체 자동 선택
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
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargetAliases', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargetFolders', brand.id],
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
        title="출고업체별 바코드"
        description="자사 바코드를 출고업체에 등록하고, 사용중/일시중지를 관리합니다. 바코드 자체는 자사 바코드 메뉴에서 등록합니다."
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => setManagerOpen(true)}
          >
            출고업체 관리
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            출고업체
          </div>
          {targetsQuery.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              불러오는 중...
            </p>
          ) : targets.length === 0 ? (
            <div className="space-y-3 px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                등록된 출고업체가 없습니다.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => setManagerOpen(true)}
              >
                <Plus className="size-3.5" />
                출고업체 추가
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
                            비활성
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
                왼쪽에서 출고업체를 선택하거나 먼저 출고업체를 추가하세요.
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
                <UsageBulkUploadPanel
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
                              ? '이 업체에 등록된 바코드가 없습니다. 위에서 추가하세요.'
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

      <UsageTargetManagerDialog
        open={managerOpen}
        brandId={brand.id}
        targets={targets}
        folders={folders}
        aliases={aliases}
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

