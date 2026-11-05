import assert from 'node:assert/strict'
import { canManageLogisticsOperations, CHINA_DEPARTMENT_ID, isHeadOfficeMember, isPersonnelMember, LOGISTICS_DEPARTMENT_ID, LOGISTICS_OPERATIONS_HREF, LOGISTICS_OPERATIONS_MANAGER_ID, workforceMode, WORKFORCE_COMPANY_ID } from './workforce-management.ts'
import { companyNavGroupsForProfile } from '../../components/layout/company-workspace-nav.ts'
import { releaseHref, releasePersonalPart } from './release-access.ts'
import { attendanceTrackingStart } from '../../features/operations-support/attendance-period.ts'
import { logisticsInstant, logisticsLocalTime, logisticsWorkMinutes } from '../../features/logistics/operations/logistics-records.ts'
import type { Profile } from '../supabase/profiles.ts'

const person = (id: string, departmentId: string | null) => ({ id, departmentId, companyId: WORKFORCE_COMPANY_ID, status: 'active', email: 'fixture@example.invalid', position: '사원', jobGrade: '사원', departmentName: '', memberships: [], capabilities: [], permissionGrants: [] }) as unknown as Profile
const manager = person(LOGISTICS_OPERATIONS_MANAGER_ID, LOGISTICS_DEPARTMENT_ID)
const warehouse = person('warehouse-staff', LOGISTICS_DEPARTMENT_ID)
const partner = person('china-staff', CHINA_DEPARTMENT_ID)
const headOffice = person('head-office', null)
const developer = person('d0000000-0000-4000-8000-000000000001', null)
assert.equal(workforceMode(headOffice), 'head-office')
assert.equal(workforceMode(warehouse), 'logistics')
assert.equal(workforceMode(partner), 'external')
assert.equal(isPersonnelMember(warehouse), true)
assert.equal(isPersonnelMember({ workforceMode: 'local' }), true)
assert.equal(isHeadOfficeMember({ workforceMode: 'local' }), false)
assert.equal(canManageLogisticsOperations({ ...headOffice, workforceMode: 'local' }), false, 'generic local scope does not grant named logistics manager rights')
assert.equal(isPersonnelMember(partner), false)
assert.equal(isHeadOfficeMember(warehouse), false)
assert.equal(isHeadOfficeMember(partner), false)
assert.equal(workforceMode({ ...partner, workforceMode: 'head-office' }), 'head-office', 'explicit management setting takes precedence without changing department')
assert.equal(canManageLogisticsOperations(manager), true)
for (const who of [warehouse, partner, headOffice, developer, { ...manager, status: 'pending' }, { ...manager, status: 'disabled' }, { ...manager, companyId: 'other' }]) {
  assert.equal(canManageLogisticsOperations(who), false)
  assert.equal(releaseHref(who, LOGISTICS_OPERATIONS_HREF), null)
  assert.ok(!companyNavGroupsForProfile(who).some(group => group.items.some(item => item.to === LOGISTICS_OPERATIONS_HREF)))
}
assert.equal(releaseHref(manager, LOGISTICS_OPERATIONS_HREF), LOGISTICS_OPERATIONS_HREF)
assert.equal(companyNavGroupsForProfile(manager).flatMap(group => group.items).filter(item => item.to === LOGISTICS_OPERATIONS_HREF).length, 1)
for (const who of [manager, warehouse]) assert.equal(releaseHref(who, '/logistics/invoices'), '/logistics/invoices', 'existing logistics work access unchanged')
assert.equal(releaseHref(partner, '/china/work-orders'), '/china/work-orders')
assert.equal(releasePersonalPart(partner, 'meetings'), true)
assert.equal(releasePersonalPart(partner, 'my-attendance'), true, 'schedule and to-dos remain available')
assert.equal(releasePersonalPart(partner, 'overtime'), false)
assert.equal(releasePersonalPart(warehouse, 'attendance', true), false)
assert.equal(attendanceTrackingStart('2020-01-01', '2026-11-06'), '2026-11-06')
assert.equal(attendanceTrackingStart('2026-11-10', '2026-11-06'), '2026-11-10')
assert.equal(attendanceTrackingStart('invalid', '2026-11-06'), '2026-11-06')
assert.equal(attendanceTrackingStart('2020-01-01', '2026-02-30'), '2026-11-02')
const start = logisticsInstant('2026-11-06T09:00')!, end = logisticsInstant('2026-11-07T03:00')!
assert.equal(start, '2026-11-06T00:00:00.000Z')
assert.equal(end, '2026-11-06T18:00:00.000Z')
assert.equal(logisticsLocalTime(end), '2026-11-07T03:00')
assert.equal(logisticsWorkMinutes({ started_at: start, ended_at: end, break_minutes: 90 }), 990)
assert.equal(logisticsInstant('2026-02-30T09:00'), null)
console.info('Workforce: department defaults, named-manager-only navigation, existing work access, explicit overrides, effective dates, overnight and breaks passed')
