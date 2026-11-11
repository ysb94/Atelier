import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useAuth } from '@/lib/supabase/auth'
import { requestWarehouseFixedLocations, type FixedLocationSnapshot } from '@/lib/supabase/warehouse-fixed-locations'

export function useWarehouseFixedLocationSnapshot(brandId: string, enabled = true) {
  const active = useWorkspaceTabActivity()
  const { session } = useAuth()
  const cache = useQueryClient()
  const queryKey = ['warehouse-fixed-location-snapshot', brandId, session?.user.id] as const
  const canRead = active && Boolean(session) && enabled
  const snapshot = useQuery({
    queryKey,
    queryFn: () => requestWarehouseFixedLocations(brandId, 'read', cache.getQueryData<FixedLocationSnapshot>(queryKey)),
    enabled: canRead,
    refetchInterval: canRead ? 60_000 : false,
    retry: false,
  })
  return { snapshot, queryKey }
}
