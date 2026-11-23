import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { OutboundPartnerRegistrationPreview } from '@/features/codes/OutboundPartnerRegistrationPreview'
import { UsageTargetManagerPanel } from '@/features/codes/UsageTargetManager'
import {
  getCodeUsageAssignments,
  getCodeUsageTargetAliases,
  getCodeUsageTargetFolders,
  getCodeUsageTargets,
  getOutboundPartnerGroups,
} from '@/lib/api'

// The old W컨셉 row without a branch is still referenced by outbound shipments.
const LEGACY_W_CONCEPT_TARGET_ID = '38ea0156-c5b3-4df7-843c-d71ec0e5540f'

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
        title={`${brand.name} 출고업체`}
        description="업체와 지점을 찾거나 등록합니다."
      />

      {loading && targets.length === 0 && folders.length === 0 ? (
        <div className="text-sm text-muted-foreground">불러오는 중...</div>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-5">
            <OutboundPartnerRegistrationPreview targets={targets} folders={folders} />
            <UsageTargetManagerPanel
              brandId={brand.id}
              targets={targets}
              hiddenTargetId={LEGACY_W_CONCEPT_TARGET_ID}
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
