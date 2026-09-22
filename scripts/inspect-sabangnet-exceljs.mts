import ExcelJS from 'exceljs'

const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile('node_modules/.tmp/sabangnet-official.xlsx')

const sheet = workbook.worksheets[0]
console.log(JSON.stringify({
  worksheetCount: workbook.worksheets.length,
  name: sheet?.name ?? null,
  rowCount: sheet?.rowCount ?? 0,
  actualRowCount: sheet?.actualRowCount ?? 0,
  columnCount: sheet?.columnCount ?? 0,
  firstRows: [1, 2, 3, 4, 5].map((n) => {
    const row = sheet?.getRow(n)
    const values = Array.isArray(row?.values) ? row.values.slice(1, 12) : []
    return {
      n,
      values: values.map((value) =>
        value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value),
      ),
    }
  }),
}, null, 2))
