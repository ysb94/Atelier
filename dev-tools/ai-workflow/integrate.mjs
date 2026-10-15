import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { settings } from './settings.mjs'
import { TaskGit, validateBranchName, sameRepositoryPullRequest, headCloneUrl } from './git-task.mjs'
import { selectedIntegrationBranch, reviewIntegration } from './integration-review.mjs'

// Operator-only integration. The automation never merges; this CLI merges only the PR heads named on the command line.
const usage = `사용법:
  node dev-tools/ai-workflow/integrate.mjs list [--integration=<브랜치>] [--allow-cross-repo]
  node dev-tools/ai-workflow/integrate.mjs merge --approve-integration --pr=<번호>@<head SHA> [--pr=...] [--integration=<브랜치>] [--allow-cross-repo]
  node dev-tools/ai-workflow/integrate.mjs review [--integration=<브랜치>]

브랜치를 생략하면 노션 설정 페이지에 선택된 통합 브랜치를 사용합니다.
review는 그 브랜치를 fetch해 SHA를 고정하고, 분리된 읽기 전용 작업 공간에서 설정 검사와 GPT 소스 검토를 한 뒤
dev-tools/ai-workflow/.state/integration-reviews/<sha>.json 에 기록을 남깁니다. main에는 병합하지 않습니다.`

export function parseArgs(argv) {
  const [command, ...rest] = argv, options = { command, prs: [], approve: false, integration: null, allowCrossRepo: false }
  for (const arg of rest) {
    if (arg === '--approve-integration') options.approve = true
    else if (arg === '--allow-cross-repo') options.allowCrossRepo = true
    else if (arg.startsWith('--pr=')) {
      const match = arg.slice(5).match(/^(\d+)@([0-9a-f]{40,64})$/)
      if (!match) throw new Error(`--pr는 <번호>@<전체 head SHA> 형식이어야 합니다: ${arg}`)
      options.prs.push({ number: Number(match[1]), head: match[2] })
    } else if (arg.startsWith('--integration=')) options.integration = arg.slice(14)
    else throw new Error(`알 수 없는 인자: ${arg}\n${usage}`)
  }
  return options
}

const mainNames = config => new Set(['main', 'master', config.v2?.mainBranch].filter(Boolean).map(name => String(name).toLowerCase()))

export async function listCandidates({ config = settings(), git = new TaskGit({ config }), notion, integration, allowCrossRepo = false } = {}) {
  const base = await selectedIntegrationBranch({ config, notion, integration })
  await git.verifyOrigin()
  const { output } = await git.gh(['pr', 'list', `--repo=${git.slug}`, `--base=${base}`, '--state=open',
    '--json=number,url,title,headRefName,headRefOid,baseRefName,isCrossRepository,headRepository,headRepositoryOwner', '--limit=100'])
  return JSON.parse(output || '[]').filter(pr => pr.baseRefName === base && !mainNames(config).has(String(pr.baseRefName).toLowerCase())
    && (allowCrossRepo || sameRepositoryPullRequest(pr, git.slug)))
}

export async function mergeApproved({ config = settings(), git = new TaskGit({ config }), notion, integration, prs, approve, allowCrossRepo = false }) {
  if (!approve) throw new Error('통합에는 --approve-integration이 필요합니다. 승인은 이 실행에만 쓰이며 저장되지 않습니다.')
  if (!prs?.length) throw new Error('통합할 PR을 --pr=<번호>@<head SHA>로 지정하세요.')
  const base = await selectedIntegrationBranch({ config, notion, integration })
  validateBranchName(base, { role: 'integration' })
  await git.verifyOrigin()
  const checked = []
  for (const { number, head } of prs) {
    const pr = await git.pullRequest(number)
    if (pr.state !== 'OPEN') throw new Error(`PR #${number}은 열린 상태가 아닙니다(${pr.state}).`)
    if (pr.baseRefName !== base || mainNames(config).has(String(pr.baseRefName).toLowerCase())) throw new Error(`PR #${number}의 대상(${pr.baseRefName})이 통합 브랜치(${base})가 아닙니다.`)
    if (!allowCrossRepo && !sameRepositoryPullRequest(pr, git.slug)) throw new Error(`PR #${number}은 다른 저장소의 브랜치입니다(${pr.headRefName}). 별도 승인(--allow-cross-repo) 없이는 합치지 않습니다.`)
    if (!sameRepositoryPullRequest(pr, git.slug) && !headCloneUrl(pr)) throw new Error(`PR #${number}의 head 저장소를 확인하지 못해 통합하지 않습니다.`)
    if (pr.headRefOid !== head) throw new Error(`PR #${number}의 현재 head(${pr.headRefOid})가 승인한 커밋(${head})과 다릅니다. 다시 확인한 뒤 승인하세요.`)
    checked.push(pr)
  }
  const applied = await git.mergeIntoIntegration({
    branch: base,
    heads: checked.map(pr => ({
      branch: pr.headRefName,
      sha: pr.headRefOid,
      remote: sameRepositoryPullRequest(pr, git.slug) ? null : headCloneUrl(pr),
    })),
  })
  return { integration: base, method: applied.method, previous: applied.previous, tip: applied.tip,
    merged: checked.map(pr => ({ number: pr.number, url: pr.url, head: pr.headRefOid })),
    note: '승인한 커밋만 로컬에서 통합 브랜치에 합친 뒤 그 ref만 비교 후 갱신했습니다. PR 병합 API와 main은 사용하지 않습니다. 노션 반영 상태는 관리자가 GitHub를 조회해 갱신합니다.' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const config = settings()
    if (options.command === 'list') console.log(JSON.stringify(await listCandidates({ ...options, config }), null, 2))
    else if (options.command === 'merge') console.log(JSON.stringify(await mergeApproved({ ...options, config }), null, 2))
    else if (options.command === 'review') {
      const result = await reviewIntegration({ ...options, config })
      console.log(JSON.stringify(result, null, 2))
      if (!result.approved || result.statusError) process.exitCode = 1
    } else { console.error(usage); process.exitCode = 2 }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
