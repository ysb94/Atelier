import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Exercise the real read adapter; network and offsite lookup are isolated fixtures.
const fixture = { replies: [], calls: [], settlements: [] }
globalThis.__overtimeCheckoutFixture = fixture
const bundle = await build({ entryPoints: ['src/lib/supabase/overtime-actuals.ts'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'fixture-network', setup(b) {
  b.onResolve({ filter: /^\.\/(client|offsite-settlements)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === './client' ? `
    export function getSupabase(){return {from(table){const q={select(){return q},order(){return q},range(from,to){const f=globalThis.__overtimeCheckoutFixture;f.calls.push({table,from,to});if(!f.replies.length)throw Error('Unexpected read');return Promise.resolve(f.replies.shift())}};return q}}}
  ` : `export async function listOffsiteSettlements(){return {rows:globalThis.__overtimeCheckoutFixture.settlements}}`, loader: 'js' }))
} }] })
const { listOvertimeActuals } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const row = { request_id: 'r', start_at: '2020-01-06T18:00:00+09:00', end_at: '2020-01-06T21:00:00+09:00', break_minutes: 0, revision: 0, saved_at: '2020-01-06T21:00:00+09:00', clock_linked: true, checkout_at: '2020-01-06T21:00:00+09:00' }
const result = data => ({ data, error: null }), failure = code => ({ data: null, error: { code, message: 'fixture failure' } })
fixture.replies = [result([row])]
const linked = await listOvertimeActuals()
assert.equal(linked.checkoutLinkedReady, true)
assert.equal(linked.rows[0].clockLinked, true)
assert.equal(linked.rows[0].checkoutAt, row.checkout_at)
assert.equal(fixture.calls.length, 1, 'one read when new server is ready')

// If the new view disappears between pages, restart the legacy API from page 0.
fixture.calls = []; fixture.replies = [result(Array.from({ length: 500 }, (_, n) => ({ ...row, request_id: `auto-${n}` }))), failure('PGRST205'), result([{ ...row, request_id: 'legacy', clock_linked: undefined, break_minutes: 15 }])]
const fallback = await listOvertimeActuals()
assert.equal(fallback.checkoutLinkedReady, false)
assert.deepEqual(fallback.rows.map(r => r.requestId), ['legacy'])
assert.equal(fallback.rows[0].breakMinutes, 15)
assert.equal(fallback.rows[0].clockLinked, false)
assert.deepEqual(fixture.calls.map(c => [c.table, c.from]), [['overtime_actual_with_checkout', 0], ['overtime_actual_with_checkout', 500], ['overtime_actual_latest', 0]])

fixture.replies = [failure('42501')]
await assert.rejects(listOvertimeActuals(), /fixture failure/, 'permission failure cannot fall back or become zero')
fixture.replies = [failure('57014')]
await assert.rejects(listOvertimeActuals(), /fixture failure/, 'timeout cannot become a successful empty result')
fixture.replies = [failure('42P01'), failure('42P01')]
assert.equal((await listOvertimeActuals()).ready, false)
delete globalThis.__overtimeCheckoutFixture
console.log('PASS: real overtime adapter; automatic metadata, legacy restart/history, missing server, permission and timeout failures')
