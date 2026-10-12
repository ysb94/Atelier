import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { analyze } from './analyze.mjs'

export const toolDir = path.dirname(fileURLToPath(import.meta.url))
export const root = path.resolve(toolDir, '../..')
export const outputDir = path.join(toolDir, 'generated')
export const outputFile = path.join(outputDir, 'atelier-structure.html')

export function replaceGeneratedFile(source, destination, rename = fs.renameSync, pause = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)) {
  for (let attempt = 0;; attempt++) {
    try {
      rename(source, destination)
      if (attempt) console.info('[structure-map] 생성 파일 교체 재시도 성공', { file: destination, attempts: attempt + 1 })
      return
    } catch (error) {
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
      if (!attempt) console.warn('[structure-map] 생성 파일 잠금; 교체 재시도', { file: destination, code: error.code })
      pause(100 * (attempt + 1))
    }
  }
}

export function build(writeHtmlSnapshot = true) {
  const started = performance.now()
  const config = JSON.parse(fs.readFileSync(path.join(toolDir, 'domains.json'), 'utf8'))
  const data = analyze(root, config)
  const template = fs.readFileSync(path.join(toolDir, 'viewer.html'), 'utf8')
  const css = fs.readFileSync(path.join(toolDir, 'viewer.css'), 'utf8')
  const script = fs.readFileSync(path.join(toolDir, 'viewer.js'), 'utf8')
  // Reconnecting browsers also refresh when the viewer or naming rules have changed.
  data.fingerprint = crypto.createHash('sha256').update(data.fingerprint).update(template).update(css).update(script)
    .update(fs.readFileSync(path.join(toolDir, 'analyze.mjs'))).update(fs.readFileSync(path.join(toolDir, 'labels.mjs'))).digest('hex')
  // Escape characters that can terminate an inline script even when inside a JSON string.
  const json = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  const html = template.replace('/*__STYLES__*/', () => css).replace('/*__VIEWER__*/', () => script).replace('__STRUCTURE_DATA__', () => json)
  fs.mkdirSync(outputDir, { recursive: true })
  const temporary = `${outputFile}.${process.pid}.tmp`
  if (writeHtmlSnapshot) fs.writeFileSync(temporary, html)
  const jsonFile = path.join(outputDir, 'structure.json')
  const temporaryJson = `${jsonFile}.${process.pid}.tmp`
  fs.writeFileSync(temporaryJson, JSON.stringify(data, null, 2))
  replaceGeneratedFile(temporaryJson, jsonFile)
  // Commit the browser artifact last: a metadata-write failure keeps its previous snapshot.
  if (writeHtmlSnapshot) replaceGeneratedFile(temporary, outputFile)
  Object.defineProperty(data, 'html', { value: html })
  const elapsed = Math.round(performance.now() - started)
  const log = elapsed >= 1000 ? console.warn : console.info
  log(`[structure-map] ${data.stats.files} files, ${data.stats.edges} links, ${data.stats.resources} resources (${elapsed}ms)`)
  if (writeHtmlSnapshot) console.info(`[structure-map] ${outputFile}`)
  return data
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { build() } catch (error) { console.error('[structure-map] 생성 실패', error); process.exitCode = 1 }
}
