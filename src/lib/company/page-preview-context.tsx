import { createContext, useContext } from 'react'
import type { Profile } from '../supabase/profiles'
import type { PreviewFacts } from './page-preview-coverage'

/** 현재 페이지 아래에서만 제공한다. 숨긴 KeepAlive 탭이나 실제 로그인 세션에 전파하지 않는다. */
export const PagePreviewContext = createContext<{ facts?: PreviewFacts; realProfile: Profile | null; active: boolean } | null>(null)

export function usePagePreview() {
  return useContext(PagePreviewContext)
}
