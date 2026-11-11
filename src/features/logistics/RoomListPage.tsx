import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { useRenderWatch } from '@/lib/diagnostics'

export function RoomListPage() {
  useRenderWatch('RoomListPage')

  return (
    <>
      <PageHeader title="방별리스트" />
      <Card className="p-8 text-center text-sm text-muted-foreground">
        표시할 목록이 없습니다.
      </Card>
    </>
  )
}
