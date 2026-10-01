import path from 'node:path';
import { lstat, realpath, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export const ROLES = ['IMPLEMENT', 'RESEARCH', 'VERIFY', 'REVIEW'];
const blocked = new Set(['.git', 'node_modules', '.codex', '.agents', '.aws', 'coordinator-state']);

export function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes(':') || value.includes('\0') || path.isAbsolute(value)) {
    throw new Error('A workspace-relative path is required');
  }
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || blocked.has(p.toLowerCase()) ||
    /^\.env(?:\.|$)/iu.test(p) || /^(auth\.json|service-account.*\.json|.*\.(pem|key))$/iu.test(p))) {
    throw new Error('Path is outside the permitted file scope');
  }
  return parts.join('/');
}

export async function scopedPath(root, value, { create = false } = {}) {
  const relative = relativePath(value);
  const rootReal = await realpath(root);
  const target = path.resolve(rootReal, relative);
  let current = rootReal;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not permitted');
    } catch (error) {
      if (error.code !== 'ENOENT' || !create || i !== parts.length - 1) throw error;
    }
  }
  const resolved = await realpath(create ? path.dirname(target) : target);
  const within = path.relative(rootReal, resolved);
  if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('Path escapes workspace');
  return target;
}

export function createFileTools(root, role, allowedFiles = [], audit = () => {}) {
  if (!ROLES.includes(role)) throw new Error('Unknown role');
  const allowed = new Set(allowedFiles.map(relativePath));
  const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
  const string = { type: 'string' };
  const tool = (description, inputSchema, execute, readOnly = true) => ({
    description, inputSchema,
    annotations: { readOnlyHint: readOnly, openWorldHint: false },
    execute: async (args) => {
      try {
        const result = await execute(args);
        audit({ role, tool: description, path: args.path, success: true });
        return result;
      } catch (error) {
        audit({ role, tool: description, path: args.path, success: false, reason: error.message });
        return { content: [{ type: 'text', text: error.message }], isError: true };
      }
    },
  });
  const tools = {
    search_source: tool('Search literal text in tracked-style source/config files using ripgrep. No regular expressions or shell execution.',
      schema({ text: string }, ['text']), async ({ text }) => {
        if (typeof text !== 'string' || !text || text.length > 1000) throw new Error('Invalid search text');
        const args = ['--no-config', '--no-follow', '--fixed-strings', '--line-number', '--max-count', '20', '--max-filesize', '2M',
          '-g', '*.ts', '-g', '*.tsx', '-g', '*.js', '-g', '*.mjs', '-g', '*.css', '-g', '*.json', '-g', '*.md', '-g', '*.mdc',
          '-g', '!**/auth.json', '-g', '!**/service-account*.json',
          '-g', '!**/.git/**', '-g', '!**/node_modules/**', '-g', '!**/.codex/**', '-g', '!**/.agents/**',
          '-g', '!**/.aws/**', '-g', '!**/coordinator-state/**', '--', text, '.'];
        try {
          const { stdout } = await runFile('rg', args, { cwd: root, windowsHide: true, maxBuffer: 1_000_000, timeout: 15000 });
          return { text: stdout.slice(0, 24000), truncated: stdout.length > 24000 };
        } catch (error) {
          if (error.code === 1) return { text: '', truncated: false };
          throw new Error('Source search failed; use list_files/read_file instead');
        }
      }),
    read_file: tool('Read a UTF-8 workspace file with line numbers. Credentials and runtime state are excluded.',
      schema({ path: string, start: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 400 } }, ['path']),
      async ({ path: file, start = 1, limit = 200 }) => {
        if (!Number.isInteger(start) || start < 1 || !Number.isInteger(limit) || limit < 1 || limit > 400) throw new Error('Invalid line range');
        const target = await scopedPath(root, file);
        if ((await lstat(target)).size > 2_000_000) throw new Error('File exceeds 2MB read limit');
        const content = await readFile(target, 'utf8');
        if (content.includes('\0')) throw new Error('Binary file');
        const lines = content.split(/\r?\n/u);
        return { path: file, totalLines: lines.length, text: lines.slice(start - 1, start - 1 + limit).map((line, i) => `${i + start}: ${line}`).join('\n') };
      }),
    list_files: tool('List one workspace directory. Pass an empty path for the workspace root.',
      schema({ path: string }, ['path']), async ({ path: directory }) => {
        const target = directory === '' ? await realpath(root) : await scopedPath(root, directory);
        const entries = await readdir(target, { withFileTypes: true });
        return entries.filter(e => {
          try { relativePath(directory ? `${directory}/${e.name}` : e.name); return !e.isSymbolicLink(); }
          catch { return false; } // Excluded paths are intentionally hidden from the model.
        }).slice(0, 500).map(e => ({ name: e.name, directory: e.isDirectory() }));
      }),
  };
  if (role === 'IMPLEMENT') {
    tools.write_file = tool('Write UTF-8 content only to an explicitly allowed file. Existing parent directory is required.',
      schema({ path: string, content: string }, ['path', 'content']), async ({ path: file, content }) => {
        if (!allowed.has(relativePath(file))) throw new Error('This file was not authorized for editing');
        if (typeof content !== 'string' || Buffer.byteLength(content) > 2_000_000) throw new Error('Invalid content');
        await writeFile(await scopedPath(root, file, { create: true }), content, 'utf8');
        return { written: file };
      }, false);
    tools.replace_text = tool('Replace a unique exact text occurrence in an explicitly allowed file, preserving all other text.',
      schema({ path: string, before: string, after: string }, ['path', 'before', 'after']), async ({ path: file, before, after }) => {
        if (!allowed.has(relativePath(file))) throw new Error('This file was not authorized for editing');
        if (typeof before !== 'string' || !before || typeof after !== 'string') throw new Error('Invalid replacement');
        const target = await scopedPath(root, file);
        const text = await readFile(target, 'utf8');
        if (text.split(before).length !== 2) throw new Error('Expected one exact match; reread the file');
        await writeFile(target, text.replace(before, () => after), 'utf8');
        return { updated: file };
      }, false);
  }
  return tools;
}
