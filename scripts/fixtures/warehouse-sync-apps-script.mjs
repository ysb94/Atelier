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
  const sheet = {
    getSheetId: () => 1,
    getMaxRows: () => maxRows,
    getLastRow: () => maxRows,
    getMaxColumns: () => 35,
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
        clearNote: () => notes.delete(coordinate(row, column)),
      }
    },
  }
  const ok = { getResponseCode: () => 200, getContentText: () => '{"ok":true}' }
  const ctx = createContext({
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
  notes.set(coordinate(5610, 27), '이전 행의 작업 메모')
  formulas.set(coordinate(5611, 3), '=IF(TRUE,"","")')
  for (const [i, place] of ['2-1-1', 'P-7-1'].entries()) {
    const rowId = `at_manual_${String(i).padStart(32, '0')}`
    const entry = { requestId: `event-${i}`, rowId, before: null,
      values: { number: '', productName: '캐논 콜라보 토트백', place,
        receivedOn: '261116', units: '20', boxes: '2', note: '' } }
    assert.equal(ctx._writeAtelierStockCondition(sheet, entry).row_id, rowId)
    assert.equal(ctx._writeAtelierStockCondition(sheet, entry).row_id, rowId)
    assert.deepEqual([get(5612 + i, 2), get(5612 + i, 3), get(5612 + i, 4), get(5612 + i, 27)],
      ['', entry.values.productName, place, rowId])
  }
  const firstEvent = { requestId: 'event-0', rowId: `at_manual_${'0'.repeat(32)}`, before: null,
    values: { number: '', productName: '캐논 콜라보 토트백', place: '2-1-1',
      receivedOn: '261116', units: '20', boxes: '2', note: '' } }
  put(5612, 4, [new Date('2002-01-01T00:00:00Z')])
  assert.equal(ctx._writeAtelierStockCondition(sheet, firstEvent).row_id, firstEvent.rowId)
  assert.equal(get(5612, 4), '2-1-1')
  ctx.syncAtelierWarehouseSnapshot_({ validateOnly: false })
  const events = payloads.at(-1).rows.filter(row => row.externalRowId.startsWith('at_manual_'))
  assert.equal(events.length, 2)
  assert.equal(notes.get(coordinate(5610, 27)), '이전 행의 작업 메모')
  assert.equal(formulas.get(coordinate(5611, 3)), '=IF(TRUE,"","")')
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
  ctx.PLACEMENT_REMOVED_NOTE = 'Finder 지운 행 ID: '
  ctx.warehousePlacementCell = (_id, row, column, fields, value) => ({ row, column, fields, value })
  ctx.findWarehousePlacementEmptyRows = () => [5701]
  ctx.warehousePlacementSheetApi = (_sheet, path, method, { requests }) => {
    assert.equal(path, ':batchUpdate')
    assert.equal(method, 'post')
    stockBatches.push(requests)
    for (const { row, column, fields, value } of requests) {
      put(row, column, [value.userEnteredValue?.numberValue ?? value.userEnteredValue?.stringValue ?? ''])
      if (fields.includes('note') && value.note) notes.set(coordinate(row, column), value.note)
    }
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
  assert.deepEqual([get(5700, 7), get(5701, 4), get(5701, 7), get(5701, 27)], [5, 'P-7-1', 2, split.id])

  const resized = { ...remaining, values: remaining.values.map((v, i) => i === 4 ? '40' : i === 5 ? '3' : v) }
  ctx.writeAtelierQrAuditSheet(sheet, stockWork([remaining], [resized]))
  assert.deepEqual(Array.from(stockBatches.at(-1), ({ column }) => column), [6, 7])
  ctx.writeAtelierQrAuditSheet(sheet, stockWork([resized], []))
  for (const column of [2, 3, 4, 5, 6, 7, 8, 19, 27]) assert.equal(get(5700, column), '')
  assert.equal(get(5700, 9), '다른 열')
  assert.equal(get(5701, 27), split.id)
  assert.equal(notes.get(coordinate(5700, 27)), 'Finder 지운 행 ID: ' + initial.id)
  ctx.findWarehousePlacementEmptyRows = () => [5702]
  const named = { id: 'at_manual_abc00000000040008000000000000001', qr: 'UNPLACED-REVIEW-QR',
    values: ['', '테이프', '2-1-1', '261113', '24', '1', ''] }
  const namedJob = stockWork([], [named])
  lostReply = true
  assert.throws(() => ctx.writeAtelierQrAuditSheet(sheet, namedJob), /LOST_BATCH_RESPONSE/)
  const namedBatchCount = stockBatches.length
  assert.equal(ctx.writeAtelierQrAuditSheet(sheet, namedJob)[0].id, named.id)
  assert.equal(stockBatches.length, namedBatchCount)
  assert.deepEqual([get(5702, 2), get(5702, 3), get(5702, 19), get(5702, 27)], ['', '테이프', named.qr, named.id])
  console.log('warehouse-sheet-sync Apps Script: trailing swatches, AA identity, product search and removal verified')
}
