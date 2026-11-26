import { useId, useState, type FormEvent } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn, formatNumber } from '@/lib/utils'

type SourceDepartment = { id: string; name: string; isActive: boolean }
type WorkPart = { id: string; name: string; english?: string; isActive: boolean }
type PreviewDepartment = SourceDepartment & { parts: WorkPart[] }
type PartEditor = { departmentId: string; partId?: string }

const planningNames = new Set(['기획팀', '기획팀_[BAG]', '기획팀_[APPAREL]'])

/** 부서 원본을 수정하지 않고 승인된 화면 구상을 위한 묶음과 예시 파트만 만든다. */
function initialDepartments(source: SourceDepartment[]): PreviewDepartment[] {
  const planning = source.filter(department => planningNames.has(department.name.trim()))
  let planningShown = false
  return source.flatMap<PreviewDepartment>(department => {
    if (planningNames.has(department.name.trim())) {
      if (planningShown) return []
      planningShown = true
      return [{
        id: department.id,
        name: '기획팀',
        isActive: planning.some(item => item.isActive),
        parts: [
          { id: 'preview-bag', name: '백팩', english: 'BAG', isActive: planning.find(item => item.name.trim() === '기획팀_[BAG]')?.isActive ?? true },
          { id: 'preview-apparel', name: '어패럴', english: 'APPAREL', isActive: planning.find(item => item.name.trim() === '기획팀_[APPAREL]')?.isActive ?? true },
        ],
      }]
    }
    const parts = /^md(?:\s*team|팀)?$/i.test(department.name.trim()) ? [
      { id: 'preview-md', name: 'MD', isActive: true },
      { id: 'preview-amd', name: 'AMD', isActive: true },
    ] : []
    return [{ id: department.id, name: department.name, isActive: department.isActive, parts }]
  })
}

function NameForm({ label, initialName = '', existingNames, submitLabel, onSubmit, onCancel }: {
  label: string
  initialName?: string
  existingNames: string[]
  submitLabel: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const inputId = useId()
  const [name, setName] = useState(initialName)
  const [error, setError] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('이름을 입력해 주세요.'); return }
    if (existingNames.some(existing => existing.trim().toLocaleLowerCase('ko') === trimmed.toLocaleLowerCase('ko'))) {
      setError('같은 이름이 이미 있습니다.')
      return
    }
    onSubmit(trimmed)
  }
  return (
    <form className="space-y-2 py-3" onSubmit={submit}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-[1_1_10rem] space-y-1.5">
          <label htmlFor={inputId} className="block text-xs text-muted-foreground">{label}</label>
          <Input id={inputId} autoFocus value={name} maxLength={40} placeholder={`${label} 입력`}
            aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined}
            onChange={event => { setName(event.target.value); setError('') }} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">{submitLabel}</Button>
          <Button type="button" variant="outline" onClick={onCancel}>취소</Button>
        </div>
      </div>
      {error && <p id={`${inputId}-error`} role="alert" className="text-xs text-danger">{error}</p>}
    </form>
  )
}

