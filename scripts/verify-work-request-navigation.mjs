import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildWorkRequestSearch,
  dropWorkRequestDraft,
  isSameWorkRequestSearch,
  isWorkRequestDraftDirty,
  parseWorkRequestView,
  resolveWorkRequestView,
  shouldListenWorkRequestEscape,
  switchWorkRequestDraft,
  workRequestDraftKey,
  workRequestNavigation,
  workRequestRecoverySearch,
  workRequestScreenKey,
} from '../src/features/work-requests/work-request-navigation.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PATHNAME = '/work-requests/planning'

function params(search) {
  return Object.fromEntries(new URLSearchParams(search))
}

// ── URL 해석 ──────────────────────────────────────────────
assert.deepEqual(parseWorkRequestView(''), { view: { kind: 'list' }, recovery: null })
assert.deepEqual(parseWorkRequestView('?brand=undecided'), { view: { kind: 'list' }, recovery: null })
assert.deepEqual(parseWorkRequestView('?requestId=R1'), { view: { kind: 'detail', requestId: 'R1' }, recovery: null })
assert.deepEqual(parseWorkRequestView('?requestId=R1&mode=edit'), { view: { kind: 'edit', requestId: 'R1' }, recovery: null })
assert.deepEqual(parseWorkRequestView('?mode=new'), { view: { kind: 'new' }, recovery: null })
assert.deepEqual(parseWorkRequestView('?requestId=R1&mode=bogus'), { view: { kind: 'detail', requestId: 'R1' }, recovery: 'invalidMode' })
assert.deepEqual(parseWorkRequestView('?mode=bogus'), { view: { kind: 'list' }, recovery: 'invalidMode' })
assert.deepEqual(parseWorkRequestView('?mode='), { view: { kind: 'list' }, recovery: 'invalidMode' })
assert.deepEqual(parseWorkRequestView('?mode=edit'), { view: { kind: 'list' }, recovery: 'invalidMode' })
assert.deepEqual(parseWorkRequestView('?requestId=R1&mode=new'), { view: { kind: 'detail', requestId: 'R1' }, recovery: 'invalidMode' })
assert.deepEqual(parseWorkRequestView('?requestId=%20%20'), { view: { kind: 'list' }, recovery: null })

// ── query 작성: 다른 query 보존, 순서 유지 ───────────────────
assert.equal(buildWorkRequestSearch('?brand=undecided', { kind: 'detail', requestId: 'R1' }), '?brand=undecided&requestId=R1')
assert.equal(buildWorkRequestSearch('?brand=undecided&requestId=R1', { kind: 'edit', requestId: 'R1' }), '?brand=undecided&requestId=R1&mode=edit')
assert.equal(buildWorkRequestSearch('?requestId=R1&brand=undecided&mode=edit', { kind: 'list' }), '?brand=undecided')
assert.equal(buildWorkRequestSearch('?brand=undecided&x=1', { kind: 'new' }), '?brand=undecided&x=1&mode=new')
assert.equal(buildWorkRequestSearch('', { kind: 'list' }), '')
assert.equal(buildWorkRequestSearch('?requestId=a&requestId=b', { kind: 'detail', requestId: 'b' }), '?requestId=b')
assert.ok(isSameWorkRequestSearch('?a=1&b=2', '?b=2&a=1'))
assert.ok(!isSameWorkRequestSearch('?a=1', '?a=1&a=1'))
console.info('PASS: URL 해석·작성, brand 등 기존 query 보존')

// ── 접근 조건(기존 역할 조건을 그대로 주입) ─────────────────────
function makeContext(role, requests) {
  return {
    canCreate: role === 'requester',
    accessOf(requestId) {
      const request = requests.get(requestId)
      if (!request) return null
      return {
        needsReviewStart: role === 'manager' && request.status === 'requested',
        editable: role === 'requester' && request.status === 'requested',
      }
    },
  }
}
const baseRequests = () =>
  new Map([
    ['R1', { id: 'R1', title: 'R1 원본', brandId: '', status: 'requested' }],
    ['R2', { id: 'R2', title: 'R2 원본', brandId: '', status: 'requested' }],
    ['R3', { id: 'R3', title: 'R3 원본', brandId: 'B1', status: 'accepted' }],
    ['R4', { id: 'R4', title: 'R4 원본', brandId: 'B2', status: 'requested' }],
  ])

