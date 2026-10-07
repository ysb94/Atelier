import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn } from '@/lib/utils'
import { OrgChartPage } from '@/features/org/OrgChartPage'
import { AttendancePanel } from './AttendancePanel'
import { LeavePanel } from './LeavePanel'

const PARTS = [
  { id: 'org', label: '조직도', description: '부서 배치와 직책·직급을 관리합니다.' },
  { id: 'attendance', label: '근태', description: '월별 직원 근태를 검토하고 정산 자료를 준비합니다.' },
  { id: 'leave', label: '연차관리', description: '연차 부여와 사용 일수를 관리합니다.' },
] as const

type PartId = (typeof PARTS)[number]['id']

function partFromSearch(value: string | null): PartId {
  return PARTS.some((part) => part.id === value) ? (value as PartId) : 'org'
}

export function OperationsSupportPage() {
  useRenderWatch('OperationsSupportPage')
  const [searchParams, setSearchParams] = useSearchParams()
  const part = partFromSearch(searchParams.get('part'))
  const current = PARTS.find((item) => item.id === part) ?? PARTS[0]

  function selectPart(next: PartId) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous)
      if (next === 'org') params.delete('part')
      else params.set('part', next)
      return params
    }, { replace: true })
  }

  return (
    <div>
      <PageHeader title="운영지원" description={current.description} />
      <div role="tablist" aria-label="운영지원 파트" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {PARTS.map((item) => {
          const selected = item.id === part
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectPart(item.id)}
              className={cn(
                'shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors',
                selected
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      {part === 'org' ? <OrgChartPage mode="manage" showHeading={false} /> : null}
      {part === 'attendance' ? <AttendancePanel /> : null}
      {part === 'leave' ? <LeavePanel /> : null}
    </div>
  )
}
