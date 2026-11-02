import type { RequestStatus } from './work-request-types'

export type DepartmentWork = {
  id: string; kind: 'request' | 'internal'; title: string; requesterId: string
  requesterName: string; requesterDepartment: string; assigneeIds: string[]
  assigneeNames: string[]; status: RequestStatus; createdAt: string; dueDate: string
  brandId: string; brandName: string
}
export type WorkFilters = { requester: string[]; assignee: string[]; status: string[]; brand: string[] }
export const clearWorkFilters = (): WorkFilters => ({ requester: [], assignee: [], status: [], brand: [] })
export function filterDepartmentWork(rows: DepartmentWork[], filters: WorkFilters, search: string) {
  return rows.filter(row => (!search || row.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    && (!filters.requester.length || filters.requester.includes(row.requesterId))
    && (!filters.assignee.length || (row.assigneeIds.length ? row.assigneeIds.some(id => filters.assignee.includes(id)) : filters.assignee.includes('unassigned')))
    && (!filters.brand.length || filters.brand.includes(row.brandId || 'undecided'))
    && (filters.status.length ? filters.status.includes(row.status) : !['completed', 'cancelled', 'rejected'].includes(row.status)))
}
