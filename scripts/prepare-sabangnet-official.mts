/**
 * 공식 사방넷 대량수정 파일을 앱 파서로 읽어 등록 후보를 만든다.
 * 실행: npx tsx --tsconfig tsconfig.app.json scripts/prepare-sabangnet-official.mts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseStyleNoList } from '../src/lib/codes/style-no-list'
import {
  findSabangnetHeader,
  prepareSabangnetRows,
} from '../src/lib/codes/sabangnet-import'
import { readPrefixedOfficeOpenXml } from '../src/lib/import/ooxml-spreadsheet'

const sourcePath =
  process.argv[2] ??
  'node_modules/.tmp/sabangnet-official.xlsx'

const buffer = readFileSync(sourcePath)
const sha256 = createHash('sha256').update(buffer).digest('hex')
const sheets = await readPrefixedOfficeOpenXml(buffer)
const sheetName = sheets[0]?.name
const rows = sheets[0]?.rows ?? []
if (!sheetName || rows.length === 0) {
  throw new Error('시트를 찾지 못했습니다.')
}

const header = findSabangnetHeader(rows)
if (!header) {
  throw new Error('사방넷 헤더를 찾지 못했습니다.')
}

const dataRows: Array<{ code: string; name: string; styleNos: string[] }> = []
const uniqueM = new Set<string>()
let linked = 0
let unlinked = 0
let multi = 0
let linkCount = 0

for (let i = header.dataStartIndex; i < rows.length; i += 1) {
  const row = rows[i] ?? []
  const code = (row[header.codeIdx] ?? '').trim()
  const name = (row[header.nameIdx] ?? '').trim()
  const styleNos = parseStyleNoList(row[header.stylesIdx] ?? '')
  if (!code && !name && styleNos.length === 0) continue
  dataRows.push({ code, name, styleNos })
  if (styleNos.length === 0) unlinked += 1
  else {
    linked += 1
    if (styleNos.length > 1) multi += 1
  }
  linkCount += styleNos.length
  for (const styleNo of styleNos) uniqueM.add(styleNo)
}

const preview = prepareSabangnetRows({
  rows,
  styles: [],
  existingProducts: [],
})
const pending = preview.filter((row) => row.statusLabel === 'pending').length
const errors = preview.filter((row) => row.statusLabel === 'error')

const outPath = 'node_modules/.tmp/sabangnet-official.json'
writeFileSync(
  outPath,
  JSON.stringify(
    {
      sourcePath,
      fileName: basename(sourcePath),
      sha256,
      sheetName,
      header,
      parentCount: dataRows.length,
      linked,
      unlinked,
      multi,
      linkCount,
      uniqueM: Array.from(uniqueM).sort(),
      previewPending: pending,
      previewErrors: errors.slice(0, 20),
      rows: dataRows,
    },
    null,
    2,
  ),
)

console.log(
  JSON.stringify(
    {
      sourcePath,
      sha256,
      header,
      parentCount: dataRows.length,
      linked,
      unlinked,
      multi,
      linkCount,
      uniqueM: uniqueM.size,
      previewPending: pending,
      previewErrorCount: errors.length,
      outPath,
    },
    null,
    2,
  ),
)
