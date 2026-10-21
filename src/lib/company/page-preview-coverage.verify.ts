import assert from 'node:assert/strict'
import { completePagePreviewCases, previewUsageAccess } from './page-preview-coverage'
import { previewProfile } from './profile-preview'
import { canAccessBrandManagement, canAccessMamamIdeaInbox, canManagePersonnel, canEditOrgAssignment, canAccessOperationsSupport, isAttendanceExempt, isCompanyReviewer, isCompanyManager } from './capabilities'
import type { Profile } from '../supabase/profiles'
import { previewMeetingActor, previewRequestIsSelf } from './relationship-preview'
import { canDeleteMeetingSeries, canRemovePrepFile, filterSeriesForViewer, type MeetingSeries } from '../../features/meetings/meeting-schedule'

const real = { companyId: 'company', id: 'developer', email: 'dev@atelier.local', status: 'active', isAdmin: true, capabilities: [], memberships: [] } as unknown as Profile
const snapshot = JSON.stringify(real)
const cases = (path: string) => completePagePreviewCases(path, real)
const profile = (path: string, id: string) => {
  const item = cases(path).find(item => item.id === id)
  assert.ok(item, `${path}: ${id}`)
  const result = previewProfile(real, item.settings)
  assert.equal(result.id, real.id, '다른 사람의 ID로 쿼리하지 않음')
  return result
}
for (const path of ['/', '/settings/profile', '/work', '/members', '/drafts', '/operations-support', '/brands', '/settings/ai', '/idea-contest', '/usage-codes', '/chat/room/test']) {
  const items = cases(path)
  assert.equal(new Set(items.map(item => item.id)).size, items.length)
  assert.ok(items.every(item => item.label && item.settings.status === 'active'))
}
const home = cases('/').filter(item => !item.facts?.chatRole).map(item => previewProfile(real, item.settings))
assert.deepEqual(new Set(home.map(item => isCompanyReviewer(item) ? 'reviewer' : item.departmentName === '운영지원팀' ? 'operations' : isCompanyManager(item) ? 'manager' : 'employee')), new Set(['reviewer', 'operations', 'manager', 'employee']))
assert.deepEqual(new Set(home.map(isAttendanceExempt)), new Set([true, false]))
assert.equal(canManagePersonnel(profile('/', 'personnel-member')), true)
for (const [id, manage, assignment] of [['editor', true, true], ['personnel-member', true, false], ['admin', true, false], ['viewer', false, false], ['reviewer', false, false]] as const) {
  const p = profile('/members', id)
  assert.equal(canManagePersonnel(p), manage, id)
  assert.equal(canEditOrgAssignment(p), assignment, id)
}
assert.equal(canAccessOperationsSupport(profile('/operations-support', 'admin-denied')), false)
assert.equal(canAccessOperationsSupport(profile('/operations-support', 'reviewer')), true)
for (const id of ['reviewer', 'reviewer-admin', 'reviewer-lead']) assert.equal(canAccessBrandManagement(profile('/brands', id)), true)
for (const id of ['admin', 'employee']) assert.equal(canAccessBrandManagement(profile('/brands', id)), false)
assert.equal(canAccessMamamIdeaInbox(profile('/idea-contest', 'reviewer')), true)
assert.equal(canAccessMamamIdeaInbox(profile('/idea-contest', 'admin')), false)
assert.deepEqual(cases('/settings/profile').filter(item => item.facts?.departmentApprover !== undefined).map(item => item.facts?.departmentApprover), [true, false])
assert.equal(cases('/settings/ai').find(item => item.id === 'brand-lead')?.facts?.brandLead, true, '멤버십이 없는 대표도 책임자 화면 시험')
const original = Object.freeze({ canRead: true, canEdit: false, canManage: false, editorIds: [] })
assert.equal(previewUsageAccess(original), original)
assert.deepEqual(['manager', 'editor', 'viewer'].map(mode => {
  const result = previewUsageAccess(original, mode as 'manager' | 'editor' | 'viewer')
  return [result.canEdit, result.canManage]
}), [[true, true], [true, false], [false, false]])
assert.equal(original.canEdit, false, '표시 전환이 실제 권한·캐시를 바꾸지 않음')
assert.equal(JSON.stringify(real), snapshot)
const owner = { id: 'owner', name: '주최자' }, member = { id: 'member', name: '참여자' }
const series = [{ host: owner, members: [member], rounds: [{ prepMaterials: [{ uploadedBy: member }] }] }] as unknown as MeetingSeries[]
const host = previewMeetingActor(owner, series, 'host')
const participant = previewMeetingActor(owner, series, 'participant')
const outsider = previewMeetingActor(owner, series, 'outsider')
assert.equal(canDeleteMeetingSeries(series[0], host, false), true)
assert.equal(canDeleteMeetingSeries(series[0], participant, false), false)
assert.equal(filterSeriesForViewer(series, participant, false).length, 1)
assert.equal(filterSeriesForViewer(series, outsider, false).length, 0)
assert.equal(filterSeriesForViewer(series, outsider, true).length, 1)
assert.equal(canRemovePrepFile({ uploadedBy: member }, previewMeetingActor(owner, series, 'uploader')), true)
assert.deepEqual([previewRequestIsSelf(false, 'self'), previewRequestIsSelf(true, 'other'), previewRequestIsSelf(true)], [true, false, true])
console.log('page-preview-coverage: 역할 조합·접근 제한·담당자 표시·원본 보존 통과')
