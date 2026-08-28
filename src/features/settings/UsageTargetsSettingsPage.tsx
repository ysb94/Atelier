import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { UsageTargetManagerPanel } from '@/features/codes/UsageTargetManager'
import {
  getCodeUsageAssignments,
  getCodeUsageTargetAliases,
  getCodeUsageTargetFolders,
  getCodeUsageTargets,
} from '@/lib/api'

export function UsageTargetsSettingsPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()

  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })
  const aliasesQuery = useQuery({
    queryKey: ['codeUsageTargetAliases', brand.id],
    queryFn: () => getCodeUsageTargetAliases(brand.id),
  })
  const foldersQuery = useQuery({
    queryKey: ['codeUsageTargetFolders', brand.id],
    queryFn: () => getCodeUsageTargetFolders(brand.id),
  })
  const assignmentsQuery = useQuery({
    queryKey: ['codeUsageAssignments', brand.id],
    queryFn: () => getCodeUsageAssignments(brand.id),
  })

  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data])
  const aliases = useMemo(() => aliasesQuery.data ?? [], [aliasesQuery.data])
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
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
        queryKey: ['codeUsageTargetAliases', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageTargetFolders', brand.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['codeUsageAssignments', brand.id],
      }),
    ])
  }

  const loading =
    targetsQuery.isLoading ||
    aliasesQuery.isLoading ||
    foldersQuery.isLoading ||
    assignmentsQuery.isLoading

  return (
    <div>
      <PageHeader
        title="출고업체"
        description={`${brand.name} 물건을 보내는 곳을 폴더로 나누고, 카드에 그 업체만의 특징을 적습니다.`}
      />

      {loading ? (
        <div className="text-sm text-muted-foreground">불러오는 중...</div>
      ) : (
        <Card>
          <CardContent className="p-5">
            <UsageTargetManagerPanel
              brandId={brand.id}
              targets={targets}
              folders={folders}
              aliases={aliases}
              assignments={assignments}
              onChanged={invalidate}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
