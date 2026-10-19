import { runCommand } from './process.mjs'
import { NeedsInput } from './acp.mjs'
import { EnvironmentError } from './errors.mjs'
import { effortsForModel } from './control.mjs'
import { cliCommand } from './cli-command.mjs'

export function codexCommand(config, args) {
  return cliCommand(config.env.ATELIER_CODEX_BIN ?? 'codex', args)
}

// These process-local overrides prevent a cached API key or a provider profile
// from silently replacing the user's ChatGPT subscription during a review.
export function subscriptionCommand(config, args) {
  return codexCommand(config, [
    '-c','forced_login_method="chatgpt"','-c','model_provider="openai"',...args
  ])
}

// Source-bundle calls get no shell, app or agent tools; the manager supplies the evidence.
export const toolFreeArgs=['shell_tool','unified_exec','apps','plugins','multi_agent','browser_use','computer_use'].flatMap(name=>['-c',`features.${name}=false`])

// Placed after `exec`; no fallback model is ever substituted.
// Efforts come only from the shared catalog (max included; minimal only when that model lists it).
export function gptModelArgs(gpt) {
  if(!gpt)return []
  const allowed = effortsForModel(gpt.model)
  if(typeof gpt.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(gpt.model)||!allowed.includes(gpt.effort))
    throw new EnvironmentError(`GPT 모델 설정이 올바르지 않습니다: ${String(gpt.model)} / ${String(gpt.effort)}`,{retry:false,code:'model_config'})
  return ['--model',gpt.model,'-c',`model_reasoning_effort="${gpt.effort}"`]
}

export async function requireSubscriptionLogin(config, {root,signal,run=runCommand} = {}) {
  let status
  try {
    const cli=codexCommand(config,['login','status'])
    const result=await run(cli.command,cli.args,{cwd:root,signal,timeoutMs:10000})
    status=`${result.output}\n${result.stderr}`
  }catch(error){
    if(signal?.aborted)throw error
    if (['ENOENT','EACCES','EPERM','ENOEXEC'].includes(error.code))
      throw new EnvironmentError(`Codex CLI를 실행할 수 없습니다 (${error.code}). npm run ai:connect로 설치 경로·로그인을 확인하세요. 추가 API 과금을 막기 위해 GPT를 호출하지 않았습니다.`, {retry:false,code:'codex_executable'})
    throw new NeedsInput('Codex의 ChatGPT 구독 로그인을 확인할 수 없습니다. 추가 API 과금을 막기 위해 GPT를 호출하지 않았습니다. 같은 PC·실행기 계정에서 npm run ai:connect로 ChatGPT 로그인을 확인하세요.')
  }
  if(/not logged in|unauthenticated|api[ _-]?key/i.test(status)||!/logged in (?:using|with) ChatGPT\b/i.test(status)) {
    throw new NeedsInput('Codex 검토는 ChatGPT 구독 로그인만 허용합니다. API 키나 확인되지 않은 인증으로는 검토하지 않습니다. 실행기에서 구독 계정으로 로그인해야 합니다.')
  }
  return {authMethod:'chatgpt',billing:'subscription'}
}
