import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, readdir, appendFile, open, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Agent, Cursor, JsonlLocalAgentStore } from '@cursor/sdk';
import { ROLES, createFileTools } from './policy.mjs';

export const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stateDir = path.join(workspace, '.cursor/coordinator-state');
const store = new JsonlLocalAgentStore(path.join(stateDir, 'sessions'));
const defaultModel = { id: 'composer-2.5', params: [{ id: 'fast', value: 'false' }] };
const output = (value) => console.log(JSON.stringify(value));
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const saveJson = async (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');

async function roleState() {
  try { return await readJson(path.join(stateDir, 'roles.json')); }
  catch (error) { if (error.code === 'ENOENT') return { workspace, roles: {} }; throw error; }
}

async function rules() {
  const files = ['AGENTS.md'];
  for (const entry of await readdir(path.join(workspace, '.cursor/rules'))) {
    if (entry.endsWith('.mdc')) files.push(`.cursor/rules/${entry}`);
  }
  // Rules are supplied explicitly; ambient settings, hooks, plugins and MCP are disabled.
  const loaded = [];
  for (const file of files) loaded.push(`FILE ${file}\n${await readFile(path.join(workspace, file), 'utf8')}`);
  return loaded.join('\n\n');
}

const checks = {
  connection: { command: process.execPath, args: [path.join(workspace, 'tools/cursor-coordinator/verify-fixture.mjs')] },
  monitor: { command: process.execPath, args: [path.join(workspace, 'tools/cursor-coordinator/verify-monitor.mjs')] },
  lint: { npmScript: 'lint' },
  diagnostics: { npmScript: 'verify:diagnostics' },
  build: { npmScript: 'build' },
};

async function runCheck(id) {
  const check = checks[id];
  if (!check) throw new Error('Unknown check');
  const command = check.npmScript ? (process.platform === 'win32' ? process.env.ComSpec : 'npm') : check.command;
  const args = check.npmScript ? (process.platform === 'win32' ? ['/d', '/s', '/c', `npm.cmd run ${check.npmScript}`] : ['run', check.npmScript]) : check.args;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace, windowsHide: true, shell: false });
    let text = '';
    let timedOut = false;
    child.stdout.on('data', data => { text = (text + data.toString()).slice(-24000); });
    child.stderr.on('data', data => { text = (text + data.toString()).slice(-24000); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 5 * 60 * 1000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ id, exitCode: code, timedOut, output: text }); });
  });
}

