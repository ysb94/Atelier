import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { settings, toolDir, cursorServers, cursorCommand } from './settings.mjs'
import { childEnv, runCommand } from './process.mjs'

// CLI's mcp commands discover the Git root, unlike ACP's explicit session servers.
// Use an isolated ignored repository; never rewrite the IDE's MCP configuration.
export function publicMcpConfig(servers) {
  if(!servers.length)throw new Error('MCP 서버 설정을 찾지 못했습니다.')
  if(servers.some(server=>server.type!=='http'||server.headers?.length))throw new Error('이 연결 도우미는 비밀 헤더 없는 HTTP MCP만 지원합니다. 원본 인증 정보를 복사하지 않습니다.')
  for(const server of servers) {
    const url=new URL(server.url)
    if(url.protocol!=='https:'||url.username||url.password||[...url.searchParams.keys()].some(key=>/token|secret|key|auth|password/i.test(key)))throw new Error('인증값이 포함되거나 HTTPS가 아닌 MCP 주소는 점검 설정에 복사하지 않습니다.')
  }
  return {mcpServers:Object.fromEntries(servers.map(server=>[server.name,{url:server.url}]))}
}
export async function prepareProbe(config) {
  const definitions=publicMcpConfig(cursorServers(config))
  const probe=path.join(toolDir,'.runtime','mcp-probe')
  fs.mkdirSync(path.join(probe,'.cursor'),{recursive:true})
  if(!fs.existsSync(path.join(probe,'.git')))await runCommand('git',['init','--quiet'],{cwd:probe})
  fs.writeFileSync(path.join(probe,'.cursor','mcp.json'),JSON.stringify(definitions,null,2))
  return {probe,names:Object.keys(definitions.mcpServers)}
}
async function main() {
  const [action='status',name,...rest]=process.argv.slice(2)
  if(!['status','login'].includes(action)||rest.length||action==='status'&&name)throw new Error('사용법: npm run ai:mcp:status 또는 npm run ai:mcp:login -- notion|supabase|cloudflare')
  const config=settings(),{probe,names}=await prepareProbe(config),cli=cursorCommand(config)
  if(action==='login'&&!names.includes(name))throw new Error(`로그인할 MCP 이름을 선택하세요: ${names.join(', ')}`)
  const run=async args=>{
    await new Promise((resolve,reject)=>{
      const child=spawn(cli.command,[...cli.args,'mcp',...args],{cwd:probe,env:childEnv(),stdio:'inherit',windowsHide:true,shell:false})
      child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Cursor MCP 명령 실패 (${code})`)))
    })
  }
  // A login invocation names the exact service to approve. Status never grants approval.
  if(action==='login')await run(['enable',name])
  await run(action==='login'?['login',name]:['list'])
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{await main()}catch(error){console.error('[ai-workflow] MCP 연결 확인 실패',error.message);process.exitCode=1}
}
