import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, RotateCcw, Users } from 'lucide-react'
import { useAuth } from '@/lib/supabase/auth'
import { canPreviewProfile } from '@/lib/company/profile-preview'
import { PagePreviewContext } from '@/lib/company/page-preview-context'
import { PreviewContext } from '@/lib/company/developer-preview-context'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  ImpersonationError,
  clearImpersonationState,
  isImpersonationSwitching,
  listImpersonationTargets,
  readImpersonationState,
  returnToOperator,
  startImpersonation,
  type ImpersonationTarget,
} from '@/lib/supabase/impersonation'

const emptyPreview = {
  allowed: false,
  reviewer: false,
  pathname: '',
  viewKey: '',
  cases: [],
  selected: null,
  selectedIds: {},
  facts: undefined,
  apply: () => {},
}

/** 역할 표시 전환은 쓰지 않는다. 실제 세션이 화면과 데이터를 결정한다. */
export function DeveloperPreviewProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => emptyPreview, [])
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

export function DeveloperPreviewPage({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const preview = useMemo(() => ({ facts: undefined, realProfile: profile, active: false as const }), [profile])
  return <PagePreviewContext.Provider value={preview}>{children}</PagePreviewContext.Provider>
}

export function DeveloperPreviewBar({ scope = 'page' }: { scope?: 'page' | 'chat' }) {
  useRenderWatch('DeveloperPreviewBar')
  if (scope === 'chat') return <ImpersonationChatNotice />
  return <EmployeeImpersonationBar />
}

function ImpersonationChatNotice() {
  const { session } = useAuth()
  const stored = readImpersonationState()
  if (!stored || !session || stored.operatorId === session.user.id || stored.targetId !== session.user.id) return null
  return <p className="shrink-0 border-b border-border bg-muted/30 px-4 py-2 text-xs text-warning">{stored.targetName} 계정으로 보는 중</p>
}

function groupTargets(targets: readonly ImpersonationTarget[]) {
  const map = new Map<string, ImpersonationTarget[]>()
  for (const target of targets) {
    const department = target.department?.trim() || '부서 없음'
    const people = map.get(department) ?? []
    people.push(target)
    map.set(department, people)
  }
  return [...map.entries()]
    .sort(([left], [right]) => {
      if (left === '부서 없음') return 1
      if (right === '부서 없음') return -1
      return left.localeCompare(right, 'ko')
    })
    .map(([department, people]) => ({
      department,
      people: [...people].sort((left, right) => left.name.localeCompare(right.name, 'ko')),
    }))
}

function EmployeeImpersonationBar() {
  const auth = useAuth()
  const sessionUserId = auth.session?.user.id ?? null
  const allowed = Boolean(canPreviewProfile(auth.profile, auth.session?.user.email ?? null))
  const [stored, setStored] = useState(readImpersonationState)
  const [targets, setTargets] = useState<ImpersonationTarget[]>([])
  const [phase, setPhase] = useState<'check' | 'ready' | 'hidden'>('check')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const impersonating = Boolean(stored && sessionUserId && stored.operatorId !== sessionUserId && stored.targetId === sessionUserId)
  const groups = useMemo(() => groupTargets(targets), [targets])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    let state = readImpersonationState()
    if (state && sessionUserId && sessionUserId !== state.targetId && !isImpersonationSwitching()) {
      if (sessionUserId !== state.operatorId) {
        console.warn('[impersonation] 현재 로그인과 보관된 전환이 달라 보관값을 지웁니다.', { operatorId: state.operatorId, targetId: state.targetId })
      }
      clearImpersonationState()
      state = null
      setStored(null)
    } else {
      setStored(state)
    }
    const show = Boolean((state && sessionUserId === state.targetId) || (!state && allowed))
    if (!show) {
      setPhase('hidden')
      return
    }
    setPhase('check')
    setListError(null)
    void listImpersonationTargets(state?.accessToken).then((next) => {
      if (cancelled) return
      setTargets(next)
      setPhase('ready')
    }).catch((caught) => {
      if (cancelled) return
      const status = caught instanceof ImpersonationError ? caught.status : 0
      if (status !== 0) console.warn('[impersonation] 직원 목록 조회 실패', { status })
      if (state && sessionUserId === state.targetId) {
        setPhase('ready')
        setListError('직원 목록을 불러오지 못했습니다. 내 계정으로 돌아간 뒤 다시 선택해 주세요.')
      } else {
        setPhase('hidden')
      }
    })
    return () => {
      cancelled = true
    }
  }, [allowed, sessionUserId])

  async function choose(person: ImpersonationTarget) {
    if (pending) return
    setError(null)
    if (stored && person.id === stored.operatorId) {
      setPending(true)
      const result = await returnToOperator()
      if (result === 'failed') setPending(false)
      return
    }
    if (person.id === sessionUserId) return
    setPending(true)
    try {
      await startImpersonation(person.id, auth.profile?.displayName?.trim() || '내 계정')
    } catch (caught) {
      console.warn('[impersonation] 계정 전환 실패', { targetId: person.id, message: caught instanceof Error ? caught.message : 'unknown' })
      setError(caught instanceof Error ? caught.message : '계정 전환에 실패했습니다.')
      setStored(readImpersonationState())
      setPending(false)
    }
  }

  if (phase === 'hidden') return null
  if (!impersonating && phase !== 'ready') return null

  return <section aria-label="직원 계정 전환" aria-busy={pending} className="shrink-0 border-b border-border bg-muted/30 px-4 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex items-center gap-1.5 rounded-md px-1 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
        <Users size={13} />
        직원 계정
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {impersonating && stored ? <span className="text-[11px] text-warning">{stored.targetName} 계정으로 사용 중 · 저장·승인·채팅·읽음이 이 직원 이름으로 기록됩니다</span> : null}
      {impersonating ? <button type="button" disabled={pending} onClick={() => { if (pending) return; setPending(true); void returnToOperator().then((result) => { if (result === 'failed') setPending(false) }) }} className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-60"><RotateCcw size={12} />내 계정으로 돌아가기</button> : null}
    </div>
    {open ? <div className="mt-2 rounded-md border border-border bg-card p-2">
      <div role="group" aria-label="재직 직원" className="flex overflow-x-auto pb-1">
        {groups.map((group, index) => <div key={group.department} className={`min-w-[8.5rem] shrink-0 px-3 ${index > 0 ? 'border-l border-border' : ''}`}>
          <p className="mb-1 px-1 py-0.5 text-xs font-medium">{group.department}</p>
          <ul className="space-y-0.5">
            {group.people.map((person) => {
              const current = person.id === sessionUserId
              return <li key={person.id}>
                <button type="button" aria-pressed={current} disabled={pending} onClick={() => void choose(person)} className={`flex w-full flex-col rounded px-1.5 py-1 text-left transition-colors disabled:opacity-60 ${current ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted'}`}>
                  <span className="font-medium">{person.name}</span>
                  {person.position ? <span className={`text-[10px] ${current ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{person.position}</span> : null}
                </button>
              </li>
            })}
          </ul>
        </div>)}
      </div>
    </div> : null}
    {error || listError ? <p role="alert" className="pt-2 text-danger">{error ?? listError}</p> : null}
  </section>
}
