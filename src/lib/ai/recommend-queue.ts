/**
 * 추천 호출 동시 실행 수. 한 건이 LLM 왕복까지 5초를 넘기므로 순차로 돌리면
 * 100건에 6분이 걸린다. 제공자 속도 제한에 걸리지 않는 선에서 병렬로 돈다.
 */
const LIMIT = 8

/** 속도 제한으로 실패한 호출을 버리면 그 묶음 전체가 보류로 떨어진다. */
const RETRIES = 2
const RETRY_DELAY_MS = 1_200
const RATE_LIMITED =
  /(429|529|rate.?limit|too many requests|overloaded|일시적|잠시 후)/i

export function createSlotGate(limit: number) {
  let active = 0
  const waiters: Array<() => void> = []
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    // 깨어난 뒤에도 다시 확인한다. 그 사이 다른 호출이 자리를 채울 수 있다.
    while (active >= limit) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    }
    active += 1
    try {
      return await fn()
    } finally {
      active -= 1
      waiters.shift()?.()
    }
  }
}

export function isRateLimitError(error: unknown) {
  return RATE_LIMITED.test(error instanceof Error ? error.message : String(error))
}

const recommendGate = createSlotGate(LIMIT)

export async function withRecommendSlot<T>(fn: () => Promise<T>): Promise<T> {
  // 자리를 붙잡은 채 기다려 재시도가 제공자 부하를 더 키우지 않게 한다.
  return recommendGate(async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fn()
      } catch (error) {
        if (attempt >= RETRIES || !isRateLimitError(error)) throw error
        await new Promise<void>((resolve) => {
          setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1))
        })
      }
    }
  })
}