{
  const requester = makeContext('requester', baseRequests())
  const member = makeContext('member', baseRequests())
  const manager = makeContext('manager', baseRequests())
  assert.deepEqual(resolveWorkRequestView('?requestId=NOPE', requester), { view: { kind: 'list' }, recovery: 'missing' })
  assert.deepEqual(resolveWorkRequestView('?requestId=NOPE&mode=edit', requester), { view: { kind: 'list' }, recovery: 'missing' })
  assert.deepEqual(resolveWorkRequestView('?requestId=R3&mode=edit', requester), { view: { kind: 'detail', requestId: 'R3' }, recovery: 'notEditable' })
  assert.deepEqual(resolveWorkRequestView('?mode=new', member), { view: { kind: 'list' }, recovery: 'cannotCreate' })
  assert.deepEqual(resolveWorkRequestView('?requestId=R1', manager), { view: { kind: 'list' }, recovery: 'needsReviewStart' })
  assert.deepEqual(resolveWorkRequestView('?requestId=R3', manager), { view: { kind: 'detail', requestId: 'R3' }, recovery: null })
  assert.deepEqual(resolveWorkRequestView('?requestId=R1&mode=edit', manager), { view: { kind: 'list' }, recovery: 'needsReviewStart' })
  assert.deepEqual(resolveWorkRequestView('?requestId=R1&mode=edit', requester), { view: { kind: 'edit', requestId: 'R1' }, recovery: null })

  // 복구 query는 한 번 적용하면 다시 바뀌지 않는다(effect 무한 반복 방지).
  const samples = [
    '', '?brand=undecided', '?requestId=R1', '?requestId=NOPE&brand=undecided', '?mode=bogus&brand=undecided',
    '?requestId=R1&mode=bogus', '?requestId=R3&mode=edit', '?mode=new', '?mode=edit', '?requestId=R1&mode=new',
    '?requestId=a&requestId=R1', '?requestId=', '?brand=undecided&requestId=R1&mode=edit',
  ]
  for (const context of [requester, member, manager]) {
    for (const search of samples) {
      const resolved = resolveWorkRequestView(search, context)
      const next = workRequestRecoverySearch(search, resolved, { active: true }) ?? search
      assert.equal(
        workRequestRecoverySearch(next, resolveWorkRequestView(next, context), { active: true }),
        null,
        `복구가 수렴하지 않음: ${search} -> ${next}`,
      )
      assert.equal(params(next).brand, params(search).brand, `brand 보존 실패: ${search}`)
    }
  }
  assert.equal(workRequestRecoverySearch('?requestId=NOPE', resolveWorkRequestView('?requestId=NOPE', requester), { active: false }), null)
  assert.equal(workRequestRecoverySearch('?brand=undecided&requestId=R1', resolveWorkRequestView('?brand=undecided&requestId=R1', requester), { active: true }), null)
  assert.equal(workRequestRecoverySearch('?requestId=R1&brand=undecided', resolveWorkRequestView('?requestId=R1&brand=undecided', requester), { active: true }), null)
}
console.info('PASS: 삭제·없는 ID·잘못된 mode·권한 밖 단계 복구와 수렴, 숨김 탭 URL 미변경')

