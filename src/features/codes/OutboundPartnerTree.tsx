import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

function TreeItem({
  last,
  children,
}: {
  last: boolean
  children: ReactNode
}) {
  return (
    <div className="relative pl-3">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-px top-4 h-px w-3 bg-muted-foreground/35"
      />
      {last ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -left-px top-4 bottom-0 w-px bg-card"
        />
      ) : null}
      {children}
    </div>
  )
}

export function TreeBranch({
  label,
  last = false,
  root = false,
  defaultOpen = true,
  children,
}: {
  label: ReactNode
  last?: boolean
  root?: boolean
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const toggleTimer = useRef<number | null>(null)

  function clearToggleTimer() {
    if (toggleTimer.current != null) {
      window.clearTimeout(toggleTimer.current)
      toggleTimer.current = null
    }
  }

  function toggle() {
    clearToggleTimer()
    setOpen((prev) => !prev)
  }

  function onLabelClick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('input')) return
    if (event.detail > 1) {
      clearToggleTimer()
      return
    }
    clearToggleTimer()
    toggleTimer.current = window.setTimeout(() => {
      toggleTimer.current = null
      setOpen((prev) => !prev)
    }, 220)
  }

  function onLabelDoubleClick() {
    clearToggleTimer()
  }

  const body = (
    <>
      <div className="flex h-8 min-w-0 items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? '접기' : '펼치기'}
          className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground"
          onClick={toggle}
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={onLabelClick}
          onDoubleClick={onLabelDoubleClick}
        >
          {label}
        </div>
      </div>
      {open ? (
        <div className="ml-3 border-l border-muted-foreground/35">{children}</div>
      ) : null}
    </>
  )
  if (root) return <div>{body}</div>
  return <TreeItem last={last}>{body}</TreeItem>
}

export function TreeLeaf({
  last = false,
  root = false,
  children,
}: {
  last?: boolean
  root?: boolean
  children: ReactNode
}) {
  if (root) return children
  return <TreeItem last={last}>{children}</TreeItem>
}
