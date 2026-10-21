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
import type { PreviewGroup } from '@/lib/company/page-preview-cases'

export function DeveloperPreviewProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { pathname, search } = useLocation()
  const viewKey=pathname+'?part='+(new URLSearchParams(search).get('part') ?? '')
  const allowed = Boolean(canPreviewProfile(auth.profile, auth.session?.user.email ?? null))
  const reviewer = isCompanyReviewer(auth.profile)
  const [selection, setSelection] = useState<{ owner: string; viewKey: string; ids: Partial<Record<PreviewGroup,string>> } | null>(null)
  const cases = useMemo(() => allowed && auth.profile ? completePagePreviewCases(pathname, auth.profile, search) : [], [allowed, pathname, search, auth.profile])
  const selectedItems=useMemo(()=>allowed && selection?.owner===auth.profile?.id && selection?.viewKey===viewKey
    ? cases.filter(item=>selection.ids[item.group]===item.id):[],[allowed,selection,auth.profile?.id,viewKey,cases])
  const selected=selectedItems.find(item=>item.group==='role') ?? null
  const selectedIds=useMemo(()=>Object.fromEntries(selectedItems.map(item=>[item.group,item.id])),[selectedItems])
  const facts=useMemo(()=>selectedItems.length?Object.assign({},...selectedItems.map(item=>item.facts)):undefined,[selectedItems])
  const apply = useCallback((id: string | null, group?: PreviewGroup) => {
    if (!allowed || !auth.profile) return
    if (!id && !group) {setSelection(null);return}
    const item=cases.find(item=>item.id===id)
    if (id && (!item || (group && item.group!==group))) return
    const kind=group ?? item!.group
    setSelection(previous=>({owner:auth.profile!.id,viewKey,ids:{...(previous?.owner===auth.profile!.id && previous?.viewKey===viewKey?previous.ids:{}),[kind]:id ?? undefined}}))
  }, [allowed, auth.profile, viewKey, cases])
  const value = useMemo(() => ({ allowed, reviewer, pathname, viewKey, cases, selected, selectedIds, facts, apply }), [allowed, reviewer, pathname, viewKey, cases, selected, selectedIds, facts, apply])
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

/** KeepAlive 내부의 고정된 경로와 비교해 해당 페이지에만 표시 프로필을 적용한다. */
export function DeveloperPreviewPage({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { pathname, search } = useLocation()
  const context = useContext(PreviewContext)
  const current=context?.viewKey===pathname+'?part='+(new URLSearchParams(search).get('part') ?? '')
  const facts = current ? context?.facts : undefined
  const settings = current ? context?.selected?.settings : null
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
  const cases = context.cases.filter(item => item.group === (chat?'chat':'role'))
  const selectedId = context.selectedIds[chat?'chat':'role']
  const active=chat?Boolean(context.selectedIds.chat):Boolean(context.selectedIds.role || context.selectedIds.request || context.selectedIds.meeting)
  return <section aria-label={chat ? '채팅 화면 미리보기' : '개발자 화면 미리보기'} className="shrink-0 border-b border-border bg-muted/30 px-4 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 flex items-center gap-1.5 text-muted-foreground"><FlaskConical size={13} />{chat ? '채팅 화면 테스트' : '화면 테스트'}</span>
      {context.reviewer && <span className="rounded-md bg-card px-2 py-1 text-muted-foreground">회사 현황 조회 담당</span>}
      <div role="group" className="flex min-w-0 flex-wrap gap-2 py-1" aria-label="표시 역할">
      {cases.length ? cases.map(item => <button key={item.id} type="button" aria-pressed={selectedId === item.id} onClick={() => apply(item.id)} className={`shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 transition-colors ${selectedId === item.id ? 'border-amber-400 bg-amber-100 font-medium text-amber-950' : 'border-border bg-card text-foreground hover:bg-muted'}`}>{item.label}</button>) : <span className="text-muted-foreground">구분 없음</span>}
      </div>
      {!chat && (['request','meeting'] as const).map(group=>{
        const options=context.cases.filter(item=>item.group===group)
        if (!options.length) return null
        const label=group==='request'?'신청 관계':'회의 관계'
        return <label key={group} className="flex shrink-0 items-center gap-2 text-muted-foreground">{label}<select aria-label={label} value={context.selectedIds[group] ?? ''} onChange={event=>apply(event.target.value || null,group)} className="rounded-md border border-border bg-card px-2 py-1.5 text-foreground"><option value="">실제 {label}</option>{options.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      })}
      {context.reviewer && <span className="text-[11px] text-muted-foreground">변경·승인은 로그인 계정의 기존 권한을 따릅니다.</span>}
      {active && <><span className="text-[11px] text-amber-800">표시만 변경 중 · 실제 권한 유지</span><button type="button" onClick={() => apply(null)} aria-label="미리보기 종료" title="내 계정으로 돌아가기" className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"><RotateCcw size={12} />종료</button></>}
    </div>
  </section>
}
