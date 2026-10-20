import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { emptyList } from '@/lib/utils'
import {
  type UsageCodeColumn,
  type UsagePrivateValue,
} from '@/lib/codes/usage-code-columns'
import {
  getUsagePartnerSettings,
  getUsagePartnerValues,
  saveUsagePartnerColumns,
  saveUsagePartnerValues,
  saveUsagePartnerEditors,
  type UsagePartnerValue,
} from '@/lib/supabase/usage-partner-settings'

export function useUsagePartnerSettings(
  brandId: string,
  targetId: string | null,
) {
  const queryClient = useQueryClient()
  const key = ['usagePartnerSettings', brandId, targetId] as const
  const settings = useQuery({
    queryKey: key,
    enabled: Boolean(targetId),
    retry: false,
    queryFn: () => getUsagePartnerSettings(brandId, targetId!),
  })
  const values = useQuery({
    queryKey: ['usagePartnerValues', brandId, targetId],
    enabled: Boolean(targetId && settings.data?.ready),
    retry: false,
    queryFn: () => getUsagePartnerValues(brandId, targetId!),
  })
  const valueRows = values.data ?? emptyList<UsagePartnerValue>()
  const valueMap = useMemo(() => {
    const map = new Map<string, Record<string, UsagePrivateValue>>()
    for (const row of valueRows) {
      const entry = map.get(row.productCodeId) ?? {}
      entry[row.fieldId] = row.value
      map.set(row.productCodeId, entry)
    }
    return map
  }, [valueRows])
  const refresh = (target: string) =>
    queryClient.invalidateQueries({
      queryKey: ['usagePartnerSettings', brandId, target],
    })
  const columnsMutation = useMutation({
    mutationFn: (request: {
      target: string
      columns: UsageCodeColumn[]
      previous: UsageCodeColumn[]
    }) =>
      saveUsagePartnerColumns(
        brandId,
        request.target,
        request.columns,
        request.previous,
      ),
    onSuccess: async (_, request) => {
      await refresh(request.target)
    },
  })
  const valuesMutation = useMutation({
    mutationFn: (request: {
      target: string
      codeId: string
      values: Record<string, UsagePrivateValue>
    }) =>
      saveUsagePartnerValues(
        brandId,
        request.target,
        request.codeId,
        request.values,
      ),
    onSuccess: async (_, request) => {
      await queryClient.invalidateQueries({
        queryKey: ['usagePartnerValues', brandId, request.target],
      })
    },
  })
  const editorsMutation = useMutation({
    mutationFn: (request: { target: string; profileIds: string[] }) =>
      saveUsagePartnerEditors(brandId, request.target, request.profileIds),
    onSuccess: async (_, request) => {
      await refresh(request.target)
    },
  })
  return {
    settings,
    values,
    valueMap,
    columnsMutation,
    valuesMutation,
    editorsMutation,
  }
}
