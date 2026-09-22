import { readFileSync, statSync } from 'node:fs'
import * as XLSX from 'xlsx'

const sourcePath =
  process.argv[2] ??
  'node_modules/.tmp/sabangnet-official.xlsx'

const stat = statSync(sourcePath)
const buffer = readFileSync(sourcePath)
const workbook = XLSX.read(buffer, {
  type: 'buffer',
  cellDates: true,
})
const sheetName = workbook.SheetNames[0]
const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
const keys = sheet ? Object.keys(sheet).slice(0, 40) : []

console.log(JSON.stringify({
  sourcePath,
  size: stat.size,
  magic: buffer.subarray(0, 8).toString('hex'),
  sheetName,
  sheetNames: workbook.SheetNames,
  sheetKeys: Object.keys(workbook.Sheets),
  props: workbook.Workbook ?? null,
  ref: sheet?.['!ref'] ?? null,
  keys,
  A1: sheet?.A1 ?? null,
  A2: sheet?.A2 ?? null,
  B2: sheet?.B2 ?? null,
  C2: sheet?.C2 ?? null,
  A4: sheet?.A4 ?? null,
}, null, 2))
