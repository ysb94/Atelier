import { useEffect, useRef } from 'react'
import { useAuth } from '@/lib/supabase/auth'
import { recordAccessIp } from '@/lib/supabase/access-ip'

/** 실제 AuthProvider 아래에 한 번 설치. 표시 프로필·승인 상태·로그인 흐름에는 관여하지 않는다. */
export function AccessIpRecorder() {
  const { session } = useAuth()
  const recorded = useRef('')
  useEffect(() => {
    if (!session) { recorded.current = ''; return }
    // 토큰 갱신·새로고침·여러 탭의 중복은 서버에서 검증된 세션 ID로 최종 제거한다.
    const token = session.access_token
    if (recorded.current === token) return
    recorded.current = token
    void recordAccessIp('login').then(ok => { if (!ok && recorded.current === token) recorded.current = '' })
  }, [session])
  return null
}
