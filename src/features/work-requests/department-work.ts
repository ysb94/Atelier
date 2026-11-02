import type { RequestStatus } from './work-request-types'

export type DepartmentWork = {
  id: string; kind: 'request' | 'internal'; title: string; requesterId: string
  requesterName: string; requesterDepartment: string; assigneeIds: string[]
  assigneeNames: string[]; status: RequestStatus; createdAt: string; dueDate: string
  brandId: string; brandName: string
  cancellation?: { state: string } | null
}
export type WorkFilters = { requester: string[]; assignee: string[]; status: string[]; brand: string[] }
export const clearWorkFilters = (): WorkFilters => ({ requester: [], assignee: [], status: [], brand: [] })
export type DepartmentWorkScope = 'mine' | 'team'
export const DEPARTMENT_WORK_STAGES = [
  { value: 'all', label: '전체' },
  { value: 'unconfirmed', label: '미확인' },
  { value: 'progress', label: '진행 중' },
  { value: 'feedback', label: '피드백' },
  { value: 'completion', label: '완료 대기' },
] as const
export type DepartmentWorkStage = typeof DEPARTMENT_WORK_STAGES[number]['value']
export function inDepartmentWorkScope(row: Pick<DepartmentWork, 'requesterId' | 'assigneeIds'>, scope: DepartmentWorkScope, actor: string) {
  return scope === 'team' || row.requesterId === actor || row.assigneeIds.includes(actor)
}
export function inDepartmentWorkStage(status: RequestStatus, stage: DepartmentWorkStage) {
  if (stage === 'all') return !['completed', 'cancelled', 'rejected'].includes(status)
  const stages: Record<Exclude<DepartmentWorkStage, 'all'>, readonly RequestStatus[]> = {
    unconfirmed: ['requested', 'reviewing'],
    progress: ['accepted', 'inProgress', 'waiting'],
    feedback: ['completionReview'],
    completion: ['completionConfirm'],
  }
  return stages[stage].includes(status)
}
export function filterDepartmentWork(rows: DepartmentWork[], filters: WorkFilters, search: string) {
  return rows.filter(row => (!search || row.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    && (!filters.requester.length || filters.requester.includes(row.requesterId))
    && (!filters.assignee.length || (row.assigneeIds.length ? row.assigneeIds.some(id => filters.assignee.includes(id)) : filters.assignee.includes('unassigned')))
    && (!filters.brand.length || filters.brand.includes(row.brandId || 'undecided'))
    && (filters.status.length ? filters.status.includes(row.status) : !['completed', 'cancelled', 'rejected'].includes(row.status)))
}
