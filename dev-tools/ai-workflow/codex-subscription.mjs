import { runCommand } from './process.mjs'
import { NeedsInput } from './acp.mjs'
import { EnvironmentError } from './errors.mjs'
import { effortsForModel } from './control.mjs'

// These process-local overrides prevent a cached API key or a provider profile
// from silently replacing the user's ChatGPT subscription during a review.
export function subscriptionCommand(config, args) {
  return {command:config.env.ATELIER_CODEX_BIN??'codex',args:[
    '-c','forced_login_method="chatgpt"','-c','model_provider="openai"',...args
  ]}
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
    const result=await run(config.env.ATELIER_CODEX_BIN??'codex',['login','status'],{cwd:root,signal,timeoutMs:10000})
    status=`${result.output}\n${result.stderr}`
  }catch(error){
    if(signal?.aborted)throw error
    throw new NeedsInput('Codex의 ChatGPT 구독 로그인을 확인할 수 없습니다. 추가 API 과금을 막기 위해 검토를 시작하지 않았습니다. 실행기에서 ChatGPT 계정 로그인을 확인해야 합니다.')
  }
  if(/not logged in|unauthenticated|api[ _-]?key/i.test(status)||!/logged in (?:using|with) ChatGPT\b/i.test(status)) {
    throw new NeedsInput('Codex 검토는 ChatGPT 구독 로그인만 허용합니다. API 키나 확인되지 않은 인증으로는 검토하지 않습니다. 실행기에서 구독 계정으로 로그인해야 합니다.')
  }
  return {authMethod:'chatgpt',billing:'subscription'}
}
