import { readFileSync, writeFileSync } from 'node:fs'

const raw = readFileSync(process.argv[2], 'utf8')
const start = raw.indexOf('[')
const end = raw.lastIndexOf(']')
if (start < 0 || end < 0) {
  throw new Error('JSON 배열을 찾지 못했습니다.')
}
const json = raw.slice(start, end + 1)
writeFileSync('node_modules/.tmp/masmarulez-styles.json', json)
const rows = JSON.parse(json) as unknown[]
console.log(`styles ${rows.length}`)
