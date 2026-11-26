import { useEffect, useId, useRef, useState } from 'react'
import { useDraftLoading } from './DraftLoading'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { listOrgChartPeople } from '@/lib/supabase/profiles'
import type { DraftSpecs } from '@/lib/types'

export function DraftProposerPicker({ value, onChange, actorId, readOnly }: {
  value: DraftSpecs['proposer']
  onChange: (value: DraftSpecs['proposer']) => void
  actorId?: string
  readOnly: boolean
}) {
  const [openFor, setOpenFor] = useState<string>()
  const [search, setSearch] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const optionsId = useId()
  const open = !readOnly && Boolean(actorId && openFor === actorId)
  const directory = useQuery({
    queryKey: ['orgChartMembers', actorId, 'people'],
    queryFn: listOrgChartPeople,
    enabled: open,
    ...sharedReadPolicy,
  })
  const query = search.trim().toLowerCase()
  useDraftLoading(open && directory.isLoading && '제안자 직원 목록을 불러오는 중…')
  const people = (directory.data ?? [])
    .flatMap(person => person.displayName?.trim() ? [{ id: person.id, name: person.displayName.trim(), position: person.position }] : [])
    .filter(person => person.name.toLowerCase().includes(query))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'))

  useEffect(() => {
    if (!open) return
    searchInput.current?.focus()
    function closeOutside(event: Event) {
      if (!(event.target instanceof Node) || root.current?.contains(event.target)) return
      setOpenFor(undefined)
      setSearch('')
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('focusin', closeOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOutside)
    }
  }, [open])

  function close(returnFocus = false) {
    setOpenFor(undefined)
    setSearch('')
    if (returnFocus) trigger.current?.focus()
  }

  function choose(proposer?: DraftSpecs['proposer']) {
    onChange(proposer)
    close(true)
  }

  if (readOnly) return <Input aria-label="제안자" className="h-8 text-xs" value={value?.name ?? '미지정'} readOnly />
  return (
    <div ref={root} className="relative"
      onKeyDown={event => {
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        close(true)
      }}>
      <Button type="button" size="sm" variant="outline" aria-label="제안자 선택 (선택 사항)"
        disabled={!actorId} aria-expanded={open} aria-controls={open ? optionsId : undefined}
        className="w-full justify-between font-normal" onClick={event => {
          trigger.current = event.currentTarget
          if (open) close()
          else setOpenFor(actorId)
        }}>
        <span className="truncate">{value ? `제안자 · ${value.name}` : '제안자 (선택 사항)'}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
      {open && <div id={optionsId} className="absolute left-0 top-full z-20 mt-1 w-full min-w-48 rounded-md border border-border bg-card p-2 shadow-md">
        <Input ref={searchInput} aria-label="제안자 이름 검색" placeholder="이름 검색" className="h-8 text-xs"
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
    </div>
  )
}
