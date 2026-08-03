import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getDesignSpec, getStylesByBrand } from '@/lib/api'
import { STYLE_STATUS_LABEL } from '@/lib/types'

const sampleStatusLabel = {
  pending: '대기',
  in_review: '검토중',
  approved: '승인',
  rejected: '반려',
} as const

export function DesignPage() {
  const { brand } = useBrand()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'design'],
    queryFn: () => getStylesByBrand(brand.id),
  })

  const styles = stylesQuery.data ?? []
  const selected = styles.find((s) => s.id === selectedId) ?? styles[0] ?? null

  const specQuery = useQuery({
    queryKey: ['design-spec', selected?.id],
    queryFn: () => getDesignSpec(selected!.id),
    enabled: Boolean(selected?.id),
  })

  const spec = specQuery.data

  return (
    <div>
      <PageHeader
        title="디자인"
        description="도식화 · 작업지시서 · 샘플 차수 관리"
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div>
          {stylesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {styles.map((style) => {
                const active =
                  (selectedId ?? styles[0]?.id) === style.id
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setSelectedId(style.id)}
                    className={`overflow-hidden rounded-xl border bg-card text-left transition-all ${
                      active
                        ? 'border-foreground/30 shadow-md ring-1 ring-foreground/10'
                        : 'border-border hover:border-foreground/20 hover:shadow-sm'
                    }`}
                  >
                    <div
                      className="flex h-32 items-end p-3"
                      style={{ backgroundColor: style.thumbnailColor }}
                    >
                      <span className="rounded bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                        {style.styleNo}
                      </span>
                    </div>
                    <div className="space-y-1 p-3">
                      <div className="truncate text-sm font-medium">
                        {style.name}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {style.category}
                        </span>
                        <Badge variant="muted">
                          {STYLE_STATUS_LABEL[style.status]}
                        </Badge>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              작업지시서
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                스타일을 선택하세요.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {selected.styleNo}
                  </div>
                  <div className="text-lg font-semibold">{selected.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Designer · {selected.designer ?? '—'}
                  </div>
                </div>

                {specQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">스펙 로딩 중...</p>
                ) : !spec ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    아직 작업지시서가 없습니다. (목업 — 추후 작성 화면 연결)
                  </div>
                ) : (
                  <div className="space-y-4 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        샘플 {spec.sampleRound}차
                      </Badge>
                      <Badge
                        variant={
                          spec.sampleStatus === 'approved'
                            ? 'success'
                            : spec.sampleStatus === 'rejected'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {sampleStatusLabel[spec.sampleStatus]}
                      </Badge>
                      <Badge variant="muted">{spec.sizeRange}</Badge>
                    </div>

                    <SpecRow label="원단" value={spec.fabric} />
                    {spec.lining ? (
                      <SpecRow label="안감" value={spec.lining} />
                    ) : null}
                    <SpecRow label="부자재" value={spec.trimNotes} />

                    <div>
                      <div className="mb-1.5 text-muted-foreground">
                        작업 메모
                      </div>
                      <p className="rounded-md bg-muted p-3 text-sm">
                        {spec.workOrderNotes}
                      </p>
                    </div>

                    <div>
                      <div className="mb-1.5 text-muted-foreground">치수표</div>
                      <table className="w-full text-left text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="pb-1 font-medium">부위</th>
                            <th className="pb-1 font-medium">사이즈</th>
                            <th className="pb-1 font-medium">값(cm)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {spec.measurements.map((m) => (
                            <tr
                              key={`${m.part}-${m.size}`}
                              className="border-t border-border"
                            >
                              <td className="py-1.5">{m.part}</td>
                              <td className="py-1.5">{m.size}</td>
                              <td className="py-1.5 tabular-nums">{m.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-0.5 text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}
