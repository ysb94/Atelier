import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { SingleBrandOrList } from '@/components/layout/SingleBrandOrList'
import { CompanyUsageCodeList } from '@/features/workspace/company-operation-lists'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { UsageAssignedCodes } from '@/features/codes/UsageAssignedCodes'
import { UsageBulkUploadPanel } from '@/features/codes/UsageBulkUploadPanel'
import { UsageCodeFinder } from '@/features/codes/UsageCodeFinder'
import { UsageCodePartnersDialog } from '@/features/codes/UsageCodePartnersDialog'
import { UsagePartnerList } from '@/features/codes/UsagePartnerList'
import { UsageTargetManagerDialog } from '@/features/codes/UsageTargetManager'
import { useRenderWatch } from '@/lib/diagnostics/render-watch'
import {
  EMPTY_ASSIGNMENT_COUNTS,
  codeSearchText,
  countAssignmentsByTarget,
  mergeCodeUsageAssignments,
  planCodeUsageChanges,
} from '@/lib/codes/code-usage'
import { outboundPartnerDisplayName } from '@/lib/codes/outbound-partner'
import {
  getBarcodePartnerDisplaySetting,
  getCodeUsageAssignments,
  getCodeUsageTargetAliases,
  getCodeUsageTargetFolders,
  getCodeUsageTargets,
  getOutboundPartnerGroups,
  getProductCodes,
  getStylesByBrand,
  initializeBarcodePartnerDisplayTargets,
  replaceBarcodePartnerDisplayTargets,
  saveCodeUsageAssignments,
} from '@/lib/api'
import type {
  CodeUsageAssignment,
  CodeUsageAssignmentChange,
  CodeUsageStatus,
  CodeUsageTarget,
  CodeUsageTargetAlias,
  CodeUsageTargetFolder,
  OutboundPartnerGroup,
  ProductCode,
  Style,
} from '@/lib/types'
import { cn, emptyList } from '@/lib/utils'

function visibleTargetsKey(brandId: string) {
  return `atelier:usage-codes-target-ids:${brandId}`
}

