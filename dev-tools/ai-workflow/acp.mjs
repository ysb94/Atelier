import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { cursorCommand, inside, redact } from './settings.mjs'
import { childEnv } from './process.mjs'
import { digest, readFile } from './workspace.mjs'
import { prepareProbe } from './mcp.mjs'

export class NeedsInput extends Error {}

export function readonlyMcpTool(title) {
  const [provider,tool,...rest]=title.split(':').map(value=>value.trim())
  if(rest.length||!tool)return false
  const notion=new Set(['notion-fetch','notion-search','notion-get-comments'])
  const supabase=new Set(['list_tables','list_extensions','list_migrations'])
  return notion.has(tool)&&(provider==='notion'||provider===`notion-${tool}`)||supabase.has(tool)&&(provider==='supabase'||provider===`supabase-${tool}`)
}

export function permissionDecision(params, files, root) {
  const call = params.toolCall ?? {}, title = String(call.title ?? ''), kind = call.kind
  if (/execute_sql|apply_migration|deploy|delete|insert|update.*database|create.*project/i.test(title)) return false
  // Never infer SQL read-only safety from a tool name/title. Writes and unknown tools require input.
  if (kind === 'read' || kind === 'search') return true
  if (kind === 'edit') {
    const locations = [...call.locations??[],...(call.content??[]).filter(item=>item.type==='diff').map(item=>({path:item.path}))]
    return locations.length > 0 && locations.every(item => {
      try { return files.includes(path.relative(root, inside(root, item.path)).replaceAll('\\', '/')) } catch { return false }
    })
  }
  if(kind==='other')return readonlyMcpTool(title)
  // The manager runs configured checks itself; arbitrary agent terminal commands stay unapproved.
  if (kind === 'execute') return false
  return false
}

