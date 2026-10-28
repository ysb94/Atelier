import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { useRenderWatch } from '@/lib/diagnostics'
import { createSeason, deleteSeason, getCompanyProductDrafts, getSeasonsByBrand, updateProductDraft, updateSeason } from '@/lib/api'
import {
  DEFAULT_COMPANY_ID,
  canViewDraftsByOwner,
} from '@/lib/company/capabilities'
import {
  UNASSIGNED_DRAFT_BRAND,
  UNASSIGNED_DRAFT_OWNER,
  matchesDraftBrandScope,
  matchesDraftOwnerScope,
  type DraftBrandScope,
  type DraftOwnerScope,
} from '@/lib/drafts/company-draft'
import { newColorRow } from '@/lib/drafts/empty-draft'
import {
  newColorSampleRound,
  passLatestColorSampleRound,
  publishNextColorSampleRound,
  resolveColorSampleRounds,
} from '@/lib/drafts/draft-flow'
import { draftToInput, attachSampleWorkOrderFile, latestFilledSampleWorkOrder, legacyWorkOrderFields, setLatestSampleWorkOrderPassed } from '@/lib/drafts/sample-work-order'
import { receiveSample, registerNextReceivedSample } from '@/lib/drafts/sample-receipt'
import { parseSizeSpecInput } from '@/lib/drafts/spec-format'
import { writeColorSpec } from '@/lib/drafts/color-spec'
import { useAuth } from '@/lib/supabase/auth'
import { useBasicWorkAccess, canWriteDraft } from '@/lib/supabase/basic-work-access'
import {
  type Brand,
  type ProductDraft,
  type ProductDraftInput,
  type Season,
} from '@/lib/types'
import { combineListQueries, flattenListQueries } from '@/lib/query/list-queries'
import { draftDetailPath, draftNewPath } from '@/lib/workspace/company-paths'
import { cn, formatNumber, emptyList } from '@/lib/utils'
import { DraftFolderBar, DraftFolderHeading } from './DraftFolderBar'
import { matchesDraftFolder } from './draft-folder-filter'
import { DraftSheetRow, type DraftConfirmFlag } from './DraftSheetRow'
import { DraftReleaseScheduleDialog } from './DraftReleaseScheduleDialog'
import {
  formatReleaseGroupLabel,
  resolveReleaseSchedule,
  seasonToPreviewGroup,
  type PreviewReleaseAssignment,
  type PreviewReleaseGroup,
  type ResolvedReleaseSchedule,
} from './release-schedule-preview'

type BoardFilter = 'all' | 'unassigned' | 'scheduled'

function hasReleaseGroup(schedule: ResolvedReleaseSchedule | undefined) {
  return Boolean(schedule?.group)
}

function countScheduleRows(
  rows: ProductDraft[],
  scheduleByDraft: Map<string, ResolvedReleaseSchedule>,
) {
  let pending = 0
  let scheduled = 0
  for (const draft of rows) {
    if (hasReleaseGroup(scheduleByDraft.get(draft.id))) scheduled += 1
    else pending += 1
  }
  return { total: rows.length, pending, scheduled }
}

function emptyMessage(
  hasAny: boolean,
  folderFilter: string,
  boardFilter: BoardFilter,
  brandScope: DraftBrandScope,
  ownerScope: DraftOwnerScope,
) {
  if (hasAny) return '조건에 맞는 기획안이 없습니다.'
  if (ownerScope === UNASSIGNED_DRAFT_OWNER) {
    return '담당 미정 기획안이 없습니다.'
  }
  if (ownerScope !== 'all') {
    return '이 담당자의 기획안이 없습니다.'
  }
  if (brandScope === UNASSIGNED_DRAFT_BRAND) {
    return '브랜드 미정 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
  }
  if (boardFilter === 'unassigned') {
    return '출시 일정이 비어 있는 기획안이 없습니다.'
  }
  if (boardFilter === 'scheduled') {
    return '출시 일정이 잡힌 기획안이 없습니다.'
  }
  if (folderFilter === 'unassigned') return '폴더가 지정되지 않은 기획안이 없습니다.'
  if (folderFilter !== 'all') return '이 폴더에 담긴 기획안이 없습니다.'
  return '아직 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
}

