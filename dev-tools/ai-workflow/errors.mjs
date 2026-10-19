// Environment failures are operator problems, never questions for the memo author.
export class EnvironmentError extends Error {
  constructor(message, { retry = true, code = 'environment', action } = {}) {
    super(message)
    Object.assign(this, { retry, code, action })
  }
}

export class ModelUnavailable extends EnvironmentError {
  constructor(message, { provider, model } = {}) {
    super(message, { retry: false, code: 'model_unavailable',
      action: '설정 페이지에서 사용 가능한 모델로 바꾸면 새 작업 접수가 다시 시작됩니다. 다른 모델로 자동 전환하지 않습니다. 이 카드는 자동화 단계를 대기로 바꾸면 이어서 진행합니다.' })
    Object.assign(this, { provider, model })
  }
}

export function modelProblem(text) {
  return /(?:model|모델)[^\n]{0,80}(?:not found|does not exist|not supported|unsupported|unknown|invalid|not available|unavailable|no access|not allowed|사용할 수 없|지원하지 않)|unknown model|model_not_found|invalid model/i.test(String(text ?? ''))
}

const operator = (code, action) => reason => ({ retry: false, code, reason, action })
const rules = [
  [/ChatGPT 구독|구독 로그인|API 과금/, operator('codex_login', '실행기 PC에서 Codex를 ChatGPT 구독 계정으로 로그인한 뒤 카드의 자동화 단계를 대기로 바꿔 주세요. API 키나 유료 크레딧으로 전환하지 않습니다.')],
  [/cursor_login|Cursor CLI 로그인|authenticate:|not authenticated|unauthenticated/i, operator('cursor_login', '실행기 PC에서 npm run ai:login으로 Cursor CLI에 로그인한 뒤 카드의 자동화 단계를 대기로 바꿔 주세요.')],
  [/gh auth|not logged into any GitHub|GitHub CLI 로그인|authentication failed|HTTP 40[13]|Permission to \S+ denied|could not read Username/i, operator('github_auth', '실행기 PC에서 gh auth login과 Git 자격 증명을 확인한 뒤 카드의 자동화 단계를 대기로 바꿔 주세요. 강제 푸시나 main 반영은 하지 않습니다.')],
  [/Please tell me who you are|user\.email|user\.name/i, operator('git_identity', '실행기 PC의 Git 사용자 이름·이메일 설정을 확인한 뒤 카드의 자동화 단계를 대기로 바꿔 주세요.')],
]

export function classifyFailure(error) {
  const reason = String(error?.message ?? error ?? '알 수 없는 오류')
  if (error instanceof EnvironmentError) return { retry: error.retry, code: error.code, reason,
    action: error.action ?? (error.retry ? '자동으로 다시 시도합니다. 같은 오류가 반복되면 실행기 연결 상태를 확인해 주세요.' : '실행기 상태를 확인한 뒤 카드의 자동화 단계를 대기로 바꿔 주세요.') }
  for (const [pattern, describe] of rules) if (pattern.test(reason)) return describe(reason)
  return { retry: true, code: 'transient', reason, action: '자동으로 다시 시도합니다. 같은 오류가 반복되면 실행기 연결 상태를 확인해 주세요.' }
}
