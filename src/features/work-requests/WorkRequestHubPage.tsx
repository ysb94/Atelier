import { Link } from 'react-router-dom'
import { Boxes, LayoutGrid, Palette, PenLine } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WORK_REQUEST_CONFIG, WORK_REQUEST_OWNERS } from './work-request-form-config'

const ICONS = {
  planning: PenLine,
  design: Palette,
  md: LayoutGrid,
  logistics: Boxes,
} as const

export function WorkRequestHubPage() {
  return (
    <div>
      <PageHeader
        title="회사 업무"
        description="작업 요청은 회사 범위입니다. 브랜드는 나중에 하나만 확정합니다."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {WORK_REQUEST_OWNERS.map((owner) => {
          const config = WORK_REQUEST_CONFIG[owner]
          const Icon = ICONS[owner]
          return (
            <Link key={owner} to={`/work-requests/${owner}`}>
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4" />
                    {config.teamName}
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
    </div>
  )
}
