import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

export async function verifyWarehouseSheetWritebackEdge() {
  const source = readFileSync('supabase/functions/warehouse-sheet-sync/index.ts', 'utf8')
  const { outputText, diagnostics } = ts.transpileModule(source, {
    fileName: 'index.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.deepEqual(diagnostics, [])
  const brand = 'b0000000-0000-4000-8000-000000000001'
  const id = 'a0000000-0000-4000-8000-000000000001'
  const lease = 'a0000000-0000-4000-8000-000000000002'
  const secret = 'fixture-edge-hmac'
  const calls = []
  const results = {
    claim_atelier_stock_sheet_jobs: { enabled: false, jobs: [] },
    finish_atelier_stock_sheet_job: false,
    fail_atelier_stock_sheet_job: true,
    release_atelier_stock_sheet_removal_markers: true,
    list_warehouse_stock_condition_exports: [],
    confirm_warehouse_stock_condition_exports: 0,
  }
  const table = { select: () => table, eq: () => table, maybeSingle: async () => ({ data: { id: brand, slug: 'masmarulez' } }) }
  const client = {
    from: name => { assert.equal(name, 'brands'); return table },
    rpc: async (name, args) => {
      assert.ok(Object.hasOwn(results, name), name)
      calls.push({ name, ...args })
      return { data: results[name] }
    },
  }
  let handler
  runInNewContext(outputText, {
    exports: {}, Request, Response, TextEncoder, crypto: globalThis.crypto, console,
    Deno: {
      env: { get: key => ({ ATELIER_WAREHOUSE_SYNC_SECRET: secret, SUPABASE_SERVICE_ROLE_KEY: 'fixture' })[key] },
      serve: fn => { handler = fn },
    },
    require: name => name.startsWith('npm:')
      ? { createClient: () => client } : { WAREHOUSE_SHEET_SYNC_BRAND_SLUG: 'masmarulez' },
  })
  const send = async (payload, valid = true) => {
    const body = JSON.stringify(payload)
    const timestamp = String(Date.now())
    const signature = createHmac('sha256', valid ? secret : 'wrong').update(timestamp + '.' + body).digest('hex')
    const response = await handler(new Request('https://fixture.invalid', {
      method: 'POST', body, headers: { 'x-atelier-signature': signature, 'x-atelier-timestamp': timestamp },
    }))
    return [response.status, await response.json()]
  }
  assert.equal((await send({ action: 'claim-stock-sheet-jobs' }, false))[0], 401)
  assert.equal((await send({ action: 'claim-stock-sheet-jobs', validateOnly: true }))[0], 400)
  assert.deepEqual(calls, [])
  assert.deepEqual(await send({ action: 'claim-stock-sheet-jobs' }), [200, { ok: true, enabled: false, jobs: [] }])
  const finish = confirmed => send({ action: 'finish-stock-sheet-job', confirmed })
  assert.equal((await finish({ id, lease, rows: [] }))[0], 400)
  assert.equal((await finish({ id, lease, rows: [], absent: [] }))[0], 409)
  const rows = [{ id: 'aa', qr: '', values: ['M2363', '테스트', '!-0-0', '260919', '25', '3', ''] }]
  results.finish_atelier_stock_sheet_job = true
  assert.deepEqual(await finish({ id, lease, rows, absent: [] }), [200, { ok: true }])
  assert.deepEqual(structuredClone(calls.at(-1)), {
    name: 'finish_atelier_stock_sheet_job', p_brand_id: brand, p_job_id: id, p_lease: lease, p_rows: rows, p_absent: [],
  })
  assert.equal((await send({ action: 'fail-stock-sheet-job', confirmed: { id, lease, reason: 'SHEET_STOCK_CHANGED', differences: [] } }))[0], 200)
  assert.equal((await send({ action: 'cleanup-stock-sheet-job', confirmed: { id } }))[0], 200)
  assert.deepEqual(await send({ action: 'list-stock-conditions' }), [200, { ok: true, entries: [] }])
  assert.deepEqual(await send({ action: 'confirm-stock-conditions', confirmed: [{ request_id: id }] }),
    [200, { ok: true, confirmed: 0 }])
  console.log('warehouse-sheet-sync Edge handler: signed V2 claims, actual readback, conflict and legacy compatibility verified')
}
