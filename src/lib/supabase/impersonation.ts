import { getSupabase } from '@/lib/supabase/client'

const STORAGE_KEY = 'atelier:impersonation'
let switching = 0
let protectedUntil = 0

/** 전환 도중에는 보관값을 오래된 세션으로 보고 지우지 않는다. */
export function isImpersonationSwitching() {
  return switching > 0 || Date.now() < protectedUntil
}

export class ImpersonationError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ImpersonationError'
    this.status = status
  }
}

export type ImpersonationTarget = {
  id: string
  name: string
  department: string | null
  position: string | null
}

type StoredImpersonation = {
  v: 1
  operatorId: string
  operatorName: string
  accessToken: string
  refreshToken: string
  targetId: string
  targetName: string
  eventId: string
  employeeAccessToken: string
}

type InvokeError = {
  message?: string
  context?: { status?: number; json?: () => Promise<unknown> }
}

function browserStorage() {
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

function isStored(value: unknown): value is StoredImpersonation {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<StoredImpersonation>
  return row.v === 1
    && typeof row.operatorId === 'string'
    && typeof row.accessToken === 'string'
    && typeof row.refreshToken === 'string'
    && typeof row.targetId === 'string'
}

export function readImpersonationState(): StoredImpersonation | null {
  const storage = browserStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isStored(parsed)) {
      storage.removeItem(STORAGE_KEY)
      return null
    }
    return {
      ...parsed,
      operatorName: parsed.operatorName?.trim() || '내 계정',
      targetName: parsed.targetName?.trim() || '직원',
      eventId: parsed.eventId || '',
      employeeAccessToken: parsed.employeeAccessToken || '',
    }
  } catch (error) {
    console.warn('[impersonation] 보관값을 읽지 못했습니다.', { message: error instanceof Error ? error.message : 'unknown' })
    try {
      storage.removeItem(STORAGE_KEY)
    } catch {
      // 저장소를 지우지 못해도 잘못된 값은 사용하지 않는다.
    }
    return null
  }
}

export function clearImpersonationState() {
  const storage = browserStorage()
  if (!storage) return
  try {
    storage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.warn('[impersonation] 보관값을 지우지 못했습니다.', { message: error instanceof Error ? error.message : 'unknown' })
  }
}

function writeState(state: StoredImpersonation) {
  const storage = browserStorage()
  if (!storage) throw new ImpersonationError('이 브라우저에 원래 계정을 보관하지 못해 전환하지 않았습니다.')
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
    protectedUntil = Date.now() + 15_000
  } catch (error) {
    console.warn('[impersonation] 운영자 세션을 보관하지 못했습니다.', { message: error instanceof Error ? error.message : 'unknown' })
    throw new ImpersonationError('이 브라우저에 원래 계정을 보관하지 못해 전환하지 않았습니다.')
  }
}

function goHome() {
  if (window.location.pathname === '/' && window.location.search === '') {
    window.location.reload()
    return
  }
  window.location.assign('/')
}

async function invoke(body: Record<string, unknown>, accessToken?: string) {
  const supabase = getSupabase() as {
    functions?: {
      invoke?: (name: string, options: { body: unknown; headers?: Record<string, string> }) => Promise<{ data: unknown; error: InvokeError | null }>
    }
  }
  if (typeof supabase.functions?.invoke !== 'function') {
    throw new ImpersonationError('계정 전환 함수를 호출할 수 없습니다.', 0)
  }
  const { data, error } = await supabase.functions.invoke('impersonate-employee', {
    body,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  })
  if (error) {
    let message = error.message || '계정 전환 요청이 실패했습니다.'
    const status = typeof error.context?.status === 'number' ? error.context.status : 0
    try {
      const parsed = await error.context?.json?.() as { error?: string } | undefined
      if (parsed?.error) message = parsed.error
    } catch {
      // 본문이 JSON이 아니면 상태 문구를 그대로 보여 준다.
    }
    throw new ImpersonationError(message, status)
  }
  return data
}

function asTarget(value: unknown): ImpersonationTarget | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<ImpersonationTarget>
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  return {
    id: row.id,
    name: row.name.trim() || '이름 없음',
    department: typeof row.department === 'string' && row.department.trim() ? row.department.trim() : null,
    position: typeof row.position === 'string' && row.position.trim() ? row.position.trim() : null,
  }
}

