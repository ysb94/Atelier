import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, Settings2 } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { BarcodeOutboundDataEntryPanel } from '@/features/logistics/BarcodeOutboundDataEntryPanel'
import {
  getCodeUsageTargetAliases,
  getCodeUsageTargets,
  listStyleRefsForLookup,
  replaceBarcodeDataEntryShipments,
} from '@/lib/api'
import {
  countOutboundCompanies,
  groupOutboundPartnersInFolder,
  matchesOutboundPartnerSearch,
  type OutboundCompanyInFolder,
} from '@/lib/codes/outbound-partner'
import {
  barcodeDataEntryAllReady,
  barcodeDataEntryBackupEntries,
  barcodeDataEntryCompanyKey,
  barcodeDataEntrySourceRef,
  emptyBarcodeDataEntryDraft,
  filterTargetsByVisibleIds,
  isIsoDate,
  readBarcodeDataEntryDraft,
  readBarcodeDataEntryVisibleIds,
  todayIsoDate,
  unitIdsForCompanyKeys,
  visibleCompanyKeysFromUnitIds,
  writeBarcodeDataEntryDraft,
  writeBarcodeDataEntryVisibleIds,
  type BarcodeDataEntryRow,
} from '@/lib/outbound/barcode-outbound-data-entry'
import { PRODUCT_OUTBOUND_UPDATED_EVENT } from '@/lib/outbound/product-outbound'
import type { CodeUsageTarget } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

function notifyOutboundUpdated(brandId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(PRODUCT_OUTBOUND_UPDATED_EVENT, {
      detail: { brandId },
    }),
  )
}

