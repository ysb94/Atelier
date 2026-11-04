import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js'
import { createDiagnosticFetch } from '@/lib/diagnostics/request-watch'
import { createCoalescedReadFetch } from './coalesced-read-fetch'

/** All present/future stores use the same observer, preserving caller policies. */
export function createDiagnosedClient(url: string, key: string, options?: SupabaseClientOptions<'public'>) {
  return createClient(url, key, {
    ...options,
    global: { ...options?.global, fetch: createCoalescedReadFetch(url, createDiagnosticFetch(url, options?.global?.fetch)) },
  })
}
