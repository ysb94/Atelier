import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  addCodeUsageTargetAlias,
  saveCodeUsageTarget,
} from '@/lib/api'
import {
  findDefaultSabangnetFolderId,
  folderMoveOptions,
} from '@/lib/codes/outbound-folder'
import {
  compactOutboundPartnerKey,
  matchesOutboundPartnerSearch,
  normalizeOutboundPartnerName,
} from '@/lib/codes/outbound-partner'
import type { InvoiceMallSite } from '@/lib/invoice/mall-resolution'
import type {
  CodeUsageTarget,
  CodeUsageTargetAlias,
  CodeUsageTargetFolder,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'

type SiteDraft = {
  mode: 'existing' | 'create'
  targetId: string
  name: string
  folderId: string | null
}

function defaultDraft(
  site: InvoiceMallSite,
  folderId: string | null,
): SiteDraft {
  return {
    mode: 'existing',
    targetId: '',
    name: site.displayName === '(빈 값)' ? '' : site.displayName,
    folderId,
  }
}

export function InvoiceMallResolutionDialog({
  brandId,
  brandSlug,
  sites,
  targets,
  aliases,
  folders,
  onClose,
}: {
  brandId: string
  brandSlug: string
  sites: InvoiceMallSite[]
  targets: readonly CodeUsageTarget[]
  aliases: readonly CodeUsageTargetAlias[]
  folders: readonly CodeUsageTargetFolder[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const defaultFolderId = useMemo(
    () => findDefaultSabangnetFolderId(folders),
    [folders],
  )
  const folderOptions = useMemo(() => folderMoveOptions(folders), [folders])
  const activeTargets = useMemo(
    () =>
      targets
        .filter((target) => target.active)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [targets],
  )
  const aliasesByTarget = useMemo(() => {
    const map = new Map<string, string[]>()
    aliases.forEach((alias) => {
      const list = map.get(alias.targetId) ?? []
      list.push(alias.alias)
      map.set(alias.targetId, list)
    })
    return map
  }, [aliases])

  const [drafts, setDrafts] = useState<Record<string, SiteDraft>>({})
  const [searchByKey, setSearchByKey] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({})

  const unresolved = sites.filter((site) => site.status !== 'matched')

  function draftOf(site: InvoiceMallSite): SiteDraft {
    return drafts[site.key] ?? defaultDraft(site, defaultFolderId)
  }

  function patchDraft(key: string, patch: Partial<SiteDraft>) {
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? defaultDraft(
          sites.find((site) => site.key === key) ?? {
            key,
            rawNames: [],
            displayName: '',
            rowCount: 0,
            status: 'unmatched',
            usageTargetId: null,
            officialName: null,
          },
          defaultFolderId,
        )),
        ...patch,
      },
    }))
  }

  async function invalidatePartners() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['codeUsageTargets', brandId] }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargetAliases', brandId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargetFolders', brandId],
      }),
    ])
  }

  async function resolveSite(site: InvoiceMallSite) {
    if (savingKey || site.status !== 'unmatched') return
    const draft = draftOf(site)
    setSavingKey(site.key)
    setErrorByKey((current) => ({ ...current, [site.key]: '' }))
    try {
      if (draft.mode === 'existing') {
        if (!draft.targetId) {
          throw new Error('연결할 출고업체를 고르세요.')
        }
        const names =
          site.rawNames.length > 0 ? site.rawNames : [site.displayName]
        for (const name of names) {
          await addCodeUsageTargetAlias(brandId, draft.targetId, name)
        }
      } else {
        const name = normalizeOutboundPartnerName(draft.name)
        if (!name) throw new Error('업체 이름을 입력하세요.')
        const extra = site.rawNames.filter(
          (raw) =>
            compactOutboundPartnerKey(raw) !== compactOutboundPartnerKey(name),
        )
        await saveCodeUsageTarget(brandId, {
          name,
          folderId: draft.folderId,
          aliases: extra,
        })
      }
      await invalidatePartners()
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
        aria-labelledby="invoice-mall-resolution-title"
        className="relative z-10 max-h-[min(90vh,840px)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="invoice-mall-resolution-title"
                className="text-base font-semibold tracking-tight"
              >
                사이트 연결
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                파일의 쇼핑몰명을 출고업체에 연결해야 다음 단계로 갈 수
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
            <p className="text-sm text-success">모든 사이트를 연결했습니다.</p>
          ) : null}

          {unresolved.map((site) => {
            const draft = draftOf(site)
            const keyword = searchByKey[site.key] ?? ''
            const choices = activeTargets.filter((target) =>
              matchesOutboundPartnerSearch(
                keyword,
                target,
                aliasesByTarget.get(target.id) ?? [],
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
                      쇼핑몰명이 비어 있습니다. 사방넷에서 쇼핑몰명이 있는
                      파일을 다시 내려받으세요.
                    </p>
                  </div>
                ) : null}

                {site.status === 'inactive' ? (
                  <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <p>
                      비활성 출고업체{' '}
                      <span className="font-medium">
                        {site.officialName}
                      </span>
                      와 같습니다.{' '}
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          draft.mode === 'existing'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground'
                        }`}
                        onClick={() =>
                          patchDraft(site.key, { mode: 'existing' })
                        }
                      >
                        기존 업체에 연결
                      </button>
                      <button
                        type="button"
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          draft.mode === 'create'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground'
                        }`}
                        onClick={() =>
                          patchDraft(site.key, { mode: 'create' })
                        }
                      >
                        새 업체로 등록
                      </button>
                    </div>

                    {draft.mode === 'existing' ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
                        <input
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                          placeholder="출고업체 검색"
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
                          value={draft.targetId}
                          onChange={(event) =>
                            patchDraft(site.key, {
                              targetId: event.target.value,
                            })
                          }
                        >
                          <option value="">업체를 고르세요</option>
                          {choices.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted-foreground">업체명</span>
                          <input
                            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                            value={draft.name}
                            onChange={(event) =>
                              patchDraft(site.key, { name: event.target.value })
                            }
                          />
                        </label>
                        <label className="space-y-1 text-xs">
                          <span className="text-muted-foreground">위치</span>
                          <select
                            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                            value={draft.folderId ?? ''}
                            onChange={(event) =>
                              patchDraft(site.key, {
                                folderId: event.target.value || null,
                              })
                            }
                          >
                            {folderOptions.map((option) => (
                              <option
                                key={option.id ?? 'unfiled'}
                                value={option.id ?? ''}
                                disabled={option.disabled}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}

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
