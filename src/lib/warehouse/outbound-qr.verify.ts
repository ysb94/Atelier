import assert from 'node:assert/strict'
import { buildOutboundRackCodes, outboundSlotCodes, outboundSlotExcelRows, outboundRackLabelPages, type OutboundQrInput } from './outbound-qr.ts'

const input: OutboundQrInput = { mode: 'range', warehouse: '3', row: '1', startRack: '1', endRack: '7', list: '' }
const result = buildOutboundRackCodes(input)
assert.equal(result.error, null)
assert.deepEqual(result.racks, ['3-1-1', '3-1-2', '3-1-3', '3-1-4', '3-1-5', '3-1-6', '3-1-7'])
assert.deepEqual(outboundSlotCodes('3-1-1'), ['3-1-1_A1', '3-1-1_A2', '3-1-1_A3', '3-1-1_A4', '3-1-1_B1', '3-1-1_B2', '3-1-1_B3', '3-1-1_B4', '3-1-1_C1', '3-1-1_C2', '3-1-1_C3', '3-1-1_C4', '3-1-1_D1', '3-1-1_D2', '3-1-1_D3', '3-1-1_D4'])
const rows = outboundSlotExcelRows(result.racks)
assert.deepEqual(rows[0], ['QR', '렉자리', '렉박스자리'])
assert.equal(rows.length, 113)
assert.equal(new Set(rows.slice(1).map((row) => row[0])).size, 112)
assert.ok(rows.slice(1).every(([qr, rack, slot]) => qr === `${rack}_${slot}` && [qr, rack, slot].every((value) => typeof value === 'string')))
assert.deepEqual(rows[1], ['3-1-1_A1', '3-1-1', 'A1'])
assert.deepEqual(rows[16], ['3-1-1_D4', '3-1-1', 'D4'])
assert.deepEqual(rows.at(-1), ['3-1-7_D4', '3-1-7', 'D4'])
assert.deepEqual(outboundRackLabelPages(result.racks), [['3-1-1', '3-1-2', '3-1-3', '3-1-4'], ['3-1-5', '3-1-6', '3-1-7', null]])
assert.deepEqual(outboundRackLabelPages([]), [])
assert.equal(outboundRackLabelPages(['3-1-1', '3-1-2', '3-1-3', '3-1-4']).length, 1)
for (const value of ['', '-1', '3-1', '_A1', 'a b', '\u0001']) {
  assert.ok(buildOutboundRackCodes({ ...input, warehouse: value }).error, value)
  assert.ok(buildOutboundRackCodes({ ...input, row: value }).error, value)
}
for (const value of ['', '-1', '1.5', '1e2', 'Infinity', 'NaN', '9007199254740992']) {
  assert.ok(buildOutboundRackCodes({ ...input, startRack: value }).error, value)
}
assert.deepEqual(buildOutboundRackCodes({ ...input, warehouse: '#', row: '7', endRack: '2' }).racks, ['#-7-1', '#-7-2'])
assert.deepEqual(buildOutboundRackCodes({ ...input, warehouse: '%', row: '6', startRack: '9', endRack: '9' }).racks, ['%-6-9'])
assert.deepEqual(buildOutboundRackCodes({ ...input, warehouse: '!', row: '0', startRack: '0', endRack: '0' }).racks, ['!-0-0'])
assert.ok(buildOutboundRackCodes({ ...input, startRack: '8' }).error)
assert.ok(buildOutboundRackCodes({ ...input, endRack: '201' }).error)
assert.equal(outboundSlotExcelRows(buildOutboundRackCodes({ ...input, endRack: '200' }).racks).length, 3201)
assert.deepEqual(buildOutboundRackCodes({ ...input, mode: 'list', list: '3-1-1\n3-1-1\r\n3-1-2\n' }).racks, ['3-1-1', '3-1-2'])
const specialRacks = ['#-7-1', '%-6-9', '!-0-0', 'A-특수-렉', '03-01-001']
assert.deepEqual(buildOutboundRackCodes({ ...input, mode: 'list', list: specialRacks.concat('# - 7 - 1').join('\n') }).racks, specialRacks)
assert.deepEqual(outboundSlotExcelRows(specialRacks).slice(1, 2), [['#-7-1_A1', '#-7-1', 'A1']])
assert.equal(outboundSlotExcelRows(specialRacks).at(-1)?.[0], '03-01-001_D4')
for (const list of ['', '3-1-1_A1', '3-1', '3--1', 'text', '3-1-1\n=HYPERLINK("url")']) {
  assert.ok(buildOutboundRackCodes({ ...input, mode: 'list', list }).error, list)
}
assert.ok(buildOutboundRackCodes({ ...input, mode: 'list', list: Array.from({ length: 201 }, (_, index) => `3-1-${index + 1}`).join('\n') }).error)
console.log('outbound-qr verify: symbol identifiers and zero/leading-zero codes preserved; 7 racks / 112 slots; A-D ordering; four-up pagination; invalid/oversize ranges rejected: OK')
