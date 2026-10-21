import { createContext, useContext, useMemo } from 'react'
import type { Profile } from '../supabase/profiles'
import { previewProfile } from './profile-preview'
import type { CompletePreviewCase, PreviewFacts } from './page-preview-coverage'
import type { PreviewGroup } from './page-preview-cases'

export const PreviewContext = createContext<{
  allowed: boolean
  reviewer: boolean
  pathname: string
  viewKey: string
  cases: CompletePreviewCase[]
  selected: CompletePreviewCase | null
  selectedIds: Partial<Record<PreviewGroup,string>>
  facts?: PreviewFacts
  apply: (id: string | null, group?: PreviewGroup) => void
} | null>(null)

export function useHeaderPreview() {
  return useContext(PreviewContext)?.facts
}

/** 메뉴 표시만 전환한다. 로그인 계정 정보와 숨긴 탭의 인증 문맥은 보존한다. */
export function useNavigationPreviewProfile(real: Profile | null) {
  const context = useContext(PreviewContext)
  const settings = context?.selected?.settings
  return useMemo(() => real && settings ? previewProfile(real, settings) : real, [real, settings])
}
