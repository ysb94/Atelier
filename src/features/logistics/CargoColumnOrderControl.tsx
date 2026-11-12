import { useState } from 'react'
import { ArrowLeft, ArrowRight, Columns3, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CargoLineListColumnKey } from './cargo-line-list-columns'

type Column = { key: CargoLineListColumnKey; label: string }

export function CargoColumnOrderControl({ columns, defaults, onChange }: {
  columns: readonly Column[]
  defaults: readonly Column[]
  onChange: (keys: CargoLineListColumnKey[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [draggedKey, setDraggedKey] = useState<CargoLineListColumnKey | null>(null)
  const [dropTarget, setDropTarget] = useState<{ key: CargoLineListColumnKey; after: boolean } | null>(null)
  const isDefault = columns.every((column, index) => column.key === defaults[index]?.key)

  function move(from: CargoLineListColumnKey, target: CargoLineListColumnKey, after: boolean) {
    if (from === target) return
    const next = columns.map(column => column.key).filter(key => key !== from)
    const targetIndex = next.indexOf(target)
    if (targetIndex < 0) return
    next.splice(targetIndex + (after ? 1 : 0), 0, from)
    onChange(next)
  }

  function clearDrag() {
    setDraggedKey(null)
    setDropTarget(null)
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <Columns3 className="size-3.5" aria-hidden />열 순서
        </Button>
        {open && <>
          <Button type="button" size="sm" variant="ghost" disabled={isDefault} onClick={() => { clearDrag(); onChange(defaults.map(column => column.key)) }}>
            기본 순서
          </Button>
          <span className="text-xs text-muted-foreground">헤더 이름을 드래그하거나 좌우 버튼으로 옮기세요. 인쇄·엑셀에도 같은 순서가 적용됩니다.</span>
        </>}
      </div>
      {open && (
        <div role="group" aria-label="헤더 순서 설정" className="max-w-full overflow-x-auto pb-1">
          <div className="flex w-max items-center gap-1 p-1">
            {columns.map((column, index) => (
              <div
                key={column.key}
                role="group"
                aria-label={`${column.label} 열 위치`}
                onDragOver={event => {
                  if (!draggedKey || draggedKey === column.key) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  const rect = event.currentTarget.getBoundingClientRect()
                  setDropTarget({ key: column.key, after: event.clientX >= rect.left + rect.width / 2 })
                }}
                onDragLeave={event => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
                }}
                onDrop={event => {
                  if (!draggedKey) return
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  move(draggedKey, column.key, event.clientX >= rect.left + rect.width / 2)
                  clearDrag()
                }}
                className={cn('relative flex shrink-0 items-center rounded-md border border-border bg-card', draggedKey === column.key && 'opacity-40',
                  dropTarget?.key === column.key && 'after:pointer-events-none after:absolute after:inset-y-0 after:w-0.5 after:bg-primary',
                  dropTarget?.key === column.key && (dropTarget.after ? 'after:-right-1' : 'after:-left-1'))}
              >
                <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`${column.label} 열 왼쪽으로`} disabled={index === 0} onClick={() => move(column.key, columns[index - 1].key, false)}>
                  <ArrowLeft className="size-3" aria-hidden />
                </Button>
                <span
                  draggable
                  title="끌어서 열 순서 변경"
                  className="flex cursor-grab select-none items-center gap-1 px-1 py-1.5 text-xs active:cursor-grabbing"
                  onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', column.key); setDraggedKey(column.key) }}
                  onDragEnd={clearDrag}
                >
                  <GripVertical className="size-3 text-muted-foreground" aria-hidden />{column.label}
                </span>
                <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`${column.label} 열 오른쪽으로`} disabled={index === columns.length - 1} onClick={() => move(column.key, columns[index + 1].key, true)}>
                  <ArrowRight className="size-3" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
