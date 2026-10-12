import type { ReactNode } from 'react'
import { useWorkspaceTabActivity } from './workspace-tab-activity'

/** 비활성 KeepAlive 탭의 전역 차단 레이어는 렌더하지 않는다. */
export function WorkspaceTabOverlay({ children }: { children: ReactNode }) {
  const active = useWorkspaceTabActivity()
  if (!active) return null
  return children
}
