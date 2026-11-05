import { safeInteractionContext } from '@/lib/diagnostics/perf-watch'

export const SUPABASE_READ_TIMEOUT_MS = 25_000
// auth-js retries refresh failures inside a 30s window. Expire after that window
// so a stalled refresh is not sent twice, while keeping its retryable error and
// stored session intact for recovery (never turn it into an invalid-token error).
export const SUPABASE_AUTH_TIMEOUT_MS = 31_000
const TIMEOUT_MESSAGE = '서버 응답 시간이 초과됐습니다. 연결 상태를 확인한 뒤 다시 조회해 주세요.'

// These RPCs are invoked to read screens. Some also reconcile server-maintained
// records, so a timeout must never cause an immediate automatic replay.
// Do not infer safety from a name prefix or apply this deadline to write RPCs.
const SCREEN_READ_RPCS = new Set([
  'count_brand_styles',
  'get_my_basic_work_access', 'list_my_permission_grants', 'permission_directory',
  'list_org_chart_members', 'get_my_employee_onboarding_status', 'list_employee_onboardings',
  'is_my_attendance_exempt', 'list_company_attendance_exempt', 'list_effective_attendance_clocks',
  'get_my_workday_basis', 'get_my_attendance_basis', 'my_offsite_attendance', 'my_offsite_groups',
  'list_my_approval_requests', 'employee_extra_leave_records', 'my_extra_leave_entries',
  'employee_leave_advances', 'list_my_extra_leave_notices', 'leave_notice_management_v2',
  'leave_usage_notice_management', 'list_my_home_work_notifications',
  'list_workforce_management', 'get_logistics_operations', 'list_my_managed_work_notifications', 'list_my_managed_late_notices',
  'list_company_meetings', 'list_meeting_directory', 'list_meeting_member_participation',
  'list_meeting_calendar', 'list_meeting_availability_with_todos', 'list_my_meeting_invitations',
  'list_my_chat_rooms', 'list_chat_directory', 'list_chat_room_members', 'chat_storage_usage',
  'list_my_late_statement_notices', 'list_my_manageable_late_statements', 'count_late_statements_awaiting_hr',
])

export function isSupabaseReadTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message
    : typeof error === 'object' && error !== null && 'message' in error ? String(error.message)
      : String(error ?? '')
  // Store adapters often preserve only error.message. Keep the classifier after
  // that conversion without exposing an internal error code in the screen.
  return message.includes(TIMEOUT_MESSAGE)
}

export function shouldRetrySupabaseQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && !isSupabaseReadTimeout(error)
}

/** Includes response-body time, preserves caller cancellation, and never retries. */
export function createSupabaseFetch(
  supabaseUrl: string,
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
  timeoutMs = SUPABASE_READ_TIMEOUT_MS,
  authTimeoutMs = SUPABASE_AUTH_TIMEOUT_MS,
): typeof fetch {
  const origin = new URL(supabaseUrl).origin
  return async (input, init) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input))
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1]
    const auth = url.pathname.startsWith('/auth/v1/')
    const read = url.pathname.startsWith('/rest/v1/') &&
      (method === 'GET' || method === 'HEAD' || (method === 'POST' && Boolean(rpc && SCREEN_READ_RPCS.has(rpc))))
    if (url.origin !== origin || (!auth && !read)) return fetcher(input, init)
    const deadlineMs = auth ? authTimeoutMs : timeoutMs

    const controller = new AbortController()
    const callerSignal = init?.signal ?? request?.signal
    const timeoutError = new Error(TIMEOUT_MESSAGE)
    let timedOut = false
    const cancel = () => controller.abort(callerSignal?.reason)
    if (callerSignal?.aborted) cancel()
    else callerSignal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      console.warn('[supabase-request] 응답 시간 초과 · 자동 재시도하지 않음', {
        method, endpoint: url.pathname, timeoutMs: deadlineMs,
        ...(typeof location === 'undefined' ? {} : safeInteractionContext()),
      })
      controller.abort(timeoutError)
    }, deadlineMs)
    const cleanup = () => { clearTimeout(timer); callerSignal?.removeEventListener('abort', cancel) }
    try {
      const response = await fetcher(input, { ...init, signal: controller.signal })
      // Do not wrap an empty Chromium stream in a body-forbidden response.
      if (method === 'HEAD' || [204, 205, 304].includes(response.status) || !response.body) { cleanup(); return response }
      const reader = response.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const chunk = await reader.read()
            if (chunk.done) { cleanup(); stream.close() }
            else stream.enqueue(chunk.value)
          } catch (error) {
            cleanup()
            stream.error(timedOut ? timeoutError : error)
          }
        },
        cancel(reason) { cleanup(); return reader.cancel(reason) },
      })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch (error) {
      cleanup()
      throw timedOut ? timeoutError : error
    }
  }
}
