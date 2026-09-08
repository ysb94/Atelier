import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  ClipboardList,
  Network,
  Shirt,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { primaryWorkOwner } from '@/components/layout/company-nav'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getBrands } from '@/lib/api'
import {
  capabilityLabel,
  isCompanyManager,
  profileCapabilities,
} from '@/lib/company/capabilities'
import { useAuth } from '@/lib/supabase/auth'
import { WORK_REQUEST_CONFIG } from '@/features/work-requests/work-request-form-config'

export function CompanyHomePage() {
  const { profile } = useAuth()
  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: getBrands,
  })
  const brands = brandsQuery.data ?? []
  const manager = isCompanyManager({
    status: profile?.status,
    isAdmin: profile?.isAdmin,
    position: profile?.position,
  })
  const capabilities = profileCapabilities({
    capabilities: profile?.capabilities,
    status: profile?.status,
    isAdmin: profile?.isAdmin,
  })
  const owner = primaryWorkOwner({
    departmentName: profile?.departmentName,
    capabilities: profile?.capabilities,
  })
  const workHref = `/work-requests/${owner}`

  return (
    <div>
      <PageHeader
        title="E&J 홈"
        description="E&J 전 브랜드 업무를 한 화면에서 봅니다. 브랜드는 필터와 열입니다."
      />

      <div className="mb-6 rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          {profile?.displayName || '직원'} · {profile?.departmentName || '팀 미정'} ·{' '}
          {profile?.position || '직급 미정'}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {capabilities.length > 0 ? (
            capabilities.map((capability) => (
              <Badge key={capability} variant="outline">
                {capabilityLabel(capability)}
              </Badge>
            ))
          ) : (
            <Badge variant="muted">역량 미지정</Badge>
          )}
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">지금 하는 업무</CardTitle>
            <CardDescription>장착한 일은 해당 부서 업무판에서 확인합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to={workHref}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
            >
              내 업무 열기
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">오늘·마감 임박</CardTitle>
            <CardDescription>회사 일정과 업무 마감을 함께 봅니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/schedule"
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium"
            >
              일정 보기
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">브랜드 미정</CardTitle>
            <CardDescription>
              아직 브랜드를 고르지 않은 요청은 회사 영역에 둡니다. 상품은 만들지 않습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to={`${workHref}?brand=undecided`}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium"
            >
              미정 업무
            </Link>
          </CardContent>
        </Card>
        {manager ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">팀 접수 대기</CardTitle>
              <CardDescription>
                {WORK_REQUEST_CONFIG[owner].teamName} 요청을 접수하고 배정합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to={workHref}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium"
              >
                팀 업무판
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">내 완료 요청</CardTitle>
              <CardDescription>완료 확인이 남은 요청을 업무판에서 봅니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to={workHref}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium"
              >
                완료 목록
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mb-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          to="/products"
          className="flex items-start gap-3 rounded-lg border border-border px-3 py-3 hover:bg-muted/50"
        >
          <Shirt className="mt-0.5 size-4 text-muted-foreground" />
          <span>
            <span className="block text-sm font-medium">전체 상품</span>
            <span className="text-xs text-muted-foreground">여러 브랜드를 한 목록에서</span>
          </span>
        </Link>
        <Link
          to="/work"
          className="flex items-start gap-3 rounded-lg border border-border px-3 py-3 hover:bg-muted/50"
        >
          <ClipboardList className="mt-0.5 size-4 text-muted-foreground" />
          <span>
            <span className="block text-sm font-medium">업무 허브</span>
            <span className="text-xs text-muted-foreground">기획·디자인·MD·물류 요청</span>
          </span>
        </Link>
        <Link
          to="/schedule"
          className="flex items-start gap-3 rounded-lg border border-border px-3 py-3 hover:bg-muted/50"
        >
          <CalendarDays className="mt-0.5 size-4 text-muted-foreground" />
          <span>
            <span className="block text-sm font-medium">일정</span>
            <span className="text-xs text-muted-foreground">회사 공통 달력</span>
          </span>
        </Link>
        <Link
          to="/org-chart"
          className="flex items-start gap-3 rounded-lg border border-border px-3 py-3 hover:bg-muted/50"
        >
          <Network className="mt-0.5 size-4 text-muted-foreground" />
          <span>
            <span className="block text-sm font-medium">조직도</span>
            <span className="text-xs text-muted-foreground">E&J 팀 구조</span>
          </span>
        </Link>
        {manager ? (
          <Link
            to="/members"
            className="flex items-start gap-3 rounded-lg border border-border px-3 py-3 hover:bg-muted/50"
          >
            <Users className="mt-0.5 size-4 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium">멤버·권한</span>
              <span className="text-xs text-muted-foreground">승인·역량·팀</span>
            </span>
          </Link>
        ) : (
          <Link
            to="/brands"
            className="flex items-start gap-3 rounded-lg border border-border px-3 py-3 hover:bg-muted/50"
          >
            <Shirt className="mt-0.5 size-4 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium">브랜드 관리</span>
              <span className="text-xs text-muted-foreground">브랜드 추가·수정</span>
            </span>
          </Link>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">브랜드 상품</h3>
        <div className="flex items-center gap-3">
          <Link to="/products" className="text-xs text-muted-foreground hover:text-foreground">
            통합 상품
          </Link>
          <Link to="/brands" className="text-xs text-muted-foreground hover:text-foreground">
            브랜드 관리
          </Link>
        </div>
      </div>
      {brandsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">브랜드를 불러오는 중...</p>
      ) : brands.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>아직 브랜드가 없습니다</CardTitle>
            <CardDescription>
              관리자가 브랜드를 만들면 여기서 상품 목록으로 들어갑니다.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {brands.map((brand) => (
            <div
              key={brand.id}
              className="rounded-xl border border-border bg-card transition-colors hover:bg-muted/40"
            >
              <Link
                to={`/products?brands=${encodeURIComponent(brand.slug)}`}
                className="block p-4"
              >
                <div className="flex items-center gap-3">
                  <BrandAvatar brand={brand} className="size-10" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{brand.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {brand.nameKo} · 상품 {brand.styleCount} SKU
                    </p>
                  </div>
                </div>
              </Link>
              <div className="border-t border-border px-4 py-2">
                <Link
                  to={`/drafts?brands=${encodeURIComponent(brand.slug)}`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  이 브랜드 기획안
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
