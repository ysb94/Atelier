import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { emptyList } from '@/lib/utils'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { previewUsageAccess } from '@/lib/company/page-preview-coverage'
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
  const preview = usePagePreview()
  const queryClient = useQueryClient()
  const key = ['usagePartnerSettings', brandId, targetId] as const
  const settings = useQuery({
    queryKey: key,
    enabled: Boolean(targetId),
    retry: false,
    queryFn: () => getUsagePartnerSettings(brandId, targetId!),
  })
  const displayedData = useMemo(() => settings.data ? {
    ...settings.data,
    access: previewUsageAccess(settings.data.access, preview?.facts?.usageAccess),
  } : undefined, [settings.data, preview?.facts?.usageAccess])
  function requireActualAccess(kind: 'canEdit' | 'canManage', target: string) {
    if (target !== targetId || !settings.data?.ready || !settings.data.access[kind]) {
      throw new Error('로그인 계정에 이 업체를 수정할 권한이 없습니다. 화면 테스트는 실제 권한을 변경하지 않습니다.')
    }
  }
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
    }) => {
      requireActualAccess('canEdit', request.target)
      return saveUsagePartnerColumns(
        brandId,
        request.target,
        request.columns,
        request.previous,
      )
    },
    onSuccess: async (_, request) => {
      await refresh(request.target)
    },
  })
  const valuesMutation = useMutation({
    mutationFn: (request: {
      target: string
      codeId: string
      values: Record<string, UsagePrivateValue>
    }) => {
      requireActualAccess('canEdit', request.target)
      return saveUsagePartnerValues(
        brandId,
        request.target,
        request.codeId,
        request.values,
      )
    },
    onSuccess: async (_, request) => {
      await queryClient.invalidateQueries({
        queryKey: ['usagePartnerValues', brandId, request.target],
      })
    },
  })
  const editorsMutation = useMutation({
    mutationFn: (request: { target: string; profileIds: string[] }) => {
      requireActualAccess('canManage', request.target)
      return saveUsagePartnerEditors(brandId, request.target, request.profileIds)
    },
    onSuccess: async (_, request) => {
      await refresh(request.target)
    },
  })
  return {
    settings: settings.isSuccess ? { ...settings, data: displayedData ?? settings.data } : settings,
    values,
    valueMap,
    columnsMutation,
    valuesMutation,
    editorsMutation,
  }
}
