/** Shared consumers reuse recent server results; writes/realtime still invalidate immediately. */
export const sharedReadPolicy = {
  staleTime: 15_000,
  retry: false,
  retryOnMount: false,
  refetchOnMount: (query: { state: { status: string } }) => query.state.status !== 'error',
  refetchOnWindowFocus: false,
} as const

/** Keep the normal refresh rate; a failed read waits before its next automatic attempt. */
export function readPollInterval(interval: number, enabled = true) {
  return (query: { state: { status: string } }) => enabled
    ? query.state.status === 'error' ? Math.max(interval, 60_000) : interval
    : false
}
