import type { QueryClient } from '@tanstack/react-query'
import { clearDiagnosticReport, diagnosticReport, rememberDiagnosticInput, startWorkflow } from './workflow-trace'

const installed = new WeakSet<QueryClient>()
let browserInstalled = false

/** Always retain bounded failure evidence, including when verbose diagnostics are off. */
export function installWorkflowDiagnostics(client: QueryClient) {
  if (installed.has(client)) return
  installed.add(client)
  client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'error') return
    startWorkflow('app', 'query').fail(event.action.error, { scope: 'query' })
  })
  client.getMutationCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'error') return
    startWorkflow('app', 'mutation').fail(event.action.error, { scope: 'mutation' })
  })
  if (typeof window === 'undefined' || browserInstalled) return
  browserInstalled = true
  Object.assign(window.atelierDebug ?? {}, { report: diagnosticReport, clear: clearDiagnosticReport })
  for (const event of ['pointerdown', 'keydown', 'submit', 'change']) window.addEventListener(event, rememberDiagnosticInput, { capture: true, passive: true })
  window.addEventListener('error', event => {
    // Stack source is useful for bundles/source modules; arbitrary external paths may name people/files.
    const source = /\/(assets|src)\//.test(event.filename) ? event.filename.split('/').pop()?.split(/[?#]/)[0] : undefined
    startWorkflow('app', 'uncaught').fail(event.error ?? new Error(event.message), {
      ...(source && /^[a-zA-Z0-9_.-]{1,100}$/.test(source) ? { source } : {}), line: event.lineno, column: event.colno,
    })
  })
  window.addEventListener('unhandledrejection', event => startWorkflow('app', 'unhandled_rejection').fail(event.reason))
  window.addEventListener('offline', () => startWorkflow('app', 'connection').block('offline'))
  window.addEventListener('online', () => startWorkflow('app', 'connection').done({ state: 'online' }))
}
