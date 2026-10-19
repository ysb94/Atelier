import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIsolatedWorkspace } from './isolation.mjs'
import { snapshot } from './workspace.mjs'
import { runCommand } from './process.mjs'

async function fixture(t, { dependencies = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-isolation-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'source')
  fs.mkdirSync(root)
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  write('.gitignore', 'node_modules/\nignored.txt\n')
  write('source.js', 'export const value = "committed"\n')
  write('deleted.js', 'export default true\n')
  await runCommand('git', ['init', '--quiet'], { cwd: root })
  await runCommand('git', ['add', '.'], { cwd: root })
  await runCommand('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Fixture'], { cwd: root })
  write('source.js', 'export const value = "user edit"\n')
  write('new.js', 'export const untracked = true\n')
  write('ignored.txt', 'ignored data')
  fs.unlinkSync(path.join(root, 'deleted.js'))
  if (dependencies) {
    const installed = path.join(dir, 'dependencies')
    fs.mkdirSync(path.join(installed, 'build-tool/bin'), { recursive: true })
    fs.mkdirSync(path.join(installed, '@scope/package'), { recursive: true })
    fs.writeFileSync(path.join(installed, '@scope/package/index.js'), 'module.exports = true\n')
    fs.writeFileSync(path.join(installed, 'build-tool/bin/build.js'), '#!/usr/bin/env node\nconst fs=require("node:fs"); fs.writeFileSync("node_modules/.tmp/build.json",JSON.stringify({cwd:process.cwd()})); fs.mkdirSync("dist",{recursive:true}); fs.writeFileSync("dist/result",fs.readFileSync("source.js"));\n')
    fs.chmodSync(path.join(installed, 'build-tool/bin/build.js'), 0o755)
    fs.mkdirSync(path.join(installed, '.bin'))
    fs.symlinkSync('../build-tool/bin/build.js', path.join(installed, '.bin/build-tool'))
    fs.mkdirSync(path.join(installed, '.tmp'))
    fs.writeFileSync(path.join(installed, '.tmp/original'), 'original cache')
    fs.symlinkSync(installed, path.join(root, 'node_modules'), 'dir')
    write('package.json', JSON.stringify({ scripts: { build: 'node node_modules/build-tool/bin/build.js' } }))
  }
  return { dir, root, write }
}

test('copies current tracked/untracked changes and tracked deletion, with a clean independent Git repository', async t => {
  const f = await fixture(t)
  const expected = await snapshot(f.root)
  const result = await createIsolatedWorkspace({ root: f.root, dir: path.join(f.dir, 'worker') })
  assert.deepEqual(result.seed.all, expected)
  assert.deepEqual(await snapshot(result.root), expected)
  assert.match(fs.readFileSync(path.join(result.root, 'source.js'), 'utf8'), /user edit/)
  assert.ok(fs.existsSync(path.join(result.root, 'new.js')))
  assert.ok(!fs.existsSync(path.join(result.root, 'deleted.js')))
  assert.ok(!fs.existsSync(path.join(result.root, 'ignored.txt')))
  const history = await runCommand('git', ['rev-parse', '--verify', 'HEAD'], { cwd: result.root, acceptedCodes: [128] })
  assert.equal(history.code, 128)
  fs.writeFileSync(path.join(result.root, 'source.js'), 'worker edit')
  assert.match(fs.readFileSync(path.join(f.root, 'source.js'), 'utf8'), /user edit/)
})

test('two simultaneous workspaces share packages but have independent builds and writable caches', async t => {
  const f = await fixture(t, { dependencies: true })
  const workers = await Promise.all([1, 2].map(number => createIsolatedWorkspace({ root: f.root, dir: path.join(f.dir, `worker-${number}`) })))
  for (let index = 0; index < workers.length; index++) fs.writeFileSync(path.join(workers[index].root, 'source.js'), `worker ${index}`)
  await Promise.all(workers.map(worker => runCommand('npm', ['run', 'build'], { cwd: worker.root })))
  for (let index = 0; index < workers.length; index++) {
    const { root } = workers[index]
    assert.equal(fs.lstatSync(path.join(root, 'node_modules')).isSymbolicLink(), false)
    assert.equal(fs.lstatSync(path.join(root, 'node_modules/@scope')).isSymbolicLink(), false)
    assert.equal(fs.lstatSync(path.join(root, 'node_modules/@scope/package')).isSymbolicLink(), true)
    assert.equal(fs.lstatSync(path.join(root, 'node_modules/build-tool')).isSymbolicLink(), true)
    assert.equal(fs.readFileSync(path.join(root, 'dist/result'), 'utf8'), `worker ${index}`)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/.tmp/build.json'), 'utf8')), { cwd: root })
    for (const cache of ['.tmp', '.vite', '.vite-temp', '.cache']) assert.equal(fs.lstatSync(path.join(root, `node_modules/${cache}`)).isSymbolicLink(), false)
    assert.ok(!(await snapshot(root))['node_modules/.tmp/build.json'])
  }
  assert.match(fs.readFileSync(path.join(f.root, 'source.js'), 'utf8'), /user edit/)
  assert.equal(fs.readFileSync(path.join(f.root, 'node_modules/.tmp/original'), 'utf8'), 'original cache')
  assert.ok(!fs.existsSync(path.join(f.root, 'node_modules/.tmp/build.json')))
})

