import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ITEM = 36
const VIEW = ITEM * 5
const PAD = (VIEW - ITEM) / 2

type DateParts = { year: number; month: number; day: number }

function parseDateKey(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function dateKey(parts: DateParts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function range(from: number, to: number) {
  const list: number[] = []
  for (let value = from; value <= to; value += 1) list.push(value)
  return list
}

function clampDate(next: DateParts, min: DateParts, max: DateParts): DateParts {
  const year = Math.min(Math.max(next.year, min.year), max.year)
  const monthStart = year === min.year ? min.month : 1
  const monthEnd = year === max.year ? max.month : 12
  const month = Math.min(Math.max(next.month, monthStart), monthEnd)
  const dayStart = year === min.year && month === min.month ? min.day : 1
  const dayEnd = year === max.year && month === max.month
    ? Math.min(max.day, daysInMonth(year, month))
    : daysInMonth(year, month)
  const day = Math.min(Math.max(next.day, dayStart), dayEnd)
  return { year, month, day }
}

function WheelColumn({
  label,
  items,
  value,
  format,
  onPick,
}: {
  label: string
  items: number[]
  value: number
  format: (value: number) => string
  onPick: (value: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const skip = useRef(false)
  const onPickRef = useRef(onPick)
  const valueRef = useRef(value)
  const itemsRef = useRef(items)
  onPickRef.current = onPick
  valueRef.current = value
  itemsRef.current = items

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const index = Math.max(0, items.indexOf(value))
    const top = index * ITEM
    if (Math.abs(el.scrollTop - top) <= 1) return
    skip.current = true
    el.scrollTop = top
    skip.current = false
  }, [items, value])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer = 0
    function pick() {
      if (skip.current) return
      const list = itemsRef.current
      const index = Math.round(el.scrollTop / ITEM)
      const next = list[Math.min(list.length - 1, Math.max(0, index))]
      if (next !== undefined && next !== valueRef.current) onPickRef.current(next)
    }
    function onScroll() {
      window.clearTimeout(timer)
      timer = window.setTimeout(pick, 80)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('scrollend', pick)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', pick)
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-center text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-9 -translate-y-1/2 rounded-md bg-muted" />
        <div
          ref={ref}
          className="relative z-10 h-[180px] overflow-y-auto overscroll-contain [scrollbar-width:none]"
          style={{ scrollSnapType: 'y mandatory' }}
        >
          <div style={{ height: PAD }} />
          {items.map((item) => (
            <button
              key={item}
              type="button"
              aria-label={format(item)}
              aria-pressed={item === value}
              className={cn(
                'flex h-9 w-full items-center justify-center text-sm',
                item === value ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
              style={{ scrollSnapAlign: 'center' }}
              onClick={() => onPick(item)}
            >
              {format(item)}
            </button>
          ))}
          <div style={{ height: PAD }} />
        </div>
      </div>
    </div>
  )
}

export function HireDateScrollField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
  className,
}: {
  label: string
  value: string
  min: string
  max: string
  disabled?: boolean
  onChange: (value: string) => void
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)
  const minDate = useMemo(() => parseDateKey(min) ?? { year: 1950, month: 1, day: 1 }, [min])
  const maxDate = useMemo(() => parseDateKey(max) ?? minDate, [max, minDate])
  const [draft, setDraft] = useState<DateParts>(() => parseDateKey(value) ?? maxDate)
  const picked = clampDate(draft, minDate, maxDate)
  const years = useMemo(() => range(minDate.year, maxDate.year), [minDate.year, maxDate.year])
  const months = useMemo(() => {
    const start = picked.year === minDate.year ? minDate.month : 1
    const end = picked.year === maxDate.year ? maxDate.month : 12
    return range(start, end)
  }, [maxDate.month, maxDate.year, minDate.month, minDate.year, picked.year])
  const days = useMemo(() => {
    const start = picked.year === minDate.year && picked.month === minDate.month ? minDate.day : 1
    const end = picked.year === maxDate.year && picked.month === maxDate.month
      ? Math.min(maxDate.day, daysInMonth(picked.year, picked.month))
      : daysInMonth(picked.year, picked.month)
    return range(start, end)
  }, [maxDate.day, maxDate.month, maxDate.year, minDate.day, minDate.month, minDate.year, picked.month, picked.year])

  function place() {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 292
    const height = 292
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
    const below = rect.bottom + 6
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below
    setBox({ top, left })
  }

  function openPicker() {
    if (disabled) return
    setDraft(clampDate(parseDateKey(value) ?? maxDate, minDate, maxDate))
    place()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    function onLayout() { place() }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onLayout)
    window.addEventListener('scroll', onLayout, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onLayout)
      window.removeEventListener('scroll', onLayout, true)
    }
  }, [open])

  function pick(partial: Partial<DateParts>) {
    setDraft((current) => clampDate({ ...current, ...partial }, minDate, maxDate))
  }

  const panel = open && box ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${label} 선택`}
      className="fixed z-[70] w-[292px] rounded-xl border border-border bg-card p-3 shadow-lg"
      style={{ top: box.top, left: box.left }}
    >
      <div className="flex gap-2">
        <WheelColumn label="년" items={years} value={picked.year} format={(item) => `${item}년`} onPick={(year) => pick({ year })} />
        <WheelColumn label="월" items={months} value={picked.month} format={(item) => `${item}월`} onPick={(month) => pick({ month })} />
        <WheelColumn label="일" items={days} value={picked.day} format={(item) => `${item}일`} onPick={(day) => pick({ day })} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => { onChange(''); setOpen(false) }}>지우기</Button>
        <Button type="button" size="sm" onClick={() => { onChange(dateKey(picked)); setOpen(false) }}>적용</Button>
      </div>
    </div>
  ) : null
  const mount = rootRef.current?.closest('dialog') ?? (typeof document === 'undefined' ? null : document.body)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        className={cn(
          'flex h-9 items-center rounded-md border border-border bg-card px-3 text-left text-sm shadow-sm transition-colors hover:border-foreground/30 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
          value ? 'text-foreground' : 'text-muted-foreground',
          className,
        )}
        onClick={openPicker}
      >
        {value ? value.replace(/-/g, '.') : '없음'}
      </button>
      {panel && mount ? createPortal(panel, mount) : null}
    </div>
  )
}