function VisiblePartnerSettingsDialog({
  partners,
  initialCompanyKeys,
  onClose,
  onSave,
}: {
  partners: CodeUsageTarget[]
  initialCompanyKeys: Set<string>
  onClose: () => void
  onSave: (ids: string[]) => void
}) {
  const [draft, setDraft] = useState(() => new Set(initialCompanyKeys))
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [search, setSearch] = useState('')

  const companies = useMemo(
    () => groupOutboundPartnersInFolder(partners),
    [partners],
  )
  const visibleCompanies = useMemo(() => {
    const keyword = search.trim()
    if (!keyword) return companies
    return companies.filter((company) =>
      company.units.some((unit) =>
        matchesOutboundPartnerSearch(keyword, unit, []),
      ),
    )
  }, [companies, search])

  function toggleCompany(company: OutboundCompanyInFolder) {
    setDraft((current) => {
      const next = new Set(current)
      if (next.has(company.key)) next.delete(company.key)
      else next.add(company.key)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[min(80vh,40rem)] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">표시할 출고업체</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            체크한 업체만 선택 목록에 나옵니다. 지점이 있는 업체는 업체 단위로
            고릅니다.
          </p>
        </div>
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="업체로 검색"
              aria-label="표시할 출고업체 검색"
              className="pl-8"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={visibleCompanies.length === 0}
              onClick={() => {
                setDraft((current) => {
                  const next = new Set(current)
                  for (const company of visibleCompanies) next.add(company.key)
                  return next
                })
              }}
            >
              보이는 곳 모두 선택
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={draft.size === 0}
              onClick={() => setDraft(new Set())}
            >
              선택 해제
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto px-3 py-3">
          {partners.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              등록된 출고업체가 없습니다.
            </p>
          ) : visibleCompanies.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              검색과 맞는 출고업체가 없습니다.
            </p>
          ) : (
            visibleCompanies.map((company) => {
              const checked = draft.has(company.key)
              return (
                <label
                  key={company.key}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                    checked
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-transparent hover:bg-muted/40',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={checked}
                    onChange={() => toggleCompany(company)}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {company.groupName}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {company.units.length}곳
                  </span>
                </label>
              )
            })
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {formatNumber(draft.size)}개 업체 선택
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onSave(unitIdsForCompanyKeys(partners, draftRef.current))
                onClose()
              }}
            >
              저장
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** (임시) 바코드 출고 데이터입력 — 업체를 고르고 지점별 상품명·수량을 넣는다. */
export function BarcodeOutboundDataEntryPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [visibleIds, setVisibleIds] = useState<string[] | null>(() =>
    readBarcodeDataEntryVisibleIds(brand.id),
  )
  const [shippedOn, setShippedOn] = useState(todayIsoDate)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSearch('')
    setSelectedKey(null)
    setVisibleIds(readBarcodeDataEntryVisibleIds(brand.id))
    setShippedOn(todayIsoDate())
  }, [brand.id])

  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })
  const aliasesQuery = useQuery({
    queryKey: ['codeUsageTargetAliases', brand.id],
    queryFn: () => getCodeUsageTargetAliases(brand.id),
  })

  const targets = useMemo(
    () => targetsQuery.data ?? [],
    [targetsQuery.data],
  )
  const aliases = useMemo(
    () => aliasesQuery.data ?? [],
    [aliasesQuery.data],
  )
  const aliasesByTarget = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const alias of aliases) {
      const list = map.get(alias.targetId) ?? []
      list.push(alias.alias)
      map.set(alias.targetId, list)
    }
    return map
  }, [aliases])

  const allowedTargets = useMemo(
    () => filterTargetsByVisibleIds(targets, visibleIds),
    [targets, visibleIds],
  )
  const visibleTargets = useMemo(
    () =>
      allowedTargets.filter((target) =>
        matchesOutboundPartnerSearch(
          search,
          target,
          aliasesByTarget.get(target.id) ?? [],
        ),
      ),
    [aliasesByTarget, allowedTargets, search],
  )
  const companies = useMemo(
    () => groupOutboundPartnersInFolder(visibleTargets),
    [visibleTargets],
  )
  const selectedCompany =
    companies.find((company) => company.key === selectedKey) ??
    groupOutboundPartnersInFolder(allowedTargets).find(
      (company) => company.key === selectedKey,
    ) ??
    null

  useEffect(() => {
    if (
      selectedKey &&
      !allowedTargets.some(
        (target) => barcodeDataEntryCompanyKey(target) === selectedKey,
      )
    ) {
      setSelectedKey(null)
    }
  }, [allowedTargets, selectedKey])

  const configured = visibleIds != null
  const loading = targetsQuery.isPending || aliasesQuery.isPending
  const loadError = targetsQuery.error || aliasesQuery.error
  const draft = selectedCompany
    ? readBarcodeDataEntryDraft(brand.id, selectedCompany.key)
    : emptyBarcodeDataEntryDraft()
  const settingsCompanyKeys =
    visibleCompanyKeysFromUnitIds(targets, visibleIds) ?? new Set<string>()

  function persistDraft(rows: BarcodeDataEntryRow[], note: string) {
    if (!selectedCompany) {
      throw new Error('출고업체를 먼저 고르세요.')
    }
    writeBarcodeDataEntryDraft(brand.id, selectedCompany.key, { rows, note })
  }

  return (
    <div>
      <PageHeader
        title="(임시) 바코드 출고 데이터입력"
        description={`${brand.name} 바코드 출고용 과거 데이터를 넣는 임시 화면입니다.`}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSettingsOpen(true)}
            disabled={loading || targets.length === 0}
          >
            <Settings2 className="size-3.5" />
            업체 설정
          </Button>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>출고업체 선택</CardTitle>
            <CardDescription>
              업체를 고른 뒤 상품명·수량·지점명을 넣습니다. 지점 칩은 숨기고
              업체 줄만 선택합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">
                출고업체를 불러오는 중...
              </p>
            ) : loadError ? (
              <p className="text-sm text-danger">
                출고업체를 불러오지 못했습니다.
              </p>
            ) : targets.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  등록된 출고업체가 없습니다. 출고업체 화면에서 먼저 만들어
                  주세요.
                </p>
                <Link to={`/b/${brand.slug}/settings/usage-targets`}>
                  <Button type="button" size="sm">
                    출고업체 관리
                  </Button>
                </Link>
              </div>
            ) : configured && allowedTargets.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  표시할 업체를 아직 체크하지 않았습니다.
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings2 className="size-3.5" />
                  업체 설정
                </Button>
              </div>
            ) : (
              <>
                {selectedCompany ? (
                  <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">선택한 업체</p>
                    <p className="mt-0.5 text-sm font-medium">
                      {selectedCompany.groupName}
                      <span className="ml-1 font-normal text-muted-foreground">
                        {selectedCompany.units.length}곳
                      </span>
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    아래 목록에서 데이터를 넣을 업체를 고르세요.
                  </p>
                )}

                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="업체 그룹, 지점, 별칭으로 검색"
                    aria-label="출고업체 검색"
                    className="pl-8"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  {formatNumber(countOutboundCompanies(visibleTargets))}개 업체 ·{' '}
                  {formatNumber(visibleTargets.length)}곳
                  {configured
                    ? ` · 설정 ${formatNumber(countOutboundCompanies(allowedTargets))}개`
                    : ' · 아직 설정 전이라 전체가 보입니다'}
                </p>

                {companies.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    검색과 맞는 출고업체가 없습니다.
                  </p>
                ) : (
                  <div className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
                    {companies.map((company) => {
                      const selected = selectedKey === company.key
                      return (
                        <button
                          key={company.key}
                          type="button"
                          aria-selected={selected}
                          className={cn(
                            'flex h-8 w-full items-center rounded-md px-1.5 text-left',
                            selected ? 'bg-muted' : 'hover:bg-muted/60',
                          )}
                          onClick={() => setSelectedKey(company.key)}
                        >
                          <span className="truncate text-sm font-medium">
                            {company.groupName}
                          </span>
                          <span className="ml-1 shrink-0 text-xs text-muted-foreground">
                            {company.units.length}곳
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>상품명·수량·지점</CardTitle>
            <CardDescription>
              「상품명」「수량」「지점명」을 표에 붙여넣거나 엑셀로 올린 뒤
              등록하면 M번호를 붙이고, 지점명은 이 업체 지점에 연결합니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedCompany ? (
              <p className="text-sm text-muted-foreground">
                위에서 출고업체를 고르면 양식 받기와 엑셀 올리기를 쓸 수
                있습니다.
              </p>
            ) : (
              <div className="space-y-4">
                <label className="flex max-w-xs flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    출고일
                  </span>
                  <Input
                    type="date"
                    value={shippedOn}
                    onChange={(event) => setShippedOn(event.target.value)}
                  />
                </label>
                <BarcodeOutboundDataEntryPanel
                  key={selectedCompany.key}
                  brandId={brand.id}
                  brandSlug={brand.slug}
                  companyName={selectedCompany.groupName}
                  units={selectedCompany.units}
                  aliases={aliases}
                  rows={draft.rows}
                  jobNote={draft.note}
                  saving={saving}
                  onSave={async (rows, note) => {
                    persistDraft(rows, note)
                  }}
                  onBackup={async (rows, note) => {
                    if (!isIsoDate(shippedOn)) {
                      throw new Error('출고일을 확인하세요.')
                    }
                    if (!barcodeDataEntryAllReady(rows)) {
                      throw new Error(
                        '연결되지 않은 상품명이나 지점이 있습니다. 등록과 지점 연결을 다시 하세요.',
                      )
                    }
                    const entries = barcodeDataEntryBackupEntries(rows)
                    if (entries.length === 0) {
                      throw new Error('백업할 수량이 없습니다.')
                    }
                    setSaving(true)
                    try {
                      persistDraft(rows, note)
                      const saved = await replaceBarcodeDataEntryShipments({
                        brandId: brand.id,
                        sourceRef: barcodeDataEntrySourceRef(
                          selectedCompany.key,
                        ),
                        shippedOn,
                        note,
                        partnerIds: selectedCompany.units.map((unit) => unit.id),
                        entries,
                      })
                      notifyOutboundUpdated(brand.id)
                      await queryClient.invalidateQueries({
                        queryKey: ['outboundShipments', brand.id],
                      })
                      const qty = entries.reduce(
                        (sum, entry) => sum + entry.quantity,
                        0,
                      )
                      return { kinds: saved, qty }
                    } finally {
                      setSaving(false)
                    }
                  }}
                  onLookupStyles={(names) =>
                    listStyleRefsForLookup(brand.id, { names })
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {settingsOpen ? (
        <VisiblePartnerSettingsDialog
          partners={targets}
          initialCompanyKeys={settingsCompanyKeys}
          onClose={() => setSettingsOpen(false)}
          onSave={(ids) => {
            writeBarcodeDataEntryVisibleIds(brand.id, ids)
            setVisibleIds(ids)
          }}
        />
      ) : null}
    </div>
  )
}
