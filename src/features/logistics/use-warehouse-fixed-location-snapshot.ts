import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { diagnosticOperation } from '@/lib/diagnostics/workflow-trace'
import { useAuth } from '@/lib/supabase/auth'
import { listAllStyleRefs } from '@/lib/supabase/styles'
import { requestWarehouseFixedLocations, type FixedLocationSnapshot } from '@/lib/supabase/warehouse-fixed-locations'
import { emptyList } from '@/lib/utils'
import { linkFixedLocationStyles, type FixedLocationRow } from '@/lib/warehouse/fixed-location-styles'

export function useWarehouseFixedLocationSnapshot(brandId: string, enabled = true) {
  const active = useWorkspaceTabActivity()
  const { session } = useAuth()
  const cache = useQueryClient()
  const userId = session?.user.id
  const queryKey = ['warehouse-fixed-location-snapshot', brandId, userId] as const
  const styleLookupKey = ['styles', brandId, 'fixed-location-refs', userId] as const
  const canRead = active && Boolean(userId) && enabled
  const snapshot = useQuery({
    queryKey,
    queryFn: () => requestWarehouseFixedLocations(brandId, 'read', cache.getQueryData<FixedLocationSnapshot>(queryKey)),
    enabled: canRead,
    refetchInterval: canRead ? 60_000 : false,
    retry: false,
  })
  const sheetRows = snapshot.data?.rows
  const styleLookup = useQuery({
    queryKey: styleLookupKey,
    queryFn: () => diagnosticOperation('app', 'warehouse_fixed_location_styles', trace =>
      trace.run('read_catalog', context => listAllStyleRefs(brandId, context))),
    enabled: canRead && Boolean(sheetRows?.some(row => row.productName.trim())),
  })
  const styles = styleLookup.data
  const rows = useMemo(() => sheetRows ? linkFixedLocationStyles(sheetRows, styles ?? emptyList()) : emptyList<FixedLocationRow>(), [sheetRows, styles])
  return { snapshot, queryKey, rows, styleLookup, styleLookupKey }
}
