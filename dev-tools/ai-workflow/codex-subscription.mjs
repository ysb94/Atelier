import { runCommand } from './process.mjs'
import { NeedsInput } from './acp.mjs'

// These process-local overrides prevent a cached API key or a provider profile
// from silently replacing the user's ChatGPT subscription during a review.
export function subscriptionCommand(config, args) {
  return {command:config.env.ATELIER_CODEX_BIN??'codex',args:[
    '-c','forced_login_method="chatgpt"','-c','model_provider="openai"',...args
  ]}
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
