export function AppLoadingOverlay({ busy, message }: { busy: boolean; message: string }) {
  if (!busy) return null
  return <div className="app-loading-overlay open" aria-live="polite"><div className="app-loading-panel"><div className="app-loading-spinner" /><div className="app-loading-message">{message}</div></div></div>
}
