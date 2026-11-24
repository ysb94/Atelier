import { useMemo } from 'react'
import { cn } from '@/lib/utils'

type EmployeeDirectoryPerson = { id: string; name: string; department?: string | null; position?: string | null }

function groupByDepartment(people: readonly EmployeeDirectoryPerson[]) {
  const groups = new Map<string, EmployeeDirectoryPerson[]>()
  for (const person of people) {
    const department = person.department?.trim() || '부서 없음'
    const members = groups.get(department) ?? []
    members.push(person)
    groups.set(department, members)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === '부서 없음') return 1
      if (right === '부서 없음') return -1
      return left.localeCompare(right, 'ko')
    })
    .map(([department, members]) => ({
      department,
      members: members.sort((left, right) => left.name.localeCompare(right.name, 'ko')),
    }))
}

export function EmployeeDirectoryColumns({ people, isSelected, onSelect, disabled, className }: {
  people: readonly EmployeeDirectoryPerson[]
  isSelected: (id: string) => boolean
  onSelect: (id: string) => void
  disabled?: boolean
  className?: string
}) {
  const groups = useMemo(() => groupByDepartment(people), [people])

  return <div role="group" aria-label="재직 직원" className={cn('flex overflow-x-auto pb-1', className)}>
    {groups.map(({ department, members }, index) => <div key={department}
      className={cn('min-w-[8.5rem] shrink-0 px-3', index > 0 && 'border-l border-border')}>
      <p className="mb-1 px-1 py-0.5 text-xs font-medium">{department}</p>
      <ul className="space-y-0.5">
        {members.map(person => {
          const selected = isSelected(person.id)
          return <li key={person.id}>
            <button type="button" aria-pressed={selected} disabled={disabled} onClick={() => onSelect(person.id)}
              className={cn('flex w-full flex-col rounded px-1.5 py-1 text-left text-xs transition-colors disabled:opacity-60',
                selected ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted')}>
              <span className="font-medium">{person.name}</span>
              {person.position ? <span className={cn('text-[10px]', selected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                {person.position}
              </span> : null}
            </button>
          </li>
        })}
      </ul>
    </div>)}
  </div>
}