async function executeRole(role, task) {
  if (!ROLES.includes(role)) throw new Error('Unknown role');
  if (typeof task.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(task.id) || typeof task.prompt !== 'string' || !task.prompt.trim()) throw new Error('Task requires an id and prompt');
  if (!Array.isArray(task.allowedFiles ?? []) || !Array.isArray(task.checks ?? [])) throw new Error('Invalid task scope');
  for (const id of task.checks ?? []) if (!checks[id]) throw new Error('Unknown check');
  await mkdir(stateDir, { recursive: true });
  // One process at a time prevents shared JSONL store races and overlapping writes.
  const lockPath = path.join(stateDir, 'active.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Coordinator is busy; do not run concurrent jobs'); throw error; }
  await lock.writeFile(JSON.stringify({ pid: process.pid, role, taskId: task.id }));
  let agent;
  let activeRun;
  const cancel = () => { activeRun?.cancel().catch(error => console.warn('[cursor-coordinator] Cancel failed', { type: error.name })); };
  process.once('SIGINT', cancel);
  try {
    const state = await roleState();
    if (state.workspace !== workspace) throw new Error('Role state belongs to another workspace');
    const model = task.model ?? state.roles[role]?.model ?? defaultModel;
    const catalog = await Cursor.models.list();
    const definition = catalog.find(m => m.id === model.id);
    if (!definition) throw new Error('Selected model is unavailable; no automatic substitution');
    for (const parameter of model.params ?? []) {
      if (!definition.parameters?.some(p => p.id === parameter.id && p.values.some(v => v.value === parameter.value))) throw new Error('Unsupported model parameter');
    }
    const toolLog = [];
    const customTools = createFileTools(workspace, role, task.allowedFiles ?? [], event => {
      toolLog.push(event);
      output({ event: 'tool', taskId: task.id, ...event });
    });
    if (role === 'VERIFY' && task.checks?.length) {
      customTools.run_check = {
        description: `Run one of the explicitly authorized checks: ${task.checks.join(', ')}. No other commands are available.`,
        inputSchema: { type: 'object', properties: { id: { type: 'string', enum: task.checks } }, required: ['id'], additionalProperties: false },
        execute: async ({ id }) => {
          if (!task.checks.includes(id)) throw new Error('Check not authorized');
          const result = await runCheck(id);
          toolLog.push({ role, tool: 'run_check', ...result });
          output({ event: 'check', taskId: task.id, ...result });
          return result;
        },
      };
    }
    const options = {
      name: `Atelier ${role}`, model,
      tools: ['mcp'], disallowedTools: ['shell', 'task', 'edit', 'delete', 'applyAgentDiff'],
      mcpServers: {}, agents: {}, mode: 'agent',
      local: { cwd: workspace, store, settingSources: [], customTools, enableAgentRetries: false },
    };
    agent = state.roles[role]?.agentId ? await Agent.resume(state.roles[role].agentId, options) : await Agent.create(options);
    state.roles[role] = { agentId: agent.agentId, model };
    await saveJson(path.join(stateDir, 'roles.json'), state);
    const context = `작업 ${task.id}, 역할 ${role}. 실제 작업 폴더: ${workspace}.\n수정 허용 파일: ${JSON.stringify(task.allowedFiles ?? [])}. 지정 검사: ${JSON.stringify(task.checks ?? [])}.\n현재 작업만 수행한다. 과거 완료된 요청을 재실행하지 않는다. 다른 역할로 넘어가지 않는다. 파일 수정은 IMPLEMENT의 허용 파일에만 가능하다. 다른 역할은 수정 도구가 없다. 검사하지 않은 것을 통과했다고 말하지 않는다. 응답은 한국어로 작업 ID, 역할, 근거, 결과, 미검증을 포함한다.\n\n프로젝트 지침:\n${await rules()}\n\n현재 작업:\n${task.prompt}`;
    activeRun = await agent.send(context);
    output({ event: 'started', role, taskId: task.id, agentId: agent.agentId, runId: activeRun.id, model });
    const timeout = setTimeout(cancel, 8 * 60 * 1000);
    let result;
    try { result = await activeRun.wait(); }
    finally { clearTimeout(timeout); }
    const report = { taskId: task.id, role, agentId: agent.agentId, result, tools: toolLog };
    await mkdir(path.join(stateDir, 'reports'), { recursive: true });
    await saveJson(path.join(stateDir, 'reports', `${task.id}-${role}-${Date.now()}.json`), report);
    await appendFile(path.join(stateDir, 'history.ndjson'), JSON.stringify({ taskId: task.id, role, agentId: agent.agentId, runId: result.id, status: result.status }) + '\n');
    output({ event: 'completed', ...report });
    if (result.status !== 'finished') process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    agent?.close();
    await lock.close();
    await unlink(lockPath);
  }
}

async function main() {
  const [command, role, taskFile] = process.argv.slice(2);
  if (command === 'status') {
    const auth = await Cursor.auth.status();
    output({ authStatus: auth.status, workspace, ...await roleState() });
  } else if (command === 'models') {
    output((await Cursor.models.list()).map(({ id, displayName, parameters }) => ({ id, displayName, parameters })));
  } else if (command === 'send' && role && taskFile) {
    await executeRole(role, await readJson(path.resolve(taskFile)));
  } else throw new Error('Usage: node coordinator.mjs status | models | send ROLE task.json');
}

main().catch(error => {
  console.error('[cursor-coordinator] Failed', { type: error.name, message: error.message });
  process.exitCode = 1;
});
