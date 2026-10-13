import { Link } from 'react-router-dom'
import { ArrowUpRight, Boxes, ClipboardList, LayoutGrid, Palette, PenLine, UserRound } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { ownerFromDepartment, WORK_REQUEST_CONFIG, WORK_REQUEST_OWNERS } from './work-request-form-config'

const ICONS = {
  planning: PenLine,
  design: Palette,
  md: LayoutGrid,
  logistics: Boxes,
} as const

export function WorkRequestHubPage() {
  useRenderWatch('WorkRequestHubPage')
  const { profile } = useAuth()
  const departmentName = profile?.departmentName?.trim() || null
  const myOwner = ownerFromDepartment(departmentName)
  const myConfig = myOwner ? WORK_REQUEST_CONFIG[myOwner] : null
  const MyIcon = myOwner ? ICONS[myOwner] : ClipboardList

  return (
    <div>
      <PageHeader
        title="내 업무"
        description="내 프로필의 소속 부서를 기준으로 업무를 이어갑니다. 다른 부서에 요청할 일은 아래 부서별 작업 요청에서 시작하세요."
      />

      <section aria-label="내 프로필과 주요 업무" className="mb-8 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4" />
              내 프로필
            </CardTitle>
            <CardDescription>로그인한 계정의 프로필 정보입니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">이름</dt>
              <dd className="break-words font-medium">{profile?.displayName || '이름 미등록'}</dd>
              <dt className="text-muted-foreground">소속</dt>
              <dd className="break-words font-medium">{departmentName || '소속 미지정'}</dd>
              <dt className="text-muted-foreground">직책</dt>
              <dd className="break-words font-medium">{profile?.position || '직책 미지정'}</dd>
            </dl>
          </CardContent>
        </Card>

        {myOwner && myConfig ? (
          <Link to={`/work-requests/${myOwner}`} className="block h-full">
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MyIcon className="size-4" />
                  내 부서 작업 요청
                  <ArrowUpRight className="ml-auto size-4 shrink-0" />
                </CardTitle>
                <CardDescription>
                  {myConfig.teamName} 부서로 들어온 요청과 나에게 배정된 일을 확인하세요.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm font-medium">
                {myConfig.teamName} 작업 요청 열기
              </CardContent>
            </Card>
          </Link>
        ) : (
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4" />
                내 부서 작업 요청
              </CardTitle>
              <CardDescription>
                {departmentName
                  ? `소속 부서(${departmentName})는 작업 요청을 받는 부서가 아닙니다.`
                  : '프로필에 소속 부서가 지정되지 않았습니다.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              아래 부서별 작업 요청에서 필요한 부서를 직접 선택하세요.
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="work-request-departments-title">
        <div className="mb-3">
          <h2 id="work-request-departments-title" className="text-base font-semibold">부서별 작업 요청</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            작업 요청은 회사 범위입니다. 브랜드는 나중에 하나만 확정합니다.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {WORK_REQUEST_OWNERS.map((owner) => {
            const config = WORK_REQUEST_CONFIG[owner]
            const Icon = ICONS[owner]
            return (
              <Link key={owner} to={`/work-requests/${owner}`}>
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <Icon className="size-4" />
                      {config.teamName}
                      {owner === myOwner ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          내 부서
                        </span>
                      ) : null}
                    </CardTitle>
                    <CardDescription>{config.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    브랜드 미정으로 시작할 수 있습니다. 상품·기획안은 브랜드를 확정한 뒤에만 만듭니다.
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