// ── 초안 보관 ────────────────────────────────────────────
{
  const initial = (key) => ({ title: `${key} 원본`, dirty: false })
  let step = switchWorkRequestDraft({}, { fromKey: null, toKey: 'edit:R1', current: null, dirty: false, initial })
  assert.deepEqual(step.loaded, { title: 'edit:R1 원본', dirty: false })
  step = switchWorkRequestDraft(step.drafts, { fromKey: 'edit:R1', toKey: null, current: { title: 'R1 초안', dirty: true }, dirty: true, initial })
  assert.deepEqual(step.drafts, { 'edit:R1': { title: 'R1 초안', dirty: true } })
  const other = switchWorkRequestDraft(step.drafts, { fromKey: null, toKey: 'edit:R2', current: null, dirty: false, initial })
  assert.deepEqual(other.loaded, { title: 'edit:R2 원본', dirty: false })
  const fresh = switchWorkRequestDraft(step.drafts, { fromKey: null, toKey: 'new', current: null, dirty: false, initial })
  assert.deepEqual(fresh.loaded, { title: 'new 원본', dirty: false })
  const back = switchWorkRequestDraft(step.drafts, { fromKey: null, toKey: 'edit:R1', current: null, dirty: false, initial })
  assert.deepEqual(back.loaded, { title: 'R1 초안', dirty: true })
  const clean = switchWorkRequestDraft(step.drafts, { fromKey: 'edit:R1', toKey: null, current: { title: 'x', dirty: false }, dirty: false, initial })
  assert.deepEqual(clean.drafts, {})
  const same = {}
  assert.equal(dropWorkRequestDraft(same, 'edit:R9'), same)
  assert.equal(dropWorkRequestDraft(same, null), same)
  assert.equal(workRequestDraftKey({ kind: 'detail', requestId: 'R1' }), null)
  assert.notEqual(workRequestDraftKey({ kind: 'edit', requestId: 'R1' }), workRequestDraftKey({ kind: 'edit', requestId: 'R2' }))
  assert.notEqual(workRequestScreenKey({ kind: 'detail', requestId: 'R1' }), workRequestScreenKey({ kind: 'edit', requestId: 'R1' }))

  // 브랜드 선택은 hasEdited를 켜지 않으므로 처음 연 브랜드와의 차이로 초안 여부를 판단한다.
  assert.equal(isWorkRequestDraftDirty({ hasEdited: false, brandId: '', baseBrandId: '' }), false)
  assert.equal(isWorkRequestDraftDirty({ hasEdited: false, brandId: 'B1', baseBrandId: '' }), true)
  assert.equal(isWorkRequestDraftDirty({ hasEdited: false, brandId: 'B1', baseBrandId: 'B1' }), false)
  assert.equal(isWorkRequestDraftDirty({ hasEdited: false, brandId: '', baseBrandId: 'B1' }), true)
  assert.equal(isWorkRequestDraftDirty({ hasEdited: true, brandId: '', baseBrandId: '' }), true)
}

// ── 브라우저 history + 화면 모델 ───────────────────────────
function createBrowserHistory(search) {
  const entries = [{ pathname: PATHNAME, search }]
  let index = 0
  return {
    get current() { return entries[index] },
    get searches() { return entries.map((entry) => entry.search) },
    get index() { return index },
    apply(navigation) {
      const entry = { pathname: PATHNAME, search: navigation.search }
      if (navigation.replace) {
        entries[index] = entry
        return
      }
      entries.splice(index + 1)
      entries.push(entry)
      index += 1
    },
    back() { assert.ok(index > 0, '뒤로 갈 기록 없음'); index -= 1 },
    forward() { assert.ok(index < entries.length - 1, '앞으로 갈 기록 없음'); index += 1 },
  }
}

