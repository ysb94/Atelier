import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addCodeUsageTargetAlias } from '@/lib/api'
import {
  matchesOutboundPartnerSearch,
  outboundPartnerUnitLabel,
} from '@/lib/codes/outbound-partner'
import type { BarcodeDataEntrySite } from '@/lib/outbound/barcode-outbound-data-entry'
import type { CodeUsageTarget } from '@/lib/types'
import { formatNumber } from '@/lib/utils'

export function BarcodeOutboundSiteResolutionDialog({
  brandId,
  brandSlug,
  companyName,
  sites,
  units,
  aliasesByTarget,
  onClose,
}: {
  brandId: string
  brandSlug: string
  companyName: string
  sites: readonly BarcodeDataEntrySite[]
  units: readonly CodeUsageTarget[]
  aliasesByTarget: ReadonlyMap<string, readonly string[]>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const activeUnits = useMemo(
    () =>
      units
        .filter((unit) => unit.active)
        .slice()
        .sort((left, right) =>
          outboundPartnerUnitLabel(left).localeCompare(
            outboundPartnerUnitLabel(right),
            'ko',
          ),
        ),
    [units],
  )
  const [targetByKey, setTargetByKey] = useState<Record<string, string>>({})
  const [searchByKey, setSearchByKey] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({})

  const unresolved = sites.filter((site) => site.status !== 'matched')

  async function resolveSite(site: BarcodeDataEntrySite) {
    if (savingKey || site.status !== 'unmatched') return
    const targetId = targetByKey[site.key] ?? ''
    setSavingKey(site.key)
    setErrorByKey((current) => ({ ...current, [site.key]: '' }))
    try {
      if (!targetId) throw new Error('연결할 지점을 고르세요.')
      const names = site.rawNames.length > 0 ? site.rawNames : [site.displayName]
      for (const name of names) {
        await addCodeUsageTargetAlias(brandId, targetId, name)
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['codeUsageTargets', brandId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['codeUsageTargetAliases', brandId],
        }),
      ])
    } catch (error) {
      setErrorByKey((current) => ({
        ...current,
        [site.key]:
          error instanceof Error ? error.message : '연결하지 못했습니다.',
      }))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        disabled={Boolean(savingKey)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-site-resolution-title"
        className="relative z-10 max-h-[min(90vh,840px)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="barcode-site-resolution-title"
                className="text-base font-semibold tracking-tight"
              >
                지점명 연결
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {companyName} 안의 지점에 붙여넣은 지점명을 연결해야 백업할 수
                있습니다. 연결 필요 {formatNumber(unresolved.length)}곳.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={Boolean(savingKey)}
              onClick={onClose}
            >
              닫기
            </Button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {unresolved.length === 0 ? (
            <p className="text-sm text-success">모든 지점명을 연결했습니다.</p>
          ) : null}

          {unresolved.map((site) => {
            const keyword = searchByKey[site.key] ?? ''
            const choices = activeUnits.filter((unit) =>
              matchesOutboundPartnerSearch(
                keyword,
                unit,
                aliasesByTarget.get(unit.id) ?? [],
              ),
            )
            return (
              <section
                key={site.key || 'empty'}
                className="space-y-3 rounded-lg border border-border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {site.displayName}
                      {site.rawNames.length > 1
                        ? ` · ${site.rawNames.slice(1).join(', ')}`
                        : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      원본 {formatNumber(site.rowCount)}행
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {site.status === 'empty'
                      ? '빈 값'
                      : site.status === 'inactive'
                        ? '비활성'
                        : '미등록'}
                  </span>
                </div>

                {site.status === 'empty' ? (
                  <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <p>
                      지점명이 비어 있습니다. 상품명·수량·지점명 세 칸으로
                      다시 붙여넣으세요.
                    </p>
                  </div>
                ) : null}

                {site.status === 'inactive' ? (
                  <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <p>
                      비활성 지점{' '}
                      <span className="font-medium">{site.officialName}</span>
                      과 같습니다.{' '}
                      <Link
                        to={`/b/${brandSlug}/settings/usage-targets`}
                        className="underline underline-offset-2"
                      >
                        출고업체 설정
                      </Link>
                      에서 다시 켠 뒤 이 화면을 새로고침하세요.
                    </p>
                  </div>
                ) : null}

                {site.status === 'unmatched' ? (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
                      <input
                        className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                        placeholder="지점 검색"
                        value={keyword}
                        onChange={(event) =>
                          setSearchByKey((current) => ({
                            ...current,
                            [site.key]: event.target.value,
                          }))
                        }
                      />
                      <select
                        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                        value={targetByKey[site.key] ?? ''}
                        onChange={(event) =>
                          setTargetByKey((current) => ({
                            ...current,
                            [site.key]: event.target.value,
                          }))
                        }
                      >
                        <option value="">지점을 고르세요</option>
                        {choices.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {outboundPartnerUnitLabel(unit)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {errorByKey[site.key] ? (
                      <p className="text-xs text-danger">{errorByKey[site.key]}</p>
                    ) : null}
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={Boolean(savingKey)}
                        onClick={() => void resolveSite(site)}
                      >
                        {savingKey === site.key ? '연결 중...' : '연결'}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
