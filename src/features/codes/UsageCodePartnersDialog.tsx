import { useDeferredValue, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { codeComponentSummary } from '@/lib/codes/code-usage'
import { folderPathLabel } from '@/lib/codes/outbound-folder'
import {
  outboundPartnerDisplayName,
  outboundPartnerUnitLabel,
} from '@/lib/codes/outbound-partner'
import { groupOutboundSearchSections } from '@/lib/codes/outbound-partner-browser'
import type {
  CodeUsageAssignment,
  CodeUsageAssignmentChange,
  CodeUsageTarget,
  CodeUsageTargetFolder,
  ProductCode,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

export function UsageCodePartnersDialog({
  code,
  styleNames,
  partners,
  folders,
  assignments,
  saving,
  error,
  onClose,
  onSave,
}: {
  code: ProductCode
  styleNames: ReadonlyMap<string, string>
  partners: CodeUsageTarget[]
  folders: CodeUsageTargetFolder[]
  assignments: CodeUsageAssignment[]
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (changes: CodeUsageAssignmentChange[]) => void
}) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const statusByTarget = useMemo(() => {
    const map = new Map<string, CodeUsageAssignment['status']>()
    for (const row of assignments) map.set(row.usageTargetId, row.status)
    return map
  }, [assignments])
  const [draft, setDraft] = useState(() => {
    const map = new Map<string, boolean>()
    for (const partner of partners) {
      map.set(partner.id, statusByTarget.get(partner.id) === 'active')
    }
    return map
  })

  const keyword = deferredSearch.trim().toLowerCase()
  const visiblePartners = useMemo(() => {
    if (!keyword) return partners
    return partners.filter((partner) => {
      const haystack = [
        outboundPartnerDisplayName(partner),
        outboundPartnerUnitLabel(partner),
        partner.groupName,
        partner.siteName,
        folderPathLabel(folders, partner.folderId),
      ]
        .join('\n')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [folders, keyword, partners])
  const sections = useMemo(
    () =>
      groupOutboundSearchSections({
        folders,
        hits: visiblePartners,
      }),
    [folders, visiblePartners],
  )

  const changes = useMemo(() => {
    const next: CodeUsageAssignmentChange[] = []
    for (const partner of partners) {
      const wantActive = draft.get(partner.id) === true
      const current = statusByTarget.get(partner.id)
      if (wantActive && current !== 'active') {
        next.push({
          productCodeId: code.id,
          usageTargetId: partner.id,
          status: 'active',
        })
      } else if (!wantActive && current === 'active') {
        next.push({
          productCodeId: code.id,
          usageTargetId: partner.id,
          status: 'paused',
        })
      }
    }
    return next
  }, [code.id, draft, partners, statusByTarget])

  function setUnits(units: readonly CodeUsageTarget[], checked: boolean) {
    setDraft((current) => {
      const next = new Map(current)
      for (const unit of units) next.set(unit.id, checked)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={() => {
          if (!saving) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-code-partners-title"
        className="relative z-10 flex max-h-[min(80vh,40rem)] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="usage-code-partners-title" className="text-base font-semibold">
            이 코드를 쓰는 업체
          </h2>
          <p className="mt-1 break-words text-sm">
            <span className="font-medium tabular-nums">{code.code}</span>
            <span className="ml-2 text-muted-foreground">{code.name}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {codeComponentSummary(code, styleNames)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            체크하면 사용중이 됩니다. 체크를 해제하면 일시중지되고, 연결은
            지워지지 않습니다.
          </p>
        </div>
        <div className="border-b border-border px-5 py-3">
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
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
          {sections.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              {partners.length === 0
                ? '표시할 출고업체가 없습니다. 업체 설정에서 먼저 고르세요.'
                : '검색된 업체가 없습니다.'}
            </p>
          ) : (
            sections.map((section) => (
              <section key={section.folderId ?? 'unfiled'}>
                <p className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                  {section.pathLabel}
                </p>
                <ul className="space-y-1">
                  {section.companies.map((company) => {
                    const allChecked = company.units.every(
                      (unit) => draft.get(unit.id) === true,
                    )
                    const branched = company.mode === 'branched'
                    return (
                      <li key={company.key}>
                        {branched ? (
                          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted/40">
                            <input
                              type="checkbox"
                              className="size-3.5 accent-primary"
                              checked={allChecked}
                              onChange={() =>
                                setUnits(company.units, !allChecked)
                              }
                            />
                            <span className="min-w-0 flex-1 break-words">
                              {company.groupName}
                            </span>
                          </label>
                        ) : null}
                        <ul className={cn(branched && 'pl-5')}>
                          {company.units.map((unit) => {
                            const checked = draft.get(unit.id) === true
                            const paused =
                              statusByTarget.get(unit.id) === 'paused' &&
                              !checked
                            return (
                              <li key={unit.id}>
                                <label
                                  className={cn(
                                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40',
                                    !unit.active && 'opacity-60',
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    className="size-3.5 accent-primary"
                                    checked={checked}
                                    onChange={() =>
                                      setUnits([unit], !checked)
                                    }
                                  />
                                  <span className="min-w-0 flex-1 break-words">
                                    {branched
                                      ? outboundPartnerUnitLabel(unit)
                                      : outboundPartnerDisplayName(unit)}
                                  </span>
                                  {paused ? (
                                    <span className="shrink-0 text-[11px] text-muted-foreground">
                                      일시중지
                                    </span>
                                  ) : null}
                                  {!unit.active ? (
                                    <span className="shrink-0 text-[11px] text-muted-foreground">
                                      비활성
                                    </span>
                                  ) : null}
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        {error ? (
          <p className="mx-5 mb-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || changes.length === 0}
            onClick={() => onSave(changes)}
          >
            {saving
              ? '저장 중...'
              : changes.length === 0
                ? '저장'
                : `${formatNumber(changes.length)}건 저장`}
          </Button>
        </div>
      </div>
    </div>
  )
}