/** WorkRequestPage의 단계 해석·초안 전환·복구·이동 순서를 그대로 따른다. */
function createPage({ role = 'requester', search = '' } = {}) {
  const history = createBrowserHistory(search)
  const requests = baseRequests()
  const context = makeContext(role, requests)
  const state = {
    drafts: {},
    loaded: { screenKey: '', draftKey: null, baseBrandId: '' },
    form: null,
    active: true,
    created: 0,
    confirmPrompts: 0,
  }

  function editingRequestOf(view) {
    return view.kind === 'edit' ? requests.get(view.requestId) : undefined
  }

  function render(depth = 0) {
    assert.ok(depth < 3, `복구 replace가 반복됨: ${history.current.search}`)
    const resolved = resolveWorkRequestView(history.current.search, context)
    const { view } = resolved
    const screenKey = workRequestScreenKey(view)
    if (screenKey !== state.loaded.screenKey) {
      const editing = editingRequestOf(view)
      const draftKey = workRequestDraftKey(view)
      const switched = switchWorkRequestDraft(state.drafts, {
        fromKey: state.loaded.draftKey,
        toKey: draftKey,
        current: state.form,
        dirty:
          state.form !== null &&
          isWorkRequestDraftDirty({
            hasEdited: state.form.hasEdited,
            brandId: state.form.formBrandId,
            baseBrandId: state.loaded.baseBrandId,
          }),
        initial: () => ({ title: editing?.title ?? '', formBrandId: editing?.brandId ?? '', hasEdited: false }),
      })
      state.drafts = switched.drafts
      state.form = switched.loaded
      state.loaded = { screenKey, draftKey, baseBrandId: editing?.brandId ?? '' }
    }
    const recovery = workRequestRecoverySearch(history.current.search, resolved, { active: state.active })
    if (recovery !== null) {
      history.apply({ search: recovery, replace: true })
      return render(depth + 1)
    }
    return view
  }

  function go(action) {
    if (!state.active) return render()
    history.apply(workRequestNavigation(history.current.search, render(), action))
    return render()
  }

  return {
    history,
    requests,
    state,
    render,
    go,
    type(title) {
      assert.ok(state.form, '양식 단계가 아님')
      state.form = { ...state.form, title, hasEdited: true }
    },
    /** 양식의 브랜드 선택. 화면과 같이 hasEdited는 바꾸지 않고, 확정된 브랜드는 바꿀 수 없다. */
    selectBrand(brandId) {
      assert.ok(state.form, '양식 단계가 아님')
      assert.ok(!editingRequestOf(render())?.brandId, '브랜드가 확정된 요청은 선택이 잠겨 있음')
      state.form = { ...state.form, formBrandId: brandId }
    },
    save() {
      const view = render()
      const key = workRequestDraftKey(view)
      let id
      if (view.kind === 'edit') {
        id = view.requestId
        const request = requests.get(id)
        requests.set(id, { ...request, title: state.form.title, brandId: request.brandId || state.form.formBrandId })
      } else {
        assert.equal(view.kind, 'new')
        state.created += 1
        id = `NEW${state.created}`
        requests.set(id, { id, title: state.form.title, brandId: state.form.formBrandId, status: 'requested' })
      }
      state.drafts = dropWorkRequestDraft(state.drafts, key)
      state.form = { ...state.form, hasEdited: false }
      state.loaded = { ...state.loaded, draftKey: null }
      return go({ type: 'saved', requestId: id })
    },
    /** 화면과 같이 입력을 수정한 경우에만 확인 창을 띄운다. */
    cancel({ confirm = true } = {}) {
      if (state.form.hasEdited) {
        state.confirmPrompts += 1
        if (!confirm) return render()
      }
      state.form = { ...state.form, hasEdited: false }
      state.loaded = { ...state.loaded, draftKey: null }
      state.drafts = dropWorkRequestDraft(state.drafts, workRequestDraftKey(render()))
      return go({ type: 'cancelForm' })
    },
    remove(requestId) {
      requests.delete(requestId)
      state.drafts = dropWorkRequestDraft(state.drafts, workRequestDraftKey({ kind: 'edit', requestId }))
      return go({ type: 'deleted' })
    },
    back() { history.back(); return render() },
    forward() { history.forward(); return render() },
  }
}

function assertSameTab(page) {
  for (const search of page.history.searches) {
    assert.equal(params(search).brand, 'undecided', `brand query 유실: ${search}`)
  }
  assert.equal(page.history.current.pathname, PATHNAME, '업무 탭 경로가 바뀜')
}

// 목록 → 상세 → 수정 → 뒤로 → 뒤로 → 앞으로 → 앞으로, 같은 요청 초안 복원
{
  const page = createPage({ search: '?brand=undecided' })
  assert.deepEqual(page.render(), { kind: 'list' })
  assert.deepEqual(page.go({ type: 'openDetail', requestId: 'R1' }), { kind: 'detail', requestId: 'R1' })
  assert.deepEqual(page.go({ type: 'openEdit', requestId: 'R1' }), { kind: 'edit', requestId: 'R1' })
  assert.equal(page.state.form.title, 'R1 원본')
  page.type('R1 수정 중')
  assert.deepEqual(page.back(), { kind: 'detail', requestId: 'R1' })
  assert.deepEqual(page.back(), { kind: 'list' })
  assert.deepEqual(page.forward(), { kind: 'detail', requestId: 'R1' })
  assert.deepEqual(page.forward(), { kind: 'edit', requestId: 'R1' })
  assert.deepEqual(page.state.form, { title: 'R1 수정 중', formBrandId: '', hasEdited: true })
  assert.deepEqual(page.history.searches, ['?brand=undecided', '?brand=undecided&requestId=R1', '?brand=undecided&requestId=R1&mode=edit'])
  assertSameTab(page)

  // 다른 요청 수정·새 요청은 R1 초안과 섞이지 않는다.
  page.back()
  page.back()
  assert.deepEqual(page.go({ type: 'openEdit', requestId: 'R2' }), { kind: 'edit', requestId: 'R2' })
  assert.deepEqual(page.state.form, { title: 'R2 원본', formBrandId: '', hasEdited: false })
  page.type('R2 수정 중')
  page.back()
  assert.deepEqual(page.go({ type: 'openNew' }), { kind: 'new' })
  assert.deepEqual(page.state.form, { title: '', formBrandId: '', hasEdited: false })
  page.back()
  page.go({ type: 'openEdit', requestId: 'R1' })
  assert.deepEqual(page.state.form, { title: 'R1 수정 중', formBrandId: '', hasEdited: true })
  page.back()
  page.go({ type: 'openEdit', requestId: 'R2' })
  assert.deepEqual(page.state.form, { title: 'R2 수정 중', formBrandId: '', hasEdited: true })
  assertSameTab(page)
}
console.info('PASS: 목록→상세→수정→뒤로→앞으로 단계 복원, 같은 요청 초안 복원·다른 요청 초안 분리')

