import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Settings2 } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PartnerCodeListPanel } from '@/features/codes/PartnerCodeListPanel'
import { getCodeUsageTargets } from '@/lib/api'
import type { CodeUsageTarget } from '@/lib/types'
import { cn } from '@/lib/utils'

function storageKey(brandId: string) {
  return `atelier:partner-codes-target-ids:${brandId}`
}

/** null = 아직 설정 안 함(목록 비움). 빈 배열 = 의도적으로 없음. */
function readEnabledTargetIds(brandId: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey(brandId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return null
  }
}

function writeEnabledTargetIds(brandId: string, ids: string[]) {
  localStorage.setItem(storageKey(brandId), JSON.stringify(ids))
}

function PartnerSettingsDialog({
  partners,
  initialIds,
  onClose,
  onSave,
}: {
  partners: CodeUsageTarget[]
  initialIds: Set<string>
  onClose: () => void
  onSave: (ids: string[]) => void
}) {
  const [draft, setDraft] = useState(() => new Set(initialIds))

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
          <h2 className="text-base font-semibold">거래처 코드 업체 설정</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            자사 88코드를 안 쓰거나 못 쓰는 출고업체만 고릅니다. 여기서 켠
            업체만 위 목록에 나옵니다.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto px-3 py-3">
          {partners.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              등록된 출고업체가 없습니다. 출고업체별 바코드의 업체 관리에서 먼저
              추가하세요.
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
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {partner.name}
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
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onSave(
                partners
                  .filter((item) => draft.has(item.id))
                  .map((item) => item.id),
              )
              onClose()
            }}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}

export function PartnerCodePage() {
  const { brand } = useBrand()
  const [enabledTargetIds, setEnabledTargetIds] = useState<string[] | null>(
    () => readEnabledTargetIds(brand.id),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)

  useEffect(() => {
    setEnabledTargetIds(readEnabledTargetIds(brand.id))
    setSelectedTargetId(null)
  }, [brand.id])

  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })

  const allPartners = useMemo(
    () =>
      (targetsQuery.data ?? []).sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          left.order - right.order ||
          left.name.localeCompare(right.name, 'ko'),
      ),
    [targetsQuery.data],
  )

  const visiblePartners = useMemo(() => {
    if (enabledTargetIds == null) return []
    const allowed = new Set(enabledTargetIds)
    return allPartners.filter((item) => allowed.has(item.id))
  }, [allPartners, enabledTargetIds])

  const settingsInitialIds = useMemo(() => {
    if (enabledTargetIds == null) return new Set<string>()
    return new Set(
      enabledTargetIds.filter((id) =>
        allPartners.some((partner) => partner.id === id),
      ),
    )
  }, [allPartners, enabledTargetIds])

  const selectedTarget =
    visiblePartners.find((item) => item.id === selectedTargetId) ??
    visiblePartners[0] ??
    null

  const configured = enabledTargetIds != null

  return (
    <div>
      <PageHeader
        title="거래처 코드"
        description="자사 88바코드를 안 쓰는 업체의 바코드 리스트입니다. 표시할 업체는 설정에서 고릅니다."
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-3.5" />
            업체 설정
          </Button>
        }
      />

      <div className="space-y-4">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            미사용 업체
          </div>
          {targetsQuery.isLoading ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              불러오는 중...
            </p>
          ) : !configured ? (
            <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                아직 업체를 고르지 않았습니다.
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
          ) : visiblePartners.length === 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                선택된 업체가 없습니다.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSettingsOpen(true)}
              >
                <Plus className="size-3.5" />
                업체 추가
              </Button>
            </div>
          ) : (
            <div className="flex gap-1 overflow-x-auto p-2">
              {visiblePartners.map((target) => {
                const active = selectedTarget?.id === target.id
                return (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => setSelectedTargetId(target.id)}
                    className={cn(
                      'shrink-0 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted',
                      !target.active && !active && 'opacity-60',
                    )}
                  >
                    <span className="block max-w-[12rem] truncate font-medium">
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
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        <div className="min-w-0">
          {!selectedTarget ? (
            <Card>
              <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
                {!configured
                  ? '업체 설정에서 자사 바코드를 안 쓰는 업체를 먼저 골라 주세요.'
                  : '위에서 업체를 선택하세요.'}
              </CardContent>
            </Card>
          ) : (
            <PartnerCodeListPanel
              brandId={brand.id}
              partner={selectedTarget}
            />
          )}
        </div>
      </div>

      {settingsOpen ? (
        <PartnerSettingsDialog
          partners={allPartners}
          initialIds={settingsInitialIds}
          onClose={() => setSettingsOpen(false)}
          onSave={(ids) => {
            writeEnabledTargetIds(brand.id, ids)
            setEnabledTargetIds(ids)
            if (
              selectedTargetId &&
              !ids.includes(selectedTargetId)
            ) {
              setSelectedTargetId(null)
            }
          }}
        />
      ) : null}
    </div>
  )
}
