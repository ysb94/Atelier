import { isDiagnosticsEnabled } from '@/lib/diagnostics'
import { interactionContext } from '@/lib/diagnostics/perf-watch'

export function timeAttendanceWork<T>(name: string, calculate: () => T): T {
  if (!isDiagnosticsEnabled()) return calculate()
  const start=performance.now()
  try { return calculate() } finally {
    const elapsed=Math.round(performance.now()-start)
    if (elapsed>=200) {
      const context={...interactionContext(),elapsedMs:elapsed}
      if (elapsed>=1000) console.warn('[attendance-work] '+name,context)
      else console.info('[attendance-work] '+name,context)
    }
  }
}
