import assert from 'node:assert/strict'
import { attendanceStartIndex, resolveAttendanceStart, type AttendanceStartSetting } from './attendance-start-settings.ts'
const settings: AttendanceStartSetting[] = [
  {id:'a',month:'2026-09',departmentId:'visual',employeeId:null,source:'department',start:'09:00',grace:5},
  {id:'b',month:'2026-09',departmentId:'visual',employeeId:'employee',source:'individual',start:'10:00',grace:3},
  {id:'c',month:'2026-10',departmentId:'visual',employeeId:'employee',source:'department',start:'09:00',grace:5},
]
const index=attendanceStartIndex(settings)
assert.equal(resolveAttendanceStart(index,'other','visual','2026-09').start,'09:00')
assert.equal(resolveAttendanceStart(index,'employee','visual','2026-09').start,'10:00')
assert.equal(resolveAttendanceStart(index,'employee','visual','2026-09').grace,3)
assert.equal(resolveAttendanceStart(index,'employee','visual','2026-10').start,'09:00')
assert.equal(resolveAttendanceStart(index,'employee','visual','2026-11').configured,false)
assert.equal(resolveAttendanceStart(index,'employee','new-department','2026-10').start,'09:00', 'Saved employee month survives department transfer')
assert.equal(resolveAttendanceStart(index,'other',null,'2026-09').configured,false)
console.log('attendance start settings verify: ok (month isolation, inheritance, exception, transfer history, unset)')
