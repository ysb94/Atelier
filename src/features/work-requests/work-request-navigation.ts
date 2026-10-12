/**
 * 작업 요청 화면 단계(목록·상세·수정·새 요청)를 URL query와 오가는 순수 함수.
 * pathname은 건드리지 않으므로 업무 탭 식별자(경로 기준)가 그대로 유지되고,
 * brand 등 다른 query는 순서·값을 보존한다.
 *
 * - 목록: query 없음
 * - 상세: ?requestId=ID
 * - 수정: ?requestId=ID&mode=edit
 * - 새 요청: ?mode=new
 */

export const WORK_REQUEST_ID_PARAM = 'requestId'
export const WORK_REQUEST_MODE_PARAM = 'mode'

export type WorkRequestView =
  | { kind: 'list' }
  | { kind: 'detail'; requestId: string }
  | { kind: 'edit'; requestId: string }
  | { kind: 'new' }

/** URL을 그대로 보여줄 수 없어 다른 단계로 되돌린 이유 */
export type WorkRequestRecovery =
  | 'invalidMode'
  | 'missing'
  | 'needsReviewStart'
  | 'notEditable'
  | 'cannotCreate'

export type ResolvedWorkRequestView = {
  view: WorkRequestView
  recovery: WorkRequestRecovery | null
}

/** 현재 역할로 열 수 있는 요청의 접근 조건. 열 수 없으면 null을 돌려준다. */
export type WorkRequestAccess = {
  /** 관리자가 신규 요청을 열면 기존처럼 검토 시작 확인을 거쳐야 한다. */
  needsReviewStart: boolean
  editable: boolean
}

export type WorkRequestAccessContext = {
  canCreate: boolean
  accessOf: (requestId: string) => WorkRequestAccess | null
}

export type WorkRequestNavAction =
  | { type: 'openDetail'; requestId: string }
  | { type: 'closeDetail' }
  | { type: 'openEdit'; requestId: string }
  | { type: 'openNew' }
  | { type: 'cancelForm' }
  | { type: 'saved'; requestId: string }
  | { type: 'deleted' }

export type WorkRequestNavigation = { search: string; replace: boolean }

const LIST_VIEW: WorkRequestView = { kind: 'list' }

function toParams(search: string | URLSearchParams): URLSearchParams {
  return new URLSearchParams(
    typeof search === 'string' ? search : search.toString(),
  )
}