test('does not copy credentials, environment, local runtime or database backups', async t => {
  const f = await fixture(t)
  const privatePaths = ['.env', '.env.local', '.env.example', '.cursor/mcp.json', '.codex/auth.json', '.aws/credentials', 'dev-tools/.state/state.json', 'dev-tools/.runtime/auth.json', 'credentials.json', 'service-account.json', 'auth.json', 'account-credentials.json', 'private-key.pem', 'docs/backups/database.xlsx', 'outputs/warehouse-snapshots/database.csv', 'database-backup.sql']
  for (const file of privatePaths) f.write(file, 'private-data')
  // Include ignored .env.local to verify tracked private files are excluded too.
  await runCommand('git', ['add', '-f', ...privatePaths], { cwd: f.root })
  f.write('src/public-config.json', '{"public":true}')
  const worker = await createIsolatedWorkspace({ root: f.root, dir: path.join(f.dir, 'worker') })
  for (const file of privatePaths) assert.ok(!fs.existsSync(path.join(worker.root, file)), file)
  assert.ok(fs.existsSync(path.join(worker.root, 'src/public-config.json')))
  assert.ok(worker.seed.all['.env.local'])
  const entries = await runCommand('git', ['ls-files', '-o', '--exclude-standard'], { cwd: worker.root })
  assert.ok(!entries.output.includes('private'))
})

test('materializes safe file links and rejects escaping or directory code links', async t => {
  const f = await fixture(t)
  fs.symlinkSync('source.js', path.join(f.root, 'linked.js'))
  const safe = await createIsolatedWorkspace({ root: f.root, dir: path.join(f.dir, 'safe') })
  assert.equal(fs.lstatSync(path.join(safe.root, 'linked.js')).isSymbolicLink(), false)
  fs.writeFileSync(path.join(safe.root, 'linked.js'), 'worker')
  assert.match(fs.readFileSync(path.join(f.root, 'source.js'), 'utf8'), /user edit/)
  fs.writeFileSync(path.join(f.dir, 'outside.js'), 'outside')
  fs.symlinkSync('../outside.js', path.join(f.root, 'escaping.js'))
  await assert.rejects(createIsolatedWorkspace({ root: f.root, dir: path.join(f.dir, 'bad-file') }), /원본 밖/)
  fs.unlinkSync(path.join(f.root, 'escaping.js'))
  fs.mkdirSync(path.join(f.root, 'src'))
  f.write('src/file.js', 'source')
  fs.symlinkSync('src', path.join(f.root, 'linked-folder'), 'dir')
  await assert.rejects(createIsolatedWorkspace({ root: f.root, dir: path.join(f.dir, 'bad-folder') }), /디렉터리 링크/)
})

test('detects source changes during copy and only cleans its own newly created workspace', async t => {
  const f = await fixture(t)
  const write = fs.writeFileSync
  let changed = false
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = write(file, ...args)
    if (!changed && String(file).includes(`${path.sep}workspace${path.sep}`)) {
      changed = true
      write(path.join(f.root, 'source.js'), 'concurrent user edit')
    }
    return result
  })
  const parent = path.join(f.dir, 'worker')
  await assert.rejects(createIsolatedWorkspace({ root: f.root, dir: parent }), /원본 파일이 변경/)
  assert.ok(!fs.existsSync(path.join(parent, 'workspace')))
  assert.equal(fs.readFileSync(path.join(f.root, 'source.js'), 'utf8'), 'concurrent user edit')
  fs.mkdirSync(path.join(parent, 'workspace'))
  write(path.join(parent, 'workspace/existing'), 'keep')
  await assert.rejects(createIsolatedWorkspace({ root: f.root, dir: parent }), /이미 존재/)
  assert.equal(fs.readFileSync(path.join(parent, 'workspace/existing'), 'utf8'), 'keep')
})

test('rejects a work directory that resolves inside the original repository and external dependency links', async t => {
  const f = await fixture(t, { dependencies: true })
  fs.symlinkSync(f.root, path.join(f.dir, 'parent-link'), 'dir')
  await assert.rejects(createIsolatedWorkspace({ root: f.root, dir: path.join(f.dir, 'parent-link') }), /원본 프로젝트 밖/)
  fs.mkdirSync(path.join(f.dir, 'outside-package'))
  fs.symlinkSync(path.join(f.dir, 'outside-package'), path.join(f.root, 'node_modules/external-package'), 'dir')
  await assert.rejects(createIsolatedWorkspace({ root: f.root, dir: path.join(f.dir, 'worker') }), /외부 연결/)
  assert.ok(!fs.existsSync(path.join(f.dir, 'worker/workspace')))
})
