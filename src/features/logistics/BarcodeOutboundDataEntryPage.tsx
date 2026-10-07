import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BrandTargetGate } from '@/components/layout/BrandTargetGate'
import { FileSpreadsheet, History, Search, Settings2 } from 'lucide-react'
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
import { BarcodeOutboundDataEntryHistoryPanel } from '@/features/logistics/BarcodeOutboundDataEntryHistoryPanel'
import { BarcodeOutboundDataEntryPanel } from '@/features/logistics/BarcodeOutboundDataEntryPanel'
import {
  deleteBarcodeDataEntryRun,
  getCodeUsageTargetAliases,
  getCodeUsageTargetFolders,
  getCodeUsageTargets,
  listStyleRefsForLookup,
  saveBarcodeDataEntryRun,
} from '@/lib/api'
import {
  groupOutboundPartnersInFolder,
  matchesOutboundPartnerSearch,
} from '@/lib/codes/outbound-partner'
import {
  barcodeDataEntryAllReady,
  barcodeDataEntryBackupEntries,
  emptyBarcodeDataEntryDraft,
  filterTargetsByVisibleIds,
  groupBarcodeDataEntryCompaniesByCategory,
  isIsoDate,
  readBarcodeDataEntryDraft,
  readBarcodeDataEntryVisibleIds,
  unitIdsForCompanyKeys,
  visibleCompanyKeysFromUnitIds,
  writeBarcodeDataEntryDraft,
  writeBarcodeDataEntryVisibleIds,
  type BarcodeDataEntryRow,
  type BarcodeDataEntryCompanySelection,
} from '@/lib/outbound/barcode-outbound-data-entry'
import { PRODUCT_OUTBOUND_UPDATED_EVENT } from '@/lib/outbound/product-outbound'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn, formatNumber } from '@/lib/utils'

const COMPANY_RANK_COUNT = 3

type PageTab = 'entry' | 'history'

const PAGE_TABS: { value: PageTab; label: string; icon: typeof FileSpreadsheet }[] =
  [
    { value: 'entry', label: '데이터 입력', icon: FileSpreadsheet },
    { value: 'history', label: '등록 이력', icon: History },
  ]