function toSearch(params: URLSearchParams): string {
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** URL query를 화면 단계로 해석한다. 권한·존재 여부는 보지 않는다. */
export function parseWorkRequestView(
  search: string | URLSearchParams,
): ResolvedWorkRequestView {
  const params = toParams(search)
  const requestId = params.get(WORK_REQUEST_ID_PARAM)?.trim() ?? ''
  const hasMode = params.has(WORK_REQUEST_MODE_PARAM)
  const mode = params.get(WORK_REQUEST_MODE_PARAM)

  if (!hasMode) {
    return {
      view: requestId ? { kind: 'detail', requestId } : LIST_VIEW,
      recovery: null,
    }
  }
  if (mode === 'edit' && requestId) {
    return { view: { kind: 'edit', requestId }, recovery: null }
  }
  if (mode === 'new' && !requestId) {
    return { view: { kind: 'new' }, recovery: null }
  }
  // 알 수 없는 mode, requestId 없는 edit, requestId가 붙은 new는 새 양식을 열지 않고
  // 기존 요청 상세(있으면) 또는 목록으로 되돌린다.
  return {
    view: requestId ? { kind: 'detail', requestId } : LIST_VIEW,
    recovery: 'invalidMode',
  }
}

/** URL 단계를 현재 데이터·권한으로 확인해 실제로 보여줄 단계를 정한다. */
export function resolveWorkRequestView(
  search: string | URLSearchParams,
  context: WorkRequestAccessContext,
): ResolvedWorkRequestView {
  const parsed = parseWorkRequestView(search)
  const { view } = parsed
  if (view.kind === 'list') return parsed
  if (view.kind === 'new') {
    return context.canCreate
      ? parsed
      : { view: LIST_VIEW, recovery: 'cannotCreate' }
  }
  const access = context.accessOf(view.requestId)
  if (!access) return { view: LIST_VIEW, recovery: 'missing' }
  if (access.needsReviewStart) {
    return { view: LIST_VIEW, recovery: 'needsReviewStart' }
  }
  if (view.kind === 'edit' && !access.editable) {
    return {
      view: { kind: 'detail', requestId: view.requestId },
      recovery: 'notEditable',
    }
  }
  return parsed
}

/** 현재 query에서 작업 요청 키만 바꾼 query를 만든다. 다른 키는 순서까지 보존한다. */
export function buildWorkRequestSearch(
  search: string | URLSearchParams,
  view: WorkRequestView,
): string {
  const params = toParams(search)
  const requestId =
    view.kind === 'detail' || view.kind === 'edit' ? view.requestId : null
  const mode =
    view.kind === 'edit' ? 'edit' : view.kind === 'new' ? 'new' : null
  if (requestId) params.set(WORK_REQUEST_ID_PARAM, requestId)
  else params.delete(WORK_REQUEST_ID_PARAM)
  if (mode) params.set(WORK_REQUEST_MODE_PARAM, mode)
  else params.delete(WORK_REQUEST_MODE_PARAM)
  return toSearch(params)
}

function sortedEntries(search: string | URLSearchParams): string {
  return JSON.stringify(
    [...toParams(search).entries()].sort(([a, av], [b, bv]) =>
      a === b ? av.localeCompare(bv) : a.localeCompare(b),
    ),
  )
}

/** 두 query가 키 순서·인코딩만 다르고 같은 값인지 확인한다. */
export function isSameWorkRequestSearch(
  left: string | URLSearchParams,
  right: string | URLSearchParams,
): boolean {
  return sortedEntries(left) === sortedEntries(right)
}

/**
 * 보이는 탭에서만 잘못된 URL을 실제 단계로 바꿀 query를 돌려준다(replace 전용).
 * 숨겨진 KeepAlive 탭은 전역 주소를 바꾸면 안 되므로 항상 null이다.
 */
export function workRequestRecoverySearch(
  search: string | URLSearchParams,
  resolved: ResolvedWorkRequestView,
  options: { active: boolean },
): string | null {
  if (!options.active) return null
  const next = buildWorkRequestSearch(search, resolved.view)
  return isSameWorkRequestSearch(search, next) ? null : next
}

/** 사용자 조작을 다음 URL과 history 처리(push/replace)로 바꾼다. */
export function workRequestNavigation(
  search: string | URLSearchParams,
  current: WorkRequestView,
  action: WorkRequestNavAction,
): WorkRequestNavigation {
  switch (action.type) {
    case 'openDetail':
      return {
        search: buildWorkRequestSearch(search, {
          kind: 'detail',
          requestId: action.requestId,
        }),
        replace: false,
      }
    case 'closeDetail':
      return { search: buildWorkRequestSearch(search, LIST_VIEW), replace: false }
    case 'openEdit':
      return {
        search: buildWorkRequestSearch(search, {
          kind: 'edit',
          requestId: action.requestId,
        }),
        replace: false,
      }
    case 'openNew':
      return {
        search: buildWorkRequestSearch(search, { kind: 'new' }),
        replace: false,
      }
    case 'cancelForm':
      return {
        search: buildWorkRequestSearch(
          search,
          current.kind === 'edit'
            ? { kind: 'detail', requestId: current.requestId }
            : LIST_VIEW,
        ),
        replace: false,
      }
    case 'saved':
      // 저장한 양식 entry를 상세로 덮어써, 뒤로가기로 같은 양식이 다시 열려
      // 중복 저장되지 않게 한다.
      return {
        search: buildWorkRequestSearch(search, {
          kind: 'detail',
          requestId: action.requestId,
        }),
        replace: true,
      }
    case 'deleted':
      return { search: buildWorkRequestSearch(search, LIST_VIEW), replace: true }
  }
}

/** 화면 단계가 바뀌었는지 비교하는 키 */
export function workRequestScreenKey(view: WorkRequestView): string {
  switch (view.kind) {
    case 'list':
      return 'list'
    case 'detail':
      return `detail:${view.requestId}`
    case 'edit':
      return `edit:${view.requestId}`
    case 'new':
      return 'new'
  }
}

/** 양식 초안 키. 요청별 수정 초안과 새 요청 초안을 서로 섞지 않는다. */
export function workRequestDraftKey(view: WorkRequestView): string | null {
  if (view.kind === 'edit') return `edit:${view.requestId}`
  if (view.kind === 'new') return 'new'
  return null
}

/**
 * 양식을 초안으로 보관할지 판단한다. 브랜드 선택은 입력 수정(hasEdited)으로 세지 않으므로
 * 양식을 처음 열 때의 브랜드와 달라졌는지도 함께 본다.
 */
export function isWorkRequestDraftDirty(state: {
  hasEdited: boolean
  brandId: string
  baseBrandId: string
}): boolean {
  return state.hasEdited || state.brandId !== state.baseBrandId
}

/**
 * 양식 단계를 떠나고 들어올 때 초안을 보관·복원한다.
 * 떠나는 양식이 수정된 상태면 그 키로 보관하고, 수정 전이면 남은 초안을 지운다.
 * 들어오는 양식은 같은 키의 초안을, 없으면 initial을 쓴다.
 */
export function switchWorkRequestDraft<T>(
  drafts: Readonly<Record<string, T>>,
  move: {
    fromKey: string | null
    toKey: string | null
    current: T
    dirty: boolean
    initial: (key: string) => T
  },
): { drafts: Readonly<Record<string, T>>; loaded: T | null } {
  let next = drafts
  if (move.fromKey && move.fromKey !== move.toKey) {
    next = move.dirty
      ? { ...drafts, [move.fromKey]: move.current }
      : dropWorkRequestDraft(drafts, move.fromKey)
  }
  if (!move.toKey) return { drafts: next, loaded: null }
  return {
    drafts: next,
    loaded: next[move.toKey] ?? move.initial(move.toKey),
  }
}

export function dropWorkRequestDraft<T>(
  drafts: Readonly<Record<string, T>>,
  key: string | null,
): Readonly<Record<string, T>> {
  if (!key || !(key in drafts)) return drafts
  const next = { ...drafts }
  delete next[key]
  return next
}

/** 숨겨진 탭은 Escape에 반응하지 않는다. */
export function shouldListenWorkRequestEscape(state: {
  tabActive: boolean
  detailOpen: boolean
  acceptOpen: boolean
  reviewConfirmOpen: boolean
}): boolean {
  return (
    state.tabActive &&
    (state.detailOpen || state.acceptOpen || state.reviewConfirmOpen)
  )
}
