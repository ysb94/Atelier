import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { UsageTargetManagerPanel } from '@/features/codes/UsageTargetManager'
import { getCodeUsageAssignments, getCodeUsageTargets } from '@/lib/api'

export function UsageTargetsSettingsPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()

  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })
  const assignmentsQuery = useQuery({
    queryKey: ['codeUsageAssignments', brand.id],
    queryFn: () => getCodeUsageAssignments(brand.id),
  })

  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data])
  const assignments = useMemo(
    () => assignmentsQuery.data ?? [],
    [assignmentsQuery.data],
  )

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargets', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageAssignments', brand.id],
      }),
    ])
  }

  return (
    <div>
      <PageHeader
        title="사용처"
        description={`${brand.name} 바코드를 등록할 판매처·납품처를 관리합니다.`}
      />

      {targetsQuery.isLoading || assignmentsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">불러오는 중...</div>
      ) : (
        <Card>
          <CardContent className="p-5">
            <UsageTargetManagerPanel
              brandId={brand.id}
              targets={targets}
              assignments={assignments}
              onChanged={invalidate}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
