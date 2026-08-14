const LIMIT = 2
let active = 0
const waiters: Array<() => void> = []

export async function withRecommendSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= LIMIT) {
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
