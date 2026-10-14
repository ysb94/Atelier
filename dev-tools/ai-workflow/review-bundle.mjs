import fs from 'node:fs'
import path from 'node:path'
import { digest, readFile } from './workspace.mjs'
import { taskFiles, inside } from './settings.mjs'
import { excludedFromWorkspace } from './isolation.mjs'

// Read source under the manager's existing permissions, without a nested shell.
// `requested` are reviewer-requested extra files; unavailable ones are reported, never guessed.
export function reviewBundle(root, task, evidence, requested = [], bundleFiles) {
  const required = bundleFiles ?? taskFiles(task.files)
  if (bundleFiles && (!bundleFiles.length || bundleFiles.length > 200 || bundleFiles.some(file => typeof file !== 'string'))) throw new Error('통합 검수 파일 목록이 올바르지 않습니다.')
  const selected = new Set(['AGENTS.md', ...required])
  const mapPath = path.join(root, 'dev-tools/structure-map/generated/structure.json')
  if (fs.existsSync(mapPath)) {
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
    for (const edge of map.edges) {
      const from = edge.source ?? edge.from, to = edge.target ?? edge.to
      if (required.includes(from) && typeof to === 'string' && /\.[cm]?[jt]sx?$/.test(to)
        && !excludedFromWorkspace(to)) selected.add(to)
    }
  }
  const unavailable = []
  for (const raw of requested.slice(0, 40)) {
    const file = String(raw).trim().replaceAll('\\', '/')
    let problem = null
    try { inside(root, file) } catch { problem = '작업 폴더 밖 경로' }
    if (!problem && excludedFromWorkspace(file)) problem = '비공개 경로'
    if (!problem && readFile(root, file) === null) problem = '파일 없음'
    if (!problem && evidence.snapshot && !(file in evidence.snapshot)) problem = 'Git 추적 대상이 아닌 생성 파일'
    if (problem) unavailable.push({ path: file, reason: problem }); else selected.add(file)
  }
  const files = []
  for (const file of selected) {
    if (excludedFromWorkspace(file)) throw new Error(`검토 자료에 비공개 경로를 포함할 수 없습니다: ${file}`)
    const content = readFile(root, file)
    const sha256 = content === null ? null : digest(content)
    if (evidence.snapshot && (evidence.snapshot[file] ?? null) !== sha256)
      throw new Error(`검증 이후 파일이 변경되었습니다: ${file}`)
    files.push({ path: file, sha256, content })
  }
  for (const change of evidence.changes) {
    const current = files.find(file => file.path === change.file)
    if (!current || current.sha256 !== change.afterHash)
      throw new Error(`변경 증거와 실제 파일이 다릅니다: ${change.file}`)
  }
  return { method: 'manager-read-source', capturedAt: new Date().toISOString(),
    scope: 'Full task files and direct source dependencies; not the whole repository. Missing evidence must not be assumed.', files,
    ...(requested.length ? { unavailable } : {}) }
}
