import fs from 'node:fs'
import path from 'node:path'
import { digest, changedPaths } from './workspace.mjs'
import { runCommand } from './process.mjs'

const privateSegments = /^(?:\.git|\.cursor|\.state|\.runtime|\.codex|\.aws|node_modules|\.env.*)$/i
const privateJson = /(?:auth|credentials?|service[-_.]?account).*\.json$/i
const privateFiles = /(?:^|[._-])(?:secrets?|tokens?|private[-_]?key)(?:[._-]|$)|\.(?:pem|key|p12|pfx)$/i
const backups = /(?:^|\/)(?:backups?|(?:db|database|postgres|supabase)[-_]?backups?|[^/]*[-_]snapshots)(?:\/|$)|(?:backup|snapshot)[^/]*\.(?:sql|dump|xlsx?|csv|json|zip|gz|tar)$/i
const caches = ['.tmp', '.vite', '.vite-temp', '.cache', '.parcel-cache', '.rollup.cache', '.tscache', '.turbo']

export function excludedFromWorkspace(file) {
  const normalized = file.replaceAll('\\', '/')
  return normalized.split('/').some(segment => privateSegments.test(segment)) || privateJson.test(path.posix.basename(normalized)) || privateFiles.test(path.posix.basename(normalized)) || backups.test(normalized)
}