// 저장: 수정 entry를 상세로 replace → 뒤로가기로 수정 양식이 다시 열리지 않는다.
{
  const page = createPage({ search: '?brand=undecided' })
  page.go({ type: 'openDetail', requestId: 'R1' })
  page.go({ type: 'openEdit', requestId: 'R1' })
  page.type('저장할 제목')
  assert.deepEqual(page.save(), { kind: 'detail', requestId: 'R1' })
  assert.equal(page.requests.get('R1').title, '저장할 제목')
  assert.ok(page.history.searches.every((search) => params(search).mode === undefined), '저장 뒤 수정 entry가 남음')
  assert.deepEqual(page.history.searches, ['?brand=undecided', '?brand=undecided&requestId=R1', '?brand=undecided&requestId=R1'])
  assert.deepEqual(page.back(), { kind: 'detail', requestId: 'R1' })
  assert.deepEqual(page.back(), { kind: 'list' })
  assert.deepEqual(page.state.drafts, {})
  page.go({ type: 'openEdit', requestId: 'R1' })
  assert.deepEqual(page.state.form, { title: '저장할 제목', formBrandId: '', hasEdited: false })
  assertSameTab(page)
}

// 새 요청: mode=new → 뒤로/앞으로 초안 유지 → 저장 시 새 요청 상세로 replace
{
  const page = createPage({ search: '?brand=undecided' })
  assert.deepEqual(page.go({ type: 'openNew' }), { kind: 'new' })
  assert.equal(params(page.history.current.search).mode, 'new')
  page.type('새 요청 초안')
  assert.deepEqual(page.back(), { kind: 'list' })
  assert.deepEqual(page.forward(), { kind: 'new' })
  assert.deepEqual(page.state.form, { title: '새 요청 초안', formBrandId: '', hasEdited: true })
  assert.deepEqual(page.save(), { kind: 'detail', requestId: 'NEW1' })
  assert.deepEqual(page.history.searches, ['?brand=undecided', '?brand=undecided&requestId=NEW1'])
  assert.deepEqual(page.back(), { kind: 'list' })
  assert.equal(page.state.created, 1)
  page.go({ type: 'openNew' })
  assert.deepEqual(page.state.form, { title: '', formBrandId: '', hasEdited: false })
  assertSameTab(page)
}

// 취소: 수정은 상세로, 새 요청은 목록으로. 확인 후 버린 초안은 남기지 않는다.
{
  const page = createPage({ search: '?brand=undecided' })
  page.go({ type: 'openDetail', requestId: 'R1' })
  page.go({ type: 'openEdit', requestId: 'R1' })
  page.type('버릴 초안')
  assert.deepEqual(page.cancel(), { kind: 'detail', requestId: 'R1' })
  assert.deepEqual(page.state.drafts, {})
  assert.deepEqual(page.go({ type: 'openEdit', requestId: 'R1' }), { kind: 'edit', requestId: 'R1' })
  assert.deepEqual(page.state.form, { title: 'R1 원본', formBrandId: '', hasEdited: false })
  page.back()
  page.go({ type: 'closeDetail' })
  page.go({ type: 'openNew' })
  assert.deepEqual(page.cancel(), { kind: 'list' })
  assertSameTab(page)
}
console.info('PASS: 저장 후 상세 replace(중복 저장 방지), 새 요청 저장, 취소 경로')

