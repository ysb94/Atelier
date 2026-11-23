import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { getCodeUsageTargetFolders } from '@/lib/api'
import { descendantFolderIds, folderPath } from '@/lib/codes/outbound-folder'
import { listCodeUsageTargetOptions } from '@/lib/supabase/code-usage-targets'

export type DraftPartnerOption = { id: string; label: string }

export function useDraftSabangnetPartners(brandId: string | null, enabled: boolean) {
  const active = useWorkspaceTabActivity()
  const shouldLoad = active && enabled && Boolean(brandId)
  const targets = useQuery({
    queryKey: ['codeUsageTargets', brandId, 'options'],
    queryFn: ({ signal }) => listCodeUsageTargetOptions(brandId!, signal),
    enabled: shouldLoad,
  })
  const folders = useQuery({
    queryKey: ['codeUsageTargetFolders', brandId],
    queryFn: () => getCodeUsageTargetFolders(brandId!),
    enabled: shouldLoad,
  })
  const { options, names } = useMemo(() => {
    const options: DraftPartnerOption[] = []
    const names = new Map<string, string>()
    if (!targets.data || !folders.data) return { options, names }

    const sabangnetFolders = new Set<string>()
    for (const folder of folders.data) {
      if (folder.normalizedName !== '사방넷') continue
      const root = folderPath(folders.data, folder.id)[0]
      if (!root || root.parentId || root.normalizedName !== '온라인') continue
      sabangnetFolders.add(folder.id)
      for (const id of descendantFolderIds(folders.data, folder.id)) sabangnetFolders.add(id)
    }
    for (const target of targets.data) {
      names.set(target.id, target.name)
      if (target.active && target.folder_id && sabangnetFolders.has(target.folder_id)) {
        options.push({ id: target.id, label: target.name })
      }
    }
    return { options, names }
  }, [folders.data, targets.data])

  let placeholder = '사방넷 업체 선택'
  if (!brandId) placeholder = '브랜드를 먼저 선택하세요'
  else if (targets.isLoading || folders.isLoading) placeholder = '사방넷 업체 불러오는 중…'
  else if (targets.isError || folders.isError) placeholder = '사방넷 업체 조회 실패'
  else if (!options.length) placeholder = '선택 가능한 사방넷 업체 없음'
  return { options, names, placeholder }
}

export function withSavedDraftPartner(
  options: DraftPartnerOption[], savedId: string | null, savedName: string, currentName?: string,
) {
  const value = savedId ?? (savedName ? 'saved-partner' : '')
  if (!value || options.some(option => option.id === value)) return { options, value }
  const label = currentName || savedName || '업체'
  return { options: [...options, { id: value, label: `${label} (기존)` }], value }
}
