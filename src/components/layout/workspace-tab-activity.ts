import { createContext, useContext } from 'react'

// 화면에서 탭 상태를 읽을 때 전체 라우트 트리를 가져오지 않도록 독립시킨다.
export const WorkspaceTabActivityContext = createContext(true)

/** KeepAlive 라우트가 현재 사용자에게 보이는 작업 탭인지 반환한다. */
export function useWorkspaceTabActivity() {
  return useContext(WorkspaceTabActivityContext)
}

