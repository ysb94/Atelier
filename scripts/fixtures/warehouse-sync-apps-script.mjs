import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

export function verifyWarehouseSyncAppsScript() {
  const cells = new Map()
  const notes = new Map()
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
  const sheet = {
    getMaxRows: () => 12,
    getMaxColumns: () => 35,
    getRange(row, column, height = 1, width = 1) {
      const read = getter => Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => getter(row + y, column + x)))
      return {
        getValue: () => get(row, column),
        getRow: () => row,
        getValues: () => read(get),
        getDisplayValues: () => read((r, c) => String(get(r, c))),
        getNextDataCell: () => {
          let previous = row - 1
          while (previous > 1 && get(previous, column) === '') previous -= 1
          return { getRow: () => previous }
        },
        setValues(values) { values.forEach((valuesAtRow, y) => put(row + y, column, valuesAtRow)); return this },
        setValue(value) { put(row, column, [value]); return this },
        setNumberFormat() { return this },
        getNotes: () => read((r, c) => notes.get(coordinate(r, c)) ?? ''),
        getNote: () => notes.get(coordinate(row, column)) ?? '',
        clearNote: () => notes.delete(coordinate(row, column)),
      }
    },
  }
  const ok = { getResponseCode: () => 200, getContentText: () => '{"ok":true}' }
  const ctx = createContext({
    SpreadsheetApp: {
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
  console.log('warehouse-sheet-sync Apps Script: trailing swatches, AA identity, product search and removal verified')
}
