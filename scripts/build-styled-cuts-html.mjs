import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const source = await readFile(new URL('src/lib/design/styled-cuts.ts', root), 'utf8')
if (/^import /m.test(source)) throw new Error('Standalone model must not import external modules')
const compiled = ts.transpileModule(source.replace(/^export /gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const template = await readFile(new URL('tools/styled-cuts/template.html', root), 'utf8')
const html = template.replace('/* SHARED_MODEL */', compiled.replace(/<\/script/gi, '<\\/script'))
await mkdir(new URL('outputs/', root), { recursive: true })
const output = new URL('outputs/연출컷-제작.html', root)
await writeFile(output, html, 'utf8')
console.log(`Standalone HTML: ${fileURLToPath(output)} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`)
