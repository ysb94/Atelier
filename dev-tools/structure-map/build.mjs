import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { analyze } from './analyze.mjs'

export const toolDir = path.dirname(fileURLToPath(import.meta.url))
export const root = path.resolve(toolDir, '../..')
export const outputDir = path.join(toolDir, 'generated')
export const indexFile = path.join(outputDir, 'ai-index.md')
export const jsonFile = path.join(outputDir, 'structure.json')
export const outputFile = indexFile

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

export function formatAiIndex(data) {
  const routeLines = [`## 1. Routes (URL -> Menu -> Target Files)`]
  for (const r of data.routes) {
    if (r.redirect) {
      routeLines.push(`- \`${r.path}\` -> redirect \`${r.redirect}\` (${r.file}:${r.line})`)
      continue
    }
    const label = r.labels?.length ? ` [${r.labels.join(', ')}]` : ''
    const targets = r.targets?.length ? r.targets.join(', ') : r.components?.join(', ') || '(wrapper)'
    routeLines.push(`- \`${r.path}\`${label} -> ${targets} (${r.file}:${r.line})`)
  }

  const outResources = new Map()
  const outApi = new Map()
  const resCallers = new Map()

  for (const e of data.edges) {
    if (['table', 'rpc', 'storage', 'function'].includes(e.kind)) {
      const list = outResources.get(e.from) ?? []
      const ln = e.evidence?.[0]?.line
      list.push(ln ? `${e.to}@L${ln}` : e.to)
      outResources.set(e.from, list)

      const callers = resCallers.get(e.to) ?? []
      callers.push(ln ? `${e.from}:${ln}` : e.from)
      resCallers.set(e.to, callers)
    } else if (e.kind === 'api') {
      const list = outApi.get(e.from) ?? []
      const syms = e.evidence?.map(v => v.symbol).filter(Boolean) ?? []
      const shortTo = e.to.replace(/^src\/lib\/supabase\//, 'store:')
      list.push(syms.length ? `${shortTo}(${syms.slice(0, 6).join(',')}${syms.length > 6 ? '…' : ''})` : shortTo)
      outApi.set(e.from, list)
    }
  }

  const fileNodes = data.nodes.filter(n => n.path)
  const byDomain = new Map()
  for (const n of fileNodes) {
    const list = byDomain.get(n.domain) ?? []
    list.push(n)
    byDomain.set(n.domain, list)
  }

  const domainBlocks = []
  for (const d of data.domains) {
    const group = byDomain.get(d.id)
    if (!group?.length) continue
    const block = [`### [${d.id}] ${d.label} — ${d.description}`]
    for (const n of group.sort((a, b) => a.path.localeCompare(b.path))) {
      const exps = (n.exports ?? []).slice(0, 12).map(e => `${e.name}:${e.line}`).join(', ')
      const moreExp = (n.exports?.length ?? 0) > 12 ? ` +${n.exports.length - 12}` : ''
      const res = outResources.get(n.path)?.join(', ') ?? ''
      const apis = outApi.get(n.path)?.join(', ') ?? ''
      const parts = [`\`${n.path}\` (${n.lines}L) — ${n.label}`]
      if (exps) parts.push(`exp: ${exps}${moreExp}`)
      if (n.sections?.length) parts.push(`ui: ${n.sections.slice(0, 5).join(' / ')}`)
      if (res) parts.push(`db: ${res}`)
      if (apis) parts.push(`api: ${apis}`)
      block.push(`- ${parts.join(' | ')}`)
    }
    domainBlocks.push({ id: d.id, label: d.label, count: group.length, lines: block })
  }

  const resLines = [`## 3. Supabase Resources (resource -> caller:line)`]
  for (const [res, callers] of [...resCallers.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    resLines.push(`- \`${res}\` <- ${callers.join(', ')}`)
  }

  const headerBase = [
    `# Atelier AI Code Index`,
    `generatedAt: ${data.generatedAt} | files: ${data.stats.files} | edges: ${data.stats.edges} | resources: ${data.stats.resources}`,
    `사용법: 먼저 1~90줄(Section 0~1)만 Read하여 라우트와 도메인 줄 번호를 확인한 뒤, 필요한 도메인 줄 구간만 Read하고 타겟 소스 파일의 줄 범위(offset/limit)로 바로 이동하세요.`,
    ``,
    `## 0. Section Line Map`,
  ]

  // headerBase(5) + tocLines(3) + blank(1) + routeLines + blank(1) + domainHeader(1)
  const routeStart = headerBase.length + 3 + 1 + 1
  const routeEnd = routeStart + routeLines.length - 1
  let cursor = routeEnd + 2 // blank + "## 2. Files by Domain..."
  const domainToc = []
  const bodyLines = [`## 2. Files by Domain (path (lines) — label | exports:line | db/api)`]
  for (const b of domainBlocks) {
    bodyLines.push(``)
    const start = cursor + 2
    const end = start + b.lines.length - 1
    domainToc.push(`${b.id}(${b.label}):L${start}-${end}`)
    bodyLines.push(...b.lines)
    cursor = end
  }
  const resStart = cursor + 2
  const resEnd = resStart + resLines.length - 1

  const tocLines = [
    `- Routes: L${routeStart}-${routeEnd} | Supabase Resources: L${resStart}-${resEnd}`,
    `- Domains (1): ${domainToc.slice(0, 10).join(' | ')}`,
    `- Domains (2): ${domainToc.slice(10).join(' | ')}`,
  ]

  return [
    ...headerBase,
    ...tocLines,
    ``,
    ...routeLines,
    ``,
    ...bodyLines,
    ``,
    ...resLines,
  ].join('\n') + '\n'
}

export function build(writeSnapshot = true) {
  const started = performance.now()
  const config = JSON.parse(fs.readFileSync(path.join(toolDir, 'domains.json'), 'utf8'))
  const data = analyze(root, config)
  data.fingerprint = crypto.createHash('sha256')
    .update(data.fingerprint)
    .update(fs.readFileSync(path.join(toolDir, 'analyze.mjs')))
    .update(fs.readFileSync(path.join(toolDir, 'labels.mjs')))
    .update(fs.readFileSync(path.join(toolDir, 'build.mjs')))
    .digest('hex')

  const indexText = formatAiIndex(data)
  fs.mkdirSync(outputDir, { recursive: true })

  const temporaryJson = `${jsonFile}.${process.pid}.tmp`
  fs.writeFileSync(temporaryJson, JSON.stringify(data))
  replaceGeneratedFile(temporaryJson, jsonFile)

  if (writeSnapshot) {
    const temporaryIndex = `${indexFile}.${process.pid}.tmp`
    fs.writeFileSync(temporaryIndex, indexText)
    replaceGeneratedFile(temporaryIndex, indexFile)
  }

  Object.defineProperty(data, 'aiIndex', { value: indexText })
  const elapsed = Math.round(performance.now() - started)
  const log = elapsed >= 1000 ? console.warn : console.info
  log(`[structure-map] ${data.stats.files} files, ${data.stats.edges} links, ${data.stats.resources} resources (${elapsed}ms)`)
  if (writeSnapshot) console.info(`[structure-map] AI index: ${indexFile} (${Math.round(indexText.length / 1024)}KB)`)
  return data
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { build() } catch (error) { console.error('[structure-map] 생성 실패', error); process.exitCode = 1 }
}
