import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { FlaskConical, RotateCcw } from 'lucide-react'
import { AuthDisplayProvider, useAuth } from '@/lib/supabase/auth'
import { canPreviewProfile, previewProfile } from '@/lib/company/profile-preview'
import { pagePreviewCases, type PagePreviewCase } from '@/lib/company/page-preview-cases'
import { useRenderWatch } from '@/lib/diagnostics'

type PreviewContextValue = {
  allowed: boolean
  pathname: string
  cases: PagePreviewCase[]
  selected: PagePreviewCase | null
  apply: (id: string | null) => void
}
const PreviewContext = createContext<PreviewContextValue | null>(null)

export function DeveloperPreviewProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { pathname } = useLocation()
  const allowed = Boolean(canPreviewProfile(auth.profile, auth.session?.user.email ?? null))
  const [selection, setSelection] = useState<{ owner: string; pathname: string; id: string } | null>(null)
  const cases = useMemo(() => allowed && auth.profile ? pagePreviewCases(pathname, auth.profile) : [], [allowed, pathname, auth.profile])
  const selected = allowed && selection?.owner === auth.profile?.id && selection?.pathname === pathname
    ? cases.find(item => item.id === selection?.id) ?? null : null
  const apply = useCallback((id: string | null) => {
    if (!allowed || !auth.profile) return
    if (id && !cases.some(item => item.id === id)) return
    setSelection(id ? { owner: auth.profile.id, pathname, id } : null)
  }, [allowed, auth.profile, pathname, cases])
  const value = useMemo(() => ({ allowed, pathname, cases, selected, apply }), [allowed, pathname, cases, selected, apply])
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

/** KeepAlive 내부의 고정된 경로와 비교해 해당 페이지에만 표시 프로필을 적용한다. */
export function DeveloperPreviewPage({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const context = useContext(PreviewContext)
  const settings = context?.pathname === pathname ? context.selected?.settings : null
  const displayed = useMemo(() => profile && settings ? previewProfile(profile, settings) : profile, [profile, settings])
  return <AuthDisplayProvider profile={displayed}>{children}</AuthDisplayProvider>
}

export function DeveloperPreviewBar() {
  useRenderWatch('DeveloperPreviewBar')
  const context = useContext(PreviewContext)
  if (!context?.allowed) return null
  const { cases, selected, apply } = context
  return <section aria-label="개발자 화면 미리보기" className="shrink-0 border-b border-border bg-muted/30 px-4 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 flex items-center gap-1.5 text-muted-foreground"><FlaskConical size={13} />화면 테스트</span>
      {cases.length ? cases.map(item => <button key={item.id} type="button" aria-pressed={selected?.id === item.id} onClick={() => apply(item.id)} className={`rounded-md border px-3 py-1.5 transition-colors ${selected?.id === item.id ? 'border-amber-400 bg-amber-100 font-medium text-amber-950' : 'border-border bg-card text-foreground hover:bg-muted'}`}>{item.label}</button>) : <span className="text-muted-foreground">구분 없음</span>}
      {selected && <><span className="text-[11px] text-amber-800">실제 저장 · 로그인 계정으로 실행</span><button type="button" onClick={() => apply(null)} aria-label="미리보기 종료" title="내 계정으로 돌아가기" className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"><RotateCcw size={12} />종료</button></>}
    </div>
  </section>
}
