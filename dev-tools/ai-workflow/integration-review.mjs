import fs from 'node:fs'
import path from 'node:path'
import { stateDir } from './settings.mjs'
import { Notion } from './notion.mjs'
import { readControls, writeRunStatus } from './control.mjs'
import { TaskGit, validateBranchName } from './git-task.mjs'
import { snapshot, evidence, isManagerArtifact } from './workspace.mjs'
import { verification } from './runner.mjs'
import { runReview } from './reviewer.mjs'
import { excludedFromWorkspace } from './isolation.mjs'

const reviewDir = () => path.join(stateDir, 'integration-reviews')
const latestPath = () => path.join(reviewDir(), 'latest.json')

export function readLatestIntegrationReview() {
  const file = latestPath()
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

export function integrationReviewLine(latest, head) {
  if (!latest?.sha) return ''
  const moved = head?.branch === latest.branch && head.sha && head.sha !== latest.sha
  if (moved) return `통합 검수 무효 · ${latest.branch} @ ${latest.sha.slice(0, 12)} 기록, 현재 ${head.sha.slice(0, 12)}`
  if (!latest.approved) return `통합 검수 불합격 · ${latest.branch} @ ${latest.sha.slice(0, 12)}`
  return `통합 검수 합격 · ${latest.branch} @ ${latest.sha.slice(0, 12)} · main 미병합`
}

function writeReview(record) {
  const dir = reviewDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${record.sha}.json`)
  fs.writeFileSync(file, JSON.stringify(record, null, 2))
  const latest = { branch: record.branch, sha: record.sha, baseBranch: record.baseBranch, baseSha: record.baseSha,
    approved: record.approved, summary: record.summary, decision: record.decision, checkedAt: record.checkedAt, file }
  fs.writeFileSync(latestPath(), JSON.stringify(latest, null, 2))
  return latest
}

async function liveControls(config, notion) {
  const client = notion ?? new Notion(config)
  const controls = await readControls(client, config)
  if (!controls.ok) throw new Error(controls.problems.join(' / '))
  return { client, controls }
}

export async function selectedIntegrationBranch({ config, notion, integration }) {
  if (integration) return validateBranchName(integration, { role: 'integration' })
  const { controls } = await liveControls(config, notion)
  return validateBranchName(controls.values.integrationBranch, { role: 'integration' })
}

// Read-only detached checkout of the pinned integration SHA. Does not merge to main.
export async function reviewIntegration({ config, git = new TaskGit({ config }), notion, integration, verify = verification, review = runReview, signal } = {}) {
  const { client, controls } = await liveControls(config, notion)
  const branch = validateBranchName(integration ?? controls.values.integrationBranch, { role: 'integration' })
  const baseBranch = validateBranchName(controls.values.baseBranch, { role: 'base' })
  if (branch === baseBranch) throw new Error('기준 브랜치와 통합 브랜치는 달라야 합니다.')
  const sha = await git.fetchBranch(branch, { role: 'integration', signal })
  const baseSha = await git.fetchBranch(baseBranch, { role: 'base', signal })
  const dir = path.join(git.workspaceRoot(), 'integration-reviews', sha)
  await git.detachedWorktree(dir, sha)
  const checkedAt = new Date().toISOString()
  try {
    const checks = await verify(config, dir, signal)
    const head = (await git.git(['rev-parse', 'HEAD'], { cwd: dir })).output.trim()
    if (head !== sha) throw new Error(`검사 중 HEAD가 ${sha}에서 ${head}로 바뀌었습니다. 이 SHA는 합격하지 않습니다.`)
    const dirty = await git.dirtyPaths(dir)
    if (dirty.length) throw new Error(`검사가 고정 커밋의 소스를 수정했습니다: ${dirty.slice(0, 8).join(', ')}. 이 SHA는 합격하지 않습니다.`)
    const changed = (await git.changedFiles(dir, baseSha)).filter(file => !isManagerArtifact(file))
    if (changed.length > 200) throw new Error(`기준 대비 변경이 ${changed.length}개라 소스를 자르지 않고는 검수할 수 없습니다. 이 SHA는 합격하지 않습니다.`)
    for (const file of changed) if (excludedFromWorkspace(file)) throw new Error(`통합 검수 변경에 비공개 경로가 있습니다: ${file}`)
    const files = changed.length ? changed : ['AGENTS.md']
    const start = await snapshot(dir)
    const contents = {}
    for (const file of files) contents[file] = await git.fileAtBase(dir, baseSha, file)
    const evidenceDir = path.join(reviewDir(), `${sha}-evidence`)
    fs.mkdirSync(evidenceDir, { recursive: true })
    const proof = await evidence(dir, { all: start, contents }, files, evidenceDir)
    const outside = proof.outside.filter(file => !isManagerArtifact(file))
    if (outside.length) throw new Error(`검사 중 통합 범위 밖 파일이 바뀌었습니다: ${outside.slice(0, 10).join(', ')}`)
    const passed = checks.length > 0 && checks.every(check => check.passed)
    const reviewDirPath = path.join(reviewDir(), `${sha}-gpt`)
    fs.mkdirSync(reviewDirPath, { recursive: true })
    const criteria = '설정된 검사가 통과하고, 기준 대비 변경이 그 검사와 맞아야 합니다. main 병합은 이 검수의 합격 조건이 아닙니다.'
    const task = {
      title: `통합 브랜치 검수 ${branch}`,
      request: `${branch}의 고정 커밋을 기준 브랜치와 비교해 통합 결과를 검수합니다.`,
      criteria, criteriaItems: [criteria],
      files: files.join('\n'),
      executionKind: 'verification',
      source: { screen: '통합 검수', area: '개발' },
    }
    const gpt = { model: controls.values.gptModel, effort: controls.values.gptEffort }
    const instructions = `통합 검수입니다. 통합 브랜치 ${branch}의 고정 커밋 ${sha}를 기준 ${baseBranch} @ ${baseSha}와 비교합니다. 이 실행은 읽기 전용이며 main에 병합하지 않습니다. 합격은 이 SHA에만 유효하고 브랜치가 움직이면 무효입니다. report.deployment는 verification입니다. 운영 게시나 main 반영을 완료했다고 쓰지 마세요.`
    const gptReview = await review({ config, root: dir, task, evidence: proof, checks, cursor: { report: '통합 검수는 구현 세션 없이 고정 커밋과 검사 기록만 봅니다.' },
      runDir: reviewDirPath, signal, gpt, instructions, maxSourceRounds: config.v2?.maxSourceRounds ?? 2, bundleFiles: files })
    const approved = passed && gptReview.decision === 'pass'
    const summary = `${approved ? '합격' : '불합격'}: ${gptReview.summary}`.slice(0, 900)
    const record = { branch, sha, baseBranch, baseSha, approved, summary, decision: gptReview.decision, checkedAt,
      gpt, checks: checks.map(({ name, passed: ok }) => ({ name, passed: ok })), review: gptReview,
      changed: files, note: 'main 병합은 하지 않았습니다. 이 기록은 위 SHA에만 유효합니다.' }
    const latest = writeReview(record)
    let statusError = null
    try { await writeRunStatus(client, config, integrationReviewLine(latest)) } catch (error) { statusError = error.message }
    return { ...latest, statusError }
  } finally {
    await git.removeWorktree(dir).catch(error => console.warn('[ai-workflow] 통합 검수 공간 정리 실패', { dir, message: error.message }))
  }
}