export function CompanyDraftsPage() {
  useRenderWatch('CompanyDraftsPage')
  const { brands, brandById } = useCompanyBrandScope()
  const { profile } = useAuth()
  const workAccess = useBasicWorkAccess()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all')
  const [tempGroups, setTempGroups] = useState<PreviewReleaseGroup[]>([])
  const [assignments, setAssignments] = useState<
    Record<string, PreviewReleaseAssignment>
  >({})
  const [scheduleDraftId, setScheduleDraftId] = useState<string | null>(null)
  const folderParam = searchParams.get('folder')
  const folderFilter = folderParam ?? searchParams.get('season') ?? 'all'
  const brandScope = (searchParams.get('scope') ?? 'all') as DraftBrandScope
  const canViewByOwner = canViewDraftsByOwner(profile)
  const ownerScope = (
    canViewByOwner ? (searchParams.get('owner') ?? 'all') : 'all'
  ) as DraftOwnerScope
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID
  const brandIdBySlug = useMemo(
    () => new Map(brands.map((item) => [item.slug, item.id])),
    [brands],
  )

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })
  const seasonQueries = useQueries({
    queries: brands.map((item) => ({
      queryKey: ['seasons', item.id] as const,
      queryFn: () => getSeasonsByBrand(item.id),
    })),
    // 기본 반환 배열은 매 렌더 새 참조라 아래 useMemo 가 매번 다시 돈다. list-queries.ts 참고.
    combine: combineListQueries<Season>,
  })

  const drafts = draftsQuery.data ?? emptyList<ProductDraft>()
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const savedDraftRef = useRef(new Map<string, ProductDraft>())
  const saveChainRef = useRef(new Map<string, Promise<void>>())

  function currentDraft(draftId: string) {
    const listed = draftsRef.current.find((item) => item.id === draftId)
    const saved = savedDraftRef.current.get(draftId)
    if (!listed) return saved
    if (!saved) return listed
    return saved.updatedAt >= listed.updatedAt ? saved : listed
  }

  function saveDraftChange(
    draftId: string,
    change: (current: ProductDraft) => ProductDraftInput,
  ) {
    const previous = saveChainRef.current.get(draftId) ?? Promise.resolve()
    // 앞선 저장 실패는 그 호출을 기다린 쪽에 이미 전달됐다. 다음 수정은 이어서 저장한다.
    const task = previous.catch(() => undefined).then(async () => {
      const current = currentDraft(draftId)
      if (!current) throw new Error('기획안을 찾지 못했습니다.')
      if (!canWriteDraft(workAccess.access,current)) throw new Error('작성자만 기획안을 수정할 수 있습니다.')
      const input = change(current)
      try {
        const updated = await updateProductDraft(draftId, input)
        savedDraftRef.current.set(draftId, updated)
        queryClient.setQueryData<ProductDraft[]>(
          ['product-drafts', 'company', companyId],
          (current) =>
            current?.map((item) => (item.id === updated.id ? updated : item)),
        )
        await queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
        await queryClient.invalidateQueries({ queryKey: ['product-draft', draftId] })
        return updated
      } catch (err) {
        console.warn('[drafts] 기획안 저장 실패', {
          draftId,
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    })
    saveChainRef.current.set(
      draftId,
      task.then(
        () => undefined,
        () => undefined,
      ),
    )
    return task
  }

  const ownerFillRef = useRef(new Set<string>())
  useEffect(() => {
    const creator = profile?.displayName?.trim()
    if (!creator) return
    for (const draft of drafts) {
      if (draft.owner.trim() || ownerFillRef.current.has(draft.id)) continue
      ownerFillRef.current.add(draft.id)
      void saveDraftChange(draft.id, (current) => {
        const input = draftToInput(current)
        if (input.owner.trim()) return input
        return { ...input, owner: creator }
      }).catch((err: unknown) => {
        ownerFillRef.current.delete(draft.id)
        console.warn('[drafts] 기획안 작성자 저장 실패', err)
      })
    }
  }, [drafts, profile?.displayName])

  const seasons = useMemo(
    () => flattenListQueries(seasonQueries),
    [seasonQueries],
  )
  const seasonMap = useMemo(
    () => new Map(seasons.map((season) => [season.id, season])),
    [seasons],
  )
  const previewGroups = useMemo(() => {
    const byId = new Map<string, PreviewReleaseGroup>()
    for (const season of seasons) {
      byId.set(season.id, seasonToPreviewGroup(season))
    }
    for (const group of tempGroups) byId.set(group.id, group)
    return [...byId.values()]
  }, [seasons, tempGroups])

  const scopedDrafts = useMemo(() => {
    return drafts.filter((draft) =>
      matchesDraftBrandScope(draft.brandId, brandScope, brandIdBySlug),
    )
  }, [brandIdBySlug, brandScope, drafts])

  const ownerAllDrafts = useMemo(
    () =>
      drafts.filter((draft) =>
        matchesDraftOwnerScope(draft.owner, ownerScope),
      ),
    [ownerScope, drafts],
  )

  const ownerDrafts = useMemo(
    () =>
      scopedDrafts.filter((draft) =>
        matchesDraftOwnerScope(draft.owner, ownerScope),
      ),
    [ownerScope, scopedDrafts],
  )

  const scopedBrand =
    brandScope !== 'all' && brandScope !== UNASSIGNED_DRAFT_BRAND
      ? brands.find((item) => item.slug === brandScope)
      : undefined

  const scheduleByDraft = useMemo(() => {
    const map = new Map(
      ownerAllDrafts.map((draft) => [
        draft.id,
        resolveReleaseSchedule(draft, seasonMap, tempGroups, assignments),
      ]),
    )
    return map
  }, [assignments, ownerAllDrafts, seasonMap, tempGroups])

  const allScopeCounts = useMemo(
    () => countScheduleRows(ownerAllDrafts, scheduleByDraft),
    [ownerAllDrafts, scheduleByDraft],
  )
  const brandCards = useMemo(() => {
    return brands.map((brand) => {
      const rows = ownerAllDrafts.filter((draft) => draft.brandId === brand.id)
      return { brand, ...countScheduleRows(rows, scheduleByDraft) }
    })
  }, [brands, ownerAllDrafts, scheduleByDraft])

  const unassignedScopeCounts = useMemo(
    () =>
      countScheduleRows(
        ownerAllDrafts.filter((draft) => !draft.brandId),
        scheduleByDraft,
      ),
    [ownerAllDrafts, scheduleByDraft],
  )

  const folderDrafts = useMemo(() => ownerDrafts.filter(draft => {
    const groupId = scheduleByDraft.get(draft.id)?.group?.id
    return matchesDraftFolder(groupId, folderFilter, !folderParam && groupId ? seasonMap.get(groupId)?.code : undefined)
  }), [ownerDrafts, scheduleByDraft, folderFilter, folderParam, seasonMap])

  const folderItems = useMemo(() => {
    const counts = new Map<string, number>()
    for (const draft of ownerDrafts) {
      const id = scheduleByDraft.get(draft.id)?.group?.id
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return previewGroups
      .filter(group => matchesDraftBrandScope(group.brandId, brandScope, brandIdBySlug))
      .filter(group => seasonMap.get(group.id)?.code !== 'UNASSIGNED')
      .map(group => {
        const season = seasonMap.get(group.id)
        return {
          id: group.id,
          label: formatReleaseGroupLabel(group),
          brandId: group.brandId,
          brandName: scopedBrand ? undefined : brandById.get(group.brandId)?.name,
          name: group.name,
          total: counts.get(group.id) ?? 0,
          editable: Boolean(season && season.code !== 'UNASSIGNED'),
        }
      })
  }, [ownerDrafts, scheduleByDraft, previewGroups, brandScope, brandIdBySlug, scopedBrand, brandById, seasonMap])
  const selectedFolderIds = folderFilter === 'all' || folderFilter === 'unassigned'
    ? [folderFilter]
    : folderItems.filter(folder => matchesDraftFolder(folder.id, folderFilter, !folderParam ? seasonMap.get(folder.id)?.code : undefined)).map(folder => folder.id)
  const activeFolder = folderFilter === 'all' || folderFilter === 'unassigned'
    ? null
    : folderItems.find((folder) => selectedFolderIds.includes(folder.id)) ?? null
  const unassignedFolderCount = ownerDrafts.filter(draft => !scheduleByDraft.get(draft.id)?.group).length

  const sheetCounts = useMemo(() => {
    let pending = 0
    let scheduled = 0
    let planningOpen = 0
    let mdOpen = 0
    for (const draft of folderDrafts) {
      const schedule = scheduleByDraft.get(draft.id)
      if (hasReleaseGroup(schedule)) scheduled += 1
      else pending += 1
      if (draft.status === 'open') planningOpen += 1
      if (!schedule?.group || schedule.certainty !== 'confirmed') mdOpen += 1
    }
    return {
      total: folderDrafts.length,
      pending,
      scheduled,
      planningOpen,
      mdOpen,
    }
  }, [folderDrafts, scheduleByDraft])

  const visible = useMemo(() => {
    return folderDrafts.filter((draft) => {
      const scheduled = hasReleaseGroup(scheduleByDraft.get(draft.id))
      if (boardFilter === 'unassigned' && scheduled) return false
      if (boardFilter === 'scheduled' && !scheduled) return false
      return true
    })
  }, [boardFilter, folderDrafts, scheduleByDraft])

  const scheduleDraft = scheduleDraftId
    ? (ownerDrafts.find((draft) => draft.id === scheduleDraftId) ??
      drafts.find((draft) => draft.id === scheduleDraftId) ??
      null)
    : null
  const scheduleDraftResolved = scheduleDraft
    ? resolveReleaseSchedule(
        scheduleDraft,
        seasonMap,
        tempGroups,
        assignments,
      )
    : null

  const loading =
    draftsQuery.isLoading || seasonQueries.loading

  const selectedSeason = seasons.find(season =>
    (!scopedBrand || season.brandId === scopedBrand.id) &&
    matchesDraftFolder(season.id, folderFilter, !folderParam ? season.code : undefined) &&
    folderFilter !== 'all' && folderFilter !== 'unassigned',
  )
  const newHref = draftNewPath(scopedBrand?.slug ?? (selectedSeason ? brandById.get(selectedSeason.brandId)?.slug : undefined), {
    season: folderFilter === 'unassigned' ? 'none' : selectedSeason?.id ?? null,
  })

  function setFolderFilter(value: string) {
    setBoardFilter('all')
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('season')
      if (value === 'all') next.delete('folder')
      else next.set('folder', value)
      return next
    }, { replace: true })
  }

  function setBrandScope(value: DraftBrandScope) {
    setBoardFilter('all')
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('folder')
        next.delete('season')
        if (!value || value === 'all') next.delete('scope')
        else next.set('scope', value)
        return next
      },
      { replace: true },
    )
  }

  function closeScheduleDialog() {
    setScheduleDraftId(null)
  }

  async function applySchedule(
    draftId: string,
    value: {
      brandId: string
      group: PreviewReleaseGroup
      targetDate: string | null
      certainty: PreviewReleaseAssignment['certainty']
    },
  ) {
    let seasonId = value.group.id
    if (seasonId.startsWith('temp-')) {
      const season = await createSeason(value.brandId, {
        name: value.group.name,
        releaseTiming: value.group.releaseTiming,
      })
      seasonId = season.id
      queryClient.setQueryData<Season[]>(
        ['seasons', value.brandId],
        (current) =>
          current?.some((item) => item.id === season.id)
            ? current
            : [...(current ?? []), season],
      )
      await queryClient.invalidateQueries({ queryKey: ['seasons', value.brandId] })
    }
    await saveDraftChange(draftId, (current) => ({
      ...draftToInput(current),
      brandId: value.brandId,
      seasonId,
    }))
    setTempGroups((prev) => prev.filter((group) => group.id !== value.group.id))
    setAssignments((prev) => {
      if (!prev[draftId]) return prev
      const next = { ...prev }
      delete next[draftId]
      return next
    })
    closeScheduleDialog()
  }

  async function clearSchedule(draftId: string) {
    await saveDraftChange(draftId, (current) => ({
      ...draftToInput(current),
      seasonId: null,
    }))
    setAssignments((prev) => {
      if (!prev[draftId]) return prev
      const next = { ...prev }
      delete next[draftId]
      return next
    })
    closeScheduleDialog()
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <BrandStatCard
          label="전체"
          badge={{ name: 'ALL', color: '#343a40', logoUrl: null }}
          total={allScopeCounts.total}
          pending={allScopeCounts.pending}
          scheduled={allScopeCounts.scheduled}
          selected={brandScope === 'all'}
          onSelect={() => setBrandScope('all')}
        />
        {brandCards.map((card) => (
          <BrandStatCard
            key={card.brand.id}
            label={card.brand.name}
            badge={card.brand}
            total={card.total}
            pending={card.pending}
            scheduled={card.scheduled}
            selected={brandScope === card.brand.slug}
            onSelect={() =>
              setBrandScope(
                brandScope === card.brand.slug ? 'all' : card.brand.slug,
              )
            }
          />
        ))}
        {unassignedScopeCounts.total > 0 ? (
          <BrandStatCard
            label="브랜드 미정"
            badge={{ name: '미정', color: '#8a8e94', logoUrl: null }}
            total={unassignedScopeCounts.total}
            pending={unassignedScopeCounts.pending}
            scheduled={unassignedScopeCounts.scheduled}
            selected={brandScope === UNASSIGNED_DRAFT_BRAND}
            onSelect={() =>
              setBrandScope(
                brandScope === UNASSIGNED_DRAFT_BRAND
                  ? 'all'
                  : UNASSIGNED_DRAFT_BRAND,
              )
            }
          />
        ) : null}
      </div>

      <div className="mb-3 flex flex-col gap-3 border-b border-[#ead7b0] pb-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5 lg:pb-2">
          <BoardFilterChip
            selected={boardFilter === 'all'}
            onSelect={() => setBoardFilter('all')}
            label="전체"
            count={sheetCounts.total}
          />
          <BoardFilterChip
            selected={boardFilter === 'unassigned'}
            onSelect={() => setBoardFilter('unassigned')}
            label="출시 미정"
            count={sheetCounts.pending}
          />
          <BoardFilterChip
            selected={boardFilter === 'scheduled'}
            onSelect={() => setBoardFilter('scheduled')}
            label="출시 확정"
            count={sheetCounts.scheduled}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-[11px] leading-4 text-[#b8860b]">
            <div>미확정 : 기획 {formatNumber(sheetCounts.planningOpen)}건</div>
            <div>미확정 : MD {formatNumber(sheetCounts.mdOpen)}건</div>
          </div>
          <DraftFolderBar
            folders={folderItems}
            brands={brands.map((brand) => ({ id: brand.id, name: brand.name }))}
            defaultBrandId={scopedBrand?.id}
            selectedIds={selectedFolderIds}
            unassignedCount={unassignedFolderCount}
            onSelect={setFolderFilter}
            onCreate={async (value) => {
              await createSeason(value.brandId, {
                name: value.name,
                releaseTiming: '',
              })
              await queryClient.invalidateQueries({ queryKey: ['seasons', value.brandId] })
            }}
          />
        </div>
        {canWriteDraft(workAccess.access) && <Link
          to={newHref}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md bg-[#c60920] px-3 text-xs font-medium text-white hover:bg-[#b30920] lg:mb-1 lg:self-end"
        >
          <Plus className="size-3.5" />
          기획안 추가
        </Link>}
      </div>

      {draftsQuery.isError ? (
        <p className="mb-3 text-sm text-danger">기획안을 불러오지 못했습니다.</p>
      ) : null}

      {activeFolder ? (
        <DraftFolderHeading
          folder={activeFolder}
          onUpdate={async (id, name) => {
            const season = seasonMap.get(id)
            const updated = await updateSeason(id, {
              name,
              releaseTiming: '',
              status: season?.status,
            })
            await queryClient.invalidateQueries({ queryKey: ['seasons', updated.brandId] })
          }}
          onDelete={async (id) => {
            const season = seasonMap.get(id)
            await deleteSeason(id)
            if (folderFilter === id) setFolderFilter('all')
            if (season) {
              await queryClient.invalidateQueries({ queryKey: ['seasons', season.brandId] })
            }
          }}
        />
      ) : null}

      <div className="draft-board-scroll" role="region" aria-label="기획안 목록" tabIndex={0}>
        <table className="draft-board-table">
          <caption className="sr-only">기획안별 샘플, 상품 정보 및 MD 진행 현황</caption>
          <colgroup>{Array.from({ length: 6 }, (_, index) => <col key={index} />)}</colgroup>
          <thead>
            <tr>
              {(['BRAND', 'SAMPLE', 'PRICE', 'COLOR', 'INFORMATION'] as const).map(
                (label) => (
                  <th
                    key={label}
                    scope="col"
                  >
                    {label}
                  </th>
                ),
              )}
              <th
                scope="col"
              >
                MD TEAM
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="bg-white px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  불러오는 중...
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="bg-white px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage(
                    folderDrafts.length > 0,
                    folderFilter,
                    boardFilter,
                    brandScope,
                    ownerScope,
                  )}
                </td>
              </tr>
            ) : (
              visible.map((draft) => {
                const schedule = scheduleByDraft.get(draft.id)
                const brandId = schedule?.brandId ?? draft.brandId
                const brand = brandId ? brandById.get(brandId) : undefined
                return (
                  <DraftSheetRow
                    key={draft.id}
                    draft={draft}
                    readOnly={!canWriteDraft(workAccess.access,draft)}
                    schedule={schedule}
                    brand={brand}
                    onOpen={() => navigate(draftDetailPath(draft.id))}
                    onSchedule={() => setScheduleDraftId(draft.id)}
                    onAddColor={async (name) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        return {
                          ...input,
                          colors: [...input.colors, { ...newColorRow(), name }],
                        }
                      })
                    }}
                    onRenameProduct={async (field, name) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        const other = field === 'nameKo' ? current.nameEn.trim() : current.nameKo.trim()
                        if (!name && !other) {
                          throw new Error('상품 이름을 비울 수 없습니다.')
                        }
                        return { ...input, [field]: name }
                      })
                    }}
                    onSaveSheetValue={async (colorId, field, value, applyAll) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        const ids = applyAll
                          ? input.colors.map((color) => color.id)
                          : [colorId]
                        if (!ids.length || (!applyAll && !input.colors.some((color) => color.id === colorId))) {
                          throw new Error('컬러를 찾지 못했습니다.')
                        }
                        const stored = field === 'size' ? parseSizeSpecInput(value) : value.trim()
                        return {
                          ...input,
                          specs: writeColorSpec(input.specs, ids, field, stored),
                        }
                      })
                    }}
                    onUploadSampleWorkOrder={async (file) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        const sampleWorkOrders = attachSampleWorkOrderFile(
                          input.sampleWorkOrders,
                          file,
                        )
                        return {
                          ...input,
                          sampleWorkOrders,
                          ...legacyWorkOrderFields(sampleWorkOrders),
                        }
                      })
                    }}
                    onPassColorSample={async () => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        const rounds = resolveColorSampleRounds(current)
                        const next = passLatestColorSampleRound(rounds)
                        if (!next[next.length - 1]?.passed) {
                          throw new Error('돌아온 컬러 샘플만 합격할 수 있습니다.')
                        }
                        return {
                          ...input,
                          specs: { ...input.specs, colorSampleRounds: next },
                        }
                      })
                    }}
                    onRequestNextColorSampleRound={async (file) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        const rounds = resolveColorSampleRounds(current)
                        const before = rounds[rounds.length - 1]?.round
                        const published = publishNextColorSampleRound(input.colors, rounds, file)
                        const latest = published.rounds[published.rounds.length - 1]
                        if (!latest || latest.round === before) {
                          throw new Error('다음 차수로 넘기지 못했습니다.')
                        }
                        return {
                          ...input,
                          colors: published.colors,
                          specs: {
                            ...input.specs,
                            colorSampleRounds: published.rounds,
                          },
                        }
                      })
                    }}
                    onUploadColorWorkOrder={async (file) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        const colors = input.colors.length > 0 ? input.colors : [newColorRow()]
                        const requestedAt = new Date().toISOString()
                        return {
                          ...input,
                          specs: {
                            ...input.specs,
                            colorSampleRequestedAt: requestedAt,
                            colorSampleRounds: [
                              newColorSampleRound(1, file, requestedAt),
                            ],
                          },
                          colors: colors.map((color) => ({
                            ...color,
                            sampleWorkOrderUrl: file.url,
                            sampleWorkOrderName: file.name,
                            sampleWorkOrderShipped: false,
                            sampleWorkOrderShippedAt: null,
                            sampleInProgress: true,
                          })),
                        }
                      })
                    }}
                    onReceiveSample={async (id) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        return { ...input, sampleWorkOrders: receiveSample(input.sampleWorkOrders, id, input.originCountry) }
                      })
                    }}
                    onRequestNextSampleRound={async (file, country) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        const before = latestFilledSampleWorkOrder(input.sampleWorkOrders)?.round
                        const sampleWorkOrders = registerNextReceivedSample(input.sampleWorkOrders, file, country || input.originCountry, input.originCountry)
                        if (latestFilledSampleWorkOrder(sampleWorkOrders)?.round === before) {
                          throw new Error('다음 차수로 넘기지 못했습니다.')
                        }
                        return {
                          ...input,
                          sampleWorkOrders,
                          ...legacyWorkOrderFields(sampleWorkOrders),
                          sampleDone: false,
                          originCountry: country || input.originCountry,
                        }
                      })
                    }}
                    onPassSample={async () => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        if (!latestFilledSampleWorkOrder(input.sampleWorkOrders)?.receivedAt) throw new Error('실물 수령을 먼저 확인해 주세요.')
                        const sampleWorkOrders = setLatestSampleWorkOrderPassed(
                          input.sampleWorkOrders,
                          true,
                        )
                        if (!latestFilledSampleWorkOrder(sampleWorkOrders)?.passed) {
                          throw new Error('돌아온 샘플만 합격할 수 있습니다.')
                        }
                        return {
                          ...input,
                          sampleWorkOrders,
                          ...legacyWorkOrderFields(sampleWorkOrders),
                          sampleDone: true,
                          orderInProgress: false,
                        }
                      })
                    }}
                    onToggleConfirm={async (flag: DraftConfirmFlag, next) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        return {
                          ...input,
                          specs: { ...input.specs, [flag]: next },
                        }
                      })
                    }}
                    onRenameColor={async (colorId, name) => {
                      const next = name.trim()
                      if (!next) throw new Error('컬러 이름을 입력하세요.')
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        if (!input.colors.some((color) => color.id === colorId)) {
                          throw new Error('컬러를 찾지 못했습니다.')
                        }
                        return {
                          ...input,
                          colors: input.colors.map((color) =>
                            color.id === colorId ? { ...color, name: next } : color,
                          ),
                        }
                      })
                    }}
                  />
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <DraftReleaseScheduleDialog
        open={Boolean(scheduleDraft)}
        draft={scheduleDraft}
        draftLabel={
          scheduleDraft
            ? `${scheduleDraft.draftNo} · ${scheduleDraft.nameKo || scheduleDraft.nameEn || '이름 미정'}`
            : ''
        }
        brands={brands}
        groups={previewGroups}
        initial={scheduleDraftResolved}
        onClose={closeScheduleDialog}
        onApply={async (value) => {
          if (!scheduleDraft) return
          await applySchedule(scheduleDraft.id, value)
        }}
        onClear={async () => {
          if (!scheduleDraft) return
          await clearSchedule(scheduleDraft.id)
        }}
      />
    </div>
  )
}

