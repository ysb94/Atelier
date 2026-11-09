import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { assignWorkRequestCategory } from '@/lib/supabase/work-request-settings'
import type { LocalTeamMember, WorkRequestRecord } from './work-request-types'

export function WorkRequestCategoryAssignments({ request, members, canManage, busy = false, categoryId }: { request: WorkRequestRecord; members: LocalTeamMember[]; canManage: boolean; busy?: boolean; categoryId?: string }) {
  const client = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, { value: string; revision: number }>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const assignments = request.categoryAssignments?.filter(item => !categoryId || item.categoryId === categoryId)
  if (!assignments?.length) return null
  const closed = ['completed', 'cancelled', 'rejected'].includes(request.status)
  async function save(categoryId: string, assigneeId: string) {
    if (saving || busy) return
    setSaving(categoryId); setError('')
    try {
      await assignWorkRequestCategory(request.id, categoryId, assigneeId, drafts[categoryId]?.revision ?? request.revision ?? 1)
      await client.invalidateQueries({ queryKey: ['work-requests'] })
      setDrafts(current => { const next = { ...current }; delete next[categoryId]; return next })
    } catch (failure) {
      console.warn('[work-request-settings] 개별 작업 배정 실패', failure)
      setError(failure instanceof Error ? failure.message : '배정하지 못했습니다.')
      await client.invalidateQueries({ queryKey: ['work-requests'] })
    } finally { setSaving(null) }
  }
  return <Card><CardContent className="space-y-3 p-5">
    <h2 className="font-semibold">{categoryId ? '이 분류 중간 관리자 배정' : '분류별 중간 관리자'}</h2>
    {!categoryId && <p className="text-xs text-muted-foreground">공통 메인 내용을 함께 참고합니다. 기본 중간 관리자가 없는 작업은 관리자가 배정합니다.</p>}
    {assignments.map(item => <div key={item.categoryId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
      <span className="break-all text-sm font-medium">{item.label}</span>
      {canManage && !closed ? <div className="flex min-w-0 flex-wrap gap-2">
        <Select aria-label={`${item.label} 중간 관리자`} value={drafts[item.categoryId]?.value ?? item.assigneeId} disabled={saving !== null || busy} onChange={event => setDrafts(current => ({ ...current, [item.categoryId]: { value: event.target.value, revision: request.revision ?? 1 } }))}>
          <option value="">미지정 · 관리자 배정 필요</option>
          {item.assigneeId && !members.some(member => member.id === item.assigneeId) ? <option value={item.assigneeId}>기존 중간 관리자 · 현재 배정 불가</option> : null}
          {members.map(member => <option key={member.id} value={member.id}>{member.name}{member.position ? ` · ${member.position}` : ''}</option>)}
        </Select>
        <Button size="sm" disabled={saving !== null || busy || drafts[item.categoryId] === undefined || drafts[item.categoryId]?.value === item.assigneeId} onClick={() => void save(item.categoryId, drafts[item.categoryId]?.value ?? '')}>{saving === item.categoryId ? '저장 중…' : '배정 저장'}</Button>
      </div> : <span className="text-sm text-muted-foreground">{item.assigneeId ? members.find(member => member.id === item.assigneeId)?.name ?? '배정된 직원' : '관리자 배정 대기'}</span>}
    </div>)}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
  </CardContent></Card>
}
