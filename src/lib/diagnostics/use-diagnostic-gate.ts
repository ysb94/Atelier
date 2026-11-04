import { useEffect } from 'react'
import { startWorkflow, type DiagnosticDomain } from './workflow-trace'

/** State transitions only: never emit a log from render or store account IDs. */
export function useDiagnosticGate(domain: DiagnosticDomain, action: string, enabled: boolean, reason: string) {
  useEffect(() => {
    const trace = startWorkflow(domain, action)
    trace.step('query_gate')
    if (enabled) trace.done({ state: 'enabled' })
    else trace.block(reason)
  }, [domain, action, enabled, reason])
}