function BrandStatCard({
  label,
  badge,
  total,
  pending,
  scheduled,
  selected,
  onSelect,
}: {
  label: string
  badge: Pick<Brand, 'name' | 'color' | 'logoUrl'>
  total: number
  pending: number
  scheduled: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={selected && label !== '전체' ? '다시 누르면 전체 브랜드' : label}
      onClick={onSelect}
      className={cn(
        'inline-flex min-w-[168px] items-center gap-2 rounded-full border bg-white px-1.5 py-1 text-left',
        selected
          ? 'border-foreground shadow-sm'
          : 'border-[#ead7c8] hover:border-[#d7c2ae]',
      )}
    >
      <BrandAvatar
        brand={badge}
        className="size-9 rounded-full text-[10px]"
        textClassName="text-[10px]"
      />
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold tracking-wide">
          {label}
        </span>
        <span className="mt-0.5 flex items-baseline gap-1.5 text-[10px] text-muted-foreground">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatNumber(total)}
          </span>
          <span className="tabular-nums">미정 {formatNumber(pending)}</span>
          <span className="tabular-nums">확정 {formatNumber(scheduled)}</span>
        </span>
      </span>
    </button>
  )
}

function BoardFilterChip({
  selected,
  onSelect,
  label,
  count,
}: {
  selected: boolean
  onSelect: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'rounded border px-2 py-1 text-[11px]',
        selected
          ? 'border-foreground bg-white font-semibold text-foreground'
          : 'border-border bg-white/70 text-muted-foreground hover:text-foreground',
      )}
    >
      {label}{' '}
      <span className="tabular-nums">{formatNumber(count)}</span>
    </button>
  )
}

export function DraftsPage() {
  return <CompanyDraftsPage />
}

export function AllDraftsPage() {
  return <CompanyDraftsPage />
}

export function SeasonDraftsPage() {
  return <CompanyDraftsPage />
}
