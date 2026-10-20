import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import { Settings2, Search, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { OutboundPartnerIdentity } from '@/features/codes/OutboundPartnerIdentity'
import {
  DEFAULT_USAGE_CODE_COLUMNS,
  type UsageCodeColumn,
} from '@/lib/codes/usage-code-columns'
import {
  type AssignmentCounts,
} from '@/lib/codes/code-usage'
import {
  CODE_USAGE_STATUS_LABEL,
  type CodeUsageAssignment,
  type CodeUsageStatus,
  type CodeUsageTarget,
  type ProductCode,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

type StatusFilter = 'all' | CodeUsageStatus

function renderUsageColumn(
  systemKey: UsageCodeColumn['systemKey'],
  code: ProductCode | undefined,
  status: CodeUsageStatus,
  styleNames: ReadonlyMap<string, string>,
  openCode: () => void,
) {
  if (!systemKey) return '—'
  if (systemKey === 'code') {
    return (
      <button type="button" className="font-medium tabular-nums hover:underline" disabled={!code} onClick={openCode}>
        {code?.code ?? '—'}
      </button>
    )
  }
  if (systemKey === 'name') return code?.name ?? '삭제된 바코드'
  if (systemKey === 'status') {
    return (
      <Badge variant={status === 'active' ? 'success' : 'muted'}>
        {CODE_USAGE_STATUS_LABEL[status]}
      </Badge>
    )
  }
  const components = code?.components ?? []
  if (components.length === 0) return '—'
  if (systemKey === 'productName') {
    return components.map((component) => (
      <div key={component.styleId}>{styleNames.get(component.styleId)?.trim() || '—'}</div>
    ))
  }
  return components.map((component) => (
    <div key={component.styleId} className="tabular-nums">
      {component.styleNo}
      {component.qty > 1 ? `×${component.qty}` : ''}
    </div>
  ))
}

export function UsageAssignedCodes({
  target,
  configured,
  hasPartners,
  assignments,
  codeMap,
  styleNames,
  searchTextById,
  counts,
  saving,
  bulkOpen,
  columns,
  onManageColumns,
  onToggleBulk,
  onOpenCode,
  onChangeStatus,
  bulk,
}: {
  target: CodeUsageTarget | null
  configured: boolean
  hasPartners: boolean
  assignments: CodeUsageAssignment[]
  codeMap: Map<string, ProductCode>
  styleNames: ReadonlyMap<string, string>
  searchTextById: ReadonlyMap<string, string>
  counts: AssignmentCounts
  saving: boolean
  bulkOpen: boolean
  columns: UsageCodeColumn[]
  onManageColumns: () => void
  onToggleBulk: () => void
  onOpenCode: (code: ProductCode) => void
  onChangeStatus: (assignmentIds: string[], status: CodeUsageStatus) => void
  bulk: ReactNode
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [listSearch, setListSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const deferredSearch = useDeferredValue(listSearch)
  const targetId = target?.id ?? null
  const [seenTargetId, setSeenTargetId] = useState(targetId)
  if (targetId !== seenTargetId) {
    setSeenTargetId(targetId)
    setSelectedIds([])
    setStatusFilter('all')
    setListSearch('')
  }

  const filtered = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase()
    return assignments.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (!keyword) return true
      return (searchTextById.get(row.productCodeId) ?? '').includes(keyword)
    })
  }, [assignments, deferredSearch, searchTextById, statusFilter])

  const assignmentIds = useMemo(
    () => new Set(assignments.map((row) => row.id)),
    [assignments],
  )
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedCount = selectedIds.filter((id) => assignmentIds.has(id)).length
  const tableColumns = columns.length > 0
    ? columns
    : DEFAULT_USAGE_CODE_COLUMNS.map((column, index) => ({ ...column, id: `default-${index}` }))
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((row) => selectedSet.has(row.id))

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  function toggleVisible() {
    setSelectedIds((current) => {
      const currentSet = new Set(current)
      const visibleIds = filtered.map((row) => row.id)
      if (visibleIds.every((id) => currentSet.has(id))) {
        const visible = new Set(visibleIds)
        return current.filter((id) => !visible.has(id))
      }
      const next = new Set(current)
      for (const id of visibleIds) next.add(id)
      return [...next]
    })
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3 xl:h-full">
      {!target ? (
        <Card>
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">
            {!configured
              ? '업체 설정에서 88바코드를 쓰는 출고업체를 먼저 골라 주세요.'
              : !hasPartners
                ? '왼쪽에서 출고업체를 선택하거나 먼저 출고업체를 추가하세요.'
                : '왼쪽에서 업체를 선택하세요.'}
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold">
                <OutboundPartnerIdentity target={target} />
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                등록 {formatNumber(counts.total)}건 · 사용중{' '}
                {formatNumber(counts.active)}건 · 일시중지{' '}
                {formatNumber(counts.paused)}건
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={columns.length === 0} onClick={onManageColumns}>
                <Settings2 className="size-4" />
                헤더 설정
              </Button>
              <Button
                type="button"
                variant={bulkOpen ? 'default' : 'outline'}
                onClick={onToggleBulk}
              >
                <Upload className="size-4" />
                일괄 등록
              </Button>
            </div>
          </div>

          {bulkOpen ? bulk : null}

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
            <div className="relative sm:max-w-sm sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="바코드, 코드명, 품번, 상품명 검색"
                value={listSearch}
                onChange={(event) => setListSearch(event.target.value)}
              />
            </div>
            <div className="text-sm text-muted-foreground sm:ml-auto">
              {formatNumber(filtered.length)}건
            </div>
          </div>

          {selectedCount > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="text-sm">선택 {formatNumber(selectedCount)}건</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => onChangeStatus(selectedIds, 'paused')}
              >
                일시중지
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => onChangeStatus(selectedIds, 'active')}
              >
                다시 사용
              </Button>
            </div>
          ) : null}

          <Card className="flex min-h-[240px] flex-1 flex-col overflow-hidden">
            {filtered.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {assignments.length === 0
                  ? '이 업체에 등록된 바코드가 없습니다. 일괄 등록으로 추가하세요.'
                  : '조건에 맞는 바코드가 없습니다.'}
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 text-xs text-muted-foreground">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={allVisibleSelected}
                          aria-label="보이는 항목 선택"
                          onChange={toggleVisible}
                        />
                      </th>
                      {tableColumns.map((column) => (
                        <th key={column.id} className="px-3 py-2 font-medium">{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const code = codeMap.get(row.productCodeId)
                      return (
                        <tr
                          key={row.id}
                          className="border-b border-border last:border-0 hover:bg-muted/30"
                        >
                          <td className="px-3 py-2 align-top">
                            <input
                              type="checkbox"
                              className="mt-0.5 size-3.5 accent-primary"
                              checked={selectedSet.has(row.id)}
                              aria-label={`${code?.code ?? '바코드'} 선택`}
                              onChange={() => toggle(row.id)}
                            />
                          </td>
                          {tableColumns.map((column) => (
                            <td key={column.id} className="px-3 py-2 align-top">
                              {renderUsageColumn(column.systemKey, code, row.status, styleNames, () => {
                                if (code) onOpenCode(code)
                              })}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
