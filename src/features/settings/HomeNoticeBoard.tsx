import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { companyNoticePhase } from '@/lib/company/company-notices'
import { listCompanyNotices } from '@/lib/supabase/company-notices'
import { useRenderWatch } from '@/lib/diagnostics'
import { koreaDateKey } from '@/features/settings/my-attendance'

export function HomeNoticeBoard({
  kind,
}: {
  kind: 'company' | 'department'
}) {
  useRenderWatch(kind === 'company' ? 'CompanyNoticeBoard' : 'DepartmentNoticeBoard')
  const { profile } = useAuth()
  const today = koreaDateKey()
  const noticesQuery = useQuery({
    queryKey: ['company-notices', kind],
    queryFn: () => listCompanyNotices(kind),
  })
  const departmentId = profile?.departmentId ?? null
  const notices = (noticesQuery.data ?? []).filter((notice) => {
    if (companyNoticePhase(notice, today) !== 'live') return false
    if (kind === 'company') return notice.departmentId === null
    return departmentId !== null && notice.departmentId === departmentId
  })

  return (
    <section className="space-y-3" aria-label={kind === 'company' ? '회사 공지' : '부서 공지'}>
      {kind === 'department' && !departmentId ? (
        <p className="personal-page-notice">소속 부서가 없어 부서 공지를 볼 수 없습니다.</p>
      ) : noticesQuery.isPending ? (
        <p className="personal-page-notice" role="status">공지를 불러오는 중입니다.</p>
      ) : noticesQuery.isError ? (
        <p className="personal-page-notice is-error" role="alert">공지를 불러오지 못했습니다. 새로고침해 주세요.</p>
      ) : notices.length === 0 ? (
        <p className="personal-page-notice">등록된 공지가 없습니다.</p>
      ) : (
        notices.map((notice) => (
          <article key={notice.id} className="rounded-xl border border-border bg-card px-5 py-4">
            <h2 className="text-base font-semibold">{notice.title}</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{notice.body}</p>
          </article>
        ))
      )}
    </section>
  )
}
