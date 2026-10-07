// A small worker pool: serialize each shop, overlap independent shops, and stop dispatching on cancel.
export async function runPriceQueue<T>(items: T[], group: (item:T) => string, run: (item:T) => Promise<void>, stopped: () => boolean, concurrency = 3) {
  const pending = [...items], active = new Set<string>()
  async function worker() {
    while (!stopped()) {
      const index = pending.findIndex(item => !active.has(group(item)))
      if (index < 0) return
      const [item] = pending.splice(index,1), key = group(item)
      active.add(key)
      try { await run(item) } finally { active.delete(key) }
    }
  }
  await Promise.all(Array.from({length:Math.max(1,concurrency)},worker))
}
