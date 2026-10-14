import fs from 'node:fs'
import path from 'node:path'
import { digest, readFile } from './workspace.mjs'
import { taskFiles, inside } from './settings.mjs'
import { excludedFromWorkspace } from './isolation.mjs'
import { sourceRequest, sourceSlice, sourceChars, diffRanges } from './source-slices.mjs'
import { EnvironmentError } from './errors.mjs'

// Read source under the manager's existing permissions, without a nested shell.
// `requested` are reviewer-requested extra files; unavailable ones are reported, never guessed.
export function reviewBundle(root, task, evidence, requested = [], bundleFiles) {
  const required = bundleFiles ?? taskFiles(task.files)
  if (bundleFiles && (!bundleFiles.length || bundleFiles.length > 200 || bundleFiles.some(file => typeof file !== 'string'))) throw new Error('통합 검수 파일 목록이 올바르지 않습니다.')
  const selected = new Set(['AGENTS.md', ...required]), requests = requested.slice(0,40).map(sourceRequest)
  const dependencies = []
  const mapPath = path.join(root, 'dev-tools/structure-map/generated/structure.json')
  if (fs.existsSync(mapPath)) {
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
    for (const edge of map.edges) {
      const from = edge.source ?? edge.from, to = edge.target ?? edge.to
      if (required.includes(from) && typeof to === 'string' && /\.[cm]?[jt]sx?$/.test(to)
        && !excludedFromWorkspace(to)) dependencies.push({from,to,evidence:edge.evidence})
    }
  }
  const unavailable = []
  for (const request of requests) {
    const file = request.path
    let problem = null
    try { inside(root, file) } catch { problem = '작업 폴더 밖 경로' }
    if (!problem && excludedFromWorkspace(file)) problem = '비공개 경로'
    if (!problem && readFile(root, file) === null) problem = '파일 없음'
    if (!problem && evidence.snapshot && !(file in evidence.snapshot)) problem = 'Git 추적 대상이 아닌 생성 파일'
    if (problem) unavailable.push({ path: file, reason: problem }); else selected.add(file)
  }
  const files = []
  let total = 0
  for (const file of selected) {
    if (excludedFromWorkspace(file)) throw new Error(`검토 자료에 비공개 경로를 포함할 수 없습니다: ${file}`)
    const content = readFile(root, file)
    const sha256 = content === null ? null : digest(content)
    if (evidence.snapshot && (evidence.snapshot[file] ?? null) !== sha256)
      throw new Error(`검증 이후 파일이 변경되었습니다: ${file}`)
    const count = content?.split('\n').length ?? 0
    const changes = [...evidence.changes,...(evidence.headChanges ?? [])].filter(change=>change.file===file)
    const ranges = changes.flatMap(change=>diffRanges(change.diff)).map(([a,b])=>[Math.min(a,count),Math.min(b,count)]).filter(([a])=>a>0)
    ranges.push(...requests.filter(item=>item.path===file && item.range).map(item=>item.range))
    const item = sourceSlice(file,content,{ranges,query:[task.title,task.request,task.criteria].join('\n'),maxChars:file==='AGENTS.md'?12000:24000})
    total += sourceChars(item)
    if(total>80000)throw new EnvironmentError('검토 소스 구간이 80,000자를 넘었습니다. 추가 GPT 호출 전에 멈췄습니다. 작업을 작은 범위로 나눠야 합니다.',{retry:false,code:'review_bundle'})
    files.push(item)
  }
  for (const change of evidence.changes) {
    const current = files.find(file => file.path === change.file)
    if (!current || current.sha256 !== change.afterHash)
      throw new Error(`변경 증거와 실제 파일이 다릅니다: ${change.file}`)
  }
  return { method: 'manager-read-source', capturedAt: new Date().toISOString(),
    scope: 'Complete small task files, changed hunks with context, and explicit requested line ranges. complete=false means omitted code is NOT reviewed; request missing evidence before passing.', files, dependencies,
    ...(requested.length ? { unavailable } : {}) }
}
