import { readFileSync } from 'node:fs'

const data = JSON.parse(
  readFileSync('node_modules/.tmp/sabangnet-official.json', 'utf8'),
) as {
  rows: Array<{ code: string; name: string; styleNos: string[] }>
}

const dataRows = data.rows.filter((row) => /^\d+$/.test(row.code))
const isM = (value: string) => /^M\d+/i.test(value)
const linked = dataRows.filter((row) => row.styleNos.some(isM))
const unlinked = dataRows.filter((row) => !row.styleNos.some(isM))
const multi = dataRows.filter((row) => row.styleNos.filter(isM).length > 1)
const uniqueM = new Set(
  dataRows.flatMap((row) => row.styleNos.filter(isM)),
)
const nonM = new Set(
  dataRows.flatMap((row) => row.styleNos.filter((value) => !isM(value))),
)

console.log(
  JSON.stringify(
    {
      dataRows: dataRows.length,
      linked: linked.length,
      unlinked: unlinked.length,
      multi: multi.length,
      links: dataRows.reduce(
        (sum, row) => sum + row.styleNos.filter(isM).length,
        0,
      ),
      uniqueM: uniqueM.size,
      nonM: Array.from(nonM).slice(0, 20),
      nonMCount: nonM.size,
      sampleUnlinked: unlinked.slice(0, 5),
      sampleMulti: multi[0] ?? null,
    },
    null,
    2,
  ),
)
