import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listOrgChartMembers } from '@/lib/supabase/profiles'
import type { DraftSpecs } from '@/lib/types'

export function DraftProposerPicker({ value, onChange, actorId, readOnly }: {
  value: DraftSpecs['proposer']
  onChange: (value: DraftSpecs['proposer']) => void
  actorId?: string
  readOnly: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const trigger = useRef<HTMLElement>(null)
  const directory = useQuery({
    queryKey: ['orgChartMembers', actorId],
    queryFn: listOrgChartMembers,
    enabled: open && !readOnly && Boolean(actorId),
    retry: false,
  })
  const query = search.trim().toLowerCase()
  const people = (directory.data ?? [])
    .flatMap(person => person.displayName?.trim() ? [{ id: person.id, name: person.displayName.trim(), position: person.position }] : [])
    .filter(person => person.name.toLowerCase().includes(query))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'))

  function choose(proposer?: DraftSpecs['proposer']) {
    onChange(proposer)
    setOpen(false)
    trigger.current?.focus()
  }

  if (readOnly) return <Input aria-label="제안자" className="h-8 text-xs" value={value?.name ?? '미지정'} readOnly />
  return (
    <details open={open} className="relative [&>summary::-webkit-details-marker]:hidden"
      onToggle={event => {
        const expanded = event.currentTarget.open
        setOpen(expanded)
        if (!expanded) setSearch('')
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        setOpen(false)
        trigger.current?.focus()
      }}>
      <summary ref={trigger} aria-label="제안자 선택 (선택 사항)"
        className="flex h-8 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-xs shadow-sm focus-visible:ring-2 focus-visible:ring-ring/25">
        <span className="truncate">{value ? `제안자 · ${value.name}` : '제안자 (선택 사항)'}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </summary>
      {open && <div className="absolute left-0 top-full z-20 mt-1 w-full min-w-48 rounded-md border border-border bg-card p-2 shadow-md">
        <Input aria-label="제안자 이름 검색" placeholder="이름 검색" className="h-8 text-xs"
          value={search} onChange={event => setSearch(event.target.value)} />
        <div className="mt-1 max-h-48 overflow-auto">
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => choose()}>미지정</Button>
          {people.map(({ id, name, position }) => (
            <Button key={id} type="button" variant="ghost" size="sm" className="w-full justify-start"
              aria-pressed={value?.id === id} onClick={() => choose({ id, name })}>
              <span className="truncate">{name}{position ? ` · ${position}` : ''}</span>
            </Button>
          ))}
          {directory.isLoading && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">직원 목록을 불러오는 중입니다.</p>}
          {directory.isError && <Button type="button" variant="ghost" size="sm" onClick={() => void directory.refetch()}>직원 목록 다시 불러오기</Button>}
          {!directory.isLoading && !directory.isError && !people.length && <p className="px-3 py-2 text-xs text-muted-foreground">일치하는 직원이 없습니다.</p>}
        </div>
      </div>}
    </details>
  )
}
