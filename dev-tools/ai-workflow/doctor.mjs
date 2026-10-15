import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { settings, cursorCommand, cursorPlugins, projectRoot } from './settings.mjs'
import { runCommand } from './process.mjs'
import { requireSubscriptionLogin } from './codex-subscription.mjs'
import { TaskGit } from './git-task.mjs'
import { setupSchema } from './control.mjs'

export async function doctor(config=settings()) {
  const problems=[],mcp=[]
  const configFiles=[path.join(os.homedir(),'.cursor/mcp.json'),path.join(projectRoot,'.cursor/mcp.json')]
  for(const file of configFiles)if(fs.existsSync(file)) {
    const parsed=JSON.parse(fs.readFileSync(file,'utf8'))
    for(const name of Object.keys(parsed.mcpServers??{}))if(!config.excludedMcpServers?.includes(name))mcp.push({name,source:file})
  }
  const plugins=cursorPlugins(config)
  for(const dir of plugins)for(const name of ['mcp.json','.mcp.json']) {
    const file=path.join(dir,name);if(!fs.existsSync(file))continue
    const parsed=JSON.parse(fs.readFileSync(file,'utf8'))
    for(const name of Object.keys(parsed.mcpServers??parsed))if(!config.excludedMcpServers?.includes(name))mcp.push({name,source:'Cursor plugin',pluginDir:dir})
    break
  }
  if(!config.env.NOTION_TOKEN)problems.push('NOTION_TOKEN 미설정: dev-tools/ai-workflow/.env.local에 관리자용 노션 연결 토큰을 입력하세요.')
  const cli=cursorCommand(config)
  let cursorAuthenticated=false
  try {
    const r=await runCommand(cli.command,[...cli.args,'status'],{cwd:projectRoot,timeoutMs:15000})
    cursorAuthenticated=!/not logged in|not authenticated|unauthenticated/i.test(r.output+r.stderr)&&/logged in|authenticated|email|account/i.test(r.output+r.stderr)
    if(!cursorAuthenticated)problems.push('Cursor CLI 로그인 필요: npm run ai:login')
  }catch(error){problems.push(`Cursor CLI 확인 실패: ${error.message}`)}
  let codexBilling
  try{codexBilling=await requireSubscriptionLogin(config,{root:projectRoot})}catch(error){problems.push(error.message)}
  if(!mcp.length)problems.push('Cursor MCP 설정/플러그인을 찾지 못했습니다.')
  if(config.v2?.enabled){
    if(!config.v2.controlPageId)problems.push('설정 페이지 미지정: config.json의 v2.controlPageId에 노션 설정 페이지 ID를 입력한 뒤 관리자를 다시 시작하세요.')
    const git=new TaskGit({config})
    try{await git.verifyOrigin()}catch(error){problems.push(error.message)}
    try{git.workspaceRoot()}catch(error){problems.push(error.message)}
    try{await git.gh(['auth','status','--hostname=github.com'],{timeoutMs:15000})}catch(error){
      problems.push(['ENOENT','EACCES','EPERM','ENOEXEC'].includes(error.code)
        ? `GitHub CLI를 실행할 수 없습니다 (${error.code}). gh 설치 및 ATELIER_GH_BIN 경로를 확인하세요.`
        : 'GitHub CLI 인증 확인 실패: npm run ai:connect (같은 PC·실행기 계정으로 로그인)')
    }
  }
  return {ready:problems.length===0,problems,mcp,cursorAuthenticated,codexBilling,plugins,...(config.v2?.enabled?{v2Setup:setupSchema(config)}:{})}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await doctor(),null,2))
