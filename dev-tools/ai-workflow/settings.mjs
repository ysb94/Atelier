import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const toolDir = path.dirname(fileURLToPath(import.meta.url))
export const projectRoot = path.resolve(toolDir, '../..')
export const stateDir = path.join(toolDir, '.state')

export function settings() {
  const base = JSON.parse(fs.readFileSync(path.join(toolDir, 'config.json'), 'utf8'))
  const local = path.join(toolDir, 'config.local.json')
  const config = fs.existsSync(local) ? { ...base, ...JSON.parse(fs.readFileSync(local, 'utf8')) } : base
  const envPath = path.join(toolDir, '.env.local')
  const env = fs.existsSync(envPath) ? readEnv(envPath) : {}
  for (const key of ['NOTION_TOKEN', 'ATELIER_CURSOR_BIN', 'ATELIER_CODEX_BIN', 'ATELIER_GH_BIN']) if (process.env[key]) env[key] = process.env[key]
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('자동화 포트는 1~65535 정수여야 합니다.')
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 3) throw new Error('maxAttempts는 1~3이어야 합니다.')
  if(config.maxParallelTasks!==undefined&&(!Number.isInteger(config.maxParallelTasks)||config.maxParallelTasks<1||config.maxParallelTasks>2))throw new Error('maxParallelTasks는 1~2여야 합니다.')
  if (!Number.isFinite(config.pollMs) || config.pollMs < 10000) throw new Error('pollMs는 10000 이상이어야 합니다.')
  if(config.excludedMcpServers!==undefined&&(!Array.isArray(config.excludedMcpServers)||config.excludedMcpServers.some(name=>typeof name!=='string')))throw new Error('excludedMcpServers는 제외할 MCP 이름 배열이어야 합니다.')
  if(config.mode==='memo-board'&&(!config.positions||['queued','working','needsInput','done'].some(k=>typeof config.positions[k]!=='string'||!config.positions[k].trim())))throw new Error('메모 보드의 대기·작업·확인·완료 위치 설정이 필요합니다.')
  if(config.v2?.enabled===true)validateV2(config)
  return { ...config, env }
}

function validateV2(config) {
  const v2=config.v2,text=value=>typeof value==='string'&&value.trim().length>0
  if(v2.sourceReader?.enabled)for(const [key,max] of [['chunkChars',10000],['totalChars',160000],['maxCalls',40]])if(!Number.isInteger(v2.sourceReader[key])||v2.sourceReader[key]<1||v2.sourceReader[key]>max)throw new Error(`읽기 수집기 ${key}는 1~${max}이어야 합니다.`)
  if(v2.cursorPull?.enabled&&(!text(config.positions.preparing)||!Number.isInteger(v2.cursorPull.pollMs)||v2.cursorPull.pollMs<5000))throw new Error('Cursor 목록 조회에는 GPT 준비 위치와 5초 이상의 pollMs가 필요합니다.')
  if (v2.pipeline?.enabled) {
    if(v2.pipeline.gptWorkers!==undefined&&(!Number.isInteger(v2.pipeline.gptWorkers)||v2.pipeline.gptWorkers<1||v2.pipeline.gptWorkers>2))throw new Error('GPT 공용 실행 자리는 1~2개여야 합니다.')
    for (const [key, max] of [['planning', v2.pipeline.gptWorkers??1], ['implementation', 2], ['review', v2.pipeline.gptWorkers??1], ['readyLimit', 4], ['reviewBacklog', 3]]) {
      const value = v2.pipeline[key]
      if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`v2.pipeline.${key}는 1~${max} 정수여야 합니다.`)
    }
  }
  if(config.mode!=='memo-board')throw new Error('v2 자동화는 memo-board 모드에서만 사용합니다.')
  if(['memo','answered','queued','working','needsInput','done'].some(k=>!text(config.positions[k])))throw new Error('v2에는 메모·답변 완료·자동화 할 일·작업 중·확인 필요·완료 위치가 모두 필요합니다.')
  if(config.positions.reviewing!==undefined&&config.positions.reviewing!==null&&!text(config.positions.reviewing))throw new Error('positions.reviewing은 위치 이름 또는 null이어야 합니다.')
  if(config.positions.manual)throw new Error('v2는 직접 할 일로 분류하지 않습니다. positions.manual을 제거하세요.')
  if(v2.controlPageId!==null&&v2.controlPageId!==undefined&&!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(v2.controlPageId))throw new Error('v2.controlPageId는 노션 페이지 ID여야 합니다.')
  if(!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(v2.remoteUrl??'')))throw new Error('v2.remoteUrl은 https://github.com/<owner>/<repo>.git 형식이어야 합니다.')
  if(!text(v2.mainBranch))throw new Error('v2.mainBranch가 필요합니다.')
  for(const key of ['branch','pr','reflection','model','baseCommit'])if(!text(config.properties?.[key]))throw new Error(`v2 노션 속성 이름이 필요합니다: properties.${key}`)
  for(const key of ['retryMinutes','maxRetryMinutes','reconcileMinutes'])if(v2[key]!==undefined&&(!Number.isFinite(v2[key])||v2[key]<=0))throw new Error(`v2.${key}는 양수여야 합니다.`)
  if(v2.maxSourceRounds!==undefined&&(!Number.isInteger(v2.maxSourceRounds)||v2.maxSourceRounds<0||v2.maxSourceRounds>5))throw new Error('v2.maxSourceRounds는 0~5 정수여야 합니다.')
  if(v2.workspaceRoot!=null){
    if(typeof v2.workspaceRoot!=='string'||!path.isAbsolute(v2.workspaceRoot))throw new Error('v2.workspaceRoot는 프로젝트 밖의 절대 경로여야 합니다.')
    const relative=path.relative(projectRoot,path.resolve(v2.workspaceRoot))
    if(!relative||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error('v2.workspaceRoot는 프로젝트 폴더 밖에 있어야 합니다.')
  }
}

