import assert from 'node:assert/strict'
import { registeredOvertime, type OvertimeActual } from './overtime-actuals.ts'
import { offsitePhase } from './offsite-period.ts'
import { actualOvertimeHours } from '../home/my-attendance-summary.ts'

const request={id:'trip',employeeId:'self',kind:'offsite' as const,status:'approved' as const,from:'2026-10-31',to:'2026-11-03',start:'09:00',end:'03:00',offsiteContinuous:true,place:'출장',note:'',createdAt:'2026-10-30'}
const actual: OvertimeActual={requestId:'trip',startAt:'2026-10-31T00:00:00+09:00',endAt:'2026-11-03T03:00:00+09:00',breakMinutes:0,revision:1,savedAt:'2026-11-03T04:00:00+09:00',offsiteMinutes:{'2026-10-31':120,'2026-11-01':90,'2026-11-02':60}}
assert.equal(registeredOvertime([request],[actual],'2026-10','2026-11-03')[0].minutes,120)
assert.equal(registeredOvertime([request],[actual],'2026-11','2026-11-03')[0].minutes,150,'confirmed work date owns month')
assert.equal(registeredOvertime([request,request],[actual,actual],'2026-11','2026-11-03').length,1,'same trip never counted twice')
assert.equal(registeredOvertime([request],[],'2026-11','2026-11-03').length,0,'leave/none/unsettled trips never accrue wage time')
assert.equal(registeredOvertime([{...request,status:'cancelled'}],[actual],'2026-11','2026-11-03').length,0)
assert.equal(registeredOvertime([request],[{...actual,offsiteMinutes:{'2026-11-01':-1}}],'2026-11','2026-11-03').length,0)
assert.equal(actualOvertimeHours([], [request], '12:00','13:00','2026-11','2026-11-03','09:00',[actual]),2.5,'My home and operations use the same confirmed total')
assert.equal(offsitePhase(request,Date.parse('2026-10-30T09:00:00+09:00')),'planned')
assert.equal(offsitePhase(request,Date.parse('2026-11-02T23:00:00+09:00')),'ongoing')
assert.equal(offsitePhase(request,Date.parse('2026-11-03T03:00:00+09:00')),'ended')
assert.equal(offsitePhase({...request,status:'cancelled'},Date.now()),'cancelled')
console.info('Offsite settlement: planned/ongoing/ended, monthly allocation, no leave/unsettled wage accrual, unique totals and shared My home summary passed')
