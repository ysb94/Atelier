import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { Button } from '@/components/ui/button'
import { FilterTabs, type FilterTab } from '@/components/ui/filter-tabs'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow, tracedInput, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { createSeason, deleteSeason, getCompanyProductDrafts, getSeasonsByBrand, updateProductDraft, updateSeason } from '@/lib/api'
import {
  DEFAULT_COMPANY_ID,
  canViewDraftsByOwner,
} from '@/lib/company/capabilities'
import {
  DRAFT_NAMES_REQUIRED,
  UNASSIGNED_DRAFT_BRAND,
  UNASSIGNED_DRAFT_OWNER,
  countDesignerDevelopment,
  hasBothDraftNames,
  matchesDraftBrandScope,
  matchesDraftOwnerScope,
  type DraftBrandScope,
  type DraftOwnerScope,
} from '@/lib/drafts/company-draft'
import { receiveColorSample, resolveColorSampleRounds, setColorSampleDone } from '@/lib/drafts/draft-flow'
import { registerDraftSampleStage } from '@/lib/drafts/sample-registration'
import { draftToInput, attachSampleWorkOrderFile, latestFilledSampleWorkOrder, legacyWorkOrderFields } from '@/lib/drafts/sample-work-order'
import { normalizeDraftManualPrice } from '@/lib/drafts/manual-price'
import { receiveSample, registerNextReceivedSample } from '@/lib/drafts/sample-receipt'
import { reopenDraftInformation, writeColorSpec } from '@/lib/drafts/color-spec'
import { useAuth } from '@/lib/supabase/auth'
import { useBasicWorkAccess, canWriteDraft } from '@/lib/supabase/basic-work-access'
import { draftPriceError, type DraftPriceRequest } from '@/lib/supabase/draft-price-requests'
import { saveDraftColors, saveDraftReleaseFolder } from '@/lib/supabase/product-drafts'
import { saveSeasonOpening } from '@/lib/supabase/seasons'
import {
  type ProductDraft,
  type ProductDraftInput,
  type Season,
} from '@/lib/types'
import { combineListQueries, flattenListQueries } from '@/lib/query/list-queries'
import { draftDetailPath, draftNewPath } from '@/lib/workspace/company-paths'
import { cn, formatNumber, emptyList } from '@/lib/utils'
import { DraftBrandScopeBar, countScheduleRows } from './DraftBrandScopeBar'
import { DraftFolderBar, DraftFolderHeading } from './DraftFolderBar'
import { DraftFolderOpeningDate } from './DraftFolderOpeningDate'
import { useDraftFolderOrder } from './use-draft-folder-order'
import { matchesDraftFolder, UNASSIGNED_DRAFT_FOLDER_LABEL } from './draft-folder-filter'
import { DraftSheetRow, type DraftConfirmFlag } from './DraftSheetRow'
import { DraftBoardView } from './DraftBoardView'
import { useDraftSheetLayout } from './draft-sheet-layout'
import { useDraftPriceRequests } from './useDraftPriceRequests'
import { useDraftPriceDestinations } from './use-draft-price-destinations'
import { useDraftTeamWork } from './use-draft-team-work'
import { draftVisualBoardKey, useDraftVisualBoard } from './use-draft-visual-board'
import { useDraftSpecDocumentTemporary } from './use-draft-spec-document-temporary'
import {
  formatReleaseGroupLabel,
  isUnassignedReleaseFolder,
  resolveReleaseSchedule,
  seasonToPreviewGroup,
  type PreviewReleaseGroup,
} from './release-schedule-preview'

const designerSummaryYear = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric' })

type BoardFilter = 'all' | 'unassigned' | 'scheduled'
type FolderView = 'drafts' | 'completed'

const folderViewTabs: FilterTab<FolderView>[] = [
  { value: 'drafts', label: '기획안' },
  { value: 'completed', label: '완료 (0)' },
]