// 브랜드만 바꾼 새 요청: 뒤로 → 앞으로 복원, 저장 뒤에는 초안으로 다시 보관하지 않는다.
{
  const page = createPage({ search: '?brand=undecided' })
  page.go({ type: 'openNew' })
  page.selectBrand('B1')
  assert.equal(page.state.form.hasEdited, false, '브랜드 선택이 입력 수정으로 바뀜')
  assert.deepEqual(page.back(), { kind: 'list' })
  assert.deepEqual(page.state.drafts, { new: { title: '', formBrandId: 'B1', hasEdited: false } })
  assert.deepEqual(page.forward(), { kind: 'new' })
  assert.deepEqual(page.state.form, { title: '', formBrandId: 'B1', hasEdited: false })
  page.type('브랜드 정한 새 요청')
  assert.deepEqual(page.save(), { kind: 'detail', requestId: 'NEW1' })
  assert.equal(page.requests.get('NEW1').brandId, 'B1')
  assert.deepEqual(page.state.drafts, {}, '저장한 새 요청이 초안으로 다시 보관됨')
  assert.deepEqual(page.history.searches, ['?brand=undecided', '?brand=undecided&requestId=NEW1'])
  page.back()
  page.go({ type: 'openNew' })
  assert.deepEqual(page.state.form, { title: '', formBrandId: '', hasEdited: false })
  assertSameTab(page)
}

// 브랜드 미정 요청 수정: 브랜드만 변경 → 뒤로 → 앞으로 복원, 요청별 브랜드 초안 분리
{
  const page = createPage({ search: '?brand=undecided' })
  page.go({ type: 'openDetail', requestId: 'R1' })
  page.go({ type: 'openEdit', requestId: 'R1' })
  assert.deepEqual(page.state.form, { title: 'R1 원본', formBrandId: '', hasEdited: false })
  page.selectBrand('B1')
  assert.deepEqual(page.back(), { kind: 'detail', requestId: 'R1' })
  assert.deepEqual(page.back(), { kind: 'list' })
  assert.deepEqual(page.forward(), { kind: 'detail', requestId: 'R1' })
  assert.deepEqual(page.forward(), { kind: 'edit', requestId: 'R1' })
  assert.deepEqual(page.state.form, { title: 'R1 원본', formBrandId: 'B1', hasEdited: false })

  page.back()
  page.back()
  page.go({ type: 'openEdit', requestId: 'R2' })
  assert.deepEqual(page.state.form, { title: 'R2 원본', formBrandId: '', hasEdited: false }, 'R1 브랜드 초안이 R2에 섞임')
  page.selectBrand('B2')
  page.back()
  page.go({ type: 'openNew' })
  assert.deepEqual(page.state.form, { title: '', formBrandId: '', hasEdited: false }, '수정 초안 브랜드가 새 요청에 섞임')
  page.back()
  page.go({ type: 'openEdit', requestId: 'R1' })
  assert.deepEqual(page.state.form, { title: 'R1 원본', formBrandId: 'B1', hasEdited: false })
  page.back()
  page.go({ type: 'openEdit', requestId: 'R2' })
  assert.deepEqual(page.state.form, { title: 'R2 원본', formBrandId: 'B2', hasEdited: false })
  assert.deepEqual(Object.keys(page.state.drafts).sort(), ['edit:R1', 'edit:R2'])

  // R2 저장: 상세로 replace, R2만 브랜드 확정, R1 초안은 그대로 남는다.
  assert.deepEqual(page.save(), { kind: 'detail', requestId: 'R2' })
  assert.equal(page.requests.get('R2').brandId, 'B2')
  assert.equal(page.requests.get('R1').brandId, '', '다른 요청 초안의 브랜드가 저장됨')
  assert.deepEqual(Object.keys(page.state.drafts), ['edit:R1'], '저장한 R2가 초안으로 다시 보관되거나 R1 초안이 사라짐')
  assert.ok(page.history.searches.every((search) => params(search).mode === undefined), '저장 뒤 수정 entry가 남음')

  // 저장으로 브랜드가 확정된 요청은 선택이 잠기고, 다시 열고 나가도 초안이 생기지 않는다.
  page.back()
  page.go({ type: 'openEdit', requestId: 'R2' })
  assert.deepEqual(page.state.form, { title: 'R2 원본', formBrandId: 'B2', hasEdited: false })
  assert.throws(() => page.selectBrand('B1'))
  page.back()
  assert.deepEqual(Object.keys(page.state.drafts), ['edit:R1'])

  // 원래 브랜드로 되돌리면 보관할 변경이 없으므로 초안을 지운다.
  page.go({ type: 'openEdit', requestId: 'R1' })
  page.selectBrand('')
  page.back()
  assert.deepEqual(page.state.drafts, {})
  page.go({ type: 'openEdit', requestId: 'R1' })
  assert.deepEqual(page.state.form, { title: 'R1 원본', formBrandId: '', hasEdited: false })

  // 돌아가기: 확인 창 조건(입력 수정)은 기존 그대로이고, 버린 브랜드 초안은 남지 않는다.
  page.selectBrand('B1')
  const prompts = page.state.confirmPrompts
  assert.deepEqual(page.cancel(), { kind: 'detail', requestId: 'R1' })
  assert.equal(page.state.confirmPrompts, prompts)
  assert.deepEqual(page.state.drafts, {})
  page.go({ type: 'openEdit', requestId: 'R1' })
  assert.deepEqual(page.state.form, { title: 'R1 원본', formBrandId: '', hasEdited: false })

  // 브랜드가 이미 확정된 요청은 선택이 잠겨 있다.
  page.go({ type: 'openEdit', requestId: 'R4' })
  assert.deepEqual(page.state.form, { title: 'R4 원본', formBrandId: 'B2', hasEdited: false })
  assert.throws(() => page.selectBrand(''))
  assertSameTab(page)
}
console.info('PASS: 브랜드만 바꾼 새 요청·브랜드 미정 요청 수정의 뒤로/앞으로 복원과 요청별 분리')

