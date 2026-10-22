import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, ImageIcon, Inbox, RefreshCw } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  getMamamIdeaImageUrls,
  listMamamIdeaSubmissions,
  type MamamIdeaSubmission,
} from '@/lib/api'
import { canAccessMamamIdeaInbox } from '@/lib/company/capabilities'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { cn, emptyList } from '@/lib/utils'

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
})

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormatter.format(date)
}

function queryErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : '아이디어 접수함을 불러오지 못했습니다.'
}

export function MamamIdeaInboxPage() {
  useRenderWatch('MamamIdeaInboxPage')
  const { profile } = useAuth()
  const preview = usePagePreview()
  const allowed = canAccessMamamIdeaInbox(profile)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const submissionsQuery = useQuery({
    queryKey: ['mamam-idea-submissions', 'submitted'],
    queryFn: listMamamIdeaSubmissions,
    enabled: allowed,
  })
  const submissions =
    submissionsQuery.data ?? emptyList<MamamIdeaSubmission>()
  const selected = useMemo(
    () =>
      submissions.find((submission) => submission.id === selectedId) ??
      submissions[0] ??
      null,
    [selectedId, submissions],
  )
  const imagesQuery = useQuery({
    queryKey: ['mamam-idea-submission-images', selected?.id],
    queryFn: () => getMamamIdeaImageUrls(selected!.imagePaths),
    enabled: allowed && Boolean(selected?.imagePaths.length),
    staleTime: 20 * 60 * 1000,
  })

  if (!allowed) return preview?.active
    ? <p role="status" className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-sm">접근 제한 화면 · 아이디어 공모전 접수함 조회 권한이 지정된 담당자만 볼 수 있습니다.</p>
    : <Navigate to="/" replace />

  return (
    <div className="space-y-5">
      <PageHeader
        title="아이디어 공모전 접수함"
        description="정상 접수된 제안과 비공개 첨부 이미지를 확인합니다."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={submissionsQuery.isFetching}
            onClick={() => void submissionsQuery.refetch()}
          >
            <RefreshCw
              className={cn(
                'size-3.5',
                submissionsQuery.isFetching && 'animate-spin',
              )}
            />
            새로고침
          </Button>
        }
      />

      {submissionsQuery.isError ? (
        <Card className="border-danger/30">
          <CardContent className="p-5 text-sm text-danger">
            {queryErrorMessage(submissionsQuery.error)}
          </CardContent>
        </Card>
      ) : submissionsQuery.isPending ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            접수 목록을 불러오는 중입니다.
          </CardContent>
        </Card>
      ) : submissions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Inbox className="size-8 text-muted-foreground" />
            <p className="font-medium">정상 접수된 아이디어가 없습니다.</p>
            <p className="text-sm text-muted-foreground">
              공모전 사이트에서 제출이 완료되면 여기에 표시됩니다.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.4fr)]">
          <Card className="min-w-0">
            <CardHeader className="border-b border-border">
              <CardTitle>접수 리스트</CardTitle>
              <CardDescription>총 {submissions.length}건</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[680px] space-y-2 overflow-y-auto p-3">
              {submissions.map((submission) => {
                const active = selected?.id === submission.id
                return (
                  <button
                    key={submission.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedId(submission.id)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      active
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/60',
                    )}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {submission.submitterName}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {submission.department}
                        </span>
                      </span>
                      {submission.imagePaths.length ? (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                          <ImageIcon className="size-3" />
                          {submission.imagePaths.length}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {formatDateTime(submission.submittedAt)}
                    </span>
                    <span className="mt-2 block line-clamp-2 text-sm leading-5">
                      {submission.description}
                    </span>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          {selected ? (
            <Card className="min-w-0">
              <CardHeader className="border-b border-border">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{selected.submitterName}</CardTitle>
                    <CardDescription className="mt-1">
                      {selected.department} ·{' '}
                      {formatDateTime(selected.submittedAt)}
                    </CardDescription>
                  </div>
                  <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                    접수 완료
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 p-5">
                <section aria-labelledby="mamam-idea-description">
                  <h2
                    id="mamam-idea-description"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    아이디어 설명
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                    {selected.description}
                  </p>
                </section>

                <section aria-labelledby="mamam-idea-images">
                  <h2
                    id="mamam-idea-images"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    첨부 이미지 · {selected.imagePaths.length}장
                  </h2>
                  {selected.imagePaths.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      첨부된 이미지가 없습니다.
                    </p>
                  ) : imagesQuery.isPending ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      이미지를 불러오는 중입니다.
                    </p>
                  ) : imagesQuery.isError ? (
                    <p className="mt-2 text-sm text-danger">
                      {queryErrorMessage(imagesQuery.error)}
                    </p>
                  ) : (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {imagesQuery.data.map((image, index) => (
                        <a
                          key={image.path}
                          href={image.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="group overflow-hidden rounded-lg border border-border bg-muted/30"
                        >
                          <img
                            src={image.signedUrl}
                            alt={`${selected.submitterName} 첨부 이미지 ${index + 1}`}
                            loading="lazy"
                            className="aspect-[4/3] w-full object-contain"
                          />
                          <span className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground group-hover:text-foreground">
                            이미지 {index + 1}
                            <ExternalLink className="size-3.5" />
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </section>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  )
}
