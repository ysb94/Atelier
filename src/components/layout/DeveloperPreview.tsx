import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { FlaskConical, RotateCcw } from 'lucide-react'
import { AuthDisplayProvider, useAuth } from '@/lib/supabase/auth'
import { canPreviewProfile, previewProfile } from '@/lib/company/profile-preview'
import { completePagePreviewCases } from '@/lib/company/page-preview-coverage'
import { PagePreviewContext } from '@/lib/company/page-preview-context'
import { PreviewContext } from '@/lib/company/developer-preview-context'
import { useRenderWatch } from '@/lib/diagnostics'
import { isCompanyReviewer } from '@/lib/company/capabilities'

export function DeveloperPreviewProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { pathname } = useLocation()
  const allowed = Boolean(canPreviewProfile(auth.profile, auth.session?.user.email ?? null))
  const reviewer = isCompanyReviewer(auth.profile)
  const [selection, setSelection] = useState<{ owner: string; pathname: string; id: string } | null>(null)
  const cases = useMemo(() => allowed && auth.profile ? completePagePreviewCases(pathname, auth.profile) : [], [allowed, pathname, auth.profile])
  const selected = allowed && selection?.owner === auth.profile?.id && selection?.pathname === pathname
    ? cases.find(item => item.id === selection?.id) ?? null : null
  const apply = useCallback((id: string | null) => {
    if (!allowed || !auth.profile) return
    if (id && !cases.some(item => item.id === id)) return
    setSelection(id ? { owner: auth.profile.id, pathname, id } : null)
  }, [allowed, auth.profile, pathname, cases])
  const value = useMemo(() => ({ allowed, reviewer, pathname, cases, selected, apply }), [allowed, reviewer, pathname, cases, selected, apply])
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

/** KeepAlive 내부의 고정된 경로와 비교해 해당 페이지에만 표시 프로필을 적용한다. */
export function DeveloperPreviewPage({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const context = useContext(PreviewContext)
  const facts = context?.pathname === pathname ? context.selected?.facts : undefined
  const settings = context?.pathname === pathname && !facts?.chatRole ? context.selected?.settings : null
  const displayed = useMemo(() => profile && settings ? previewProfile(profile, settings) : profile, [profile, settings])
  const preview = useMemo(() => ({ facts, realProfile: profile, active: Boolean(settings || facts) }), [facts, profile, settings])
  return <PagePreviewContext.Provider value={preview}><AuthDisplayProvider profile={displayed}>{children}</AuthDisplayProvider></PagePreviewContext.Provider>
}

export function DeveloperPreviewBar({ scope = 'page' }: { scope?: 'page' | 'chat' }) {
  useRenderWatch('DeveloperPreviewBar')
  const context = useContext(PreviewContext)
  if (!context?.allowed) return null
  const { apply } = context
  const chat = scope === 'chat'
  const cases = context.cases.filter(item => Boolean(item.facts?.chatRole) === chat)
  const selected = Boolean(context.selected?.facts?.chatRole) === chat ? context.selected : null
  return <section aria-label={chat ? '채팅 화면 미리보기' : '개발자 화면 미리보기'} className="shrink-0 border-b border-border bg-muted/30 px-4 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 flex items-center gap-1.5 text-muted-foreground"><FlaskConical size={13} />{chat ? '채팅 화면 테스트' : '화면 테스트'}</span>
      {context.reviewer && <span className="rounded-md bg-card px-2 py-1 text-muted-foreground">대표이사 · 제작 화면 검수</span>}
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1" aria-label="화면 테스트 항목">
      {cases.length ? cases.map(item => <button key={item.id} type="button" aria-pressed={selected?.id === item.id} onClick={() => apply(item.id)} className={`shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 transition-colors ${selected?.id === item.id ? 'border-amber-400 bg-amber-100 font-medium text-amber-950' : 'border-border bg-card text-foreground hover:bg-muted'}`}>{item.label}</button>) : <span className="text-muted-foreground">구분 없음</span>}
      </div>
      {context.reviewer && <span className="text-[11px] text-muted-foreground">변경·승인은 로그인 계정의 기존 권한을 따릅니다.</span>}
      {selected && <><span className="text-[11px] text-amber-800">{context.reviewer ? '표시 역할 변경 중 · 실제 권한은 유지' : '실제 저장 · 로그인 계정으로 실행'}</span><button type="button" onClick={() => apply(null)} aria-label="미리보기 종료" title="내 계정으로 돌아가기" className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"><RotateCcw size={12} />종료</button></>}
    </div>
  </section>
}
