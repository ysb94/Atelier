import { readFileSync } from 'node:fs'
import { normalizeStyleNo } from '../src/lib/import/transform'

const official = JSON.parse(
  readFileSync('node_modules/.tmp/sabangnet-official.json', 'utf8'),
) as { uniqueM: string[] }

const styles = JSON.parse(
  readFileSync(process.argv[2], 'utf8'),
) as Array<{ id: string; style_no: string }>

const byNo = new Map(
  styles.map((style) => [normalizeStyleNo(style.style_no), style]),
)
const missing = official.uniqueM.filter(
  (styleNo) => !byNo.has(normalizeStyleNo(styleNo)),
)
const found = official.uniqueM.length - missing.length

console.log(
  JSON.stringify(
    {
      needed: official.uniqueM.length,
      catalog: styles.length,
      found,
      missingCount: missing.length,
      missing: missing.slice(0, 50),
    },
    null,
    2,
  ),
)
