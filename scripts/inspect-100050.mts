import { readFileSync } from 'node:fs'
import { readPrefixedOfficeOpenXml } from '../src/lib/import/ooxml-spreadsheet'

const sheets = await readPrefixedOfficeOpenXml(
  readFileSync('node_modules/.tmp/sabangnet-official.xlsx'),
)
const row = sheets[0]?.rows.find((cells) => cells[0] === '100050')
console.log(JSON.stringify({
  found: row ?? null,
  c0: row?.[0],
  c1: row?.[1],
  c2: row?.[2],
  c3: row?.[3],
  length: row?.length ?? 0,
}, null, 2))
