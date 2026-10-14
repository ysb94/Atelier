import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { runCommand, childEnv } from './process.mjs'
import { linkDependencies } from './isolation.mjs'
import { projectRoot, redact } from './settings.mjs'
import { isManagerArtifact } from './workspace.mjs'
import { EnvironmentError } from './errors.mjs'

const ROLE_LABEL = { base: '기준 브랜치', integration: '통합 브랜치', task: '작업 브랜치' }

// Mirrors `git check-ref-format --branch` plus the automation's own boundaries.
export function validateBranchName(name, { role = 'task' } = {}) {
  const fail = reason => { throw new EnvironmentError(`${ROLE_LABEL[role] ?? '브랜치'} 이름이 올바르지 않습니다 (${reason}): ${String(name).slice(0, 120)}`, { retry: false, code: 'invalid_branch' }) }
  if (typeof name !== 'string' || !name || name.length > 200) fail('비어 있거나 너무 김')
  if (name.startsWith('-')) fail("'-'로 시작")
  if (name.startsWith('refs/')) fail("'refs/' 접두어")
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.includes('..') || name.includes('//') || name.includes('@{') || name === '@') fail('Git 참조 규칙 위반')
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) fail('허용되지 않는 문자')
  if (name.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) fail('Git 참조 규칙 위반')
  if (name.toLowerCase() === 'head') fail('HEAD는 브랜치로 사용할 수 없음')
  if (role !== 'base' && ['main', 'master'].includes(name.toLowerCase())) fail('main·master에는 자동 작업이나 통합을 하지 않음')
  if (role === 'task' && !name.startsWith('auto/')) fail("작업 브랜치는 'auto/'로 시작해야 함")
  if (role !== 'task' && role !== 'head' && name.startsWith('auto/')) fail("'auto/'는 작업 브랜치 전용")
  return name
}

const REMOTE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i
export function normalizeRemote(url) {
  const match = String(url ?? '').trim().match(REMOTE)
  return match ? `https://github.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}` : null
}
export function repoSlug(url) {
  const match = String(url ?? '').trim().match(REMOTE)
  if (!match) throw new EnvironmentError('config v2.remoteUrl은 https://github.com/<owner>/<repo>.git 형식이어야 합니다.', { retry: false, code: 'remote' })
  return `${match[1]}/${match[2]}`
}

// Same-repo PRs only. Missing owner fields are not treated as same-repo; cross-repo stays out unless the caller opts in.
export function sameRepositoryPullRequest(pr, slug) {
  const expected = String(slug).toLowerCase()
  const named = pr?.headRepository?.nameWithOwner
    ?? (pr?.headRepositoryOwner?.login && pr?.headRepository?.name ? `${pr.headRepositoryOwner.login}/${pr.headRepository.name}` : null)
  if (named) return named.toLowerCase() === expected
  return pr?.isCrossRepository === false
}

export function headCloneUrl(pr) {
  const named = pr?.headRepository?.nameWithOwner
    ?? (pr?.headRepositoryOwner?.login && pr?.headRepository?.name ? `${pr.headRepositoryOwner.login}/${pr.headRepository.name}` : null)
  return named ? normalizeRemote(`https://github.com/${named}.git`) : null
}

const compact = value => String(value).replaceAll('-', '').toLowerCase()
export function taskBranchName(pageId, runId) {
  return validateBranchName(`auto/${compact(pageId).slice(0, 8)}-${compact(runId).slice(0, 8)}`, { role: 'task' })
}

