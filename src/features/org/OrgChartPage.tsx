import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const DEPARTMENTS = ['기획', '디자인', 'MD', '물류'] as const

export function OrgChartPage() {
  return (
    <div>
      <PageHeader
        title="조직도"
        description="브랜드 조직 구조를 보여 줄 자리입니다. 구성은 아직 구상 중입니다."
      />

      <div className="flex flex-col items-center gap-6">
        <Card className="w-full max-w-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">브랜드</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            대표 / 총괄 위치를 여기에 둘 예정입니다.
          </CardContent>
        </Card>

        <div className="h-8 w-px bg-border" />

        <div className="grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {DEPARTMENTS.map((name) => (
            <Card key={name}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{name}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                팀원과 역할을 나중에 연결합니다.
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
