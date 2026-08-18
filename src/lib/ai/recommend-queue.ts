/**
 * 추천 호출 동시 실행 수. 한 건이 LLM 왕복까지 5초를 넘기므로 순차로 돌리면
 * 100건에 6분이 걸린다. 제공자 속도 제한에 걸리지 않는 선에서 병렬로 돈다.
 */
const LIMIT = 6

let active = 0
const waiters: Array<() => void> = []

export async function withRecommendSlot<T>(fn: () => Promise<T>): Promise<T> {
  // 깨어난 뒤에도 다시 확인한다. 그 사이 다른 호출이 자리를 채울 수 있다.
  while (active >= LIMIT) {
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
