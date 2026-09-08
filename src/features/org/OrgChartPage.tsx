import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listDepartments } from '@/lib/supabase/profiles'

export function OrgChartPage() {
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })
  const departments = departmentsQuery.data ?? []

  return (
    <div>
      <PageHeader
        title="조직도"
        description="E&J 회사 공통 팀입니다. 브랜드는 데이터가 나뉘는 축이고, 직원 소속은 여기입니다."
      />

      <div className="flex flex-col items-center gap-6">
        <Card className="w-full max-w-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">E&J</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            회사 공통 직원·부서. 브랜드와 관계없이 같은 조직입니다.
          </CardContent>
        </Card>

        <div className="h-8 w-px bg-border" />

        <div className="grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {departmentsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">팀을 불러오는 중...</p>
          ) : departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 팀이 없습니다.</p>
          ) : (
            departments.map((dept) => (
              <Card key={dept.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{dept.name}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  회사 공통 팀. 업무 역량은 멤버마다 따로 지정합니다.
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
