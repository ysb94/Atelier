import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

export function verifyWarehouseSyncAppsScript() {
  const cells = new Map()
  const formulas = new Map()
  const notes = new Map()
  const textFormats = new Set()
  const requests = []
  const documents = new Map()
  const payloads = []
  const properties = new Map([
    ['FIRESTORE_API_KEY', 'fixture'],
    ['WPS_DOCUMENT_SECRET', 'fixture'],
    ['ATELIER_WAREHOUSE_SYNC_URL', 'https://warehouse-sync.example.invalid'],
    ['ATELIER_WAREHOUSE_SYNC_SECRET', 'fixture'],
  ])
  const coordinate = (row, column) => `${row}:${column}`
  const put = (row, start, values) => {
    for (const [offset, value] of values.entries()) {
      cells.set(coordinate(row, start + offset), value)
    }
  }
  const get = (row, column) => cells.get(coordinate(row, column)) ?? ''
  let maxRows = 12
  let lockHeld = false
  let beforeLock
  const lock = {
    waitLock() {
      beforeLock?.()
      assert.equal(lockHeld, false, 'the writer must acquire the shared lock only once')
      lockHeld = true
    },
    tryLock() { if (lockHeld) return false; this.waitLock(); return true },
    releaseLock() { assert.equal(lockHeld, true); lockHeld = false },
  }
  const sheet = {
    getSheetId: () => 1,
    getMaxRows: () => maxRows,
    getLastRow: () => maxRows,
    getMaxColumns: () => 46,
    getRange(row, column, height = 1, width = 1) {
      const read = getter => Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => getter(row + y, column + x)))
      return {
        getValue: () => get(row, column),
        getRow: () => row,
        getValues: () => read(get),
        getDisplayValues: () => read((r, c) => {
          const value = get(r, c)
          return value instanceof Date ? value.toISOString().slice(0, 10).split('-').map(Number).join('-') : String(value)
        }),
        getFormula: () => formulas.get(coordinate(row, column)) ?? '',
        getFormulas: () => read((r, c) => formulas.get(coordinate(r, c)) ?? ''),
        createTextFinder(key) {
          return {
            matchEntireCell() { return this },
            matchCase() { return this },
            findAll: () => Array.from({ length: height }, (_, i) => row + i)
              .filter((r) => get(r, column) === key).map((r) => ({ getRow: () => r })),
          }
        },
        getNextDataCell: () => {
          let previous = row - 1
          while (previous > 1 && get(previous, column) === '') previous -= 1
          return { getRow: () => previous }
        },
        setValues(values) {
          values.forEach((valuesAtRow, y) => put(row + y, column, valuesAtRow.map(value =>
            typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value)))
          return this
        },
        setValue(value) {
          if (typeof value === 'string' && value.startsWith("'")) value = value.slice(1)
          else if (column === 4 && typeof value === 'string' && /^[1-9]-[1-9]-[1-9]$/.test(value) &&
            !textFormats.has(coordinate(row, column))) {
            const [y, m, d] = value.split('-').map(Number)
            value = new Date(Date.UTC(2000 + y, m - 1, d))
          }
          put(row, column, [value]); return this
        },
        setNumberFormat(format) { if (format === '@') textFormats.add(coordinate(row, column)); return this },
        getNotes: () => read((r, c) => notes.get(coordinate(r, c)) ?? ''),
        getNote: () => notes.get(coordinate(row, column)) ?? '',
        setNote: value => notes.set(coordinate(row, column), value),
        clearNote: () => notes.delete(coordinate(row, column)),
      }
    },
  }
  const ok = { getResponseCode: () => 200, getContentText: () => '{"ok":true}' }
  const ctx = createContext({
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: {
      flush() {},
      Direction: { UP: 'up' },
      getActive: () => ({
        getSheetByName(name) { assert.equal(name, '창고입력'); return sheet },
        toast() {},
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties.get(key) ?? null,
        setProperty: (key, value) => properties.set(key, value),
        deleteProperty: key => properties.delete(key),
      }),
    },
    Utilities: {
      Charset: { UTF_8: 'utf-8' },
      computeHmacSha256Signature: () => [0],
      formatDate: () => '2026-11-13-12-00-00',
      getUuid: () => '12345678-1234-4000-8000-000000000001',
    },
    UrlFetchApp: {
      fetchAll(batch) {
        return batch.map(request => {
          const url = new URL(request.url)
          const docId = decodeURIComponent(url.pathname.split('/').at(-1))
          const mask = url.searchParams.getAll('updateMask.fieldPaths')
          const fields = JSON.parse(request.payload).fields
          const doc = { ...documents.get(docId) }
          for (const key of mask) {
            if (fields[key]) doc[key] = fields[key].stringValue
            else delete doc[key]
          }
          documents.set(docId, doc)
          requests.push({ docId, fields, mask })
          return ok
        })
      },
      fetch(url, options) {
        assert.equal(url, 'https://warehouse-sync.example.invalid')
        payloads.push(JSON.parse(options.payload))
        return ok
      },
    },
  })

  const source = readFileSync(new URL('../google-apps-script/warehouse-sync.gs', import.meta.url), 'utf8')
  runInContext(source, ctx)
  put(3, 2, ['M0049', '정식 상품', '3-4-4_B1', '261113', 38, 1])
  put(3, 19, ['QR-123'])
  put(3, 27, ['regular'])
  put(11, 2, ['', '스와치', '3-4-4_B2', '261113', 1, 1])
  put(11, 27, ['finder-swatch'])
  put(12, 2, ['', '원단 샘플', '3-4-4_B3', '261113', 3, 2])

  ctx.syncAtelierWarehouseSnapshot_({ validateOnly: false })
  const rows = payloads.at(-1).rows
  assert.deepEqual(rows.map(row => row.sourceRowNumber), [3, 11, 12])
  assert.equal(rows[0].boxQr, 'QR-123')
  assert.deepEqual(rows[1], {
    sourceRowNumber: 11,
    externalRowId: 'finder-swatch',
    sourceStyleNo: '',
    sourceProductName: '스와치',
    locationRaw: '3-4-4_B2',
    receivedOnRaw: '261113',
    unitsPerBoxRaw: '1',
    remainingBoxesRaw: '1',
    note: '',
    boxQr: '',
  })
  assert.match(rows[2].externalRowId, /^inb_/)
  assert.equal(get(11, 27), 'finder-swatch')
  assert.equal(get(11, 19), '')
  notes.set(coordinate(4, 27), 'Finder 입고 확인 대기')
  put(4, 3, ['보호할 미확정 행'])
  assert.throws(() => ctx.syncAtelierWarehouseSnapshot_({ validateOnly: false }), /AA를 확인/)
  assert.equal(get(4, 27), '')
  assert.equal(notes.get(coordinate(4, 27)), 'Finder 입고 확인 대기')
  put(4, 3, [''])
  notes.delete(coordinate(4, 27))

  ctx.upsertWPS_WhenRowDiff_resume()
  const searchByName = name => [...documents.values()].find(doc => doc.productName === name)?.libraryNumber
  assert.equal(searchByName('스와치'), '3-4-4_B2')
  assert.equal(searchByName('원단 샘플'), '3-4-4_B3')
  assert.equal(documents.get('finder-swatch').boxCount, '1')
  assert.equal(documents.get('finder-swatch').unitsPerBox, '1')
  assert.equal(documents.get('finder-swatch').chinaCode, undefined)
  assert.deepEqual(payloads.at(-1).rows, rows)
  const beforeRetry = requests.length
  ctx.upsertWPS_WhenRowDiff_resume()
  assert.equal(requests.length, beforeRetry, 'unchanged rows do not rewrite search documents')

  put(11, 3, ['before another job'])
  beforeLock = () => { beforeLock = undefined; put(11, 3, ['newer name']) }
  ctx.upsertWPS_WhenRowDiff_resume()
  assert.equal(requests.length, beforeRetry, 'a WPS pass cannot export stale data after a competing write')
  put(11, 3, ['스와치'])

  for (const row of [11, 12]) {
    const docId = get(row, 27)
    put(row, 2, ['', '', '', '', '', '', ''])
    put(row, 27, [''])
    notes.set(coordinate(row, 27), `Finder 지운 행 ID: ${docId}`)
    documents.get(docId).unrelated = 'preserve'
  }
  // The trailing rows now exist only in AC:AH and the AA deletion notes.
  ctx.upsertWPS_WhenRowDiff_resume()
  for (const row of rows.slice(1)) {
    const removal = requests.find(request => request.docId === row.externalRowId && !request.fields.productName)
    assert.deepEqual(new Set(removal.mask), new Set([
      'secretPass', 'arrivalDate', 'boxCount', 'libraryNumber', 'productName',
      'productRef', 'unitsPerBox', 'chinaCode', 'note', 'createdAt',
    ]))
    assert.equal(documents.get(row.externalRowId).unrelated, 'preserve')
    assert.equal(notes.has(coordinate(row.sourceRowNumber, 27)), false)
  }
  assert.equal(searchByName('스와치'), undefined)
  assert.equal(searchByName('원단 샘플'), undefined)
  assert.equal(searchByName('정식 상품'), '3-4-4_B1')
  assert.deepEqual(payloads.at(-1).rows.map(row => row.externalRowId), ['regular'])

  maxRows = 8500
  put(5609, 2, ['M0049', '뒤쪽 재고', '3-4-4_B1', '261113', 38, 1])
  put(5609, 19, ['QR-5609'])
  put(5609, 27, ['after-3000'])
  put(8500, 28, ['재고 입력 범위 밖의 보조 데이터'])
  ctx.syncAtelierWarehouseSnapshot_({ validateOnly: false })
  assert.deepEqual(payloads.at(-1).rows.map(row => row.sourceRowNumber), [3, 5609])
  assert.equal(payloads.at(-1).rows.at(-1).externalRowId, 'after-3000')
  const beforeRejectedSnapshot = payloads.length
  put(8003, 3, ['상한 밖 재고'])
  assert.throws(() => ctx.syncAtelierWarehouseSnapshot_({ validateOnly: false }), /8003/)
  assert.equal(payloads.length, beforeRejectedSnapshot)
  runInContext(readFileSync('scripts/google-apps-script/warehouse-stock-condition-sync.gs', 'utf8'), ctx)
  const existing = { requestId: 'change', rowId: 'after-3000',
    before: { number: 'M0049', productName: '뒤쪽 재고', place: '3-4-4_B1', boxQr: 'QR-5609' },
    values: { number: '', productName: '뒤쪽 재고_(불량)' },
  }
  const confirmed = ctx._writeAtelierStockCondition(sheet, existing)
  assert.equal(confirmed.row_id, 'after-3000')
  assert.equal(confirmed.number, '')
  assert.equal(confirmed.product_name, '뒤쪽 재고_(불량)')
  assert.equal(get(5609, 4), '3-4-4_B1')
  assert.equal(get(5609, 19), 'QR-5609')
  assert.equal(ctx._writeAtelierStockCondition(sheet, existing).number, '', 'retry after successful write')
  const restore = { ...existing, before: { ...existing.before, ...existing.values },
    values: { number: 'M0049', productName: '뒤쪽 재고' },
  }
  formulas.set(coordinate(5609, 3), '=A1')
  assert.throws(() => ctx._writeAtelierStockCondition(sheet, restore), /B_C_CHANGED/)
  formulas.delete(coordinate(5609, 3))
  assert.equal(ctx._writeAtelierStockCondition(sheet, restore).number, 'M0049')
  assert.equal(get(5609, 3), '뒤쪽 재고')
  put(8003, 3, [''])
  // Physical row 5609 is occupied. New stock must reuse holes above it
  // while older identities, WPS work, formulas and notes await their owners.
  put(2, 2, ['헤더'])
  notes.set(coordinate(4, 27), '이전 행의 작업 메모')
  formulas.set(coordinate(5, 3), '=IF(TRUE,"","")')
  put(6, 26, ['Z 보관값'])
  formulas.set(coordinate(7, 24), '=IF(B7="","",B7)')
  put(8, 27, ['다른 재고의 AA'])
  put(10, 34, ['WPS 반영 대기'])
  put(11, 19, ['QR 유지'])
  notes.set(coordinate(12, 8), '보관할 메모')
  put(13, 24, ['WPS 입력 대기'])
  notes.set(coordinate(15, 35), '이전 WPS 메모')
  formulas.set(coordinate(17, 26), '=IF(TRUE,"","")')
  const manualRows = [7, 9]
  for (const [i, place] of ['2-1-1', 'P-7-1'].entries()) {
    const rowId = `at_manual_${String(i).padStart(32, '0')}`
    const entry = { requestId: `event-${i}`, rowId, before: null,
      values: { number: '', productName: '캐논 콜라보 토트백', place,
        receivedOn: '261116', units: '20', boxes: '2', note: '' } }
    assert.equal(ctx._writeAtelierStockCondition(sheet, entry).row_id, rowId)
    assert.equal(ctx._writeAtelierStockCondition(sheet, entry).row_id, rowId)
    const row = manualRows[i]
    assert.deepEqual([get(row, 2), get(row, 3), get(row, 4), get(row, 27)],
      ['', entry.values.productName, place, rowId])
  }
  const firstEvent = { requestId: 'event-0', rowId: `at_manual_${'0'.repeat(32)}`, before: null,
    values: { number: '', productName: '캐논 콜라보 토트백', place: '2-1-1',
      receivedOn: '261116', units: '20', boxes: '2', note: '' } }
  put(manualRows[0], 4, [new Date('2002-01-01T00:00:00Z')])
  assert.equal(ctx._writeAtelierStockCondition(sheet, firstEvent).row_id, firstEvent.rowId)
  assert.equal(get(manualRows[0], 4), '2-1-1')
  ctx.syncAtelierWarehouseSnapshot_({ validateOnly: false })
  const events = payloads.at(-1).rows.filter(row => row.externalRowId.startsWith('at_manual_'))
  assert.equal(events.length, 2)
  assert.equal(notes.get(coordinate(4, 27)), '이전 행의 작업 메모')
  assert.equal(formulas.get(coordinate(5, 3)), '=IF(TRUE,"","")')
  assert.equal(formulas.get(coordinate(7, 24)), '=IF(B7="","",B7)')
  assert.ok(events.every(row => row.sourceStyleNo === '' && row.sourceProductName === '캐논 콜라보 토트백'))
  assert.equal(get(5609, 3), '뒤쪽 재고')
  const prior = { number: 'M0049', productName: '뒤쪽 재고', place: '3-4-4_B1',
    receivedOn: '261113', units: '38', boxes: '1', note: '', boxQr: 'QR-5609' }
  const correction = { rowId: 'after-3000', requestId: 'correction', before: prior,
    values: { ...prior, productName: '정정 이름', place: '3-6-7', receivedOn: '261116', units: '40' } }
  const correctionReceipt = ctx._writeAtelierStockCondition(sheet, correction)
  assert.equal(correctionReceipt.product_name, '정정 이름')
  assert.deepEqual({ ...correctionReceipt.observed_values }, {
    number: correction.values.number, productName: '정정 이름', place: '3-6-7',
    receivedOn: '261116', units: '40', boxes: '1', note: '', boxQr: 'QR-5609',
  })
  assert.equal(ctx._writeAtelierStockCondition(sheet, correction).row_id, 'after-3000')
  assert.deepEqual([get(5609, 5), get(5609, 6), get(5609, 19), get(5609, 27)], ['261116', 40, 'QR-5609', 'after-3000'])
  assert.equal(get(5609, 4), '3-6-7')
  assert.throws(() => ctx._writeAtelierStockCondition(sheet, { ...correction,
    values: { ...correction.values, boxQr: 'OTHER' } }), /QR_CHANGED/)

  const stockBatches = []
  let lostReply = false
  let afterBatch
  ctx.PLACEMENT_REMOVED_NOTE = 'Finder 지운 행 ID: '
  ctx.warehousePlacementCell = (_id, row, column, fields, value) => ({ row, column, fields, value })
  ctx.warehousePlacementSheetApi = (_sheet, path, method, { requests }) => {
    assert.equal(path, ':batchUpdate')
    assert.equal(method, 'post')
    stockBatches.push(requests)
    for (const { row, column, fields, value } of requests) {
      put(row, column, [value.userEnteredValue?.numberValue ?? value.userEnteredValue?.stringValue ?? ''])
      if (fields.includes('note') && value.note) notes.set(coordinate(row, column), value.note)
    }
    afterBatch?.()
    if (lostReply) {
      lostReply = false
      throw new Error('LOST_BATCH_RESPONSE')
    }
  }
  runInContext(readFileSync('scripts/google-apps-script/warehouse-qr-audit-sheet-sync.gs', 'utf8'), ctx)
  const initial = { id: 'stock-aa', qr: '', rawNote: '메모',
    values: ['M0049', '기존 상품', '2-1-1', '261113', '50', '7', '메모'] }
  put(5700, 2, initial.values)
  put(5700, 27, [initial.id, 'WPS 기존 데이터'])
  put(5700, 9, ['다른 열'])
  const moved = { ...initial, values: initial.values.map((value, i) => i === 2 ? '2-1-2' : value) }
  const stockWork = (before, after) => ({ kind: 'stock', before, after })
  formulas.set(coordinate(5700, 3), '=UNRELATED()')
  ctx.writeAtelierQrAuditSheet(sheet, stockWork([initial], [moved]))
  assert.deepEqual(Array.from(stockBatches.at(-1), ({ column }) => column), [4])
  assert.equal(get(5700, 4), '2-1-2')
  formulas.delete(coordinate(5700, 3))

  const remaining = { ...moved, values: moved.values.map((v, i) => i === 5 ? '5' : v) }
  const split = { id: 'stock-split-aa', qr: '', values: ['M0049', '기존 상품', 'P-7-1', '261113', '50', '2', '메모'] }
  lostReply = true
  const splitJob = stockWork([moved], [remaining, split])
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, splitJob), /LOST_BATCH_RESPONSE/)
  assert.equal(stockBatches.length, 2)
  assert.deepEqual(Array.from(ctx.writeAtelierQrAuditSheet(sheet, splitJob), row => row.id), [initial.id, split.id])
  assert.equal(stockBatches.length, 2)
  const splitRow = 14
  assert.deepEqual([get(5700, 7), get(splitRow, 4), get(splitRow, 7), get(splitRow, 27)], [5, 'P-7-1', 2, split.id])

  const resized = { ...remaining, values: remaining.values.map((v, i) => i === 4 ? '40' : i === 5 ? '3' : v) }
  ctx.writeAtelierQrAuditSheet(sheet, stockWork([remaining], [resized]))
  assert.deepEqual(Array.from(stockBatches.at(-1), ({ column }) => column), [6, 7])
  ctx.writeAtelierQrAuditSheet(sheet, stockWork([resized], []))
  for (const column of [2, 3, 4, 5, 6, 7, 8, 19, 27]) assert.equal(get(5700, column), '')
  assert.equal(get(5700, 9), '다른 열')
  assert.equal(get(splitRow, 27), split.id)
  assert.equal(notes.get(coordinate(5700, 27)), 'Finder 지운 행 ID: ' + initial.id)
  const named = { id: 'at_manual_abc00000000040008000000000000001', qr: 'UNPLACED-REVIEW-QR',
    values: ['', '테이프', '2-1-1', '261113', '24', '1', ''] }
  const namedJob = stockWork([], [named])
  lostReply = true
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, namedJob), /LOST_BATCH_RESPONSE/)
  const namedBatchCount = stockBatches.length
  assert.equal(ctx.writeAtelierQrAuditSheet(sheet, namedJob)[0].id, named.id)
  assert.equal(stockBatches.length, namedBatchCount)
  const namedRow = 16
  assert.deepEqual([get(namedRow, 2), get(namedRow, 3), get(namedRow, 19), get(namedRow, 27)], ['', '테이프', named.qr, named.id])

  const project = (row, changes) => ({ ...row, values: row.values.map((value, index) => changes[index] ?? value) })
  const toJob = (id, before, after, picking = []) => ({
    id, lease: id + '-lease', kind: 'stock', ids: [...new Set([...before, ...after].map(row => row.id))],
    before, after, picking,
  })
  const total = { id: 'continuous-aa', qr: '', values: ['M2363', '테스트 재고', '4-6-8', '260919', '25', '2', ''] }
  put(5704, 2, total.values)
  put(5704, 27, [total.id])
  put(5704, 20, ['예약 열'])
  put(5703, 2, total.values) // The same SKU in another box must not be changed.
  put(5703, 27, ['different-aa'])
  const coalesced = project(total, { 2: '!-0-0', 5: '3', 6: '최종 메모' })
  const change = toJob('final', [total], [coalesced])
  assert.deepEqual(Array.from(ctx.writeAtelierQrAuditSheet(sheet, change).rows[0].values), coalesced.values)
  assert.deepEqual(Array.from(stockBatches.at(-1), ({ column }) => column), [4, 7, 8])
  assert.equal(get(5703, 7), '2')
  assert.equal(get(5704, 20), '예약 열')

  const noId = toJob('missing', [{ ...coalesced, id: 'missing-aa' }], [])
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, noId), error => {
    assert.equal(error.message, 'SHEET_STOCK_CHANGED')
    assert.equal(error.differences[0].field, 'AA')
    return true
  })
  const consumed = toJob('deplete', [coalesced], [])
  lostReply = true
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, consumed), /LOST_BATCH_RESPONSE/)
  const removedProof = ctx.writeAtelierQrAuditSheet(sheet, consumed)
  assert.deepEqual(Array.from(removedProof.rows), [])
  assert.deepEqual(Array.from(removedProof.absent), [coalesced.id])
  assert.equal(removedProof.cleared.get(coalesced.id), 5704)
  assert.equal(get(5704, 20), '예약 열')

  const versionedSplitFrom = { ...total, id: 'split-source' }
  const versionedSplitTo = { ...split, id: 'split-target' }
  put(5706, 2, versionedSplitFrom.values)
  put(5706, 27, [versionedSplitFrom.id])
  const atomicSplit = toJob('split', [versionedSplitFrom],
    [project(versionedSplitFrom, { 5: '1' }), project(versionedSplitTo, { 5: '1', 2: 'P-7-2' })], ['P-7-2'])
  put(5708, 4, ['P-7-2'])
  const initialBatchCount = stockBatches.length
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, atomicSplit), /PICKING_OCCUPIED/)
  assert.equal(stockBatches.length, initialBatchCount)
  put(5708, 4, [''])
  assert.equal(ctx.writeAtelierQrAuditSheet(sheet, atomicSplit).rows.length, 2)
  assert.equal(stockBatches.length, initialBatchCount + 1)
  const atomicTargetRow = 18
  assert.deepEqual([get(atomicTargetRow, 7), get(5706, 7), get(atomicTargetRow, 27)], [1, 1, versionedSplitTo.id])

  const damaged = project(atomicSplit.after[0], { 5: '2' })
  afterBatch = () => put(5706, 7, ['9'])
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, toJob('verify-write', [atomicSplit.after[0]], [damaged])),
    error => error.message === 'SHEET_VALUES_UNVERIFIED' && error.differences[0].actual === '9')
  afterBatch = undefined

  const conflict = toJob('conflict', [atomicSplit.after[0]], [damaged])
  put(5706, 3, ['다른 상품'])
  const writeIndependent = toJob('independent', [named], [project(named, { 6: '다른 행 반영' })])
  const reserved = { ...named, id: 'at_manual_abc00000000040008000000000000002', qr: '' }
  put(5709, 27, [reserved.id])
  const adoptedManual = toJob('reserved-manual', [], [reserved])
  const calls = []
  ctx._atelierStockConditionCall = action => {
    calls.push(action)
    return { enabled: false, jobs: [] }
  }
  ctx.enableAtelierStockSheetWritebackV2()
  ctx.enableAtelierStockSheetWritebackV2()
  assert.deepEqual(calls.splice(0), ['claim-stock-sheet-jobs'])
  assert.equal(properties.get('ATELIER_STOCK_SHEET_WRITEBACK_V2'), 'true')
  ctx._atelierStockConditionCall = (action, body) => {
    calls.push({ action, body })
    if (action === 'list-qr-audit-exports') return { entries: [] }
    if (action === 'claim-stock-sheet-jobs') {
      assert.deepEqual({ ...ctx.syncAtelierStockConditions() }, { confirmed: 0, pending: true },
        'a concurrent inbound trigger must defer before reading or writing rows')
      return { jobs: [conflict, writeIndependent, consumed, adoptedManual] }
    }
    return { ok: true }
  }
  assert.deepEqual({ ...ctx.syncAtelierWarehouseQrAuditSheet() }, { synced: 3, pending: true })
  assert.deepEqual(calls.map(({ action, body }) => [action, body?.id]), [
    ['list-qr-audit-exports', undefined], ['claim-stock-sheet-jobs', undefined],
    ['fail-stock-sheet-job', 'conflict'], ['finish-stock-sheet-job', 'independent'], ['finish-stock-sheet-job', 'deplete'],
    ['finish-stock-sheet-job', 'reserved-manual'], ['cleanup-stock-sheet-job', 'deplete'],
  ])
  assert.deepEqual({ ...calls[2].body.differences[0] },
    { id: versionedSplitFrom.id, field: '품명', expected: total.values[1], actual: '다른 상품', target: total.values[1] })
  assert.equal(get(namedRow, 8), '다른 행 반영')
  assert.equal(get(5709, 3), reserved.values[1])
  assert.equal(notes.has(coordinate(5704, 27)), false, 'unreferenced row becomes reusable after acknowledgement')

  // A known AA with matching SKU and name may recover from an edited count.
  put(5706, 3, [total.values[1]])
  const expectedDrift = { id: versionedSplitFrom.id, field: '박스 수', expected: '1', actual: '9', target: '2' }
  const recordFailure = () => { throw new Error('AUDIT_UNAVAILABLE') }
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, conflict, recordFailure), /AUDIT_UNAVAILABLE/)
  assert.equal(get(5706, 7), '9')
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, conflict, () => put(5706, 7, ['8'])), /SHEET_STOCK_CHANGED/)
  assert.equal(get(5706, 7), '8', 'an edit made during audit recording is checked again')
  put(5706, 7, ['9'])
  const repairs = []
  const recordRepair = differences => repairs.push(structuredClone(differences))
  lostReply = true
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, conflict, recordRepair), /LOST_BATCH_RESPONSE/)
  assert.deepEqual(repairs, [[expectedDrift]])
  assert.equal(ctx.writeAtelierQrAuditSheet(sheet, conflict, recordRepair).rows[0].values[5], '2')
  assert.deepEqual(repairs, [[expectedDrift]], 'retry reads the successful write and preserves the original audit')

  // The reported production case has empty B/C and a unique QR on the same AA.
  const qrOnly = { id: 'fp-qr-only', qr: 'ENJ-DECLARED-BOX', values: ['', '', '9-9-9', '000000', '30', '1', ''] }
  put(5710, 2, ['', '', '', '', '', '', ''])
  put(5710, 19, [qrOnly.qr])
  put(5710, 27, [qrOnly.id])
  put(5710, 20, ['예약 열'])
  const deleteDrift = toJob('qr-only-deplete', [qrOnly], [])
  calls.length = 0
  ctx._atelierStockConditionCall = (action, body) => {
    calls.push({ action, body })
    if (action === 'list-qr-audit-exports') return { entries: [] }
    if (action === 'claim-stock-sheet-jobs') return { jobs: [deleteDrift] }
    return { ok: true }
  }
  assert.deepEqual({ ...ctx.syncAtelierWarehouseQrAuditSheet() }, { synced: 1, pending: false })
  assert.deepEqual(calls.map(({ action }) => action), [
    'list-qr-audit-exports', 'claim-stock-sheet-jobs', 'record-stock-sheet-repair', 'finish-stock-sheet-job',
    'cleanup-stock-sheet-job',
  ])
  assert.equal(calls[2].body.differences.length, 4)
  assert.equal(calls[2].body.differences[1].field, '입고일')
  assert.equal(calls[2].body.differences[1].target, null)
  assert.equal(get(5710, 19), '')
  assert.equal(get(5710, 27), '')
  assert.equal(get(5710, 20), '예약 열')
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, noId, recordRepair), /SHEET_STOCK_CHANGED/)

  // M0049 was depleted in Atelier while M0954 legitimately remained at its source slot.
  const depleted = { id: 'inb_d82dedaacfd54b80', qr: '', rawNote: '', preserveNote: false,
    values: ['M0049', '플랩백팩 블랙', '3-1-4_B3', '261027', '50', '10', ''] }
  const neighbor = { id: 'inb_1c08946ebcc3413d', qr: '',
    values: ['M0954', '데일리백팩 글로우 블랙', '3-1-4_B3', '260623', '35', '1', ''] }
  put(1828, 2, neighbor.values)
  put(1828, 27, [neighbor.id, '정상 재고 WPS 원본'])
  put(1828, 20, ['다른 재고 예약 열'])
  formulas.set(coordinate(1828, 9), '=KEEP()')
  notes.set(coordinate(1828, 27), '정상 재고 메모')
  const neighborBefore = Array.from({ length: 35 }, (_, i) => get(1828, i + 1))
  const seedDepleted = (values = depleted.values, qr = '') => {
    put(2451, 2, values)
    put(2451, 19, [qr])
    put(2451, 20, ['대상 행 예약 열'])
    put(2451, 27, [depleted.id, '대상 행 WPS 원본'])
    notes.delete(coordinate(2451, 27))
  }
  const depletion = toJob('m0049-depletion', [depleted], [], ['3-1-4_B3'])
  seedDepleted()
  let batchCount = stockBatches.length
  const depletionProof = ctx.writeAtelierQrAuditSheet(sheet, depletion)
  assert.deepEqual(Array.from(depletionProof.absent), [depleted.id])
  assert.equal(depletionProof.cleared.get(depleted.id), 2451)
  assert.equal(stockBatches.length, batchCount + 1)
  assert.ok(stockBatches.at(-1).every(({ row }) => row === 2451))
  assert.equal(get(2451, 20), '대상 행 예약 열')

  // Leaving an occupied source is safe; entering an occupied destination is still blocked.
  seedDepleted()
  const movedOut = project(depleted, { 2: '4-6-8' })
  assert.equal(ctx.writeAtelierQrAuditSheet(sheet,
    toJob('leave-source', [depleted], [movedOut], ['3-1-4_B3'])).rows[0].values[2], '4-6-8')
  batchCount = stockBatches.length
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet,
    toJob('occupied-destination', [movedOut], [depleted], ['3-1-4_B3'])), /PICKING_OCCUPIED/)
  assert.equal(stockBatches.length, batchCount)

  // Replay the manually cleared production row through audit, finish and marker release.
  seedDepleted(Array(7).fill(''))
  calls.length = 0
  ctx._atelierStockConditionCall = (action, body) => {
    calls.push({ action, body })
    if (action === 'list-qr-audit-exports') return { entries: [] }
    if (action === 'claim-stock-sheet-jobs') return { jobs: [depletion] }
    return { ok: true }
  }
  assert.deepEqual({ ...ctx.syncAtelierWarehouseQrAuditSheet() }, { synced: 1, pending: false })
  assert.deepEqual(calls.map(({ action }) => action), [
    'list-qr-audit-exports', 'claim-stock-sheet-jobs', 'record-stock-sheet-repair',
    'finish-stock-sheet-job', 'cleanup-stock-sheet-job',
  ])
  const completion = calls.find(({ action }) => action === 'finish-stock-sheet-job').body
  assert.deepEqual(Array.from(completion.rows), [])
  assert.deepEqual(Array.from(completion.absent), [depleted.id])
  assert.equal(completion.id, depletion.id)
  assert.equal(completion.lease, depletion.lease)
  assert.ok(calls[2].body.differences.every(d => d.id === depleted.id && d.target === null))
  for (const column of [2, 3, 4, 5, 6, 7, 8, 19, 27]) assert.equal(get(2451, column), '')
  assert.equal(notes.get(coordinate(2451, 27)), 'Finder 지운 행 ID: ' + depleted.id)

  seedDepleted(Array(7).fill(''))
  batchCount = stockBatches.length
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet,
    toJob('blank-retained-row', [depleted], [movedOut], ['3-1-4_B3']), recordRepair), /SHEET_STOCK_CHANGED/)
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, depletion, recordFailure), /AUDIT_UNAVAILABLE/)
  assert.equal(stockBatches.length, batchCount, 'no AA cleanup without the persisted repair observation')
  assert.equal(get(2451, 27), depleted.id)
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, depletion,
    () => put(2451, 3, ['다른 직원이 입력한 상품'])), /SHEET_STOCK_CHANGED/)
  assert.equal(stockBatches.length, batchCount)

  seedDepleted(Array(7).fill(''))
  formulas.set(coordinate(2451, 3), '=IF(TRUE,"","")')
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, depletion, recordRepair), /FORMULA_CELL/)
  formulas.delete(coordinate(2451, 3))
  put(2451, 19, ['DIFFERENT-QR'])
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, depletion, recordRepair), /SHEET_STOCK_CHANGED/)
  seedDepleted(['M0954', '다른 상품', '', '', '', '', ''])
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, depletion, recordRepair), /SHEET_STOCK_CHANGED/)
  seedDepleted(['', '', '', '', '', '', '수기 메모'])
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, depletion, recordRepair), /SHEET_STOCK_CHANGED/)
  seedDepleted(Array(7).fill(''))
  put(2452, 27, [depleted.id])
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, depletion, recordRepair), /AA_MISSING_OR_DUPLICATE/)
  put(2452, 27, [''])
  assert.equal(stockBatches.length, batchCount, 'unsafe identities and formulas leave every row intact')

  // A lost batch reply can be retried using the AA removal marker without rewriting.
  lostReply = true
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, depletion, recordRepair), /LOST_BATCH_RESPONSE/)
  batchCount = stockBatches.length
  const retriedRemoval = ctx.writeAtelierQrAuditSheet(sheet, depletion, recordRepair)
  assert.deepEqual(Array.from(retriedRemoval.absent), [depleted.id])
  assert.equal(retriedRemoval.cleared.get(depleted.id), 2451)
  assert.equal(stockBatches.length, batchCount)
  assert.deepEqual(Array.from({ length: 35 }, (_, i) => get(1828, i + 1)), neighborBefore)
  assert.equal(formulas.get(coordinate(1828, 9)), '=KEEP()')
  assert.equal(notes.get(coordinate(1828, 27)), '정상 재고 메모')

  // A batch with several new IDs must reserve distinct gaps above the tail.
  // The second and fourth candidate rows carry independent WPS and Z data.
  put(20, 28, ['WPS 스냅샷'])
  put(22, 26, [0])
  const batchRows = ['A', 'B', 'C'].map(suffix => ({
    ...split, id: 'batch-' + suffix, qr: 'QR-BATCH-' + suffix,
  }))
  const gapJob = toJob('sparse-inserts', [], batchRows)
  const countBeforeInserts = stockBatches.length
  const verifiedBatch = ctx.writeAtelierQrAuditSheet(sheet, gapJob)
  assert.deepEqual(Array.from(verifiedBatch.rows, row => row.id), batchRows.map(row => row.id))
  for (const [index, row] of [19, 21, 23].entries()) {
    assert.deepEqual([get(row, 3), get(row, 19), get(row, 27)],
      [split.values[1], batchRows[index].qr, batchRows[index].id])
  }
  ctx.writeAtelierQrAuditSheet(sheet, gapJob)
  assert.equal(stockBatches.length, countBeforeInserts + 1, 'all three writes commit once across a retry')
  assert.deepEqual([get(2, 2), get(6, 26), get(8, 27), get(10, 34), get(11, 19), get(13, 24), get(20, 28), get(22, 26)],
    ['헤더', 'Z 보관값', '다른 재고의 AA', 'WPS 반영 대기', 'QR 유지', 'WPS 입력 대기', 'WPS 스냅샷', 0])
  assert.equal(notes.get(coordinate(12, 8)), '보관할 메모')
  assert.equal(notes.get(coordinate(15, 35)), '이전 WPS 메모')
  assert.equal(formulas.get(coordinate(17, 26)), '=IF(TRUE,"","")')
  assert.equal(get(5709, 27), reserved.id, 'AA reserved for the same manual job was completed at its original row')

  for (const col of [38, 45, 46]) {
    put(31, col, [0])
    formulas.set(coordinate(32, col), '=IF(TRUE,"","")')
    notes.set(coordinate(33, col), '이동 기록')
    assert.deepEqual(Array.from(ctx._atelierVacantStockRowsInRange(sheet, 31, 3)), [])
    put(31, col, [''])
    formulas.delete(coordinate(32, col))
    notes.delete(coordinate(33, col))
  }
  const claim = 'Finder 입고 BOX\nrequest'
  notes.set(coordinate(31, 27), claim)
  assert.deepEqual(Array.from(ctx._atelierVacantStockRowsInRange(sheet, 31, 1)), [])
  assert.deepEqual(Array.from(ctx._atelierVacantStockRowsInRange(sheet, 31, 1, '', claim)), [31])
  assert.deepEqual(Array.from(ctx._atelierVacantStockRowsInRange(sheet, 31, 1, '', claim + '2')), [])
  notes.delete(coordinate(31, 27))

  // Simulate another writer leaving metadata after selection, before the actual write.
  const allocate = ctx._atelierFindVacantStockRows
  let changedRow
  ctx._atelierFindVacantStockRows = (...args) => {
    const targets = allocate(...args)
    changedRow = targets[0]
    put(changedRow, 26, ['동시 입력'])
    return targets
  }
  const race = { ...split, id: 'changed-after-selection' }
  const countBeforeRace = stockBatches.length
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, toJob('race', [], [race])), /ROW_OCCUPIED/)
  ctx._atelierFindVacantStockRows = allocate
  assert.deepEqual([get(changedRow, 26), get(changedRow, 27)], ['동시 입력', ''])
  assert.equal(stockBatches.length, countBeforeRace)

  const largeBatch = Array.from({ length: 100 }, (_, i) => ({
    ...split, id: 'bulk-' + i, qr: 'INBOUND-QR-' + i,
  }))
  const bulkJob = toJob('bulk-response-lost', [], largeBatch)
  lostReply = true
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, bulkJob), /LOST_BATCH_RESPONSE/)
  const beforeReplay = stockBatches.length
  assert.equal(ctx.writeAtelierQrAuditSheet(sheet, bulkJob).rows.length, 100)
  assert.equal(stockBatches.length, beforeReplay)
  for (const item of largeBatch) {
    const rows = [...cells].filter(([key, value]) => key.endsWith(':27') && value === item.id)
    assert.equal(rows.length, 1)
    assert.equal(get(Number(rows[0][0].split(':')[0]), 19), item.qr)
  }

  runInContext(readFileSync('scripts/google-apps-script/warehouse-test-form.gs', 'utf8'), ctx)
  ctx.SpreadsheetApp.openById = () => ctx.SpreadsheetApp.getActive()
  ctx.Utilities.getUuid = () => '23456789-1234-4000-8000-000000000002'
  const form = { styleNo: 'M0001', productName: '폼 입고', location: '4-1-4', receivedOn: '2026-11-20',
    unitsPerBox: 30, boxes: 2, boxQr: 'DEV-FORM-QR' }
  lostReply = true
  assert.throws(() => ctx.saveAtelierWarehouseTestRow(form), /LOST_BATCH_RESPONSE/)
  const formBatches = stockBatches.length
  const formResult = ctx.saveAtelierWarehouseTestRow(form)
  assert.equal(formResult.aaStatus, 'preserved')
  assert.equal(get(formResult.row, 19), form.boxQr)
  assert.throws(() => ctx.saveAtelierWarehouseTestRow({ ...form, boxes: 3 }), /박스 QR/)
  assert.equal(stockBatches.length, formBatches)

  // No partial commit when a batch exceeds the remaining warehouse range.
  maxRows = 8003
  for (let row = 3; row < 8002; row++) put(row, 27, ['occupied-' + row])
  const oversized = [race, { ...race, id: 'requires-another-slot' }]
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, toJob('capacity', [], oversized)), /NO_EMPTY_ROW/)
  assert.equal(stockBatches.length, formBatches)
  assert.deepEqual([get(8002, 27), get(8003, 27)], ['', ''])
  ctx.writeAtelierQrAuditSheet(sheet, toJob('last-slot', [], [race]))
  assert.deepEqual([get(8002, 27), get(8003, 27)], [race.id, ''])

  // Several claims can arrive during one run. Reuse the scan across claims,
  // without repeatedly reading the whole sheet or returning the same gap twice.
  const available = []
  for (const [first, end] of [[3100, 5500], [6000, 7600]]) {
    for (let row = first; row < end; row += 2) {
      put(row, 27, [''])
      available.push(row)
    }
  }
  const cache = {}
  let scans = 0
  const measuredSheet = {
    ...sheet,
    getRange(...args) {
      scans++
      return sheet.getRange(...args)
    },
  }
  const assigned = []
  for (let i = 0; i < 100; i++) assigned.push(...allocate(measuredSheet, 20, cache))
  assert.deepEqual(assigned, available)
  assert.ok(scans < 100, `repeated claims must share scans (observed ${scans})`)
  console.log('warehouse-sheet-sync Apps Script: earliest safe gaps, batch allocation, WPS reservations and existing-AA retries verified')
  console.log('warehouse-sheet-sync Apps Script: M0049 source-only deletion, cleared-AA recovery, M0954 preservation and destination guards verified')
  console.log('warehouse-sheet-sync Apps Script: verified inventory drift repair, pre-write audit, QR-only removal and unsafe matches blocked')
  console.log('warehouse-sheet-sync Apps Script: coalesced AA write, readback, independent conflict, split and depletion retry verified')
  console.log('warehouse-sheet-sync Apps Script: trailing swatches, AA identity, product search and removal verified')
}
