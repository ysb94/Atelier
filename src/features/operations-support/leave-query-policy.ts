// These reads also reconcile leave in the server. Keep a slow fallback for
// other employees' changes/date rollover, and stop polling after a failure.
export const LEAVE_REFRESH_INTERVAL = 5 * 60_000
export const leaveQueryPolicy = {
  staleTime: 60_000,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: (query: { state: { status: string } }) =>
    query.state.status === 'error' ? false : LEAVE_REFRESH_INTERVAL,
} as const