function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    return m ? [[m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
  }))
}

export function inside(root, relative) {
  const resolved = path.resolve(root, relative)
  const rel = path.relative(root, resolved)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('작업 폴더 밖의 경로는 허용하지 않습니다.')
  return resolved
}

export function taskFiles(value) {
  const files = value.split(/[\n,]/).map(s => s.trim().replaceAll('\\', '/')).filter(Boolean)
  if (!files.length || files.length > 30) throw new Error('AI 허용 파일에 정확한 파일 경로 1~30개를 입력하세요.')
  for (const file of files) {
    inside(projectRoot, file)
    if (/^(?:[A-Za-z]:|\/)|(?:^|\/)(?:\.git|\.cursor|node_modules|\.env[^/]*|\.runtime|\.state)(?:\/|$)|(?:auth|credentials|service-account)\.json$/i.test(file)) throw new Error('인증·환경·Git 내부 파일은 자동화 대상으로 사용할 수 없습니다.')
    if (/^(?:supabase\/|docs\/backups\/)/i.test(file)) throw new Error('DB·백업 작업은 별도 승인과 백업 확인이 필요합니다.')
  }
  return [...new Set(files)]
}

export function cursorCommand(config) {
  const bundled = path.join(toolDir, '.runtime/cursor/package/dist-package')
  if (config.env.ATELIER_CURSOR_BIN) return { command: config.env.ATELIER_CURSOR_BIN, args: [] }
  if (fs.existsSync(path.join(bundled, 'node.exe'))) return { command: path.join(bundled, 'node.exe'), args: [path.join(bundled, 'index.js')] }
  return { command: process.platform === 'win32' ? 'agent.exe' : 'agent', args: [] }
}

// Only forward public plugin directory paths, never cached OAuth credentials.
export function cursorPlugins(config = {}) {
  const base = path.join(os.homedir(), '.cursor/plugins/cache/cursor-public')
  if (!fs.existsSync(base)) return []
  return ['notion-workspace', 'supabase', 'cloudflare'].flatMap(name => {
    if(config.excludedMcpServers?.includes(name)||config.excludedMcpServers?.includes(name==='notion-workspace'?'notion':name))return []
    const dir = path.join(base, name)
    if (!fs.existsSync(dir)) return []
    const versions = fs.readdirSync(dir).map(v => path.join(dir, v)).filter(p => fs.statSync(p).isDirectory())
    versions.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    return versions.slice(0, 1)
  })
}

// The CLI does not automatically import IDE plugin MCPs. Supply their original
// public server definitions through ACP without changing the IDE's configuration.
export function cursorServers(config = settings()) {
  const servers = new Map()
  const resolveValue = value => String(value).replace(/\$\{(?:env:)?([A-Z][A-Z0-9_]*)\}/g, (_,name) => {
    const resolved = config.env[name] ?? process.env[name]
    if (resolved === undefined) throw new Error(`MCP 환경 변수 미설정: ${name}`)
    return resolved
  })
  const files = [...cursorPlugins(config).flatMap(dir => ['mcp.json', '.mcp.json'].map(name => path.join(dir, name))),
    path.join(os.homedir(), '.cursor/mcp.json'),
    path.join(projectRoot, '.cursor/mcp.json')]
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [name, server] of Object.entries(parsed.mcpServers ?? parsed)) {
      if (server.disabled||config.excludedMcpServers?.includes(name)) { servers.delete(name); continue }
      const headers = Object.entries(server.headers ?? {}).map(([name,value]) => ({name,value:resolveValue(value)}))
      if (server.url) servers.set(name,{type:server.type==='sse'?'sse':'http',name,url:resolveValue(server.url),headers})
      else if (server.command) servers.set(name,{name,command:resolveValue(server.command),args:(server.args??[]).map(resolveValue),env:Object.entries(server.env??{}).map(([name,value])=>({name,value:resolveValue(value)}))})
    }
  }
  return [...servers.values()]
}

export function redact(text, env = {}) {
  let safe = String(text)
  for (const [key, value] of Object.entries({ ...process.env, ...env })) if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(key) && value && value.length > 5) safe = safe.split(value).join('[비밀값 숨김]')
  return safe.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [숨김]').replace(/(?:ntn_|secret_|sk-)[A-Za-z0-9_-]{15,}/g, '[비밀값 숨김]')
}