// Blob contents must be byte-exact; the shared command runner redacts and truncates output.
function rawOutput(command, args, { cwd, env, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false })
    const chunks = []; let size = 0, errorOutput = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.on('data', data => { size += data.length; if (size <= 2000000) chunks.push(data) })
    child.stderr.on('data', data => { errorOutput = (errorOutput + data).slice(-2000) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      if (size > 2000000) return reject(new Error('자동화 파일 크기 제한 초과'))
      if (code !== 0) return reject(new Error(`git 명령 실패 (${code}): ${redact(errorOutput)}`))
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

export class TaskGit {
  constructor({ config, root = projectRoot, run = runCommand }) {
    Object.assign(this, { config, root, run }); this.tail = Promise.resolve()
  }
  get remoteUrl() { return this.config.v2?.remoteUrl }
  get slug() { return repoSlug(this.remoteUrl) }
  // Repository-level refs, worktree metadata and pushes are serialized across both slots.
  serial(task, signal) {
    const run = () => {
      if (signal?.aborted) return Promise.reject(new Error('작업 중지됨'))
      return task()
    }
    const result = this.tail.then(run, run)
    this.tail = result.catch(() => {})
    return result
  }
  gitEnv() { return childEnv({ GIT_TERMINAL_PROMPT: '0' }) }
  git(args, { cwd = this.root, acceptedCodes, timeoutMs = 180000, signal } = {}) {
    return this.run('git', args, { cwd, acceptedCodes, timeoutMs, signal, env: this.gitEnv() })
  }
  gh(args, { timeoutMs = 120000, signal } = {}) {
    const auth = Object.fromEntries(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
    return this.run(this.config.env?.ATELIER_GH_BIN ?? 'gh', args, { cwd: this.root, timeoutMs, signal,
      env: childEnv({ GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', ...auth }) })
  }
  workspaceRoot() {
    const realRoot = fs.realpathSync(this.root)
    const base = this.config.v2?.workspaceRoot ? path.resolve(this.config.v2.workspaceRoot)
      : path.join(os.homedir(), '.atelier-ai-workflow', 'worktrees', createHash('sha256').update(realRoot).digest('hex').slice(0, 12))
    const relative = path.relative(realRoot, base)
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new EnvironmentError('작업 브랜치 공간은 프로젝트 폴더 밖에 있어야 합니다.', { retry: false, code: 'workspace_root' })
    const parent = path.dirname(base)
    try { fs.accessSync(parent, fs.constants.W_OK) } catch {
      throw new EnvironmentError(`작업 브랜치 공간의 상위 폴더에 쓸 수 없습니다: ${parent}`, { retry: false, code: 'workspace_root' })
    }
    return base
  }
  workspaceDir(branch) { return path.join(this.workspaceRoot(), validateBranchName(branch, { role: 'task' }).replaceAll('/', '__')) }

  async verifyOrigin(cwd = this.root) {
    const expected = normalizeRemote(this.remoteUrl)
    if (!expected) repoSlug(this.remoteUrl)
    for (const args of [['remote', 'get-url', '--all', 'origin'], ['remote', 'get-url', '--push', '--all', 'origin']]) {
      const urls = (await this.git(args, { cwd })).output.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
      if (!urls.length || urls.some(url => normalizeRemote(url) !== expected))
        throw new EnvironmentError(`origin 원격 저장소가 설정(${this.remoteUrl})과 다릅니다. 다른 저장소로 가져오거나 게시하지 않습니다.`, { retry: false, code: 'remote' })
    }
  }
  async checkRefFormat(name, role) {
    validateBranchName(name, { role })
    await this.git(['check-ref-format', '--branch', name]).catch(() => { throw new EnvironmentError(`Git이 허용하지 않는 브랜치 이름입니다: ${name}`, { retry: false, code: 'invalid_branch' }) })
  }
  async fetchBranch(name, { role = 'base', signal } = {}) {
    await this.checkRefFormat(name, role)
    return this.serial(async () => {
      await this.verifyOrigin()
      try {
        await this.git(['fetch', '--no-tags', 'origin', `+refs/heads/${name}:refs/remotes/origin/${name}`], { signal, timeoutMs: 300000 })
      } catch (error) {
        if (/couldn't find remote ref|could not find remote ref/i.test(error.message))
          throw new EnvironmentError(`원격 저장소에 ${ROLE_LABEL[role] ?? '브랜치'} ${name}이(가) 없습니다.`, { retry: false, code: 'missing_branch' })
        throw error
      }
      return (await this.git(['rev-parse', '--verify', `refs/remotes/origin/${name}^{commit}`])).output.trim()
    })
  }
  async ensureWorktree({ dir, baseSha }, branch) {
    validateBranchName(branch, { role: 'task' })
    if (!/^[0-9a-f]{40,64}$/.test(baseSha ?? '')) throw new EnvironmentError('기준 커밋이 고정되지 않았습니다.', { retry: false, code: 'base_commit' })
    if (fs.existsSync(dir)) {
      const top = (await this.git(['rev-parse', '--show-toplevel'], { cwd: dir })).output.trim()
      const head = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd: dir })).output.trim()
      if (fs.realpathSync(top) !== fs.realpathSync(dir) || head !== branch)
        throw new EnvironmentError(`작업 브랜치 공간이 예상한 브랜치가 아닙니다: ${dir}`, { retry: false, code: 'workspace_mismatch' })
      await this.verifyOrigin(dir)
      if (!fs.existsSync(path.join(dir, 'node_modules'))) linkDependencies(fs.realpathSync(this.root), dir)
      return { dir, created: false }
    }
    return this.serial(async () => {
      fs.mkdirSync(path.dirname(dir), { recursive: true })
      await this.git(['worktree', 'prune'])
      const known = (await this.git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { acceptedCodes: [0, 1, 128] })).code === 0
      await this.git(known ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '--no-track', '-b', branch, dir, baseSha])
      linkDependencies(fs.realpathSync(this.root), dir)
      return { dir, created: true }
    })
  }
  async changedFiles(dir, baseSha) {
    const tracked = (await this.git(['diff', '--name-only', '--no-renames', '-z', baseSha, '--'], { cwd: dir })).output
    const untracked = (await this.git(['ls-files', '-o', '--exclude-standard', '-z'], { cwd: dir })).output
    return [...new Set(`${tracked}\0${untracked}`.split('\0').filter(Boolean).map(file => file.replaceAll('\\', '/')))].filter(file => !isManagerArtifact(file)).sort()
  }
  async dirtyPaths(dir) {
    const tracked = (await this.git(['diff', '--name-only', '--no-renames', '-z', 'HEAD'], { cwd: dir })).output
    const untracked = (await this.git(['ls-files', '-o', '--exclude-standard', '-z'], { cwd: dir })).output
    return [...new Set(`${tracked}\0${untracked}`.split('\0').filter(Boolean).map(file => file.replaceAll('\\', '/')))].filter(file => !isManagerArtifact(file)).sort()
  }
  async headState(dir) {
    const head = (await this.git(['rev-parse', 'HEAD'], { cwd: dir })).output.trim()
    return { head, dirty: await this.dirtyPaths(dir) }
  }
  async isAncestor(dir, ancestor, descendant = 'HEAD') {
    return (await this.git(['merge-base', '--is-ancestor', ancestor, descendant], { cwd: dir, acceptedCodes: [0, 1, 128] })).code === 0
  }
  async fileAtBase(dir, baseSha, file) {
    const listed = (await this.git(['ls-tree', '-z', '--name-only', baseSha, '--', file], { cwd: dir })).output
    if (!listed.split('\0').includes(file)) return null
    return rawOutput('git', ['show', `${baseSha}:${file}`], { cwd: dir, env: this.gitEnv() })
  }
  async diffSinceBase(dir, baseSha, files) {
    if (!files.length) return ''
    await this.git(['add', '--intent-to-add', '--', ...files.filter(file => fs.existsSync(path.join(dir, file)))], { cwd: dir })
    return (await this.git(['diff', '--no-ext-diff', '--no-renames', baseSha, '--', ...files], { cwd: dir })).output
  }
  async commitFileHash(dir, spec, file) {
    const listed = (await this.git(['ls-tree', '-z', '--name-only', spec, '--', file], { cwd: dir })).output
    if (!listed.split('\0').includes(file)) return null
    const body = await rawOutput('git', ['show', `${spec}:${file}`], { cwd: dir, env: this.gitEnv() })
    return createHash('sha256').update(body).digest('hex')
  }
  async treeMatches(dir, spec, files, expectedHashes) {
    for (const file of files) {
      const actual = await this.commitFileHash(dir, spec, file)
      if (actual !== (expectedHashes[file] ?? null)) return false
    }
    return true
  }
  // A clean descendant is reused only when its tree matches the reviewed hashes.
  // Dirty allowed files become another commit on the same branch. Outside files are left untouched.
  async commit(dir, { files, baseSha, title, body, expectedHashes }) {
    if (!/^[0-9a-f]{40,64}$/.test(baseSha ?? '')) throw new EnvironmentError('기준 커밋이 고정되지 않았습니다.', { retry: false, code: 'base_commit' })
    if (!expectedHashes || files.some(file => !Object.prototype.hasOwnProperty.call(expectedHashes, file)))
      throw new EnvironmentError('검토한 내용 해시가 없어 커밋을 만들거나 재사용하지 않습니다.', { retry: false, code: 'publish_mismatch' })
    const head = (await this.git(['rev-parse', 'HEAD'], { cwd: dir })).output.trim()
    if (head !== baseSha && !await this.isAncestor(dir, baseSha, 'HEAD'))
      throw new EnvironmentError('작업 브랜치가 기준 커밋에서 이어지지 않습니다. 다른 커밋을 덮어쓰거나 푸시하지 않습니다.', { retry: false, code: 'unexpected_commit' })
    const dirty = await this.dirtyPaths(dir)
    const outside = dirty.filter(file => !files.includes(file))
    if (outside.length) throw new EnvironmentError(`허용 파일 밖 변경이 있어 커밋하지 않았습니다: ${outside.slice(0, 10).join(', ')}. 편집은 보존했습니다.`, { retry: false, code: 'outside_commit' })
    if (!dirty.length) {
      if (head === baseSha) throw new EnvironmentError('커밋할 변경이 없습니다.', { retry: false, code: 'empty_commit' })
      if (!await this.treeMatches(dir, 'HEAD', files, expectedHashes))
        throw new EnvironmentError('작업 브랜치 HEAD가 검토한 파일 내용과 다릅니다. 옛 커밋을 게시하지 않습니다.', { retry: false, code: 'publish_mismatch' })
      return head
    }
    await this.git(['add', '--all', '--', ...files], { cwd: dir })
    const staged = (await this.git(['diff', '--cached', '--name-only', '--no-renames', '-z'], { cwd: dir })).output.split('\0').filter(Boolean)
    const stagedOutside = staged.filter(file => !files.includes(file))
    if (stagedOutside.length) throw new EnvironmentError(`허용 파일 밖 변경이 커밋 대상에 포함되었습니다: ${stagedOutside.slice(0, 10).join(', ')}`, { retry: false, code: 'outside_commit' })
    if (!staged.length) throw new EnvironmentError('커밋할 변경이 없습니다.', { retry: false, code: 'empty_commit' })
    await this.git(['commit', '-m', title, '-m', body], { cwd: dir })
    const sha = (await this.git(['rev-parse', 'HEAD'], { cwd: dir })).output.trim()
    if (!await this.isAncestor(dir, baseSha, sha) || !await this.treeMatches(dir, sha, files, expectedHashes))
      throw new EnvironmentError('새 커밋 트리가 검토한 내용과 다릅니다. 이 커밋을 푸시하지 않습니다.', { retry: false, code: 'publish_mismatch' })
    return sha
  }
  async detachedWorktree(dir, sha) {
    if (!/^[0-9a-f]{40,64}$/.test(sha ?? '')) throw new EnvironmentError('검수 커밋이 고정되지 않았습니다.', { retry: false, code: 'base_commit' })
    const matches = async () => {
      const top = (await this.git(['rev-parse', '--show-toplevel'], { cwd: dir })).output.trim()
      const head = (await this.git(['rev-parse', 'HEAD'], { cwd: dir })).output.trim()
      if (fs.realpathSync(top) !== fs.realpathSync(dir) || head !== sha)
        throw new EnvironmentError('통합 검수 공간이 고정한 커밋과 다릅니다.', { retry: false, code: 'workspace_mismatch' })
    }
    if (fs.existsSync(dir)) {
      await matches()
      if (!fs.existsSync(path.join(dir, 'node_modules'))) linkDependencies(fs.realpathSync(this.root), dir)
      return { dir, created: false }
    }
    return this.serial(async () => {
      fs.mkdirSync(path.dirname(dir), { recursive: true })
      await this.git(['worktree', 'prune'])
      await this.git(['worktree', 'add', '--detach', dir, sha])
      linkDependencies(fs.realpathSync(this.root), dir)
      await matches()
      return { dir, created: true }
    })
  }
  async push(dir, branch, sha, { signal } = {}) {
    validateBranchName(branch, { role: 'task' })
    return this.serial(async () => {
      if (signal?.aborted) throw new Error('작업 중지됨')
      await this.verifyOrigin(dir)
      if (signal?.aborted) throw new Error('작업 중지됨')
      await this.git(['push', '--porcelain', 'origin', `${sha}:refs/heads/${branch}`], { cwd: dir, timeoutMs: 300000, signal })
    }, signal)
  }
  // Created from the pinned configured base only when missing; tasks are never merged into it here.
  async ensureIntegrationBranch(name, baseSha, { signal } = {}) {
    await this.checkRefFormat(name, 'integration')
    return this.serial(async () => {
      if (signal?.aborted) throw new Error('작업 중지됨')
      await this.verifyOrigin()
      if (signal?.aborted) throw new Error('작업 중지됨')
      const { output } = await this.git(['ls-remote', '--heads', 'origin', `refs/heads/${name}`], { signal })
      if (output.trim()) return { created: false }
      if (signal?.aborted) throw new Error('작업 중지됨')
      await this.git(['push', '--porcelain', 'origin', `${baseSha}:refs/heads/${name}`], { timeoutMs: 300000, signal })
      return { created: true }
    }, signal)
  }
  async pullRequests(branch, { signal } = {}) {
    const fields = 'number,url,state,baseRefName,headRefName,headRefOid,isCrossRepository,headRepository,headRepositoryOwner'
    const { output } = await this.gh(['pr', 'list', `--repo=${this.slug}`, `--head=${branch}`, '--state=all', `--json=${fields}`, '--limit=20'], { signal })
    return JSON.parse(output || '[]').filter(pr => pr.headRefName === branch)
  }
  assertPullRequestIdentity(pr, { branch, base, headSha }) {
    if (pr.headRefName !== branch || pr.baseRefName !== base || !sameRepositoryPullRequest(pr, this.slug) || pr.headRefOid !== headSha) {
      const reason = pr.headRefOid !== headSha ? `head ${pr.headRefOid} ≠ 검토 SHA ${headSha}`
        : pr.baseRefName !== base ? `대상 ${pr.baseRefName} ≠ ${base}`
        : pr.headRefName !== branch ? `브랜치 ${pr.headRefName} ≠ ${branch}`
        : '다른 저장소'
      throw new EnvironmentError(`PR #${pr.number}을 검토한 게시로 기록하지 않습니다 (${reason}). 검토 SHA ${headSha}는 유지합니다.`, { retry: false, code: 'pr_identity' })
    }
  }
  async ensurePullRequest({ branch, base, headSha, title, bodyFile, signal }) {
    if (signal?.aborted) throw new Error('작업 중지됨')
    validateBranchName(branch, { role: 'task' }); validateBranchName(base, { role: 'integration' })
    const prs = await this.pullRequests(branch, { signal })
    const open = prs.find(pr => pr.state === 'OPEN')
    if (open) {
      const current = await this.pullRequest(open.number, { signal })
      this.assertPullRequestIdentity(current, { branch, base, headSha })
      if (signal?.aborted) throw new Error('작업 중지됨')
      await this.gh(['pr', 'edit', String(open.number), `--repo=${this.slug}`, `--body-file=${bodyFile}`], { signal })
      const posted = await this.pullRequest(open.number, { signal })
      this.assertPullRequestIdentity(posted, { branch, base, headSha })
      return { number: posted.number, url: posted.url, reused: true, headSha }
    }
    const merged = prs.find(pr => pr.state === 'MERGED' && pr.headRefOid === headSha)
    if (merged) {
      const current = await this.pullRequest(merged.number, { signal })
      this.assertPullRequestIdentity(current, { branch, base, headSha })
      return { number: current.number, url: current.url, reused: true, headSha }
    }
    if (signal?.aborted) throw new Error('작업 중지됨')
    const { output } = await this.gh(['pr', 'create', `--repo=${this.slug}`, `--base=${base}`, `--head=${branch}`, `--title=${title}`, `--body-file=${bodyFile}`], { signal })
    const match = output.match(/https:\/\/github\.com\/\S+?\/pull\/(\d+)/)
    if (!match) throw new EnvironmentError('PR은 요청했지만 주소를 확인하지 못했습니다. 다음 재시도에서 기존 PR을 찾아 이어서 기록합니다.')
    const created = await this.pullRequest(Number(match[1]))
    this.assertPullRequestIdentity(created, { branch, base, headSha })
    return { number: created.number, url: created.url, reused: false, headSha }
  }
  async pullRequest(number, { signal } = {}) {
    const { output } = await this.gh(['pr', 'view', String(number), `--repo=${this.slug}`, '--json=number,url,state,baseRefName,headRefName,headRefOid,mergedAt,mergeCommit,isCrossRepository,headRepository,headRepositoryOwner'], { signal })
    return JSON.parse(output)
  }
  async contains(ref, sha) {
    if (!/^[0-9a-f]{40,64}$/.test(sha ?? '')) return false
    return (await this.git(['merge-base', '--is-ancestor', sha, ref], { acceptedCodes: [0, 1, 128] })).code === 0
  }
  async removeWorktree(dir) {
    return this.serial(() => this.git(['worktree', 'remove', dir]))
  }
  async remoteTip(branch) {
    const { output } = await this.git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])
    const line = output.trim().split(/\r?\n/).find(Boolean)
    return line ? line.split(/\s+/)[0] : null
  }
  // Fetches the named head and accepts it only when the tip is the approved SHA.
  async fetchPinnedHead({ branch, sha, remote = null }) {
    validateBranchName(branch, { role: 'head' })
    if (!/^[0-9a-f]{40,64}$/.test(sha ?? '')) throw new EnvironmentError('승인한 커밋 SHA가 올바르지 않습니다.', { retry: false, code: 'pin' })
    if (remote && !normalizeRemote(remote)) throw new EnvironmentError('다른 저장소 주소가 https://github.com/<owner>/<repo>.git 형식이 아닙니다.', { retry: false, code: 'remote' })
    const dest = `refs/atelier-pins/${sha}`
    return this.serial(async () => {
      if (!remote) await this.verifyOrigin()
      await this.git(['fetch', '--no-tags', remote ? `${normalizeRemote(remote)}.git` : 'origin', `+refs/heads/${branch}:${dest}`], { timeoutMs: 300000 })
      const got = (await this.git(['rev-parse', '--verify', `${dest}^{commit}`])).output.trim()
      if (got !== sha) throw new EnvironmentError(`가져온 ${branch} (${got})이 승인한 커밋 ${sha}와 다릅니다. 다른 커밋은 통합하지 않습니다.`, { retry: false, code: 'pin_mismatch' })
      return got
    })
  }
  // Fast-forward the integration ref only when it still points at `expected`. Never updates main.
  async compareAndSwapRef({ dir, branch, expected, next }) {
    validateBranchName(branch, { role: 'integration' })
    if (!/^[0-9a-f]{40,64}$/.test(expected ?? '') || !/^[0-9a-f]{40,64}$/.test(next ?? ''))
      throw new EnvironmentError('통합 ref 비교 대상이 고정되지 않았습니다.', { retry: false, code: 'integrate_cas' })
    if (expected === next) return next
    return this.serial(async () => {
      await this.verifyOrigin(dir)
      if (!await this.isAncestor(dir, expected, next))
        throw new EnvironmentError('통합 결과가 기존 통합 커밋의 후손이 아니라 갱신하지 않습니다.', { retry: false, code: 'integrate_ancestry' })
      await this.git(['push', '--porcelain', `--force-with-lease=refs/heads/${branch}:${expected}`, 'origin', `${next}:refs/heads/${branch}`], { cwd: dir, timeoutMs: 300000 })
      const seen = await this.remoteTip(branch)
      if (seen !== next) throw new EnvironmentError(`통합 브랜치 갱신 확인에 실패했습니다. 기대 ${next}, 원격 ${seen ?? '없음'}. 다시 밀어 맞추지 않습니다.`, { retry: false, code: 'integrate_cas' })
      return next
    })
  }
  // Local merge of pinned SHAs into a detached integration worktree, then CAS of that ref only.
  async mergeIntoIntegration({ branch, heads }) {
    validateBranchName(branch, { role: 'integration' })
    if (!heads?.length) throw new EnvironmentError('통합할 커밋이 없습니다.', { retry: false, code: 'integrate' })
    await this.verifyOrigin()
    const expected = await this.fetchBranch(branch, { role: 'integration' })
    for (const head of heads) await this.fetchPinnedHead(head)
    const dir = path.join(this.workspaceRoot(), 'integration-merges', `${expected.slice(0, 12)}-${Date.now().toString(36)}`)
    let merged = false
    try {
      await this.detachedWorktree(dir, expected)
      for (const head of heads) {
        if (await this.isAncestor(dir, head.sha, 'HEAD')) continue
        await this.git(['merge', '--no-ff', '--no-edit', '-m', `integrate ${head.sha}`, head.sha], { cwd: dir })
        if (!await this.isAncestor(dir, expected, 'HEAD') || !await this.isAncestor(dir, head.sha, 'HEAD'))
          throw new EnvironmentError('통합 머지 결과가 고정한 통합 커밋과 승인한 SHA의 후손이 아닙니다.', { retry: false, code: 'integrate_ancestry' })
      }
      const next = (await this.git(['rev-parse', 'HEAD'], { cwd: dir })).output.trim()
      if (next !== expected) await this.compareAndSwapRef({ dir, branch, expected, next })
      else {
        const seen = await this.remoteTip(branch)
        if (seen !== next) throw new EnvironmentError(`통합 브랜치가 확인 중에 ${seen ?? '없음'}로 바뀌었습니다. 갱신하지 않습니다.`, { retry: false, code: 'integrate_cas' })
      }
      merged = true
      return { previous: expected, tip: next, method: 'local-merge-cas', heads: heads.map(head => head.sha) }
    } finally {
      if (!merged) await this.git(['merge', '--abort'], { cwd: dir, acceptedCodes: [0, 1, 128] }).catch(() => {})
      await this.removeWorktree(dir).catch(error => console.warn('[ai-workflow] 통합 작업 공간 정리 실패', { dir, message: error.message }))
    }
  }
}
