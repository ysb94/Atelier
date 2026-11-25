import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import {
  departureHandoverDetailKey, departureHandoverKey, getDepartureHandover, readDepartureHandover, saveDepartureHandover,
  type DepartureHandoverDetail, type DepartureHandoverInbox,
} from '@/lib/supabase/departure-handover'

const labels = { approvals: '근태·야근 승인 담당', personal: '내 업무', sent: '보낸 요청', requests: '작업 요청', settings: '작업 요청 담당 설정' }

function eligibleCandidates(data: DepartureHandoverDetail, item: DepartureHandoverDetail['items'][number]) {
  const departmentOnly = item.kind === 'requests' || item.kind === 'settings'
  return data.candidates.filter(person => !departmentOnly || person.departmentId === item.departmentId)
}

export function DepartureHandoverDrawer({ actor, employee, onClose }: { actor: string; employee: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const attemptedRead = useRef('')
  const command = useRef<{ key: string; id: string }>(null)
  const visible = useNotificationDetailVisibility()
  const cache = useQueryClient()
  const detailKey = departureHandoverDetailKey(actor, employee)
  const [choices, setChoices] = useState<Record<string,string>>({})
  const [message, setMessage] = useState('')
  const detail = useQuery({ queryKey: detailKey, queryFn: () => getDepartureHandover(employee), enabled: visible, retry: false, staleTime: 0 })
  const data = detail.isSuccess && detail.isFetchedAfterMount ? detail.data : undefined

  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])

  const read = useMutation({ mutationFn: (version: string) => readDepartureHandover(employee, version),
    onSuccess: (readAt, version) => {
      cache.setQueryData<DepartureHandoverDetail>(detailKey, current => current?.version === version ? { ...current, readAt } : current)
      cache.setQueryData<DepartureHandoverInbox>(departureHandoverKey(actor), current => current && ({ ...current,
        rows: current.rows.map(row => row.id === employee && row.version === version ? { ...row, readAt } : row) }))
      void cache.invalidateQueries({ queryKey: departureHandoverKey(actor), exact: true })
    },
  })
  const { mutate: markRead } = read
  useEffect(() => {
    if (!visible || !data || data.readAt || !data.items.length || attemptedRead.current === data.version || !dialog.current?.open) return
    attemptedRead.current = data.version
    markRead(data.version)
  }, [data, markRead, visible])

  const save = useMutation({ mutationFn: (input: { revision: string; selected: Record<string,string>; command: string }) =>
    saveDepartureHandover(employee, input.revision, input.selected, input.command),
  onSuccess: async result => {
    setChoices({})
    setMessage(result.duplicate ? '저장 결과를 다시 불러왔습니다.' : [result.applied ? `${result.applied}건 인계 완료` : '',
      result.recommended ? `${result.recommended}건 후임 추천 완료` : ''].filter(Boolean).join(' · '))
    await Promise.all([departureHandoverKey(actor), ['department-approvers'], ['company-leave-requests'], ['my-home-work-notices'],
      ['personal-work-cards'], ['work-requests'], ['department-work'], ['employee-departures']].map(queryKey => cache.invalidateQueries({ queryKey })))
  } })
  const selected = Object.fromEntries(data ? data.items.flatMap(item => {
    const value = choices[item.key] ?? (item.canApply ? item.suggestedId : '')
    return eligibleCandidates(data, item).some(person => person.id === value) ? [[item.key, value]] : []
  }) : [])
  const selectionCount = Object.keys(selected).length

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!data || !visible || !selectionCount || save.isPending || detail.isFetching) return
    const key = JSON.stringify([data.revision, selected])
    if (command.current?.key !== key) command.current = { key, id: crypto.randomUUID() }
    setMessage('')
    save.mutate({ revision: data.revision, selected, command: command.current.id })
  }

  return <dialog ref={dialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!save.isPending) onClose() }}
    className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-2xl border-l border-border bg-card text-card-foreground shadow-2xl backdrop:bg-black/20">
    <form className="flex h-full min-w-0 flex-col" onSubmit={submit}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-5 sm:px-8">
        <div><h2 id={heading} className="text-xl font-semibold">퇴사 인계</h2>
          {data && <p className="mt-1 text-sm text-muted-foreground">{data.employeeName || '직원'} · {data.departmentName || '소속 미지정'} · {data.resignedOn} 퇴사</p>}</div>
        <Button type="button" variant="ghost" size="icon" aria-label="퇴사 인계 창 닫기" onClick={onClose} disabled={save.isPending}><X size={19} aria-hidden="true" /></Button>
      </header>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-5 py-4 sm:px-8">
        {detail.isPending && <p role="status" className="py-3 text-sm text-muted-foreground">인계 내용을 불러오는 중입니다.</p>}
        {detail.isError && <p role="alert" className="py-3 text-sm text-danger">퇴사 인계 내용을 열 수 없습니다.</p>}
        {data && !data.items.length && <p className="py-3 text-sm font-medium">남은 인계가 없습니다.</p>}
        {data?.items.map(item => {
          const id = `${heading}-${item.key}`
          const people = eligibleCandidates(data, item)
          const suggested = people.find(person => person.id === item.suggestedId)
          return <div key={item.key} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)] sm:items-center">
            <div className="min-w-0"><p className="mb-0.5 text-xs text-muted-foreground">{labels[item.kind]}</p>
              <label htmlFor={id} className="block wrap-anywhere text-sm font-medium">{item.label}</label>
              {item.suggestedId && <p className="mt-1 text-xs text-muted-foreground">{suggested?.name || '후임 재확인 필요'} · 지정 확인 대기</p>}
            </div>
            <div><Select id={id} value={selected[item.key] ?? ''} className="w-full" disabled={save.isPending || !people.length} onChange={event => {
              const value = event.currentTarget.value
              setChoices(current => ({ ...current, [item.key]: value }))
            }}><option value="">{people.length ? '후임 선택' : '선택할 직원 없음'}</option>
              {people.map(person => <option key={person.id} value={person.id}>{person.name || '이름 미등록'}{person.departmentName && ` · ${person.departmentName}`}</option>)}
            </Select>{!item.canApply && <p className="mt-1 text-xs text-muted-foreground">후임 추천 · 지정 담당자 확인</p>}</div>
          </div>
        })}
      </div>
      <footer className="space-y-2 border-t border-border px-5 py-4 sm:px-8">
        {message && <p role="status" className="text-sm text-success">{message}</p>}
        {read.isError && data && !data.readAt && <Button type="button" size="sm" variant="outline" onClick={() => read.mutate(data.version)}>읽음 저장 다시 시도</Button>}
        {save.isError && <p role="alert" className="text-sm text-danger">{save.error.message} <Button type="button" size="sm" variant="ghost" onClick={() => void detail.refetch()}>다시 조회</Button></p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {data && <Badge variant="muted">{data.items.length ? `남은 인계 ${data.items.length}건` : '인계 완료'}</Badge>}
          <Button type="submit" disabled={!selectionCount || save.isPending || detail.isFetching}>{save.isPending ? '저장 중…' : '선택 항목 저장'}</Button>
        </div>
      </footer>
    </form>
  </dialog>
}