/** 3열 횡대: 왼쪽부터 채운 뒤 다음 줄로 가고, 줄은 최대 3개다. */
function companyRowColumns(count: number) {
  if (count <= COMPANY_RANK_COUNT) return Math.max(1, count)
  return Math.ceil(count / COMPANY_RANK_COUNT)
}

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
  folders,
  initialCompanyKeys,
  onClose,
  onSave,
}: {
  partners: CodeUsageTarget[]
  folders: CodeUsageTargetFolder[]
  initialCompanyKeys: Set<string>
  onClose: () => void
  onSave: (ids: string[]) => void
}) {
  const [draft, setDraft] = useState(() => new Set(initialCompanyKeys))
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [search, setSearch] = useState('')

  const categories = useMemo(
    () => groupBarcodeDataEntryCompaniesByCategory(partners, folders),
    [partners, folders],
  )
  const visibleCategories = useMemo(() => {
    const keyword = search.trim()
    return categories.map((category) => ({
      ...category,
      companies: category.companies.filter((company) => !keyword ||
        company.units.some((unit) => matchesOutboundPartnerSearch(keyword, unit, [])),
      ),
    })).filter((category) => category.companies.length > 0)
  }, [categories, search])
  const visibleCompanies = visibleCategories.flatMap((category) => category.companies)

  function toggleCompany(company: BarcodeDataEntryCompanySelection) {
    setDraft((current) => {
      const next = new Set(current)
      if (next.has(company.selectionKey)) next.delete(company.selectionKey)
      else next.add(company.selectionKey)
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
            분류별로 체크한 업체만 선택 목록에 나옵니다. 지점이 있는 업체는
            해당 분류의 지점을 함께 고릅니다.
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
                  for (const company of visibleCompanies) next.add(company.selectionKey)
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
            visibleCategories.map((category) => (
              <section key={category.key} className="mb-3 space-y-1">
                <h3 className="sticky top-0 bg-card px-2 py-2 text-xs font-semibold text-muted-foreground">
                  {category.name}
                </h3>
                {category.companies.map((company) => {
                  const checked = draft.has(company.selectionKey)
                  return (
                    <label
                      key={company.selectionKey}
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
                      <span className="min-w-0 flex-1 truncate font-medium">{company.groupName}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{company.units.length}곳</span>
                    </label>
                  )
                })}
              </section>
            ))
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
                onSave(unitIdsForCompanyKeys(partners, draftRef.current, folders))
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
  useRenderWatch('BarcodeOutboundDataEntryPage')
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [categoryKey, setCategoryKey] = useState<string | null>(null)
  const [draftVersion, setDraftVersion] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [visibleIds, setVisibleIds] = useState<string[] | null>(() =>
    readBarcodeDataEntryVisibleIds(brand.id),
  )
  const [shippedOn, setShippedOn] = useState('')
  const [dateChosen, setDateChosen] = useState(false)
  const [backupNotice, setBackupNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pageTab, setPageTab] = useState<PageTab>('entry')
  const [historyVisited, setHistoryVisited] = useState(false)

  useEffect(() => {
    setSearch('')
    setSelectedKey(null)
    setCategoryKey(null)
    setVisibleIds(readBarcodeDataEntryVisibleIds(brand.id))
    setShippedOn('')
    setDateChosen(false)
    setBackupNotice(null)
    setPageTab('entry')
    setHistoryVisited(false)
  }, [brand.id])

  useEffect(() => {
    setShippedOn('')
    setDateChosen(false)
    setBackupNotice(null)
  }, [selectedKey])

  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })
  const aliasesQuery = useQuery({
    queryKey: ['codeUsageTargetAliases', brand.id],
    queryFn: () => getCodeUsageTargetAliases(brand.id),
  })
  const foldersQuery = useQuery({
    queryKey: ['codeUsageTargetFolders', brand.id],
    queryFn: () => getCodeUsageTargetFolders(brand.id),
  })

  const targets = useMemo(
    () => targetsQuery.data ?? [],
    [targetsQuery.data],
  )
  const aliases = useMemo(
    () => aliasesQuery.data ?? [],
    [aliasesQuery.data],
  )
  const folders = useMemo(
    () => foldersQuery.data ?? [],
    [foldersQuery.data],
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
    () => filterTargetsByVisibleIds(targets, visibleIds, folders),
    [targets, visibleIds, folders],
  )
  const categories = useMemo(
    () => groupBarcodeDataEntryCompaniesByCategory(allowedTargets, folders),
    [allowedTargets, folders],
  )
  const activeCategory = categories.find((category) => category.key === categoryKey) ??
    categories.find((category) => category.companies.length > 0) ?? categories[0]
  const companies = useMemo(
    () => (activeCategory?.companies ?? []).filter((company) =>
      company.units.some((target) => matchesOutboundPartnerSearch(
        search, target, aliasesByTarget.get(target.id) ?? [],
      )),
    ),
    [activeCategory, aliasesByTarget, search],
  )
  const allCompanies = useMemo(
    () => groupOutboundPartnersInFolder(targets),
    [targets],
  )
  const selectedCompany =
    activeCategory?.companies.find((company) => company.selectionKey === selectedKey) ?? null

  useEffect(() => {
    if (
      selectedKey &&
      !categories.some((category) => category.companies.some((company) => company.selectionKey === selectedKey))
    ) {
      setSelectedKey(null)
    }
  }, [categories, selectedKey])

  const configured = visibleIds != null
  const loading = targetsQuery.isPending || aliasesQuery.isPending || foldersQuery.isPending
  const loadError = targetsQuery.error || aliasesQuery.error || foldersQuery.error
  const allCategories = useMemo(
    () => groupBarcodeDataEntryCompaniesByCategory(targets, folders),
    [targets, folders],
  )
  const legacyDraft = selectedCompany
    ? readBarcodeDataEntryDraft(brand.id, selectedCompany.key)
    : emptyBarcodeDataEntryDraft()
  const scopedDraft = selectedCompany
    ? readBarcodeDataEntryDraft(brand.id, selectedCompany.selectionKey)
    : emptyBarcodeDataEntryDraft()
  const sharedAcrossCategories = Boolean(selectedCompany && allCategories.filter((category) =>
    category.companies.some((company) => company.key === selectedCompany.key),
  ).length > 1)
  const hasLegacyDraft = legacyDraft.rows.length > 0 || Boolean(legacyDraft.note.trim())
  const hasScopedDraft = scopedDraft.rows.length > 0 || Boolean(scopedDraft.note.trim())
  const draft = !hasScopedDraft && !sharedAcrossCategories ? legacyDraft : scopedDraft
  const settingsCompanyKeys =
    visibleCompanyKeysFromUnitIds(targets, visibleIds, folders) ?? new Set<string>()

  function persistDraft(rows: BarcodeDataEntryRow[], note: string) {
    if (!selectedCompany) {
      if (rows.length === 0 && !note.trim()) return
      throw new Error('출고업체를 먼저 고르세요.')
    }
    writeBarcodeDataEntryDraft(brand.id, selectedCompany.selectionKey, { rows, note })
    if (!sharedAcrossCategories) {
      writeBarcodeDataEntryDraft(brand.id, selectedCompany.key, emptyBarcodeDataEntryDraft())
    }
  }

  async function refreshBarcodeDataEntryLedger() {
    notifyOutboundUpdated(brand.id)
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['outboundShipments', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['barcodeDataEntryShipments', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['barcodeDataEntryRuns', brand.id],
      }),
    ])
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
            disabled={loading || targets.length === 0 || saving}
          >
            <Settings2 className="size-3.5" />
            업체 설정
          </Button>
        }
      />

      <div
        role="tablist"
        aria-label="바코드 출고 데이터입력"
        className="mb-4 flex items-stretch gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border bg-muted/40 px-2 pt-2"
      >
        {PAGE_TABS.map((item) => {
          const Icon = item.icon
          const selected = item.value === pageTab
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setPageTab(item.value)
                if (item.value === 'history') setHistoryVisited(true)
              }}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-sm transition-colors',
                selected
                  ? 'border-border bg-background text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground',
              )}
            >
              <Icon className="size-3.5 shrink-0 opacity-70" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {historyVisited ? (
        <div hidden={pageTab !== 'history'} className={pageTab === 'history' ? undefined : 'hidden'}>
          <BarcodeOutboundDataEntryHistoryPanel
            brandId={brand.id}
            companies={allCompanies}
            enabled={historyVisited}
            busy={saving}
            onSave={async (input) => {
              setSaving(true)
              try {
                await saveBarcodeDataEntryRun({
                  brandId: brand.id,
                  runId: input.runId,
                  companyKey: input.companyKey,
                  shippedOn: input.shippedOn,
                  note: input.note,
                  entries: input.entries,
                })
                await refreshBarcodeDataEntryLedger()
              } finally {
                setSaving(false)
              }
            }}
            onDelete={async (job) => {
              if (!job.runId) return
              setSaving(true)
              try {
                await deleteBarcodeDataEntryRun({
                  brandId: brand.id,
                  runId: job.runId,
                })
                await refreshBarcodeDataEntryLedger()
              } finally {
                setSaving(false)
              }
            }}
          />
        </div>
      ) : null}

      <div hidden={pageTab !== 'entry'} className={pageTab === 'entry' ? 'space-y-4' : 'hidden'}>

        <Card>
          <CardHeader>
            <CardTitle>출고업체 선택</CardTitle>
            <CardDescription>
              큰 분류를 고른 뒤 출고업체를 선택합니다. 지점은 선택한 분류 안에서
              연결합니다.
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
                <Link to={`/settings/usage-targets?brand=${encodeURIComponent(brand.slug)}`}>
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
                <div role="group" aria-label="출고업체 최상위 분류" className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={category.key}
                      type="button"
                      aria-pressed={category.key === activeCategory?.key}
                      disabled={saving}
                      onClick={() => {
                        if (category.key === activeCategory?.key) return
                        setCategoryKey(category.key)
                        setSelectedKey(null)
                        setSearch('')
                      }}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50',
                        category.key === activeCategory?.key
                          ? 'border-primary bg-primary/10 font-semibold text-primary'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      {category.name}
                      <span className="text-xs tabular-nums opacity-70">{category.companies.length}</span>
                    </button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedCompany
                    ? '아래 버튼을 눌러 업체를 바꾸면 하단 입력란 위 이름이 바뀝니다.'
                    : '아래 버튼에서 데이터를 넣을 업체를 고르세요.'}
                </p>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="업체 그룹, 지점, 별칭으로 검색"
                    aria-label="출고업체 검색"
                    disabled={saving}
                    className="pl-8"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  {activeCategory?.name} · {formatNumber(companies.length)}개 업체 ·{' '}
                  {formatNumber(companies.reduce((sum, company) => sum + company.units.length, 0))}곳
                  {configured
                    ? ` · 설정 ${formatNumber(categories.reduce((sum, category) => sum + category.companies.length, 0))}개`
                    : ' · 업체 설정에서 표시할 업체를 고를 수 있습니다'}
                </p>

                {companies.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    검색과 맞는 출고업체가 없습니다.
                  </p>
                ) : (
                  <div className="overflow-x-auto pr-1">
                    <div
                      className="grid grid-flow-row gap-2"
                      style={{
                        gridTemplateColumns: `repeat(${companyRowColumns(companies.length)}, minmax(7.5rem, 1fr))`,
                        gridTemplateRows: `repeat(${Math.min(COMPANY_RANK_COUNT, companies.length)}, auto)`,
                      }}
                    >
                      {companies.map((company) => {
                        const selected = selectedKey === company.selectionKey
                        return (
                          <button
                            key={company.selectionKey}
                            type="button"
                            aria-pressed={selected}
                            disabled={saving}
                            title={`${company.groupName} ${company.units.length}곳`}
                            className={cn(
                              'flex min-h-11 min-w-0 items-center justify-center rounded-md border px-2 text-center',
                              selected
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border bg-card hover:bg-muted/60',
                            )}
                            onClick={() => setSelectedKey(company.selectionKey)}
                          >
                            <span className="truncate text-sm font-medium">
                              {company.groupName}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            {selectedCompany ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-primary">{selectedCompany.categoryName}</p>
                <p className="text-3xl font-semibold tracking-tight">{selectedCompany.groupName}</p>
              </div>
            ) : null}
            <CardTitle>상품명·수량·지점</CardTitle>
            <CardDescription>
              「상품명」「수량」「지점명」을 표에 붙여넣거나 엑셀로 올린 뒤
              등록하면 M번호를 붙이고, 지점명은 이 업체 지점에 연결합니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedCompany ? (
              <p className="text-sm text-muted-foreground">
                위에서 출고업체를 고르면 출고일을 정할 수 있습니다.
              </p>
            ) : (
              <div className="space-y-4">
                <label className="flex max-w-xs flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    출고일
                  </span>
                  <Input
                    key={selectedCompany.selectionKey}
                    type="date"
                    autoComplete="off"
                    value={shippedOn}
                    onChange={(event) => {
                      const value = event.target.value
                      setShippedOn(value)
                      setDateChosen(isIsoDate(value))
                      setBackupNotice(null)
                    }}
                  />
                </label>
                {backupNotice ? (
                  <p className="text-sm text-success">{backupNotice}</p>
                ) : null}
                {sharedAcrossCategories && hasLegacyDraft && !hasScopedDraft ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                    <p className="flex-1 text-sm text-muted-foreground">
                      이전 임시 입력 {formatNumber(legacyDraft.rows.length)}행이 있습니다.
                      {selectedCompany.categoryName} 자료인지 확인한 뒤 불러오세요.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        persistDraft(legacyDraft.rows, legacyDraft.note)
                        writeBarcodeDataEntryDraft(brand.id, selectedCompany.key, emptyBarcodeDataEntryDraft())
                        setDraftVersion((version) => version + 1)
                      }}
                    >
                      현재 분류로 불러오기
                    </Button>
                  </div>
                ) : null}
                {dateChosen && isIsoDate(shippedOn) ? (
                  <BarcodeOutboundDataEntryPanel
                    key={`${selectedCompany.selectionKey}:${draftVersion}`}
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
                      const allowedIds = new Set(selectedCompany.units.map((unit) => unit.id))
                      if (entries.some((entry) => !allowedIds.has(entry.usageTargetId))) {
                        throw new Error('선택한 분류의 출고업체와 지점을 다시 확인하세요.')
                      }
                      if (entries.length === 0) {
                        throw new Error('백업할 수량이 없습니다.')
                      }
                      setSaving(true)
                      try {
                        persistDraft(rows, note)
                        await saveBarcodeDataEntryRun({
                          brandId: brand.id,
                          runId: null,
                          companyKey: selectedCompany.key,
                          shippedOn,
                          note,
                          entries,
                        })
                        await refreshBarcodeDataEntryLedger()
                        const qty = entries.reduce(
                          (sum, entry) => sum + entry.quantity,
                          0,
                        )
                        persistDraft([], '')
                        setBackupNotice(
                          `${shippedOn} 출고 ${formatNumber(entries.length)}종 · ${formatNumber(qty)}개를 저장했습니다. 다음 출고일을 고르세요.`,
                        )
                        setShippedOn('')
                        setDateChosen(false)
                        return { kinds: entries.length, qty }
                      } finally {
                        setSaving(false)
                      }
                    }}
                    onLookupStyles={(names) =>
                      listStyleRefsForLookup(brand.id, { names })
                    }
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    출고일을 정하면 양식 받기와 엑셀 올리기를 쓸 수 있습니다.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {settingsOpen ? (
        <VisiblePartnerSettingsDialog
          partners={targets}
          folders={folders}
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

export function CompanyBarcodeOutboundDataEntryPage() {
  return (
    <BrandTargetGate lockAfterSelect>
      <BarcodeOutboundDataEntryPage />
    </BrandTargetGate>
  )
}
