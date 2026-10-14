// Stage permits are transient; durable job phases reconstruct queues after restart.
export class Pipeline {
  constructor({ planning = 1, implementation = 2, review = 1, readyLimit = 4, reviewBacklog = 3, onChange = () => {} } = {}) {
    this.limits = { planning, implementation, review }
    this.readyLimit = readyLimit
    this.reviewBacklog = reviewBacklog
    this.onChange = onChange
    this.running = new Map()
    this.waiters = []
    this.reservations = new Map()
  }
  count(stage) { return [...this.running.values()].filter(item => item.stage === stage).length }
  queued(stage) { return this.waiters.filter(item => item.stage === stage).length }
  canPlan() {
    return this.count('planning') < this.limits.planning && this.queued('planning') === 0 &&
      this.queued('review') === 0 && this.queued('implementation') < this.readyLimit &&
      this.queued('review') + this.count('review') < this.reviewBacklog
  }
  acquire(stage, { key, files = [], signal }) {
    if (!this.limits[stage]) return Promise.reject(new Error(`알 수 없는 실행 단계: ${stage}`))
    if (signal.aborted) return Promise.reject(new Error('작업 중지됨'))
    return new Promise((resolve, reject) => {
      const item = { stage, key, files: new Set(files), resolve, reject, signal }
      item.abort = () => {
        const at = this.waiters.indexOf(item)
        if (at < 0) return
        this.waiters.splice(at, 1)
        signal.removeEventListener('abort', item.abort)
        reject(new Error('작업 중지됨'))
        this.drain()
      }
      signal.addEventListener('abort', item.abort, { once: true })
      this.waiters.push(item)
      this.drain()
    })
  }
  eligible(item) {
    if (this.count(item.stage) >= this.limits[item.stage]) return false
    if (item.stage === 'planning' && (this.queued('review') > 0 || this.queued('implementation') >= this.readyLimit ||
      this.queued('review') + this.count('review') >= this.reviewBacklog)) return false
    if (item.stage === 'implementation') {
      for (const [key, files] of this.reservations) {
        if (key !== item.key && [...item.files].some(file => files.has(file))) return false
      }
    }
    return true
  }
  drain() {
    // Inspect the whole queue so unrelated files can proceed past a conflicting job.
    for (let i = 0; i < this.waiters.length;) {
      const item = this.waiters[i]
      if (!this.eligible(item)) { i++; continue }
      this.waiters.splice(i, 1)
      item.signal.removeEventListener('abort', item.abort)
      this.running.set(item.key, item)
      if (item.stage === 'implementation') {
        const files = this.reservations.get(item.key) ?? new Set()
        for (const file of item.files) files.add(file)
        this.reservations.set(item.key, files)
      }
      let released = false
      item.resolve(() => {
        if (released) return
        released = true
        this.running.delete(item.key)
        this.drain()
      })
    }
    this.onChange()
  }
  finish(key) {
    this.reservations.delete(key)
    this.drain()
  }
  reserve(key, files) { this.reservations.set(key, new Set(files)) }
  status() {
    return Object.fromEntries(Object.keys(this.limits).map(stage => [stage, {
      running: this.count(stage), waiting: this.queued(stage), limit: this.limits[stage],
    }]))
  }
}
