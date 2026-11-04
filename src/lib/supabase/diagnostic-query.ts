import { diagnosticOperation, tracedQuery, type DiagnosticContext, type DiagnosticDomain } from '@/lib/diagnostics/workflow-trace'

/** Records SQLSTATE before adapters translate errors for the screen. Never logs data. */
export function diagnosticQuery<T>(domain: DiagnosticDomain, action: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>, context?: DiagnosticContext): Promise<T> {
  return diagnosticOperation(domain, action, async trace => {
    const { data, error } = await trace.run('db_request', current => tracedQuery(query, current))
    if (error) { trace.fail(error); throw new Error(error.message, { cause: error }) }
    return data as T
  }, context)
}