export async function runCursor({ config, root, files, prompt, signal, onEvent = () => {} }) {
  const executable = cursorCommand(config)
  const {probe}=await prepareProbe(config)
  const env = childEnv(Object.fromEntries(['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN'].filter(k => config.env[k] || process.env[k]).map(k => [k, config.env[k] || process.env[k]])))
  const child = spawn(executable.command, [...executable.args, '--workspace',probe,'--add-dir',root,'--sandbox', 'enabled','acp'], { cwd: probe, env, windowsHide: true, stdio: ['pipe','pipe','pipe'] })
  const pending = new Map(), expected = new Map(files.map(file => [file, readFile(root, file)]))
  let nextId = 1, text = '', inputNeeded = '', sessionId, closed = false
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++; pending.set(id, { resolve, reject, method })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  const respond = (id, result) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
  const failAll = error => { for (const p of pending.values()) p.reject(error); pending.clear() }
  const stop = () => { if (!closed) { closed = true; child.stdin.end(); child.kill('SIGTERM'); failAll(new Error('Cursor 실행 종료')) } }
  const timer = setTimeout(() => { inputNeeded = 'Cursor 실행 시간 제한 초과'; stop() }, config.agentTimeoutMs)
  signal?.addEventListener('abort', stop, { once: true })
  child.once('error', failAll)
  child.once('exit', code => failAll(new Error(`Cursor 프로세스 종료 (${code})`)))
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') failAll(error) })
  child.stderr.on('data', data => onEvent({ type: 'cursor-log', message: redact(String(data), config.env).slice(-2000) }))
  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', line => {
    let msg
    try { msg = JSON.parse(line) } catch { onEvent({ type: 'cursor-log', message: redact(line, config.env) }); return }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
      const p = pending.get(msg.id); if (!p) return
      pending.delete(msg.id)
      if(msg.error)p.reject(new Error(`${p.method}: ${msg.error.message ?? 'ACP 오류'} ${redact(JSON.stringify(msg.error.data ?? ''), config.env)}`))
      else p.resolve(msg.result)
      return
    }
    if (msg.method === 'session/update') {
      const update = msg.params?.update
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.text) text += update.content.text
      if (update?.sessionUpdate === 'tool_call') onEvent({ type: 'cursor-tool', title: update.title, kind: update.kind })
      return
    }
    if (msg.id === undefined) return
    try {
      if (closed || signal?.aborted) throw new NeedsInput('작업이 중지되었습니다.')
      if (msg.method === 'fs/read_text_file') {
        const file = path.relative(root, inside(root, msg.params.path)).replaceAll('\\','/')
        if (/(?:^|\/)(?:\.env[^/]*|\.git|\.state|\.runtime)(?:\/|$)/i.test(file)) throw new NeedsInput('비밀값·실행 기록 읽기는 허용하지 않습니다.')
        let content = readFile(root, file)
        if (content === null) throw new Error('파일 없음')
        if (msg.params.line) content = content.split('\n').slice(msg.params.line - 1, msg.params.limit ? msg.params.line - 1 + msg.params.limit : undefined).join('\n')
        respond(msg.id, { content }); return
      }
      if (msg.method === 'fs/write_text_file') {
        const file = path.relative(root, inside(root, msg.params.path)).replaceAll('\\','/')
        if (!files.includes(file)) throw new NeedsInput(`허용 범위 밖 수정 요청: ${file}`)
        if (readFile(root, file) !== expected.get(file)) throw new NeedsInput(`작업 중 다른 변경 발견: ${file}`)
        const parent = path.dirname(inside(root, file)); fs.mkdirSync(parent, { recursive: true })
        // Check the resolved parent too, to reject writes through directory symlinks.
        if (fs.realpathSync(root) !== fs.realpathSync(parent)) inside(fs.realpathSync(root), path.relative(fs.realpathSync(root), fs.realpathSync(parent)))
        fs.writeFileSync(inside(root, file), msg.params.content, 'utf8'); expected.set(file, msg.params.content)
        onEvent({ type: 'cursor-write', file, hash: digest(msg.params.content) }); respond(msg.id, {}); return
      }
      if (msg.method === 'session/request_permission') {
        const allowed = permissionDecision(msg.params, files, root)
        const option = msg.params.options?.find(o => o.kind === (allowed ? 'allow_once' : 'reject_once'))
        if (!allowed) inputNeeded = `도구 확인 필요: ${msg.params.toolCall?.title ?? msg.params.toolCall?.kind ?? '알 수 없는 요청'}`
        respond(msg.id, option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } }); return
      }
      if (msg.method === 'cursor/ask_question' || msg.method === 'cursor/create_plan') {
        inputNeeded = `Cursor 확인 요청: ${msg.params.title ?? msg.params.name ?? '추가 정보 필요'}`
        respond(msg.id, { outcome: { outcome: 'cancelled' } }); return
      }
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: '지원하지 않는 요청' } }) + '\n')
    } catch (error) {
      if (error instanceof NeedsInput) inputNeeded = error.message
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: redact(error.message, config.env) } }) + '\n')
    }
  })
  try {
    if (signal?.aborted) throw new Error('작업 중지됨')
    await send('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }, clientInfo: { name: 'atelier-ai-workflow', version: '1.0.0' } })
    await send('authenticate', { methodId: 'cursor_login' })
    // Session-provided HTTP MCPs use a different, project-scoped OAuth cache key.
    // Keep the already-authenticated CLI lease instead of replacing its clients.
    const session = await send('session/new', { cwd: root, mcpServers: [] }); sessionId = session.sessionId
    onEvent({ type: 'cursor-session', sessionId })
    const result = await send('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] })
    if (inputNeeded) throw new NeedsInput(inputNeeded)
    if (result.stopReason !== 'end_turn') throw new NeedsInput(`Cursor가 완료하지 못했습니다: ${result.stopReason}`)
    return { sessionId, report: redact(text, config.env) }
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); rl.close(); stop() }
}
