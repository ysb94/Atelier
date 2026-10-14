import fs from 'node:fs'
import path from 'node:path'
import { digest, readFile } from './workspace.mjs'
import { taskFiles } from './settings.mjs'
import { excludedFromWorkspace } from './isolation.mjs'

// Read source under the manager's existing permissions, without a nested shell.
export function reviewBundle(root, task, evidence) {
  const required = taskFiles(task.files)
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
    scope: 'Full task files and direct source dependencies; not the whole repository. Missing evidence must not be assumed.', files }
}