function emptyMessage(
  hasAny: boolean,
  myOnly: boolean,
  folderFilter: string,
  boardFilter: BoardFilter,
  brandScope: DraftBrandScope,
  ownerScope: DraftOwnerScope,
) {
  if (hasAny) return '조건에 맞는 기획안이 없습니다.'
  if (myOnly) return '내가 만든 기획안이 없습니다.'
  if (ownerScope === UNASSIGNED_DRAFT_OWNER) {
    return '담당 미정 기획안이 없습니다.'
  }
  if (ownerScope !== 'all') {
    return '이 담당자의 기획안이 없습니다.'
  }
  if (brandScope === UNASSIGNED_DRAFT_BRAND) {
    return '브랜드 미정 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
  }
  if (boardFilter === 'unassigned' || folderFilter === 'unassigned') {
    return '출시 미정인 기획안이 없습니다.'
  }
  if (boardFilter === 'scheduled') {
    return '출시 폴더가 지정된 기획안이 없습니다.'
  }
  if (folderFilter !== 'all') return '이 폴더에 담긴 기획안이 없습니다.'
  return '아직 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
}

export function CompanyDraftsPage() {
  useRenderWatch('CompanyDraftsPage')
  const { brands, brandById, loading: brandsLoading } = useCompanyBrandScope()
  const { profile, session } = useAuth()
  const workAccess = useBasicWorkAccess()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all')
  const [myOnly, setMyOnly] = useState(false)
  const [completedFolderId, setCompletedFolderId] = useState<string | null>(null)
  const folderParam = searchParams.get('folder')
  const requestedFolder = folderParam ?? searchParams.get('season') ?? 'all'
  const brandScope = (searchParams.get('scope') ?? 'all') as DraftBrandScope
  const canViewByOwner = canViewDraftsByOwner(profile)
  const ownerScope = (
    canViewByOwner ? (searchParams.get('owner') ?? 'all') : 'all'
  ) as DraftOwnerScope
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID
  const profileId = profile?.id
  const sheetLayout = useDraftSheetLayout(profileId)
  const brandIdBySlug = useMemo(
    () => new Map(brands.map((item) => [item.slug, item.id])),
    [brands],
  )

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })
  const prices = useDraftPriceRequests('planning')
  const priceDestinations = useDraftPriceDestinations(companyId, profileId,
    profile?.status === 'active' && profile.id === session?.user.id)
  const priceByDraft = useMemo(() => {
    const byDraft = new Map<string, { latest: DraftPriceRequest; reply?: DraftPriceRequest }>()
    for (const request of prices.requests) {
      const current = byDraft.get(request.draftId)
      const latest = !current || request.round > current.latest.round ? request : current.latest
      const reply = request.answeredAt && (!current?.reply || request.round > current.reply.round) ? request : current?.reply
      byDraft.set(request.draftId, { latest, reply })
    }
    return byDraft
  }, [prices.requests])
  const priceListError = prices.query.error ? draftPriceError(prices.query.error, '단가요청을 불러오지 못했습니다.') : ''
  const seasonQueries = useQueries({
    queries: brands.map((item) => ({
      queryKey: ['seasons', item.id] as const,
      queryFn: () => getSeasonsByBrand(item.id),
    })),
    // 기본 반환 배열은 매 렌더 새 참조라 아래 useMemo 가 매번 다시 돈다. list-queries.ts 참고.
    combine: combineListQueries<Season>,
  })

  const drafts = draftsQuery.data ?? emptyList<ProductDraft>()
  const designer = useMemo(() => profile && {
    name: profile.displayName?.trim() || '이름 미등록',
    ...countDesignerDevelopment(drafts, profile),
  }, [drafts, profile])
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

  function queueDraftSave(
    draftId: string,
    action: string,
    save: (current: ProductDraft, context: DiagnosticContext) => Promise<ProductDraft>,
  ) {
    const previous = saveChainRef.current.get(draftId) ?? Promise.resolve()
    // 앞선 저장 실패는 그 호출을 기다린 쪽에 이미 전달됐다. 다음 수정은 이어서 저장한다.
    const task = previous.catch(() => undefined).then(async () => {
      const trace = startWorkflow('app', action)
      try {
        trace.step('check_access')
        const current = currentDraft(draftId)
        if (!current) throw new Error('기획안을 찾지 못했습니다.')
        if (!canWriteDraft(workAccess.access,current)) throw new Error('작성자만 기획안을 수정할 수 있습니다.')
        trace.step('validate_input')
        const updated = await trace.run('save', (context) => save(current, context))
        await trace.run('refresh_queries', async () => {
          savedDraftRef.current.set(draftId, updated)
          queryClient.setQueryData<ProductDraft[]>(
            ['product-drafts', 'company', companyId],
            (current) =>
              current?.map((item) => (item.id === updated.id ? updated : item)),
          )
          await queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
          await queryClient.invalidateQueries({ queryKey: ['product-draft', draftId] })
        }, { writeOutcome: 'committed' })
        trace.done({ writeOutcome: 'committed' })
        return updated
      } catch (err) {
        trace.fail(err)
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

  function saveDraftChange(
    draftId: string,
    change: (current: ProductDraft) => ProductDraftInput,
    action = 'draft_save',
    temporaryInformationRevision?: string,
  ) {
    return queueDraftSave(draftId, action, (current, context) =>
      updateProductDraft(draftId, tracedInput(change(current), context), temporaryInformationRevision))
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
  const folderFilter = requestedFolder.toLowerCase() === 'unassigned' || isUnassignedReleaseFolder(seasonMap.get(requestedFolder))
    ? 'unassigned'
    : requestedFolder
  const releaseFoldersByBrand = useMemo(() => {
    const byBrand = new Map<string, Season[]>()
    for (const season of seasons) {
      if (isUnassignedReleaseFolder(season)) continue
      const folders = byBrand.get(season.brandId)
      if (folders) folders.push(season)
      else byBrand.set(season.brandId, [season])
    }
    return byBrand
  }, [seasons])
  const previewGroups = useMemo(() => {
    const byId = new Map<string, PreviewReleaseGroup>()
    for (const season of seasons) {
      if (!isUnassignedReleaseFolder(season)) byId.set(season.id, seasonToPreviewGroup(season))
    }
    return [...byId.values()]
  }, [seasons])

  const ownerAllDrafts = useMemo(
    () =>
      drafts.filter((draft) =>
        matchesDraftOwnerScope(draft.owner, ownerScope) &&
        (!myOnly || (profileId != null && draft.createdBy === profileId)),
      ),
    [drafts, myOnly, ownerScope, profileId],
  )

  const ownerDrafts = useMemo(
    () =>
      ownerAllDrafts.filter((draft) =>
        matchesDraftBrandScope(draft.brandId, brandScope, brandIdBySlug),
      ),
    [brandIdBySlug, brandScope, ownerAllDrafts],
  )

  const scopedBrand =
    brandScope !== 'all' && brandScope !== UNASSIGNED_DRAFT_BRAND
      ? brands.find((item) => item.slug === brandScope)
      : undefined
  const folderOrder = useDraftFolderOrder(scopedBrand?.id,
    profile?.status === 'active' && profile.id === session?.user.id ? profile.id : undefined, companyId)
  const canReorderFolders = Boolean(scopedBrand &&
    (workAccess.access?.legacyEdit || workAccess.access?.operator || canWriteDraft(workAccess.access, null, scopedBrand.id)))

  const scheduleByDraft = useMemo(() => {
    const map = new Map(
      ownerAllDrafts.map((draft) => [
        draft.id,
        resolveReleaseSchedule(draft, seasonMap, [], {}),
      ]),
    )
    return map
  }, [ownerAllDrafts, seasonMap])

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
    const items = previewGroups
      .filter(group => matchesDraftBrandScope(group.brandId, brandScope, brandIdBySlug))
      .map(group => {
        return {
          id: group.id,
          label: formatReleaseGroupLabel(group),
          brandId: group.brandId,
          brandName: scopedBrand ? undefined : brandById.get(group.brandId)?.name,
          name: group.name,
          total: counts.get(group.id) ?? 0,
          editable: seasonMap.has(group.id),
        }
      })
    if (!folderOrder.ids?.length) return items
    const ranks = new Map(folderOrder.ids.map((id, index) => [id, index]))
    return items.sort((a, b) => (ranks.get(a.id) ?? ranks.size) - (ranks.get(b.id) ?? ranks.size))
  }, [ownerDrafts, scheduleByDraft, previewGroups, brandScope, brandIdBySlug, scopedBrand, brandById, seasonMap, folderOrder.ids])
  const selectedFolderIds = folderFilter === 'all' || folderFilter === 'unassigned'
    ? [folderFilter]
    : folderItems.filter(folder => matchesDraftFolder(folder.id, folderFilter, !folderParam ? seasonMap.get(folder.id)?.code : undefined)).map(folder => folder.id)
  const activeFolder = folderFilter === 'all' || folderFilter === 'unassigned'
    ? null
    : folderItems.find((folder) => selectedFolderIds.includes(folder.id)) ?? null
  const showingCompleted = activeFolder !== null && activeFolder.id === completedFolderId
  const unassignedFolderCount = ownerDrafts.filter(draft =>
    matchesDraftFolder(scheduleByDraft.get(draft.id)?.group?.id, 'unassigned'),
  ).length

  const sheetCounts = useMemo(() => {
    let pending = 0
    let scheduled = 0
    let planningOpen = 0
    let mdOpen = 0
    for (const draft of folderDrafts) {
      const schedule = scheduleByDraft.get(draft.id)
      if (schedule?.group) scheduled += 1
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
      const scheduled = Boolean(scheduleByDraft.get(draft.id)?.group)
      if (boardFilter === 'unassigned' && scheduled) return false
      if (boardFilter === 'scheduled' && !scheduled) return false
      return true
    })
  }, [boardFilter, folderDrafts, scheduleByDraft])
  const teamWork = useDraftTeamWork(profileId, visible, !showingCompleted)
  const visualBoard = useDraftVisualBoard(profileId, visible, !showingCompleted)
  const editableVisible = useMemo(() => showingCompleted ? [] : visible.filter(draft => canWriteDraft(workAccess.access, draft)),
    [showingCompleted, visible, workAccess.access])
  const specDocumentTemporarySources = useDraftSpecDocumentTemporary(profileId, editableVisible)

  const loading =
    draftsQuery.isLoading || seasonQueries.loading

  const scopedFolderPending = (brandsLoading || seasonQueries.loading) && brandScope !== 'all' && brandScope !== UNASSIGNED_DRAFT_BRAND
    && (!scopedBrand || (folderFilter !== 'all' && folderFilter !== 'unassigned' && !activeFolder))
  function newDraftHref(entry: string | null = null) {
    return draftNewPath(scopedBrand?.slug, {
      season: scopedBrand ? activeFolder?.id ?? (folderFilter === 'unassigned' ? 'none' : null) : null,
      scope: brandScope === UNASSIGNED_DRAFT_BRAND ? UNASSIGNED_DRAFT_BRAND : null,
      entry,
    })
  }

  function setFolderFilter(value: string) {
    setBoardFilter('all')
    setCompletedFolderId(null)
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
    setCompletedFolderId(null)
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

  async function changeReleaseFolder(draft: ProductDraft, seasonId: string | null) {
    await queueDraftSave(draft.id, 'draft_save_release_folder', (current, context) => {
      if (!current.brandId || current.brandId !== draft.brandId) {
        throw new Error('기획안의 브랜드를 다시 확인해 주세요.')
      }
      const folder = seasonId ? seasonMap.get(seasonId) : undefined
      if (seasonId && (folder?.brandId !== current.brandId || isUnassignedReleaseFolder(folder))) {
        throw new Error('해당 브랜드의 출시 폴더를 다시 선택해 주세요.')
      }
      return saveDraftReleaseFolder(current, seasonId, context)
    })
  }

  return (
    <div>
      <DraftBrandScopeBar
        brandScope={brandScope}
        allScopeCounts={allScopeCounts}
        brandCards={brandCards}
        unassignedScopeCounts={unassignedScopeCounts}
        onSelect={setBrandScope}
        unassignedFirst
      />

      <div className="mb-3 border-b border-border pb-2">
        <div className="mb-1 flex flex-wrap gap-x-3 text-[11px] leading-4 text-warning">
          <span>미확정 : 기획 {formatNumber(sheetCounts.planningOpen)}건</span>
          <span>미확정 : MD {formatNumber(sheetCounts.mdOpen)}건</span>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 lg:flex-row lg:items-start lg:gap-4 xl:gap-6">
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {brandScope === 'all' && (
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="기획안 출시 필터">
                <BoardFilterChip
                  selected={boardFilter === 'all'}
                  onSelect={() => setBoardFilter('all')}
                  label="전체"
                  count={sheetCounts.total}
                />
                <BoardFilterChip
                  selected={boardFilter === 'unassigned'}
                  onSelect={() => setBoardFilter('unassigned')}
                  label={UNASSIGNED_DRAFT_FOLDER_LABEL}
                  count={sheetCounts.pending}
                />
                <BoardFilterChip
                  selected={boardFilter === 'scheduled'}
                  onSelect={() => setBoardFilter('scheduled')}
                  label="출시 확정"
                  count={sheetCounts.scheduled}
                />
              </div>
            )}
            <label className="ml-1 inline-flex h-7 cursor-pointer items-center gap-1.5 px-1 text-xs font-medium">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={myOnly}
                disabled={!profileId}
                onChange={(event) => setMyOnly(event.currentTarget.checked)}
              />
              my<span className="sr-only"> 내가 만든 기획안만 보기</span>
            </label>
          </div>
          {brandScope !== 'all' && (
            <DraftFolderBar
              key={scopedBrand?.id ?? brandScope}
              folders={folderItems}
              brands={brands.map((brand) => ({ id: brand.id, name: brand.name }))}
              defaultBrandId={scopedBrand?.id}
              selectedIds={selectedFolderIds}
              unassignedCount={unassignedFolderCount}
              onSelect={setFolderFilter}
              onReorder={canReorderFolders && folderOrder.ready ? folderOrder.reorder : undefined}
              reordering={folderOrder.isPending}
              orderError={canReorderFolders ? folderOrder.error : ''}
              onCreate={async (value) => {
                await createSeason(value.brandId, {
                  name: value.name,
                  releaseTiming: '',
                })
                await queryClient.invalidateQueries({ queryKey: ['seasons', value.brandId] })
              }}
            />
          )}
          {!scopedFolderPending && canWriteDraft(workAccess.access) && <Link
            to={newDraftHref()}
            onClick={event => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
              event.preventDefault()
              // The workspace keeps this tab alive. A deliberate new draft starts a new form.
              navigate(newDraftHref(crypto.randomUUID()))
            }}
            className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 self-end rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 lg:self-start"
          >
            <Plus className="size-3" aria-hidden="true" />
            기획안 추가
          </Link>}
        </div>
        {designer && (
          <div aria-label="내 상품 개발 현황" role="group" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-1 text-xs text-muted-foreground">
            <p>{designerSummaryYear.format(new Date())} 디자이너 <strong className="font-semibold text-foreground">{designer.name}</strong></p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 sm:border-l sm:border-border sm:pl-4">
              <span>개발 중 <strong className="font-semibold tabular-nums text-foreground">{draftsQuery.data ? `${formatNumber(designer.inProgress)}건` : '—'}</strong></span>
              <span>개발 완료 <strong className="font-semibold tabular-nums text-foreground">{draftsQuery.data ? `${formatNumber(designer.completed)}건` : '—'}</strong></span>
            </p>
            <p className="sm:border-l sm:border-border sm:pl-4">기여 매출 <strong className="font-semibold tabular-nums text-foreground">0원</strong></p>
          </div>
        )}
      </div>

      {draftsQuery.isError ? (
        <p className="mb-3 text-sm text-danger">기획안을 불러오지 못했습니다.</p>
      ) : null}

      <DraftBoardView
        key={profileId}
        accountId={profileId}
        layout={sheetLayout}
        label={showingCompleted ? '완료된 기획안 목록' : '기획안 목록'}
        emptyMessage={showingCompleted ? '이 폴더에 완료된 기획안이 없습니다.'
          : loading ? '불러오는 중...'
          : visible.length === 0 ? emptyMessage(folderDrafts.length > 0, myOnly, folderFilter, boardFilter, brandScope, ownerScope)
          : undefined}
        folderControls={activeFolder ? <>
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
          <FilterTabs
            size="compact"
            tabs={folderViewTabs}
            value={showingCompleted ? 'completed' : 'drafts'}
            onChange={(view) => setCompletedFolderId(view === 'completed' ? activeFolder.id : null)}
            ariaLabel={`${activeFolder.label} 목록 보기`}
          />
          <DraftFolderOpeningDate
            key={`${profileId}:${activeFolder.id}`}
            opening={seasonMap.get(activeFolder.id)?.opening}
            editable={Boolean(workAccess.access?.legacyEdit || workAccess.access?.operator || canWriteDraft(workAccess.access, null, activeFolder.brandId))}
            onSave={async (next, expected) => {
              const queryKey = ['seasons', activeFolder.brandId] as const
              try {
                const opening = await saveSeasonOpening(activeFolder.id, activeFolder.brandId, next, expected)
                await queryClient.cancelQueries({ queryKey })
                queryClient.setQueryData<Season[]>(queryKey, current => current?.map(season => season.id === activeFolder.id ? { ...season, opening } : season))
              } finally {
                await queryClient.invalidateQueries({ queryKey })
              }
            }}
          />
        </> : null}
        tableNotice={!showingCompleted && <>
          {teamWork.query.isError && <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <p role="status" className="text-muted-foreground">{teamWork.missingSchema
              ? 'AMD·MD 저장 기능은 공유 DB 적용 후 사용할 수 있습니다.' : 'AMD·MD 저장 정보를 불러오지 못했습니다.'}</p>
            <Button type="button" size="sm" variant="outline" disabled={teamWork.query.isFetching}
              onClick={() => { void teamWork.query.refetch() }}>AMD·MD 다시 조회</Button>
          </div>}
          {visualBoard.query.isError && <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <p role="status" className="text-muted-foreground">Visual 팀 저장 상태와 담당자를 불러오지 못했습니다.</p>
            <Button type="button" size="sm" variant="outline" disabled={visualBoard.query.isFetching}
              onClick={() => { void visualBoard.query.refetch() }}>Visual 다시 조회</Button>
          </div>}
        </>}
        renderRows={mode => visible.map(draft => {
                const brand = draft.brandId ? brandById.get(draft.brandId) : undefined
                const price = priceByDraft.get(draft.id)
                return (
                  <DraftSheetRow
                    key={draft.id}
                    mode={mode}
                    layout={sheetLayout}
                    draft={draft}
                    teamWork={teamWork.forDraft(draft.id)}
                    visualBoard={visualBoard.forDraft(draft.id)}
                    readOnly={!canWriteDraft(workAccess.access,draft)}
                    informationEditorId={profile?.id}
                    specDocumentTemporarySource={specDocumentTemporarySources.get(draft.id)}
                    brand={brand}
                    releaseFolders={(draft.brandId && releaseFoldersByBrand.get(draft.brandId)) || emptyList<Season>()}
                    onChangeReleaseFolder={(seasonId) => changeReleaseFolder(draft, seasonId)}
                    price={{
                      ...price, loading: prices.query.isPending, error: priceListError,
                      retry: () => { void prices.query.refetch() },
                      destinations: {
                        ...priceDestinations,
                        add: name => priceDestinations.add(draft.id, name),
                        change: (option, name) => priceDestinations.change(draft.id, option, name),
                      },
                      request: () => prices.change({
                        action: 'request', draftId: draft.id, revision: currentDraft(draft.id)?.updatedAt ?? draft.updatedAt, previousId: price?.latest.id ?? null,
                      }),
                      saveManual: async (record) => {
                        await saveDraftChange(draft.id, (current) => {
                          const manualPrice = normalizeDraftManualPrice({ ...record, savedAt: new Date().toISOString() })
                          if (!manualPrice || current.colors.length !== Object.keys(manualPrice.amounts).length ||
                            current.colors.some(color => !Object.hasOwn(manualPrice.amounts, color.id))) {
                            throw new Error('현재 컬러와 입력한 단가를 다시 확인해 주세요.')
                          }
                          const input = draftToInput(current)
                          return { ...input, specs: { ...input.specs, manualPrice } }
                        }, 'draft_price_manual_save')
                      },
                      confirm: async (reply) => {
                        await saveDraftChange(draft.id, (current) => {
                          const amounts = reply.amounts
                          if (reply.id !== price?.latest.id || !reply.answeredAt || !amounts) {
                            throw new Error('최신 회신을 다시 확인해 주세요.')
                          }
                          if (current.colors.length === 0 || current.colors.length !== Object.keys(amounts).length ||
                            current.colors.some(color => !Object.hasOwn(amounts, color.id))) {
                            throw new Error('컬러 구성이 변경됐습니다. 현재 컬러로 단가를 다시 요청해 주세요.')
                          }
                          const input = draftToInput(current)
                          return { ...input, specs: { ...input.specs, confirmedPriceRequestId: reply.id } }
                        }, 'draft_price_confirm')
                      },
                    }}
                    onOpen={() => navigate(draftDetailPath(draft.id))}
                    onNextSample={() => navigate(`${draftDetailPath(draft.id)}#next-sample`)}
                    onSaveColors={async (rows, revision) => {
                      await queueDraftSave(draft.id, 'draft_save_colors', (current, context) =>
                        saveDraftColors(current, rows, revision, context))
                      if (rows.length !== draft.colors.length || rows.some(row => row.photoChange)) {
                        await Promise.all([
                          queryClient.invalidateQueries({ queryKey: draftVisualBoardKey(profileId) }),
                          queryClient.invalidateQueries({ queryKey: ['draft-visual-content', profileId, draft.id] }),
                        ])
                      }
                    }}
                    onSharedPhotoChange={async () => {
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ['product-drafts'] }),
                        queryClient.invalidateQueries({ queryKey: ['product-draft', draft.id] }),
                      ])
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
                    onSaveSheetValue={async (colorId, changes, applyAll, field, temporaryRevision) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        if (!input.colors.some((color) => color.id === colorId)) {
                          throw new Error('컬러를 찾지 못했습니다.')
                        }
                        if (applyAll && input.colors[0]?.id !== colorId) {
                          throw new Error('컬러 순서가 변경됐습니다. 맨 위 컬러를 확인하고 다시 적용해 주세요.')
                        }
                        const ids = applyAll ? input.colors.map(color => color.id) : [colorId]
                        return {
                          ...input,
                          specs: writeColorSpec(input.specs, ids, changes, field, !applyAll),
                        }
                      }, 'draft_information_save', temporaryRevision)
                    }}
                    onSaveSpecDocument={async (value, temporaryRevision) => {
                      await saveDraftChange(draft.id, current => {
                        const input = draftToInput(current)
                        return { ...input, specs: { ...input.specs, specDocumentConfirmed: true, coating: { ...input.specs.coating, note: value } } }
                      }, 'draft_information_save', temporaryRevision)
                    }}
                    onReopenInformation={async (field, colorId) => {
                      await saveDraftChange(draft.id, current => {
                        if (field !== 'specDoc' && !current.colors.some(color => color.id === colorId)) {
                          throw new Error('컬러를 찾지 못했습니다.')
                        }
                        const input = draftToInput(current)
                        return { ...input, specs: reopenDraftInformation(input.specs, field, colorId) }
                      }, 'draft_information_save')
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
                    onReceiveColorSample={async (id) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        return { ...input, specs: { ...input.specs, colorSampleRounds: receiveColorSample(resolveColorSampleRounds(input), id, input.originCountry) } }
                      })
                    }}
                    onSetColorSampleDone={(colorId, done) => {
                      const current = currentDraft(draft.id)
                      if (!current) return Promise.reject(new Error('기획안을 찾지 못했습니다.'))
                      const latest = resolveColorSampleRounds(current).at(-1)
                      if (!latest?.receivedAt) return Promise.reject(new Error('컬러샘플을 수령 확인한 뒤에 완료로 바꿀 수 있습니다.'))
                      const optimistic: ProductDraft = {
                        ...current,
                        specs: { ...current.specs, colorSampleDone: setColorSampleDone(current.specs.colorSampleDone, latest.id, colorId, done) },
                      }
                      queryClient.setQueryData<ProductDraft[]>(['product-drafts', 'company', companyId], list => list?.map(item => item.id === draft.id ? optimistic : item))
                      return saveDraftChange(draft.id, (base) => {
                        const next = draftToInput(base)
                        const round = resolveColorSampleRounds(next).at(-1)
                        if (!round?.receivedAt) throw new Error('컬러샘플을 수령 확인한 뒤에 완료로 바꿀 수 있습니다.')
                        return { ...next, specs: { ...next.specs, colorSampleDone: setColorSampleDone(next.specs.colorSampleDone, round.id, colorId, done) } }
                      }).then(() => undefined).catch((error: unknown) => {
                        queryClient.setQueryData<ProductDraft[]>(['product-drafts', 'company', companyId], list => list?.map(item => {
                          if (item.id !== draft.id) return item
                          const round = resolveColorSampleRounds(item).at(-1)
                          if (!round) return item
                          const marked = (item.specs.colorSampleDone?.[round.id] ?? []).includes(colorId)
                          if (marked !== done) return item
                          return { ...item, specs: { ...item.specs, colorSampleDone: setColorSampleDone(item.specs.colorSampleDone, round.id, colorId, !done) } }
                        }))
                        throw error
                      })
                    }}
                    onUploadColorWorkOrder={async (file) => {
                      await saveDraftChange(draft.id, (current) => {
                        const input = draftToInput(current)
                        return registerDraftSampleStage(input, 'color', file, input.originCountry)
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
                          originCountry: country || input.originCountry,
                        }
                      })
                    }}
                    onToggleConfirm={async (flag: DraftConfirmFlag, next) => {
                      await saveDraftChange(draft.id, (current) => {
                        if (flag === 'nameConfirmed' && next && !hasBothDraftNames(current)) throw new Error(DRAFT_NAMES_REQUIRED)
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
        })}
      />

    </div>
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
    <Button
      variant="outline"
      size="sm"
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'h-7 gap-1 rounded-sm px-1.5 text-[13px]! font-semibold! leading-none! shadow-none',
        selected
          ? 'border-primary/45 text-primary hover:border-primary/65 hover:bg-primary/5'
          : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
      )}
    >
      {label}{' '}
      <span className="tabular-nums">{formatNumber(count)}</span>
    </Button>
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
