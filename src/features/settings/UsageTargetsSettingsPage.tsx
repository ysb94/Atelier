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
  getOutboundPartnerGroups,
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
  const groupsQuery = useQuery({
    queryKey: ['outboundPartnerGroups', brand.id],
    queryFn: () => getOutboundPartnerGroups(brand.id),
  })
  const assignmentsQuery = useQuery({
    queryKey: ['codeUsageAssignments', brand.id],
    queryFn: () => getCodeUsageAssignments(brand.id),
  })

  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data])
  const aliases = useMemo(() => aliasesQuery.data ?? [], [aliasesQuery.data])
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
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
        queryKey: ['outboundPartnerGroups', brand.id],
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
    groupsQuery.isLoading ||
    assignmentsQuery.isLoading

  return (
    <div>
      <PageHeader
        title="출고업체"
        description={`${brand.name} 출고처를 폴더 아래 업체와 지점으로 두고, 지점이 없으면 업체를 실제 출고 단위로 관리합니다.`}
      />

      {loading && targets.length === 0 && folders.length === 0 ? (
        <div className="text-sm text-muted-foreground">불러오는 중...</div>
      ) : (
        <Card>
          <CardContent className="p-5">
            <UsageTargetManagerPanel
              brandId={brand.id}
              targets={targets}
              folders={folders}
              groups={groups}
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
