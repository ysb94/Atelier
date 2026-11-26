import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useWorkspaceOverlayHost } from '@/components/layout/use-workspace-overlay-host'

type LoadingTask = { message: string; action: boolean }
type SetTask = (id: string, task?: LoadingTask) => void
const LoadingContext = createContext<SetTask | null>(null)

export function useDraftLoading(message: string | false | undefined, action = false) {
  const setTask = useContext(LoadingContext)
  const id = useId()
  useEffect(() => {
    if (!setTask || !message) return
    setTask(id, { message, action })
    return () => setTask(id)
  }, [setTask, id, message, action])
}

function DraftLoadingIndicator({ message }: { message: string | undefined }) {
  const active = useWorkspaceTabActivity()
  const pending = active && Boolean(message)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!pending) {
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(true), 180)
    return () => window.clearTimeout(timer)
  }, [pending])
  const visible = pending && shown
  const { container } = useWorkspaceOverlayHost(visible)

  if (!visible) return null
  return createPortal(
    <div className="pointer-events-none grid h-full place-items-center p-4">
      <div role="status" className="grid max-w-[min(100%,28rem)] justify-items-center gap-2.5 rounded-xl border border-border bg-card px-6 py-4 text-center text-card-foreground shadow-lg">
        <LoaderCircle aria-hidden="true" className="size-7 text-primary motion-safe:animate-spin" />
        <p className="min-w-0 break-all text-sm font-semibold">{message}</p>
        <p className="text-xs text-muted-foreground">완료될 때까지 잠시 기다려 주세요.</p>
      </div>
    </div>,
    container,
  )
}

export function DraftLoadingProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState(() => new Map<string, LoadingTask>())
  const setTask = useCallback<SetTask>((id, task) => {
    setTasks(current => {
      const next = new Map(current)
      if (task) next.set(id, task)
      else next.delete(id)
      return next
    })
  }, [])
  const pending = [...tasks.values()]
  const current = pending.filter(task => task.action).at(-1) ?? pending.at(-1)
  return <LoadingContext.Provider value={setTask}>
    {children}
    <DraftLoadingIndicator message={current?.message} />
  </LoadingContext.Provider>
}
