import { useDeferredValue, useMemo, useState } from 'react'
import { Plus, Search, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  type AssignmentCounts,
} from '@/lib/codes/code-usage'
import { folderPathLabel } from '@/lib/codes/outbound-folder'
import {
  outboundPartnerDisplayName,
  outboundPartnerUnitLabel,
  type OutboundCompanyInFolder,
} from '@/lib/codes/outbound-partner'
import { groupOutboundSearchSections } from '@/lib/codes/outbound-partner-browser'
import type {
  CodeUsageAssignment,
  CodeUsageStatus,
  CodeUsageTarget,
  CodeUsageTargetFolder,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

export function usagePartnerCompanyKey(folderId: string | null, companyKey: string) {
  return `${folderId ?? 'unfiled'}:${companyKey}`
}

function companyLabel(company: OutboundCompanyInFolder) {
  const name = company.groupName.trim()
  if (name) return name
  const unit = company.units[0]
  return unit ? outboundPartnerDisplayName(unit) : '업체'
}

function companyAssignmentCounts(
  units: readonly CodeUsageTarget[],
  assignments: readonly CodeUsageAssignment[],
): AssignmentCounts {
  const ids = new Set(units.map((unit) => unit.id))
  const statusByCode = new Map<string, CodeUsageStatus>()
  for (const row of assignments) {
    if (!ids.has(row.usageTargetId)) continue
    const current = statusByCode.get(row.productCodeId)
    if (!current || row.status === 'paused') {
      statusByCode.set(row.productCodeId, row.status)
    }
  }
  let active = 0
  let paused = 0
  for (const status of statusByCode.values()) {
    if (status === 'paused') paused += 1
    else active += 1
  }
  return { total: statusByCode.size, active, paused }
}

function countLabel(counts: AssignmentCounts) {
  const total = formatNumber(counts.total)
  if (counts.paused === 0) return total
  return `${total} · 중지 ${formatNumber(counts.paused)}`
}

export function UsagePartnerList({
  targets,
  folders,
  assignments,
  selectedKey,
  loading,
  configured,
  hasPartners,
  onSelect,
  onOpenSettings,
  onOpenManager,
}: {
  targets: CodeUsageTarget[]
  folders: CodeUsageTargetFolder[]
  assignments: CodeUsageAssignment[]
  selectedKey: string | null
  loading: boolean
  configured: boolean
  hasPartners: boolean
  onSelect: (companyKey: string) => void
  onOpenSettings: () => void
  onOpenManager: () => void
}) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const keyword = deferredSearch.trim().toLowerCase()

  const filteredTargets = useMemo(() => {
    if (!keyword) return targets
    return targets.filter((target) => {
      const haystack = [
        outboundPartnerDisplayName(target),
        outboundPartnerUnitLabel(target),
        target.groupName,
        target.siteName,
        target.name,
        folderPathLabel(folders, target.folderId),
      ]
        .join('\n')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [folders, keyword, targets])

  const sections = useMemo(
    () =>
      groupOutboundSearchSections({
        folders,
        hits: filteredTargets,
      }),
    [filteredTargets, folders],
  )

  return (
    <Card className="flex max-h-[70vh] min-h-[280px] flex-col overflow-hidden xl:h-full xl:max-h-none xl:min-h-0">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          출고업체
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="업체 설정"
          onClick={onOpenSettings}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </div>
      {configured && hasPartners ? (
        <div className="border-b border-border px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8"
              placeholder="업체 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      ) : null}
      {loading ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          불러오는 중...
        </p>
      ) : !hasPartners ? (
        <div className="space-y-3 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            등록된 출고업체가 없습니다.
          </p>
          <Button type="button" size="sm" onClick={onOpenManager}>
            <Plus className="size-3.5" />
            출고업체 추가
          </Button>
        </div>
      ) : !configured ? (
        <div className="space-y-3 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            아직 업체를 고르지 않았습니다.
          </p>
          <Button type="button" size="sm" onClick={onOpenSettings}>
            <Settings2 className="size-3.5" />
            업체 설정
          </Button>
        </div>
      ) : targets.length === 0 ? (
        <div className="space-y-3 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">선택된 업체가 없습니다.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenSettings}
          >
            <Plus className="size-3.5" />
            업체 추가
          </Button>
        </div>
      ) : sections.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          검색된 업체가 없습니다.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {sections.map((section) => (
            <li key={section.folderId ?? 'unfiled'} className="mb-2">
              <p className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                {section.pathLabel}
              </p>
              <ul className="space-y-0.5">
                {section.companies.map((company) => {
                  const companyKey = usagePartnerCompanyKey(section.folderId, company.key)
                  const inactive = company.units.every((unit) => !unit.active)
                  return (
                    <li key={company.key}>
                      <CompanyButton
                        label={companyLabel(company)}
                        inactive={inactive}
                        selected={selectedKey === companyKey}
                        counts={companyAssignmentCounts(company.units, assignments)}
                        onSelect={() => onSelect(companyKey)}
                      />
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function CompanyButton({
  label,
  inactive,
  selected,
  counts,
  onSelect,
}: {
  label: string
  inactive: boolean
  selected: boolean
  counts: AssignmentCounts
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
        inactive && !selected && 'opacity-60',
      )}
    >
      <span className="min-w-0 break-words font-medium">
        {label}
        {inactive ? (
          <span
            className={cn(
              'mt-0.5 block text-[11px] font-normal',
              selected ? 'text-white/70' : 'text-muted-foreground',
            )}
          >
            비활성
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
          selected ? 'bg-white/20' : 'bg-muted',
        )}
      >
        {countLabel(counts)}
      </span>
    </button>
  )
}