function within(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function filePath(root, file) {
  const target = path.resolve(root, file)
  if (path.isAbsolute(file) || !within(root, target) || target === root) throw new Error(`격리 작업 폴더 밖의 경로: ${file}`)
  return target
}

// The inventory uses the working tree, preserving edited/untracked files and
// tracked deletions. Project links are never copied back as writable links.
async function inventory(root) {
  const { output } = await runCommand('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: root })
  const files = [...new Set(output.split('\0').filter(Boolean))].sort()
  const all = {}, identities = {}, entries = []
  for (const file of files) {
    const absolute = filePath(root, file)
    let stat
    try { stat = fs.lstatSync(absolute) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    // Excluded directories may be links to authentication stores; never follow
    // them. Regular excluded files still contribute only their digest to seed.
    if (stat.isSymbolicLink() && excludedFromWorkspace(file)) continue
    const real = fs.realpathSync(absolute)
    if (!within(root, real)) throw new Error(`원본 밖을 가리키는 링크는 격리할 수 없습니다: ${file}`)
    const resolvedStat = fs.statSync(real)
    if (resolvedStat.isDirectory()) {
      if (stat.isSymbolicLink()) throw new Error(`코드 디렉터리 링크는 격리할 수 없습니다: ${file}`)
      continue
    }
    if (!resolvedStat.isFile()) throw new Error(`일반 파일이 아닌 작업 경로: ${file}`)
    const content = fs.readFileSync(real)
    all[file] = digest(content)
    identities[file] = `${resolvedStat.mode & 0o777}:${stat.isSymbolicLink() ? fs.readlinkSync(absolute) : 'file'}`
    if (!excludedFromWorkspace(file)) entries.push({ file, content, mode: resolvedStat.mode & 0o777 })
  }
  return { all, identities, entries }
}

function dependencies(root, workspace) {
  const source = path.join(root, 'node_modules')
  if (!fs.existsSync(source)) return
  const dependencyRoot = fs.realpathSync(source)
  if (!fs.statSync(dependencyRoot).isDirectory()) throw new Error('node_modules가 디렉터리가 아닙니다.')
  if (within(root, dependencyRoot) && dependencyRoot !== path.join(root, 'node_modules')) throw new Error('node_modules가 원본 코드 폴더를 가리킵니다.')
  const destination = path.join(workspace, 'node_modules')
  fs.mkdirSync(destination)
  for (const cache of caches) fs.mkdirSync(path.join(destination, cache))
  const packages = []
  const linkPackage = (relative) => {
    const original = path.join(dependencyRoot, relative), target = fs.realpathSync(original)
    if (!within(dependencyRoot, target)) throw new Error(`node_modules 외부 연결은 재사용할 수 없습니다: ${relative}`)
    if (!fs.statSync(target).isDirectory()) return
    const worker = path.join(destination, relative)
    fs.mkdirSync(path.dirname(worker), { recursive: true })
    fs.symlinkSync(target, worker, process.platform === 'win32' ? 'junction' : 'dir')
    packages.push({ target, worker })
  }
  for (const name of fs.readdirSync(dependencyRoot)) {
    if (name.startsWith('.')) continue
    if (name.startsWith('@')) {
      const scope = path.join(dependencyRoot, name)
      if (fs.lstatSync(scope).isSymbolicLink()) throw new Error(`node_modules의 범위 디렉터리 링크는 지원하지 않습니다: ${name}`)
      if (fs.statSync(scope).isDirectory()) for (const pkg of fs.readdirSync(scope)) if (!pkg.startsWith('.')) linkPackage(path.join(name, pkg))
    } else linkPackage(name)
  }
  const sourceBin = path.join(dependencyRoot, '.bin')
  if (!fs.existsSync(sourceBin)) return
  const bin = path.join(destination, '.bin')
  fs.mkdirSync(bin)
  for (const name of fs.readdirSync(sourceBin)) {
    const original = path.join(sourceBin, name), stat = fs.lstatSync(original), worker = path.join(bin, name)
    const target = fs.realpathSync(original)
    if (!within(dependencyRoot, target)) throw new Error(`node_modules 실행 파일의 외부 링크: ${name}`)
    if (!fs.statSync(target).isFile()) throw new Error(`node_modules 실행 파일이 일반 파일이 아닙니다: ${name}`)
    if (stat.isSymbolicLink()) {
      const owner = packages.filter(pkg => within(pkg.target, target)).sort((a, b) => b.target.length - a.target.length)[0]
      if (!owner) throw new Error(`패키지를 찾을 수 없는 node_modules 실행 파일: ${name}`)
      const mapped = path.join(owner.worker, path.relative(owner.target, target))
      fs.symlinkSync(path.relative(bin, mapped), worker)
    } else {
      fs.copyFileSync(original, worker)
      fs.chmodSync(worker, stat.mode & 0o777)
    }
  }
}

export async function createIsolatedWorkspace({ root, dir }) {
  const source = fs.realpathSync(root), parent = path.resolve(dir)
  fs.mkdirSync(parent, { recursive: true })
  const realParent = fs.realpathSync(parent)
  if (within(source, realParent)) throw new Error('격리 작업 공간은 원본 프로젝트 밖에 만들어야 합니다.')
  const workspace = path.join(realParent, 'workspace')
  if (fs.existsSync(workspace)) throw new Error('격리 작업 공간이 이미 존재합니다.')
  const before = await inventory(source)
  fs.mkdirSync(workspace)
  try {
    for (const { file, content, mode } of before.entries) {
      const destination = filePath(workspace, file)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, content, { flag: 'wx', mode })
      fs.chmodSync(destination, mode)
      if (digest(fs.readFileSync(destination)) !== before.all[file]) throw new Error(`격리 파일 복사 검증 실패: ${file}`)
    }
    dependencies(source, workspace)
    await runCommand('git', ['init', '--quiet'], { cwd: workspace })
    // Depend on our own exclusion file even when a fixture has no .gitignore.
    fs.appendFileSync(path.join(workspace, '.git/info/exclude'), '\nnode_modules/\n')
    const after = await inventory(source)
    if (changedPaths(before.all, after.all).length || changedPaths(before.identities, after.identities).length) throw new Error('격리 복사 중 원본 파일이 변경되었습니다. 다음 실행에서 다시 준비합니다.')
    return { root: workspace, seed: { all: before.all } }
  } catch (error) {
    // Only remove the exact directory created above, never a preexisting path.
    fs.rmSync(workspace, { recursive: true, force: true })
    throw error
  }
}
