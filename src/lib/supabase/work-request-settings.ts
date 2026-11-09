import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './auth'
import { getSupabase } from './client'
import { DEFAULT_VISUAL_CATEGORIES, type VisualCategory } from '@/features/work-requests/visual-request-config'
import type { DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { diagnosticQuery } from './diagnostic-query'

export type WorkRequestSettings = {
  revision: number; categories: VisualCategory[]; canManage: boolean; available: boolean
  supervisorIds?: string[]; activeSupervisorIds?: string[]
}
export async function loadWorkRequestSettings(): Promise<WorkRequestSettings> {
  const { data, error } = await getSupabase().rpc('get_work_request_settings', { p_owner: 'design' })
  if (error) {
    console.warn('[work-request-settings] 분류 설정 조회 실패', error)
    if (error.code === 'PGRST202' || error.code === '42883') return { revision: 0, categories: DEFAULT_VISUAL_CATEGORIES, canManage: false, available: false }
    throw new Error(error.message)
  }
  return { ...data, available: true } as WorkRequestSettings
}
export function saveWorkRequestSettings(categories: VisualCategory[], revision: number, supervisors: string[] | undefined, context: DiagnosticContext) {
  const query = supervisors === undefined
    ? getSupabase().rpc('save_work_request_settings', { p_owner: 'design', p_revision: revision, p_categories: categories })
    : getSupabase().rpc('save_visual_work_request_settings', { p_revision: revision, p_categories: categories, p_supervisors: supervisors })
  return diagnosticQuery<number>('app', 'visual_work_settings_save', query, context)
}
export async function assignWorkRequestCategory(requestId: string, categoryId: string, assigneeId: string, revision: number): Promise<void> {
  const { error } = await getSupabase().rpc('assign_work_request_category', { p_request: requestId, p_category: categoryId, p_assignee: assigneeId || null, p_revision: revision })
  if (error) { console.warn('[work-request-settings] 분류 담당자 배정 실패', error); throw new Error(error.message) }
}
export function useWorkRequestSettings(enabled = true) {
  const { profile, session } = useAuth()
  const actor = profile?.id
  const active = enabled && profile?.status === 'active' && session?.user.id === actor
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['work-request-settings', actor, 'design'], queryFn: loadWorkRequestSettings, enabled: active, retry: false })
  useEffect(() => {
    if (!active || !actor) return
    const refresh = () => { void client.invalidateQueries({ queryKey: ['work-request-settings', actor] }) }
    const channel = getSupabase().channel(`work-settings:${actor}:${crypto.randomUUID()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'work_request_settings' }, refresh).subscribe(status => {
      if (status === 'SUBSCRIBED') refresh()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[work-request-settings] 실시간 연결 실패', { status })
    })
    window.addEventListener('online', refresh)
    return () => { window.removeEventListener('online', refresh); void getSupabase().removeChannel(channel) }
  }, [active, actor, client])
  return query
}