/** UI 검토 단계: 편집값은 이 컴포넌트의 메모리에서만 유지하고 외부 저장은 하지 않는다. */
export function CompanyDepartmentWorkspace({ departments: source }: { departments: SourceDepartment[] }) {
  useRenderWatch('CompanyDepartmentWorkspace')
  const regionId = useId()
  const [departments, setDepartments] = useState(() => initialDepartments(source))
  const [opened, setOpened] = useState(() => new Set(departments.filter(department => department.parts.length).map(department => department.id)))
  const [addingDepartment, setAddingDepartment] = useState(false)
  const [editor, setEditor] = useState<PartEditor | null>(null)
  const [notice, setNotice] = useState('')

  function toggleDepartment(id: string) {
    setOpened(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function addDepartment(name: string) {
    const id = `preview-${crypto.randomUUID()}`
    setDepartments(previous => [...previous, { id, name, isActive: true, parts: [] }])
    setOpened(previous => new Set(previous).add(id))
    setAddingDepartment(false)
    setNotice(`${name} 부서를 추가했습니다.`)
  }
  function applyPart(department: PreviewDepartment, name: string) {
    const editingId = editor?.partId
    const newPart: WorkPart = { id: `preview-${crypto.randomUUID()}`, name, isActive: true }
    setDepartments(previous => previous.map(item => item.id !== department.id ? item : {
      ...item,
      parts: editingId ? item.parts.map(part => part.id === editingId ? { ...part, name } : part) : [...item.parts, newPart],
    }))
    setEditor(null)
    setNotice(`${department.name} · ${name}${editingId ? ' 이름을 변경했습니다.' : ' 파트를 추가했습니다.'}`)
  }
  function togglePart(department: PreviewDepartment, part: WorkPart) {
    setDepartments(previous => previous.map(item => item.id !== department.id ? item : {
      ...item,
      parts: item.parts.map(current => current.id === part.id ? { ...current, isActive: !current.isActive } : current),
    }))
    setNotice(`${department.name} · ${part.name}${part.isActive ? ' 파트를 중지했습니다.' : ' 파트를 사용합니다.'}`)
  }

  return (
    <section className="space-y-4" aria-label="회사 부서와 업무 파트">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">회사 부서</h2>
          <p className="text-xs text-muted-foreground">화면 미리보기 · 변경사항은 새로고침하면 초기화됩니다.</p>
        </div>
        <Button type="button" onClick={() => setAddingDepartment(true)} disabled={addingDepartment}>
          <Plus className="size-4" aria-hidden="true" />부서 추가
        </Button>
      </div>
      {addingDepartment && <NameForm label="부서 이름" existingNames={departments.map(department => department.name)}
        submitLabel="추가" onSubmit={addDepartment} onCancel={() => setAddingDepartment(false)} />}
      <div className="space-y-3">
        {departments.map((department, index) => {
          const expanded = opened.has(department.id)
          const editing = editor?.departmentId === department.id
          const panelId = `${regionId}-${index}`
          return (
            <Card key={department.id} data-department-id={department.id}>
              <Button type="button" variant="ghost" className="h-auto w-full min-w-0 justify-start gap-2 rounded-xl px-3 py-4 text-left sm:px-4"
                aria-label={`${department.name} 업무 파트 ${expanded ? '접기' : '펼치기'}`}
                aria-expanded={expanded} aria-controls={panelId} onClick={() => toggleDepartment(department.id)}>
                <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="break-words font-medium">{department.name}</span>
                  <Badge variant={department.isActive ? 'outline' : 'muted'}>{department.isActive ? '사용 중' : '중지'}</Badge>
                  <span className="basis-full text-xs font-normal text-muted-foreground sm:ml-auto sm:basis-auto">
                    업무 파트 {department.parts.length ? formatNumber(department.parts.length) : '없음'}
                  </span>
                </span>
              </Button>
              <div id={panelId} hidden={!expanded} className="mb-4 ml-5 mr-3 border-l border-border pl-3 sm:ml-6 sm:mr-4 sm:pl-4">
                {department.parts.length === 0 && <p className="py-2 text-xs text-muted-foreground">등록된 업무 파트 없음</p>}
                <div className="divide-y divide-border">
                  {department.parts.map(part => editing && editor.partId === part.id ? (
                    <NameForm key={part.id} label="업무 파트 이름" initialName={part.name}
                      existingNames={department.parts.filter(item => item.id !== part.id).map(item => item.name)}
                      submitLabel="적용" onSubmit={name => applyPart(department, name)} onCancel={() => setEditor(null)} />
                  ) : (
                    <div key={part.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="break-words text-sm">{part.name}</span>
                        {part.english && <span className="text-xs text-muted-foreground">{part.english}</span>}
                        {!part.isActive && <Badge variant="muted">중지</Badge>}
                      </div>
                      <div className="ml-auto flex shrink-0 gap-1">
                        <Button type="button" size="sm" variant="ghost" className="text-muted-foreground"
                          aria-label={`${part.name} 이름 변경`} onClick={() => setEditor({ departmentId: department.id, partId: part.id })}>이름 변경</Button>
                        <Button type="button" size="sm" variant="ghost" className="text-muted-foreground"
                          aria-label={`${part.name} ${part.isActive ? '중지' : '사용'}`} onClick={() => togglePart(department, part)}>{part.isActive ? '중지' : '사용'}</Button>
                      </div>
                    </div>
                  ))}
                </div>
                {editing && !editor.partId ? (
                  <NameForm key={`${department.id}-new`} label="업무 파트 이름"
                    existingNames={department.parts.map(part => part.name)} submitLabel="추가"
                    onSubmit={name => applyPart(department, name)} onCancel={() => setEditor(null)} />
                ) : (
                  <div className="pt-2">
                    <Button type="button" size="sm" variant="outline" className="text-primary"
                      onClick={() => setEditor({ departmentId: department.id })}><Plus className="size-3.5" aria-hidden="true" />업무 파트 추가</Button>
                  </div>
                )}
              </div>
            </Card>
          )
        })}
      </div>
      {departments.length === 0 && <p className="text-sm text-muted-foreground">등록된 부서가 없습니다.</p>}
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">{notice}</p>
    </section>
  )
}
