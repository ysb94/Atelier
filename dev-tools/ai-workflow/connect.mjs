import { spawn } from 'node:child_process'
import { settings, projectRoot, cursorCommand } from './settings.mjs'
import { cliCommand } from './cli-command.mjs'
import { childEnv, runCommand } from './process.mjs'
import { codexCommand, subscriptionCommand, requireSubscriptionLogin } from './codex-subscription.mjs'
import { TaskGit } from './git-task.mjs'
import { doctor } from './doctor.mjs'

// Interactive local setup only. No model request, Notion write or manager start.
async function interactive(cli, env=childEnv()) {
  await new Promise((resolve,reject)=>{
    const child=spawn(cli.command,cli.args,{cwd:projectRoot,env,stdio:'inherit',windowsHide:false,shell:false})
    child.once('error',reject)
    child.once('exit',code=>code===0?resolve():reject(new Error('로그인을 마치지 못했습니다. 같은 명령으로 다시 연결하세요.')))
  })
}

async function connect() {
  const config=settings(),git=new TaskGit({config})
  console.log('[연결] 이 PC의 계정으로 연결합니다. 자동화는 시작하지 않습니다.')
  console.log('[연결] 작업 폴더:',git.workspaceRoot())
  const codex=codexCommand(config,['--version'])
  try {await runCommand(codex.command,codex.args,{cwd:projectRoot,timeoutMs:15000})}
  catch {throw new Error('Codex CLI를 실행할 수 없습니다. npm install -g @openai/codex 후 터미널을 새로 열고 다시 실행하세요. 별도 경로는 ATELIER_CODEX_BIN으로 지정합니다.')}
  try {await requireSubscriptionLogin(config,{root:projectRoot})}
  catch {
    console.log('[연결] ChatGPT 구독 계정으로 Codex에 로그인하세요. API 키는 입력하지 마세요.')
    await interactive(subscriptionCommand(config,['login']))
    await requireSubscriptionLogin(config,{root:projectRoot})
  }
  console.log('[연결] Codex ChatGPT 구독 로그인 확인 완료')
  try {await git.gh(['--version'],{timeoutMs:15000})}
  catch {throw new Error('GitHub CLI를 실행할 수 없습니다. Windows에서는 winget install --id GitHub.cli --exact 후 터미널을 새로 열고 다시 실행하세요. 별도 경로는 ATELIER_GH_BIN으로 지정합니다.')}
  try {await git.gh(['auth','status','--hostname=github.com'],{timeoutMs:15000})}
  catch {
    console.log('[연결] 브라우저에서 GitHub 로그인을 완료하세요.')
    const auth=Object.fromEntries(['GH_TOKEN','GITHUB_TOKEN','GH_HOST'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))
    const env=childEnv(auth)
    await interactive(cliCommand(config.env.ATELIER_GH_BIN??'gh',['auth','login','--hostname','github.com','--git-protocol','https','--web'],{env,cwd:projectRoot}),env)
    await git.gh(['auth','status','--hostname=github.com'],{timeoutMs:15000})
  }
  console.log('[연결] GitHub 로그인 확인 완료')
  let report=await doctor(config)
  if(!report.cursorAuthenticated){
    console.log('[연결] Cursor CLI 로그인을 완료하세요.')
    const cursor=cursorCommand(config)
    await interactive(cliCommand(cursor.command,[...cursor.args,'login'],{cwd:projectRoot}))
    report=await doctor(config)
  }
  if(!report.ready){
    for(const message of report.problems)console.error('[연결] 남은 항목:',message)
    process.exitCode=1
    return
  }
  console.log('[연결] 실행기 준비 완료. 실행 중인 개발 서버·자동화 관리자를 다시 시작하면 연결을 다시 확인합니다. 노션의 자동화 실행 설정은 바꾸지 않았습니다.')
}
connect().catch(error=>{console.error('[연결]',error.message);process.exitCode=1})
