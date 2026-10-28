import { useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '@/lib/supabase/auth'
import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { readImpersonationState } from '@/lib/supabase/impersonation'
import { createLeaveAlarmSamples, LEAVE_SAMPLE_DEVELOPER, LEAVE_SAMPLE_PHASES, type LeaveAlarmSample, type LeaveSamplePhase } from './leave-alarm-sample'

// 개발자 로컬 검수용. 업무 DB와 실제 알림·휴가 잔액에는 쓰지 않는다.
// 이전 계획 입력형(v1) 샘플 원본은 별도 키에 그대로 보존한다.
const KEY = `atelier:leave-alarm-sample:v2:${DEFAULT_COMPANY_ID}:${LEAVE_SAMPLE_DEVELOPER}`
type Snapshot = { records: readonly LeaveAlarmSample[]; activeId: string | null; error: string | null }
const EMPTY: Snapshot = { records: [], activeId: null, error: null }
let snapshot = EMPTY, loaded = false
const listeners = new Set<() => void>()
function publish(next: Snapshot) { snapshot = next; for (const listener of listeners) listener() }
function parse(raw: string | null): LeaveAlarmSample[] {
  if (!raw) return []
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data) || data.length > 300 || !data.every(item => item && typeof item.id === 'string' && item.id.startsWith('leave-sample:') && item.recipientId === LEAVE_SAMPLE_DEVELOPER && LEAVE_SAMPLE_PHASES.includes(item.phase) && item.remaining === 7 && typeof item.body === 'string' && item.body.length < 10000 && typeof item.expiresOn === 'string' && typeof item.simulatedOn === 'string' && typeof item.issuedAt === 'string' && ['readAt','viewedAt','confirmedAt'].every(key => item[key] === null || typeof item[key] === 'string'))) throw new Error('샘플 기록 형식이 올바르지 않습니다.')
  const records = data as LeaveAlarmSample[]
  if (records.some(row => row.title !== undefined && (typeof row.title !== 'string' || row.title.length > 200))) throw new Error('샘플 제목이 올바르지 않습니다.')
  const validTime = (value: string | null) => value === null || Number.isFinite(Date.parse(value))
  if (records.some(row => !Number.isFinite(Date.parse(row.issuedAt)) || !['readAt','viewedAt','confirmedAt'].every(key => validTime(row[key as 'readAt'])))) throw new Error('샘플 기록 시각이 올바르지 않습니다.')
  return records
}
function load() {
  loaded = true
  try { snapshot = { ...snapshot, records: parse(localStorage.getItem(KEY)), error: null } }
  catch (error) { console.warn('[leave-alarm-sample] 샘플 기록 조회 실패', { error }); snapshot = { ...snapshot, error: '샘플 기록을 읽지 못했습니다. 기존 기록은 덮어쓰지 않습니다.' } }
}
function getSnapshot() { if (!loaded) load(); return snapshot }
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', receiveStorage)
  listeners.add(listener)
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', receiveStorage) }
}
function receiveStorage(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return
  load(); if (!snapshot.records.some(row => row.id === snapshot.activeId)) snapshot = { ...snapshot, activeId: null }
  publish({ ...snapshot })
}
function save(records: readonly LeaveAlarmSample[]) {
  try { localStorage.setItem(KEY, JSON.stringify(records)); publish({ ...snapshot, records, error: null }); return true }
  catch (error) { console.warn('[leave-alarm-sample] 샘플 기록 저장 실패', { error }); publish({ ...snapshot, error: '샘플 기록을 저장하지 못했습니다. 저장 공간 설정을 확인해 주세요.' }); return false }
}
function change(id: string, patch: (record: LeaveAlarmSample) => LeaveAlarmSample) {
  const current = getSnapshot()
  return save(current.records.map(record => record.id === id ? patch(record) : record))
}
const noSubscribe = () => () => {}, emptySnapshot = () => EMPTY
export function useLeaveAlarmSample() {
  const { profile, session } = useAuth()
  const preview = usePagePreview()
  const candidate = import.meta.env.DEV && profile?.id === LEAVE_SAMPLE_DEVELOPER && profile.status === 'active' && profile.companyId === DEFAULT_COMPANY_ID && session?.user.id === profile.id && !preview?.active
  const impersonation = candidate ? readImpersonationState() : null
  const enabled = Boolean(candidate && (!impersonation || impersonation.operatorId === impersonation.targetId))
  const state = useSyncExternalStore(enabled ? subscribe : noSubscribe, enabled ? getSnapshot : emptySnapshot, emptySnapshot)
  useEffect(() => {
    if (enabled && !getSnapshot().records.length && !snapshot.error) save(createLeaveAlarmSamples(LEAVE_SAMPLE_PHASES))
  }, [enabled])
  const guard = () => { if (!enabled) throw new Error('개발자 본인 계정의 로컬 샘플에서만 사용할 수 있습니다.') }
  return {
    ...state, enabled,
    send(phases: readonly LeaveSamplePhase[]) { guard(); if (snapshot.error) return false; if (snapshot.records.length + phases.length > 300) { publish({ ...snapshot, error: '샘플은 300건까지 보관할 수 있습니다.' }); return false } return save([...createLeaveAlarmSamples(phases), ...getSnapshot().records]) },
    open(id: string) { guard(); if (!snapshot.records.some(row => row.id === id)) return; const now = new Date().toISOString(); if (change(id, row => ({ ...row, readAt: row.readAt ?? now, viewedAt: row.viewedAt ?? now }))) publish({ ...snapshot, activeId: id }) },
    close() { guard(); publish({ ...snapshot, activeId: null }) },
    markAllRead() { guard(); const now = new Date().toISOString(); save(snapshot.records.map(row => ({ ...row, readAt: row.readAt ?? now }))) },
    confirm(id: string) { guard(); const now = new Date().toISOString(); return change(id, row => row.viewedAt ? { ...row, confirmedAt: row.confirmedAt ?? now } : row) },
  }
}
