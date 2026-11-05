import assert from 'node:assert/strict'
import { continuingOvertimeClock } from './overtime-clock.ts'
const row={date:'2026-11-04',clockIn:'09:00',clockOutAt:null as string|null,autoClosedAt:null as string|null}
const request={kind:'overtime',status:'approved',from:row.date,to:row.date}
const night=Date.parse('2026-11-05T01:00:00+09:00')
assert.equal(continuingOvertimeClock([row],[request],'2026-11-05','09:00',night),row)
assert.equal(continuingOvertimeClock([row],[{...request,status:'pending'}],'2026-11-05','09:00',night),row)
for(const status of ['cancelled','rejected'])assert.equal(continuingOvertimeClock([row],[{...request,status}],'2026-11-05','09:00',night),null)
assert.equal(continuingOvertimeClock([row],[],'2026-11-05','09:00',night),null)
assert.equal(continuingOvertimeClock([row],[{...request,kind:'annual'}],'2026-11-05','09:00',night),null)
assert.equal(continuingOvertimeClock([row],[request],'2026-11-05',null,night),null)
assert.equal(continuingOvertimeClock([row],[request],'2026-11-05','bad',night),null)
assert.equal(continuingOvertimeClock([row],[request],'2026-11-05','09:00',Date.parse('2026-11-05T09:00:00+09:00')),null)
assert.equal(continuingOvertimeClock([{...row,autoClosedAt:'2026-11-05T00:00:00+09:00'}],[request],'2026-11-05','09:00',night),null)
const closed={...row,clockOutAt:'2026-11-05T00:30:00+09:00'}
assert.equal(continuingOvertimeClock([closed],[request],'2026-11-05','09:00',night),closed,'closed night shift does not demand a new clock-in before morning')
assert.equal(continuingOvertimeClock([row],[request],'2026-11-06','09:00',Date.parse('2026-11-06T01:00:00+09:00')),null,'older missing checkout is not an ongoing night shift')
console.log('PASS: overnight overtime uses actual configured next shift, pending/closed/auto-closed/date/permission-state boundaries')