// 삭제: 상세를 목록으로 replace, 앞으로가기로 남은 수정 entry는 목록으로 복구
{
  const page = createPage({ search: '?brand=undecided' })
  page.go({ type: 'openDetail', requestId: 'R1' })
  page.go({ type: 'openEdit', requestId: 'R1' })
  page.type('삭제될 초안')
  page.back()
  assert.deepEqual(page.remove('R1'), { kind: 'list' })
  assert.equal(page.history.current.search, '?brand=undecided')
  assert.deepEqual(page.state.drafts, {})
  assert.deepEqual(page.forward(), { kind: 'list' })
  assert.equal(page.history.current.search, '?brand=undecided')
  assert.deepEqual(page.back(), { kind: 'list' })
  assertSameTab(page)
}

// 존재하지 않는 ID·잘못된 mode·권한 밖 단계로 직접 들어온 경우
{
  const missing = createPage({ search: '?brand=undecided&requestId=NOPE' })
  assert.deepEqual(missing.render(), { kind: 'list' })
  assert.equal(missing.history.current.search, '?brand=undecided')
  assert.equal(missing.history.searches.length, 1, '복구는 replace여야 함')

  const badMode = createPage({ search: '?brand=undecided&requestId=R1&mode=bogus' })
  assert.deepEqual(badMode.render(), { kind: 'detail', requestId: 'R1' })
  assert.equal(badMode.history.current.search, '?brand=undecided&requestId=R1')

  const notEditable = createPage({ search: '?brand=undecided&requestId=R3&mode=edit' })
  assert.deepEqual(notEditable.render(), { kind: 'detail', requestId: 'R3' })
  assert.equal(notEditable.state.form, null)

  const memberNew = createPage({ role: 'member', search: '?brand=undecided&mode=new' })
  assert.deepEqual(memberNew.render(), { kind: 'list' })
  assert.equal(memberNew.history.current.search, '?brand=undecided')

  const managerUnreviewed = createPage({ role: 'manager', search: '?brand=undecided&requestId=R1' })
  assert.deepEqual(managerUnreviewed.render(), { kind: 'list' })
  assert.equal(managerUnreviewed.history.current.search, '?brand=undecided')
}
console.info('PASS: 삭제·존재하지 않는 ID·잘못된 mode·생성/수정 불가 역할의 안전한 복구')

