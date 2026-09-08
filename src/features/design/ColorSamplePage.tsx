import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, ImageOff } from 'lucide-react'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getCompanyProductDrafts, updateProductDraft } from '@/lib/api'
import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import {
  isColorSampleOrdered,
  isColorSampleReadyForPhoto,
} from '@/lib/drafts/draft-flow'
import { draftToInput } from '@/lib/drafts/sample-work-order'
import { useAuth } from '@/lib/supabase/auth'
import type { ProductDraft } from '@/lib/types'
import { draftDetailPath } from '@/lib/workspace/company-paths'
import { cn, formatNumber } from '@/lib/utils'

type ShootTab = 'ready' | 'done'

const SHOOT_TABS: { value: ShootTab; label: string }[] = [
  { value: 'ready', label: '촬영 대기' },
  { value: 'done', label: '촬영 완료' },
]

export function DesignColorSamplePage() {
  const { brandById } = useCompanyBrandScope()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [listTab, setListTab] = useState<ShootTab>('ready')
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })

  const shootMutation = useMutation({
    mutationFn: async ({
      draft,
      done,
    }: {
      draft: ProductDraft
      done: boolean
    }) => {
      return updateProductDraft(draft.id, {
        ...draftToInput(draft),
        photoSampleDone: done,
      })
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['product-drafts', 'company', companyId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['product-draft', updated.id],
        }),
      ])
    },
  })

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return (draftsQuery.data ?? [])
      .filter((draft) => isColorSampleOrdered(draft))
      .filter((draft) =>
        listTab === 'done'
          ? draft.photoSampleDone
          : isColorSampleReadyForPhoto(draft),
      )
      .filter((draft) => {
        if (!keyword) return true
        return [
          draft.draftNo,
          draft.nameKo,
          draft.nameEn,
          draft.owner,
          ...draft.colors.map((color) => color.name),
        ]
          .filter(Boolean)
          .some((text) => text.toLowerCase().includes(keyword))
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }, [draftsQuery.data, listTab, search])

  const tabCounts = useMemo(() => {
    const ordered = (draftsQuery.data ?? []).filter(isColorSampleOrdered)
    return {
      ready: ordered.filter(isColorSampleReadyForPhoto).length,
      done: ordered.filter((draft) => draft.photoSampleDone).length,
    }
  }, [draftsQuery.data])

  return (
    <div>
      <PageHeader
        title="컬러샘플 촬영"
        description="기획에서 컬러샘플 발주 완료를 누르면 여기에 나타납니다. 도착한 컬러 샘플을 가져가 촬영하면 됩니다."
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="sm:max-w-xs"
          placeholder="PL번호, 이름, 컬러 검색..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="text-sm text-muted-foreground sm:ml-auto">
          {formatNumber(rows.length)}건
        </div>
      </div>

      <div
        role="tablist"
        aria-label="촬영 상태"
        className="mb-4 flex items-stretch gap-0.5 border-b border-border"
      >
        {SHOOT_TABS.map((item) => {
          const selected = item.value === listTab
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setListTab(item.value)}
              className={cn(
                '-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors',
                selected
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label} {formatNumber(tabCounts[item.value])}
            </button>
          )
        })}
      </div>

      {draftsQuery.isError ? (
        <p className="mb-3 text-sm text-danger">
          기획안을 불러오지 못했습니다.
        </p>
      ) : null}
      {shootMutation.isError ? (
        <p className="mb-3 text-sm text-danger">촬영 상태를 저장하지 못했습니다.</p>
      ) : null}

      {draftsQuery.isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          불러오는 중...
        </p>
      ) : rows.length === 0 ? (
        <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
          {search.trim()
            ? '조건에 맞는 기획안이 없습니다.'
            : listTab === 'ready'
              ? '컬러샘플 발주 완료된 기획안이 없습니다. 기획에서 발주 완료를 누르면 여기에 나타납니다.'
              : '촬영 완료한 기획안이 없습니다.'}
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((draft) => {
            const brand = draft.brandId
              ? brandById.get(draft.brandId)
              : undefined
            const namedColors = draft.colors.filter((color) =>
              color.name.trim(),
            )
            const shootingThis =
              shootMutation.isPending &&
              shootMutation.variables?.draft.id === draft.id
            const done = draft.photoSampleDone
            return (
              <Card
                key={draft.id}
                className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => navigate(draftDetailPath(draft.id))}
                >
                  <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                    {draft.imageUrl ? (
                      <img
                        src={draft.imageUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <ImageOff className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {draft.draftNo}
                      </span>
                      <Badge variant="success">컬러샘플 발주 완료</Badge>
                      {brand ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <BrandAvatar brand={brand} className="size-4" />
                          {brand.name}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate font-medium">
                      {draft.nameKo || draft.nameEn || '이름 미정'}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {namedColors.length === 0
                        ? '컬러 미정'
                        : namedColors
                            .map((color) => color.name.trim())
                            .join(', ')}
                      {draft.owner ? ` · ${draft.owner}` : ''}
                    </div>
                  </div>
                </button>
                <Button
                  type="button"
                  variant={done ? 'secondary' : 'outline'}
                  size="sm"
                  disabled={shootingThis}
                  className={cn(
                    done &&
                      'border-success/40 bg-success/10 text-foreground hover:bg-success/15',
                  )}
                  onClick={() =>
                    shootMutation.mutate({ draft, done: !done })
                  }
                >
                  {done ? <Check className="size-3.5" /> : <Camera className="size-3.5" />}
                  {shootingThis
                    ? '저장 중...'
                    : done
                      ? '촬영 완료'
                      : '촬영 완료로 표시'}
                </Button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