export async function listImpersonationTargets(accessToken?: string) {
  const data = await invoke({ action: 'list' }, accessToken) as { targets?: unknown } | null
  if (!data || !Array.isArray(data.targets)) throw new ImpersonationError('직원 목록 응답이 올바르지 않습니다.')
  return data.targets.map(asTarget).filter((row): row is ImpersonationTarget => Boolean(row))
}

async function closeEvent(accessToken: string, eventId: string, employeeAccessToken: string) {
  if (!eventId) return
  try {
    await invoke({ action: 'stop', eventId, employeeAccessToken }, accessToken)
  } catch (error) {
    console.warn('[impersonation] 직원 세션 폐기 실패', { message: error instanceof Error ? error.message : 'unknown' })
  }
}

/** 보관한 운영자 세션으로 돌아간다. 직원 전환 세션만 서버에서 폐기한다. */
export async function returnToOperator(options?: { navigate?: boolean }): Promise<'restored' | 'failed'> {
  const navigate = options?.navigate !== false
  const state = readImpersonationState()
  if (!state) {
    if (navigate) goHome()
    return 'restored'
  }
  const supabase = getSupabase()
  const current = (await supabase.auth.getSession()).data.session
  const employeeAccessToken = current?.user.id === state.targetId ? current.access_token : state.employeeAccessToken
  const { data, error } = await supabase.auth.setSession({
    access_token: state.accessToken,
    refresh_token: state.refreshToken,
  })
  if (error || !data.session || data.session.user.id !== state.operatorId) {
    console.warn('[impersonation] 운영자 세션 복원 실패', { operatorId: state.operatorId, targetId: state.targetId })
    clearImpersonationState()
    const signedOut = await supabase.auth.signOut({ scope: 'local' })
    if (signedOut.error) console.warn('[impersonation] 로그아웃 실패', { message: signedOut.error.message })
    if (navigate) goHome()
    return 'failed'
  }
  await closeEvent(data.session.access_token, state.eventId, employeeAccessToken)
  clearImpersonationState()
  if (navigate) goHome()
  return 'restored'
}

export async function startImpersonation(targetId: string, operatorName: string) {
  switching += 1
  try {
  const existing = readImpersonationState()
  if (existing) {
    const restored = await returnToOperator({ navigate: false })
    if (restored !== 'restored') throw new ImpersonationError('원래 계정으로 돌아가지 못해 다른 직원으로 바꾸지 못했습니다.')
  }
  const supabase = getSupabase()
  const session = (await supabase.auth.getSession()).data.session
  if (!session?.access_token || !session.refresh_token || !session.user.id) {
    throw new ImpersonationError('로그인이 필요합니다.')
  }
  if (session.user.id === targetId) return
  const operator = {
    operatorId: session.user.id,
    operatorName: existing?.operatorName?.trim() || operatorName.trim() || '내 계정',
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  }
  const data = await invoke({ action: 'start', targetId }, operator.accessToken) as {
    tokenHash?: string
    verificationType?: string
    eventId?: string
    target?: unknown
  } | null
  const target = asTarget(data?.target)
  const tokenHash = data?.tokenHash?.trim() ?? ''
  const eventId = data?.eventId?.trim() ?? ''
  if (!target || target.id !== targetId || !tokenHash || !eventId) {
    throw new ImpersonationError('계정 전환 응답이 올바르지 않습니다.')
  }
  const stored: StoredImpersonation = {
    v: 1,
    ...operator,
    targetId,
    targetName: target.name,
    eventId,
    employeeAccessToken: '',
  }
  writeState(stored)
  const verified = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: data?.verificationType === 'email' ? 'email' : 'magiclink',
  })
  if (verified.error || !verified.data.session || verified.data.session.user.id !== targetId) {
    clearImpersonationState()
    await closeEvent(operator.accessToken, eventId, '')
    if (verified.data.session && verified.data.session.user.id !== operator.operatorId) {
      await supabase.auth.setSession({ access_token: operator.accessToken, refresh_token: operator.refreshToken })
    }
    const detail = verified.error?.message ?? ''
    const message = /rate limit|too many/i.test(detail)
      ? '계정 전환 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
      : /otp_expired|expired/i.test(detail)
        ? '전환 링크가 만료되었습니다. 다시 선택해 주세요.'
        : '선택한 직원 세션을 열지 못했습니다.'
    throw new ImpersonationError(message)
  }
  try {
    writeState({ ...stored, employeeAccessToken: verified.data.session.access_token })
  } catch (error) {
    console.warn('[impersonation] 직원 세션 토큰 보관 실패', { targetId, message: error instanceof Error ? error.message : 'unknown' })
  }
  goHome()
  } finally {
    switching -= 1
  }
}