// 숨겨진 탭: URL 변경·Escape 처리 없음
{
  const page = createPage({ search: '?brand=undecided&requestId=NOPE' })
  page.state.active = false
  assert.deepEqual(page.render(), { kind: 'list' })
  assert.equal(page.history.current.search, '?brand=undecided&requestId=NOPE', '숨겨진 탭이 주소를 바꿈')
  page.go({ type: 'openNew' })
  assert.equal(page.history.searches.length, 1, '숨겨진 탭이 history를 추가함')
  assert.equal(shouldListenWorkRequestEscape({ tabActive: false, detailOpen: true, acceptOpen: true, reviewConfirmOpen: true }), false)
  assert.equal(shouldListenWorkRequestEscape({ tabActive: true, detailOpen: false, acceptOpen: false, reviewConfirmOpen: false }), false)
  assert.equal(shouldListenWorkRequestEscape({ tabActive: true, detailOpen: true, acceptOpen: false, reviewConfirmOpen: false }), true)
}

// ── 화면 코드 연결 확인 ─────────────────────────────────────
{
  const page = fs.readFileSync(path.join(root, 'src/features/work-requests/WorkRequestPage.tsx'), 'utf8')
  const tabs = fs.readFileSync(path.join(root, 'src/components/layout/workspace-tabs.tsx'), 'utf8')
  assert.match(tabs, /id: tabIdFromPath\(location\.pathname\)/, '업무 탭 식별자는 pathname만 사용해야 함')
  assert.match(page, /const tabActive = useWorkspaceTabActivity\(\)/)
  assert.match(page, /workRequestRecoverySearch\(locationSearch, resolvedView, \{\s*active: tabActive && ready,/)
  assert.match(page, /shouldListenWorkRequestEscape\(\{\s*tabActive,/)
  assert.match(page, /function goToView\(action: WorkRequestNavAction\) \{\s*if \(!tabActive\) return/)
  const navigateCalls = page.match(/\bnavigate\(/g) ?? []
  const pathnameCalls = page.match(/\bnavigate\(\s*\{ pathname: locationPathname, search: /g) ?? []
  assert.ok(navigateCalls.length >= 3)
  assert.equal(pathnameCalls.length, navigateCalls.length, '경로를 바꾸는 navigate 호출이 있음')
  assert.doesNotMatch(page, /setSearchParams|setScreen\(|setDetailRequestId\(/)
  assert.equal((page.match(/goToView\(\{ type: 'saved'/g) ?? []).length, 2, '수정·새 요청 저장 모두 saved(replace)여야 함')
  assert.match(page, /goToView\(\{ type: 'deleted' \}\)/)
  assert.match(page, /needsReviewStart: canManage && request\.status === 'requested'/)
  assert.match(page, /editable: isSelfRequest && request\.status === 'requested'/)
  assert.match(page, /const canEdit = isSelfRequest && selectedRequest\.status === 'requested'/)
  assert.match(page, /window\.confirm\('작성 중인 변경 내용을 지우고 돌아갈까요\?'\)/)
  assert.match(page, /hasEdited &&\s*!window\.confirm\('작성 중인 변경 내용을 지우고 돌아갈까요\?'\)/, '돌아가기 확인 조건이 바뀜')
  assert.match(
    page,
    /dirty: isWorkRequestDraftDirty\(\{\s*hasEdited,\s*brandId: formBrandId,\s*baseBrandId: loadedScreen\.baseBrandId,\s*\}\)/,
    '브랜드 변경이 초안 보관 판단에 빠짐',
  )
  assert.match(page, /baseBrandId: editingRequest\?\.brandId \?\? ''/)
  assert.equal(
    (page.match(/setLoadedScreen\(\(current\) => \(\{ \.\.\.current, draftKey: null \}\)\)/g) ?? []).length,
    2,
    '저장·돌아가기 뒤 양식이 초안으로 다시 보관될 수 있음',
  )
  assert.match(page, /onChange=\{\(e\) => setFormBrandId\(e\.target\.value\)\}\s*disabled=\{Boolean\(editingRequest\?\.brandId\)\}/, '양식 브랜드 선택 조건이 바뀜')
  assert.match(page, /brandId: request\.brandId \|\| formBrandId/, '수정 저장의 브랜드 규칙이 바뀜')
  assert.match(page, /window\.confirm\(`"\$\{request\.values\.title\}" 요청을 삭제할까요\?`\)/)
}
console.info('PASS: 숨겨진 탭 URL·Escape 보호, 같은 업무 탭 유지, 기존 확인 창·편집 조건 유지')
