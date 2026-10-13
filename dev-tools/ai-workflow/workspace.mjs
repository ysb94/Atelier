import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { runCommand } from './process.mjs'
import { inside, projectRoot } from './settings.mjs'

export const digest = content => createHash('sha256').update(content).digest('hex')
export function readFile(root, file) {
  const absolute = inside(root, file)
  if (!fs.existsSync(absolute)) return null
  const real = fs.realpathSync(absolute)
  inside(fs.realpathSync(root), path.relative(fs.realpathSync(root), real))
  if (fs.statSync(real).size > 2000000) throw new Error(`자동화 파일 크기 제한 초과: ${file}`)
  return fs.readFileSync(real, 'utf8')
}
export async function snapshot(root = projectRoot) {
  const { output } = await runCommand('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: root })
  const result = {}
  for (const file of [...new Set(output.split('\0').filter(Boolean))]) {
    const absolute = inside(root, file)
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue
    result[file.replaceAll('\\', '/')] = digest(fs.readFileSync(absolute))
  }
  return result
}
export function changedPaths(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file])
}
export function mapContext(files, root = projectRoot) {
  const source = path.join(root, 'dev-tools/structure-map/generated/structure.json')
  if (!fs.existsSync(source)) return { warning: '구조도 생성물이 없어 먼저 갱신해야 합니다.' }
  const map = JSON.parse(fs.readFileSync(source, 'utf8'))
  const edges = map.edges.filter(e => files.includes(e.source) || files.includes(e.target) || files.includes(e.from) || files.includes(e.to))
  const ids = new Set([...files, ...edges.flatMap(e => [e.source ?? e.from, e.target ?? e.to])])
  return { generatedAt: map.generatedAt, fingerprint: map.fingerprint,
    nodes: map.nodes.filter(n => ids.has(n.id)).map(n => ({ path: n.path, label: n.label, role: n.role })), edges: edges.slice(0,100) }
}

export async function evidence(root, baseline, files, runDir) {
  const after = await snapshot(root)
  const outside = changedPaths(baseline.all, after).filter(file => !files.includes(file))
  const changes = []
  for (const file of files) {
    const current = readFile(root, file)
    if (current === baseline.contents[file]) continue
    const left = path.join(runDir, `before-${changes.length}.txt`), right = path.join(runDir, `after-${changes.length}.txt`)
    fs.writeFileSync(left, baseline.contents[file] ?? '')
    fs.writeFileSync(right, current ?? '')
    const diff = await runCommand('git', ['diff', '--no-index', '--no-ext-diff', '--', left, right], { cwd: root, acceptedCodes: [0,1] })
    changes.push({ file, beforeHash: baseline.all[file] ?? null, afterHash: after[file] ?? null, deleted: current === null, diff: diff.output })
  }
  const verificationFiles=Object.keys(baseline.all).filter(file=>file.startsWith('scripts/')||file.startsWith('dev-tools/ai-workflow/browser-')||/\.(?:test|verify)\.[cm]?[jt]sx?$/.test(file))
  return { changes, outside, snapshot: after, scope: {
    inventoryMethod:'git ls-files tracked and non-ignored untracked files, compared with task-start hashes',
    changedPaths:changedPaths(baseline.all,after),outsideAllowed:outside,
    verificationFiles:verificationFiles.map(file=>({file,beforeHash:baseline.all[file],afterHash:after[file]??null}))
  } }
}
