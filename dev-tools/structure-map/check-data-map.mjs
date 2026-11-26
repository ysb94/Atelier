import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { changedConnections, contractsPath, parseContracts, readContracts, uncoveredChanges } from './data-map.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const paths = ['src', 'supabase/migrations', 'supabase/functions', 'scripts/google-apps-script']
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
const list = output => output.split('\0').filter(Boolean)

function check(base) {
  // Resolve a ref to a hash before using it in other Git arguments.
  const revision = git('rev-parse', '--verify', '--end-of-options', base + '^{commit}').trim()
  const tracked = new Set(list(git('ls-tree', '-r', '--name-only', '-z', revision, '--', ...paths, contractsPath)))
  const files = new Set([
    ...list(git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', revision, '--', ...paths)),
    ...list(git('ls-files', '--others', '--exclude-standard', '-z', '--', ...paths)),
  ])
  const previous = tracked.has(contractsPath) ? parseContracts(git('show', revision + ':' + contractsPath)) : []
  const current = readContracts(root)
  const changes = []
  for (const file of files) {
    if (!/\.(?:[cm]?[jt]sx?|sql|gs)$/.test(file)) continue
    const absolute = path.join(root, file)
    const exists = fs.existsSync(absolute)
    const before = tracked.has(file) ? git('show', revision + ':' + file) : ''
    const after = exists ? fs.readFileSync(absolute, 'utf8') : ''
    const resources = changedConnections(file, before, after)
    if (resources !== null) changes.push({ file, resources, removed: !exists })
  }
  const missing = uncoveredChanges(changes, previous, current)
  if (missing.length) {
    console.error('[data-map] 데이터 연결 변경의 근거를 ' + contractsPath + ' 안의 관련 항목에 함께 기록하세요.')
    for (const { file } of missing) console.error('- ' + file)
    process.exitCode = 1
    return
  }
  console.info('[data-map] 기록 ' + current.length + '개, 변경된 데이터 경로 ' + changes.length + '개 검증')
}

try {
  const [flag, base] = process.argv.slice(2)
  if (flag && (flag !== '--base' || !base || process.argv.length !== 4)) {
    throw new Error('사용법 · npm run verify:data-map -- --base <커밋 또는 브랜치>')
  }
  check(base ?? 'HEAD')
} catch (error) {
  console.error('[data-map] ' + error.message)
  process.exitCode = 1
}
