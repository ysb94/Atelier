import assert from 'node:assert/strict'
import { build } from 'esbuild'
const load = async options => {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'node', ...options })
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
}
const { departmentScheduleMonth, departmentAbsenceTime: time, departmentAbsenceIndex: index } = await load({ entryPoints: ['src/features/settings/department-schedule.ts'] })
const base = { id: 'r', employeeId: 'peer', name: '동료', kind: 'annual', from: '2026-11-05', to: '2026-11-06', start: '09:00', end: '18:00', continuous: false, endNextDay: false }
assert.deepEqual(departmentScheduleMonth('2028-02'), { from: '2028-02-01', to: '2028-02-29' })
for (const invalid of ['', '2026-13', '2026-1', '2026-11-01', '1899-01']) assert.equal(departmentScheduleMonth(invalid), null)
assert.equal(time(base, '2026-11-05'), '종일'); assert.equal(time(base, '2026-11-07'), null)
assert.equal(time({ ...base, kind: 'official' }, base.from), '종일')
for (const kind of ['half', 'quarter']) assert.equal(time({ ...base, kind, start: '14:00', end: '16:00' }, base.from), '14:00–16:00')
const night = { ...base, kind: 'offsite', from: '2026-10-31', to: '2026-10-31', start: '22:00', end: '02:00', endNextDay: true }
assert.equal(time(night, '2026-10-31'), '22:00–24:00'); assert.equal(time(night, '2026-11-01'), '00:00–02:00')
assert.equal(time({ ...night, end: '00:00' }, '2026-11-01'), null, 'midnight is an exclusive end')
const continuous = { ...base, kind: 'offsite', from: '2026-11-05', to: '2026-11-07', start: '16:00', end: '10:00', continuous: true }
assert.equal(time(continuous, '2026-11-05'), '16:00–24:00'); assert.equal(time(continuous, '2026-11-06'), '00:00–24:00'); assert.equal(time(continuous, '2026-11-07'), '00:00–10:00')
assert.equal(time({ ...base, kind: 'offsite' }, '2026-11-06'), '09:00–18:00', 'daily offsite repeats its registered window')
assert.equal(time({ ...base, kind: 'half', start: '' }, base.from), null)
assert.equal(index([base, base], '2026-11').get(base.from).length, 1)
assert.equal(index([base], '2026-11', '동료').size, 2); assert.equal(index([base], '2026-11', '없는이름').size, 0)
assert.equal(index([base], '2026-11', '연차').size, 2)
assert.equal(index([night], '2026-11').get('2026-11-01')[0].time, '00:00–02:00')
assert.equal(index([{ ...base, from: '1900-01-01', to: '9999-12-31' }], '9999-12').size, 31, 'long periods stay bounded even at the last valid year')

// Real adapter with isolated network/diagnostics: whitelist, pagination, failures.
const fixture = { replies: [], calls: [] }; globalThis.__departmentFixture = fixture
const { listDepartmentAbsences } = await load({ entryPoints: ['src/lib/supabase/department-schedule.ts'], plugins: [{ name: 'isolated-adapter', setup(b) {
  b.onResolve({ filter: /^\.\/client$/ }, () => ({ path: 'client', namespace: 'fixture' }))
  b.onResolve({ filter: /^@\/lib\/diagnostics\/workflow-trace$/ }, () => ({ path: 'trace', namespace: 'fixture' }))
  b.onResolve({ filter: /^@\/features\/settings\/department-schedule$/ }, () => ({ path: process.cwd() + '/src/features/settings/department-schedule.ts' }))
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'client' ? `export const getSupabase=()=>({rpc:(name,args)=>({range:(from,to)=>{const f=globalThis.__departmentFixture;f.calls.push({name,args,from,to});if(!f.replies.length)throw Error('unexpected request');return Promise.resolve(f.replies.shift())}})})` : `export const tracedQuery=q=>q;export const diagnosticOperation=(d,n,fn)=>fn({run:(name,fn)=>fn({}),block:()=>{},fail:()=>{}})` }))
} }] })
const row = { request_id: 'r', employee_id: 'peer', display_name: ' 동료 ', kind: 'half', from_date: base.from, to_date: base.from, start_time: '14:00:00', end_time: '18:00:00', end_next_day: false, offsite_continuous: false, note: 'PRIVATE', place: 'PRIVATE', attachments: ['PRIVATE'] }
fixture.replies = [{ data: [row], error: null }]
const result = await listDepartmentAbsences('2026-11')
assert.equal(result.rows[0].name, '동료'); assert.equal(result.rows[0].start, '14:00')
assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
assert.deepEqual(fixture.calls[0], { name: 'list_my_department_absences', args: { p_from: '2026-11-01', p_to: '2026-11-30' }, from: 0, to: 499 })
fixture.calls = []; fixture.replies = [{ data: Array.from({ length: 500 }, (_, n) => ({ ...row, request_id: 'r' + n })), error: null }, { data: [row], error: null }]
assert.equal((await listDepartmentAbsences('2026-11')).rows.length, 501); assert.deepEqual(fixture.calls.map(c => c.from), [0, 500])
fixture.replies = [{ data: null, error: { code: 'PGRST202' } }]; assert.deepEqual(await listDepartmentAbsences('2026-11'), { ready: false, rows: [] })
for (const code of ['42501', '57014']) { fixture.replies = [{ data: null, error: { code } }]; await assert.rejects(listDepartmentAbsences('2026-11'), e => e.cause.code === code) }
const before = fixture.calls.length; await assert.rejects(listDepartmentAbsences('wrong')); assert.equal(fixture.calls.length, before)
delete globalThis.__departmentFixture
console.log('PASS department schedule: date/time/month bounds, overnight, search, duplicate handling; real adapter privacy, pagination and missing/failed reads')