/** null = 아직 설정 안 함(목록 비움). 빈 배열 = 의도적으로 없음. */
function readVisibleTargetIds(brandId: string): string[] | null {
  try {
    const raw = localStorage.getItem(visibleTargetsKey(brandId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return null
  }
}

function clearLocalVisibleTargetIds(brandId: string) {
  try {
    localStorage.removeItem(visibleTargetsKey(brandId))
  } catch {
    // 브라우저가 저장소를 막은 경우에는 다음 조회에서 다시 옮기면 된다.
  }
}

function UsagePartnerSettingsDialog({
  partners,
  initialIds,
  onClose,
  onSave,
}: {
  partners: CodeUsageTarget[]
  initialIds: Set<string>
  onClose: () => void
  onSave: (ids: string[]) => Promise<void>
}) {
  const [draft, setDraft] = useState(() => new Set(initialIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) {
    setDraft((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
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
        className="relative z-10 flex max-h-[min(80vh,36rem)] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">표시할 출고업체</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            88바코드를 쓰는 출고업체만 고릅니다. 여기서 켠 업체만 왼쪽 목록에
            나옵니다.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto px-3 py-3">
          {partners.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              등록된 출고업체가 없습니다. 출고업체 관리에서 먼저 추가하세요.
            </p>
          ) : (
            partners.map((partner) => {
              const checked = draft.has(partner.id)
              return (
                <label
                  key={partner.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                    checked
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-transparent hover:bg-muted/40',
                    !partner.active && 'opacity-60',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={checked}
                    onChange={() => toggle(partner.id)}
                  />
                  <span className="min-w-0 flex-1 break-words font-medium">
                    {outboundPartnerDisplayName(partner)}
                  </span>
                  {!partner.active ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      비활성
                    </span>
                  ) : null}
                </label>
              )
            })
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
            disabled={saving}
            onClick={() => {
              void (async () => {
                setSaving(true)
                setError(null)
                try {
                  await onSave(
                    partners
                      .filter((item) => draft.has(item.id))
                      .map((item) => item.id),
                  )
                  onClose()
                } catch (saveError) {
                  const message =
                    saveError instanceof Error
                      ? saveError.message
                      : '업체 설정을 저장하지 못했습니다.'
                  console.warn('[usage-codes] 업체 설정 저장 실패', {
                    message,
                  })
                  setError(message)
                } finally {
                  setSaving(false)
                }
              })()
            }}
          >
            {saving ? '저장 중...' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function UsageCodePage() {
  useRenderWatch('UsageCodePage')
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [finderOpen, setFinderOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dialogCodeId, setDialogCodeId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedTargetId(null)
    setBulkOpen(false)
    setDialogCodeId(null)
  }, [brand.id])

  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })
  const settingQueryKey = [
    'barcodePartnerDisplaySetting',
    brand.id,
    'own',
  ] as const
  const settingQuery = useQuery({
    queryKey: settingQueryKey,
    queryFn: async () => {
      const shared = await getBarcodePartnerDisplaySetting(brand.id, 'own')
      if (shared.configured) return shared

      const local = readVisibleTargetIds(brand.id)
      if (local == null) return shared

      await initializeBarcodePartnerDisplayTargets(brand.id, 'own', local)
      clearLocalVisibleTargetIds(brand.id)
      return getBarcodePartnerDisplaySetting(brand.id, 'own')
    },
  })
  const saveSettingMutation = useMutation({
    mutationFn: (ids: string[]) =>
      replaceBarcodePartnerDisplayTargets(brand.id, 'own', ids),
    onSuccess: async (_result, ids) => {
      queryClient.setQueryData(settingQueryKey, {
        configured: true,
        targetIds: ids,
      })
      clearLocalVisibleTargetIds(brand.id)
      await queryClient.invalidateQueries({ queryKey: settingQueryKey })
    },
  })
  const codesQuery = useQuery({
    queryKey: ['productCodes', brand.id, 'own'],
    queryFn: () => getProductCodes(brand.id, 'own'),
  })
  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'usage-codes'],
    queryFn: () => getStylesByBrand(brand.id),
  })
  const assignmentsKey = ['codeUsageAssignments', brand.id] as const
  const drawerAssignmentsKey = ['code-usage-assignments', brand.id] as const
  const assignmentsQuery = useQuery({
    queryKey: assignmentsKey,
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
  const groupsQuery = useQuery({
    queryKey: ['outboundPartnerGroups', brand.id],
    queryFn: () => getOutboundPartnerGroups(brand.id),
  })

  const targets = useMemo(
    () => targetsQuery.data ?? emptyList<CodeUsageTarget>(),
    [targetsQuery.data],
  )
  const aliases = useMemo(
    () => aliasesQuery.data ?? emptyList<CodeUsageTargetAlias>(),
    [aliasesQuery.data],
  )
  const folders = useMemo(
    () => foldersQuery.data ?? emptyList<CodeUsageTargetFolder>(),
    [foldersQuery.data],
  )
  const groups = useMemo(
    () => groupsQuery.data ?? emptyList<OutboundPartnerGroup>(),
    [groupsQuery.data],
  )
  const codes = useMemo(
    () => codesQuery.data ?? emptyList<ProductCode>(),
    [codesQuery.data],
  )
  const styles = useMemo(
    () => stylesQuery.data ?? emptyList<Style>(),
    [stylesQuery.data],
  )
  const assignments = useMemo(
    () => assignmentsQuery.data ?? emptyList<CodeUsageAssignment>(),
    [assignmentsQuery.data],
  )
  const visibleTargetIds = settingQuery.data?.configured
    ? settingQuery.data.targetIds
    : null

  const allPartners = useMemo(
    () =>
      [...targets].sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          left.order - right.order ||
          outboundPartnerDisplayName(left).localeCompare(
            outboundPartnerDisplayName(right),
            'ko',
          ),
      ),
    [targets],
  )

  const visibleTargets = useMemo(() => {
    if (visibleTargetIds == null) return emptyList<CodeUsageTarget>()
    const allowed = new Set(visibleTargetIds)
    return allPartners.filter((item) => allowed.has(item.id))
  }, [allPartners, visibleTargetIds])

  const settingsInitialIds = useMemo(() => {
    if (visibleTargetIds == null) return new Set<string>()
    return new Set(
      visibleTargetIds.filter((id) =>
        allPartners.some((partner) => partner.id === id),
      ),
    )
  }, [allPartners, visibleTargetIds])

  const configured = visibleTargetIds != null
  const codeMap = useMemo(
    () => new Map(codes.map((code) => [code.id, code])),
    [codes],
  )
  const styleNames = useMemo(
    () => new Map(styles.map((style) => [style.id, style.name])),
    [styles],
  )
  const searchTextById = useMemo(() => {
    const map = new Map<string, string>()
    for (const code of codes) map.set(code.id, codeSearchText(code, styleNames))
    return map
  }, [codes, styleNames])
  const countsByTarget = useMemo(
    () => countAssignmentsByTarget(assignments),
    [assignments],
  )
  const assignmentsByCode = useMemo(() => {
    const map = new Map<string, CodeUsageAssignment[]>()
    for (const row of assignments) {
      const list = map.get(row.productCodeId)
      if (list) list.push(row)
      else map.set(row.productCodeId, [row])
    }
    return map
  }, [assignments])

  const selectedTarget =
    visibleTargets.find((target) => target.id === selectedTargetId) ??
    visibleTargets.find((target) => target.active) ??
    visibleTargets[0] ??
    null

  const targetAssignments = useMemo(() => {
    if (!selectedTarget) return emptyList<CodeUsageAssignment>()
    return assignments.filter((row) => row.usageTargetId === selectedTarget.id)
  }, [assignments, selectedTarget])

  const existingByCodeId = useMemo(() => {
    const map = new Map<string, CodeUsageStatus>()
    for (const row of targetAssignments) map.set(row.productCodeId, row.status)
    return map
  }, [targetAssignments])

  const dialogCode = dialogCodeId ? codeMap.get(dialogCodeId) ?? null : null
  const dialogPartners = useMemo(() => {
    if (!dialogCode) return emptyList<CodeUsageTarget>()
    const ids = new Set(visibleTargets.map((target) => target.id))
    for (const row of assignmentsByCode.get(dialogCode.id) ?? []) {
      ids.add(row.usageTargetId)
    }
    return allPartners.filter((partner) => ids.has(partner.id))
  }, [allPartners, assignmentsByCode, dialogCode, visibleTargets])

  const refreshPartners = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: assignmentsKey }),
      queryClient.invalidateQueries({ queryKey: drawerAssignmentsKey }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargets', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargetAliases', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargetFolders', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['outboundPartnerGroups', brand.id],
      }),
    ])
  }

  const saveMutation = useMutation({
    mutationFn: (changes: CodeUsageAssignmentChange[]) =>
      saveCodeUsageAssignments(brand.id, changes),
    onSuccess: async (saved) => {
      queryClient.setQueryData<CodeUsageAssignment[]>(
        assignmentsKey,
        (current) =>
          mergeCodeUsageAssignments(
            current ?? emptyList<CodeUsageAssignment>(),
            saved,
          ),
      )
      setDialogCodeId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: assignmentsKey }),
        queryClient.invalidateQueries({ queryKey: drawerAssignmentsKey }),
      ])
    },
    onError: (error, changes) => {
      console.warn('[usage-codes] 연결 저장 실패', {
        brandId: brand.id,
        count: changes.length,
        message: error instanceof Error ? error.message : String(error),
      })
      void queryClient.invalidateQueries({ queryKey: assignmentsKey })
    },
  })

  const saveError = saveMutation.isError
    ? saveMutation.error instanceof Error
      ? saveMutation.error.message
      : '연결을 저장하지 못했습니다.'
    : null

  function saveChanges(changes: CodeUsageAssignmentChange[]) {
    const plan = planCodeUsageChanges(assignments, changes)
    if (plan.changes.length === 0) {
      setDialogCodeId(null)
      return
    }
    saveMutation.mutate(plan.changes)
  }

  function registerCodes(productCodeIds: string[]) {
    if (!selectedTarget) return
    saveChanges(
      productCodeIds.map((productCodeId) => ({
        productCodeId,
        usageTargetId: selectedTarget.id,
        status: 'active',
      })),
    )
  }

  function changeStatus(assignmentIds: string[], status: CodeUsageStatus) {
    const ids = new Set(assignmentIds)
    saveChanges(
      assignments
        .filter((row) => ids.has(row.id))
        .map((row) => ({
          productCodeId: row.productCodeId,
          usageTargetId: row.usageTargetId,
          status,
        })),
    )
  }

  return (
    <div>
      <PageHeader
        title="업체별 코드 관리"
        description="출고업체를 고르고, 그 업체가 사용하는 88코드를 등록·중지합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="size-3.5" />
              업체 설정
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setManagerOpen(true)}
            >
              출고업체 관리
            </Button>
          </div>
        }
      />

      <div
        role="tablist"
        aria-label="업체별 코드"
        className="mb-4 flex items-stretch gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border bg-muted/40 px-2 pt-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className="shrink-0 rounded-t-md border border-b-0 border-border bg-background px-3 py-1.5 text-sm text-foreground"
        >
          88코드
        </button>
      </div>

      {settingQuery.isError ? (
        <p className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {settingQuery.error instanceof Error
            ? settingQuery.error.message
            : '공용 업체 설정을 불러오지 못했습니다.'}
        </p>
      ) : null}
      {saveError ? (
        <p className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {saveError}
        </p>
      ) : null}

      <div className="grid items-stretch gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:h-[clamp(520px,calc(100vh-260px),900px)] xl:grid-cols-[220px_minmax(0,1fr)_minmax(280px,340px)]">
        <UsagePartnerList
          targets={visibleTargets}
          folders={folders}
          counts={countsByTarget}
          selectedId={selectedTarget?.id ?? null}
          loading={targetsQuery.isLoading || settingQuery.isLoading}
          configured={configured}
          hasPartners={allPartners.length > 0}
          onSelect={(targetId) => {
            setSelectedTargetId(targetId)
            setBulkOpen(false)
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenManager={() => setManagerOpen(true)}
        />
        <div className="flex min-h-0 min-w-0 flex-col gap-3 xl:contents">
          <div
            className={cn(
              'min-h-0',
              finderOpen ? 'block' : 'hidden',
              'xl:col-start-3 xl:row-start-1 xl:block',
            )}
          >
            <UsageCodeFinder
              targetLabel={
                selectedTarget ? outboundPartnerDisplayName(selectedTarget) : ''
              }
              usageTargetId={selectedTarget?.id ?? null}
              codes={codes}
              searchTextById={searchTextById}
              styleNames={styleNames}
              existingByCodeId={existingByCodeId}
              saving={saveMutation.isPending}
              canRegister={Boolean(selectedTarget)}
              onRegister={registerCodes}
            />
          </div>
          <div className="min-h-0 min-w-0 xl:col-start-2 xl:row-start-1 xl:h-full">
            <UsageAssignedCodes
              target={selectedTarget}
              configured={configured}
              hasPartners={allPartners.length > 0}
              assignments={targetAssignments}
              codeMap={codeMap}
              styleNames={styleNames}
              searchTextById={searchTextById}
              counts={
                selectedTarget
                  ? (countsByTarget.get(selectedTarget.id) ??
                    EMPTY_ASSIGNMENT_COUNTS)
                  : EMPTY_ASSIGNMENT_COUNTS
              }
              saving={saveMutation.isPending}
              bulkOpen={bulkOpen}
              finderOpen={finderOpen}
              onToggleFinder={() => setFinderOpen((current) => !current)}
              onToggleBulk={() => setBulkOpen((current) => !current)}
              onOpenCode={(code) => setDialogCodeId(code.id)}
              onChangeStatus={changeStatus}
              bulk={
                bulkOpen && selectedTarget ? (
                  <UsageBulkUploadPanel
                    brandName={brand.name}
                    brandId={brand.id}
                    usageTarget={selectedTarget}
                    codes={codes}
                    existingByCodeId={existingByCodeId}
                    onApplied={async () => {
                      setBulkOpen(false)
                      await Promise.all([
                        queryClient.invalidateQueries({
                          queryKey: assignmentsKey,
                        }),
                        queryClient.invalidateQueries({
                          queryKey: drawerAssignmentsKey,
                        }),
                      ])
                    }}
                    onClose={() => setBulkOpen(false)}
                  />
                ) : null
              }
            />
          </div>
        </div>
      </div>

      <UsageTargetManagerDialog
        open={managerOpen}
        brandId={brand.id}
        targets={targets}
        folders={folders}
        groups={groups}
        aliases={aliases}
        assignments={assignments}
        onClose={() => setManagerOpen(false)}
        onChanged={refreshPartners}
      />

      {settingsOpen ? (
        <UsagePartnerSettingsDialog
          partners={allPartners}
          initialIds={settingsInitialIds}
          onClose={() => setSettingsOpen(false)}
          onSave={async (ids) => {
            await saveSettingMutation.mutateAsync(ids)
            if (selectedTargetId && !ids.includes(selectedTargetId)) {
              setSelectedTargetId(null)
            }
          }}
        />
      ) : null}

      {dialogCode ? (
        <UsageCodePartnersDialog
          code={dialogCode}
          styleNames={styleNames}
          partners={dialogPartners}
          folders={folders}
          assignments={assignmentsByCode.get(dialogCode.id) ?? emptyList<CodeUsageAssignment>()}
          saving={saveMutation.isPending}
          error={saveError}
          onClose={() => setDialogCodeId(null)}
          onSave={saveChanges}
        />
      ) : null}
    </div>
  )
}

export function CompanyUsageCodePage() {
  return (
    <SingleBrandOrList list={<CompanyUsageCodeList />}>
      <UsageCodePage />
    </SingleBrandOrList>
  )
}
