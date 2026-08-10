import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import {
  listBrandDirectory,
  type Profile,
} from '@/lib/supabase/profiles'
import { Button } from '@/components/ui/button'

type PendingApprovalPageProps = {
  mode: 'pending' | 'rejected' | 'disabled'
  onEditRequest?: () => void
}

function brandNames(
  profile: Profile,
  directory: { id: string; name: string }[],
) {
  const byId = new Map(directory.map((b) => [b.id, b.name]))
  return profile.memberships
    .map((m) => byId.get(m.brandId) ?? m.brandId.slice(0, 8))
    .join(', ')
}

export function PendingApprovalPage({
  mode,
  onEditRequest,
}: PendingApprovalPageProps) {
  const { profile, email, signOut, refreshProfile } = useAuth()
  const brandsQuery = useQuery({
    queryKey: ['brand-directory'],
    queryFn: listBrandDirectory,
  })
  const brands = useMemo(() => brandsQuery.data ?? [], [brandsQuery.data])

  const title =
    mode === 'pending'
      ? '승인 대기 중'
      : mode === 'rejected'
        ? '접근이 거절되었습니다'
        : '계정이 정지되었습니다'

  const description =
    mode === 'pending'
      ? '담당 브랜드 팀장이나 운영진이 확인하면 작업장에 들어갈 수 있습니다.'
      : mode === 'rejected'
        ? '내용을 수정해 다시 신청하거나, 운영진에게 문의해 주세요.'
        : '운영진에게 문의해 주세요. 정지 해제 전에는 작업장에 들어갈 수 없습니다.'

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Atelier
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>

        {profile ? (
          <dl className="mt-6 space-y-3 rounded-lg bg-muted/40 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">계정</dt>
              <dd className="text-right font-medium">
                {profile.displayName || email}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">이메일</dt>
              <dd className="text-right">{email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">팀</dt>
              <dd className="text-right">{profile.departmentName ?? '-'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">직책</dt>
              <dd className="text-right">{profile.position ?? '-'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">담당 브랜드</dt>
              <dd className="text-right">
                {brandNames(profile, brands) || '-'}
              </dd>
            </div>
            {profile.requestNote ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">남긴 말</dt>
                <dd className="text-right">{profile.requestNote}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {mode === 'pending' || mode === 'rejected' ? (
            <Button type="button" variant="outline" onClick={onEditRequest}>
              신청 수정
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => void refreshProfile()}
          >
            새로고침
          </Button>
          <Button type="button" onClick={() => void signOut()}>
            로그아웃
          </Button>
        </div>
      </div>
    </div>
  )
}
