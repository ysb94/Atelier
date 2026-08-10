import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { getMyProfile, type Profile } from '@/lib/supabase/profiles'

type AuthState = {
  /** 세션·프로필 확인이 끝났는지 */
  ready: boolean
  session: Session | null
  profile: Profile | null
  email: string | null
  /** 프로필을 다시 읽어 게이트 화면을 갱신한다 */
  refreshProfile: () => Promise<Profile | null>
  signInWithGoogle: () => Promise<void>
  /** DEV LOGIN — 나중에 제거 */
  signInAsDev: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function toSignInMessage(message: string) {
  if (/invalid login credentials/i.test(message)) {
    return '이메일 또는 비밀번호가 올바르지 않습니다.'
  }
  if (/email not confirmed/i.test(message)) {
    return '이메일 인증이 완료되지 않은 계정입니다.'
  }
  if (/rate limit|too many/i.test(message)) {
    return '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
  }
  if (/provider is not enabled/i.test(message)) {
    return '구글 로그인이 아직 설정되지 않았습니다. Supabase Dashboard에서 Google 제공자를 켜 주세요.'
  }
  return message
}

async function loadProfileSafe(): Promise<Profile | null> {
  try {
    return await getMyProfile()
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setReady(true)
      return
    }

    const supabase = getSupabase()
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) {
        const next = await loadProfileSafe()
        if (!active) return
        setProfile(next)
      } else {
        setProfile(null)
      }
      setReady(true)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession)
        if (!nextSession) {
          setProfile(null)
          setReady(true)
          return
        }
        // onAuthStateChange 콜백 안에서 await하면 데드락이 날 수 있어 다음 틱으로 미룬다.
        void Promise.resolve().then(async () => {
          const next = await loadProfileSafe()
          if (!active) return
          setProfile(next)
          setReady(true)
        })
      },
    )

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const next = await loadProfileSafe()
    setProfile(next)
    return next
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })
    if (error) throw new Error(toSignInMessage(error.message))
  }, [])

  /** DEV LOGIN — 나중에 LoginPage 버튼·환경변수·이 계정과 함께 제거 */
  const signInAsDev = useCallback(async () => {
    const email = import.meta.env.VITE_DEV_LOGIN_EMAIL
    const password = import.meta.env.VITE_DEV_LOGIN_PASSWORD
    if (!email || !password) {
      throw new Error(
        '개발 로그인 환경변수가 없습니다. VITE_DEV_LOGIN_EMAIL / VITE_DEV_LOGIN_PASSWORD를 확인하세요.',
      )
    }
    const { error } = await getSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw new Error(toSignInMessage(error.message))
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await getSupabase().auth.signOut()
    if (error) throw new Error(error.message)
    setProfile(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      profile,
      email: session?.user.email ?? profile?.email ?? null,
      refreshProfile,
      signInWithGoogle,
      signInAsDev,
      signOut,
    }),
    [
      ready,
      session,
      profile,
      refreshProfile,
      signInWithGoogle,
      signInAsDev,
      signOut,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return value
}

/** 담당 브랜드 여부. 관리자는 전부 통과 */
export function canAccessBrand(
  profile: Profile | null,
  brandId: string,
): boolean {
  if (!profile || profile.status !== 'active') return false
  if (profile.isAdmin) return true
  return profile.memberships.some((m) => m.brandId === brandId)
}

export function isBrandLead(
  profile: Profile | null,
  brandId: string,
): boolean {
  if (!profile || profile.status !== 'active') return false
  if (profile.isAdmin) return true
  return profile.memberships.some((m) => m.brandId === brandId && m.isLead)
}
