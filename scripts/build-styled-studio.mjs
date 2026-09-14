import { build } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const result = await build({ configFile: false, publicDir: false, logLevel: 'warn', build: {
  write: false, minify: true, cssCodeSplit: false,
  lib: { entry: fileURLToPath(new URL('tools/styled-studio/main.tsx', root)), name: 'StyledStudio', formats: ['iife'] },
}, esbuild: { jsx: 'automatic' }, define: { 'process.env.NODE_ENV': JSON.stringify('production') } })
const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output)
const js = outputs.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n')
const css = outputs.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css')).map((item) => item.source).join('\n')
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atelier · 연출컷 스튜디오</title><style>body{margin:0;background:#f5f6f2}button,input,textarea,select{font:inherit}${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
await mkdir(new URL('outputs/', root), { recursive: true })
const output = new URL('outputs/연출컷-스튜디오.html', root)
await writeFile(output, html)
console.log(`Studio preview: ${fileURLToPath(output)}`)
