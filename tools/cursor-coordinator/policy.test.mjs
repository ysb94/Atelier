import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { relativePath, scopedPath, createFileTools } from './policy.mjs';

async function cleanTestDirectory(directory) {
  const absolute = path.resolve(directory);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !/^atelier-cursor-(policy|outside)-/u.test(path.basename(absolute))) {
    throw new Error('Refusing to remove an unverified test directory');
  }
  await rm(absolute, { recursive: true, force: true });
}

test('Windows and relative escapes, secrets and runtime files are inaccessible', () => {
  for (const file of ['../outside', 'a/../../outside', 'C:\\Windows\\file', 'a:file', '\\\\server\\share', '.env', 'a/.env.local', '.git/config', '.cursor/coordinator-state/roles.json', 'key.pem']) {
    assert.throws(() => relativePath(file), undefined, file);
  }
});

test('Readers have no edit capability; implementer cannot change an unassigned file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atelier-cursor-policy-'));
  try {
    await writeFile(path.join(root, 'protected.txt'), 'KEEP');
    for (const role of ['RESEARCH', 'VERIFY', 'REVIEW']) {
      const tools = createFileTools(root, role, ['protected.txt']);
      assert.equal(tools.write_file, undefined);
      assert.equal(tools.replace_text, undefined);
    }
    const tools = createFileTools(root, 'IMPLEMENT', ['allowed.txt']);
    const result = await tools.write_file.execute({ path: 'protected.txt', content: 'BAD' });
    assert.equal(result.isError, true);
    assert.equal(await readFile(path.join(root, 'protected.txt'), 'utf8'), 'KEEP');
  } finally { await cleanTestDirectory(root); }
});

test('Exact replacement preserves unrelated fields and rejects ambiguous matches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atelier-cursor-policy-'));
  try {
    await writeFile(path.join(root, 'allowed.txt'), 'before\nKEEP\n');
    const tools = createFileTools(root, 'IMPLEMENT', ['allowed.txt']);
    assert.deepEqual(await tools.replace_text.execute({ path: 'allowed.txt', before: 'before', after: '$&after' }), { updated: 'allowed.txt' });
    assert.equal(await readFile(path.join(root, 'allowed.txt'), 'utf8'), '$&after\nKEEP\n');
    await writeFile(path.join(root, 'allowed.txt'), 'same same');
    assert.equal((await tools.replace_text.execute({ path: 'allowed.txt', before: 'same', after: 'BAD' })).isError, true);
    assert.equal(await readFile(path.join(root, 'allowed.txt'), 'utf8'), 'same same');
  } finally { await cleanTestDirectory(root); }
});

test('Junctions cannot expose files outside the workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atelier-cursor-policy-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'atelier-cursor-outside-'));
  try {
    await writeFile(path.join(outside, 'secret.txt'), 'SECRET');
    await symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(scopedPath(root, 'link/secret.txt'));
  } finally {
    await cleanTestDirectory(root);
    await cleanTestDirectory(outside);
  }
});

test('Source search returns source matches while excluding credentials and runtime state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atelier-cursor-policy-'));
  try {
    await writeFile(path.join(root, 'source.ts'), 'export const NEEDLE = true;');
    await writeFile(path.join(root, 'auth.json'), '{"NEEDLE": "SECRET"}');
    await mkdir(path.join(root, 'coordinator-state'));
    await writeFile(path.join(root, 'coordinator-state', 'roles.json'), '{"NEEDLE": "PRIVATE"}');
    const result = await createFileTools(root, 'RESEARCH').search_source.execute({ text: 'NEEDLE' });
    assert.match(result.text, /source\.ts/u);
    assert.doesNotMatch(result.text, /SECRET|PRIVATE/u);
  } finally { await cleanTestDirectory(root); }
});
