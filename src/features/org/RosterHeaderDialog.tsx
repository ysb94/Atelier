import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { addRosterColumn, saveRosterHeaderSetting, ROSTER_BASE_HEADERS, type RosterColumn, type RosterColumnKind, type RosterHeaderKind, type RosterHeaderSetting } from '@/lib/supabase/employee-roster'

const KIND_LABELS: Record<RosterHeaderKind, string> = { text: '텍스트', number: '숫자', money: '금액', date: '날짜', choice: '선택' }
type Header = { key: string; label: string; originalLabel: string; kind: RosterHeaderKind; hidden: boolean; basic: boolean }
type Action = { type: 'add'; label: string; kind: RosterColumnKind } | { type: 'setting'; key: string; label: string; hidden: boolean }

export function RosterHeaderDialog({ columns, settings, settingsReady, settingsLoading, loading, failed, onClose, onRemoved, onRetry }: {
  columns: RosterColumn[]; settings: RosterHeaderSetting[]; settingsReady: boolean; settingsLoading: boolean; loading: boolean; failed: boolean; onClose: () => void; onRemoved: () => void; onRetry: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const cache = useQueryClient()
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<RosterColumnKind>('text')
  const [search, setSearch] = useState('')
  const headers = useMemo<Header[]>(() => {
    const saved = new Map(settings.map(item => [item.key, item]))
    return [...ROSTER_BASE_HEADERS.map(item => ({ ...item, basic: true })), ...columns.map(item => ({ key: `column:${item.id}`, label: item.label, kind: item.kind, basic: false }))].map(item => ({ ...item, originalLabel: item.label, label: saved.get(item.key)?.label ?? item.label, hidden: saved.get(item.key)?.hidden ?? false }))
  }, [columns, settings])
  const needle = search.trim().toLocaleLowerCase('ko')
  const visible = headers.filter(header => `${header.label} ${header.originalLabel}`.toLocaleLowerCase('ko').includes(needle))
  const mutation = useMutation({
    mutationFn: async (action: Action) => {
      const renaming = action.type === 'add' || headers.find(header => header.key === action.key)?.label !== action.label.trim()
      if (renaming && headers.some(header => header.label === action.label.trim() && (action.type === 'add' || header.key !== action.key))) throw new Error('같은 이름의 헤더가 있습니다.')
      if (action.type === 'add') await addRosterColumn(action.label, action.kind)
      else await saveRosterHeaderSetting(action.key, action.label, action.hidden)
    },
    onSuccess: async (_, action) => {
      if (action.type === 'add') setLabel('')
      if (action.type === 'setting' && action.hidden) onRemoved()
      await Promise.all([cache.invalidateQueries({ queryKey: ['employee-roster-columns'] }), cache.invalidateQueries({ queryKey: ['employee-roster-header-settings'] })])
    },
    onError: error => console.warn('[org-chart] 헤더 관리 실패', error),
  })
  const busy = mutation.isPending
  const disabled = busy || loading || settingsLoading || failed || !settingsReady
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  function submit(action: Action) { if (!disabled) { mutation.reset(); mutation.mutate(action) } }
  return <dialog ref={ref} aria-labelledby="roster-headers-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-sm backdrop:bg-black/35">
    <header className="flex items-start justify-between gap-3"><div><h2 id="roster-headers-title" className="text-lg font-semibold">헤더 관리</h2><p className="mt-1 text-sm text-muted-foreground">기본·추가 헤더의 표시명을 바꾸거나 표에서 삭제합니다. 직원 정보와 입력값은 남으며 언제든 복원할 수 있습니다.</p></div><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label="헤더 관리 닫기" onClick={onClose}><X className="size-4" /></Button></header>
    {failed ? <div role="alert" className="mt-4 text-sm text-danger">헤더 설정을 불러오지 못했습니다. <Button type="button" variant="outline" size="sm" onClick={onRetry}>다시 불러오기</Button></div> : !settingsLoading && !settingsReady ? <p role="status" className="mt-4 text-sm text-warning">전체 헤더 설정 저장소는 서버 적용 전입니다. 기존 표는 그대로 표시되며 설정 저장은 적용 후 가능합니다.</p> : null}
    {mutation.error ? <p role="alert" className="mt-4 text-sm text-danger">{mutation.error instanceof Error ? mutation.error.message : '헤더를 저장하지 못했습니다.'}</p> : null}
    <form className="mt-5 space-y-2 rounded-xl border border-border p-3" onSubmit={event => { event.preventDefault(); if (label.trim()) submit({ type: 'add', label, kind }) }}><h3 className="text-sm font-semibold">새 헤더 추가</h3><div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 space-y-1 text-sm">헤더 이름<Input aria-label="추가할 헤더 이름" value={label} maxLength={40} placeholder="예: 자격증" disabled={disabled} onChange={event => setLabel(event.target.value)} /></label><label className="space-y-1 text-sm">성격<Select aria-label="헤더 성격" value={kind} disabled={disabled} onChange={event => setKind(event.target.value as RosterColumnKind)}>{(['text','number','money'] as const).map(value => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}</Select></label><Button type="submit" disabled={disabled || !label.trim()}>헤더 추가</Button></div></form>
    <section aria-label="전체 헤더" className="mt-5 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">전체 헤더 · {headers.length}개</h3><Input aria-label="헤더 검색" placeholder="헤더 이름 검색" value={search} onChange={event => setSearch(event.target.value)} className="max-w-64" /></div><div className="max-h-[45dvh] space-y-2 overflow-y-auto pr-1">{loading || settingsLoading ? <p role="status">불러오는 중…</p> : !visible.length ? <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p> : visible.map(header => <HeaderRow key={`${header.key}:${header.label}:${header.hidden}`} header={header} disabled={disabled} onSave={next => submit({ type: 'setting', key: header.key, label: next, hidden: header.hidden })} onToggle={() => { if (header.hidden || window.confirm(`「${header.label}」 헤더를 표에서 삭제합니다. 직원 정보와 입력값은 보존되며 이 팝업에서 복원할 수 있습니다. 계속할까요?`)) submit({ type: 'setting', key: header.key, label: header.label, hidden: !header.hidden }) }} />)}</div></section>
    <p className="mt-3 text-xs text-muted-foreground">텍스트는 일반 내용, 숫자는 수치, 금액은 천 단위 쉼표로 표시합니다. 기존 헤더의 성격과 다른 화면의 데이터 연결은 바뀌지 않습니다.</p>
    <footer className="mt-5 flex justify-end"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>닫기</Button></footer>
  </dialog>
}

function HeaderRow({ header, disabled, onSave, onToggle }: { header: Header; disabled: boolean; onSave: (label: string) => void; onToggle: () => void }) {
  const [label, setLabel] = useState(header.label)
  return <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-border p-3${header.hidden ? ' bg-muted/30' : ''}`}><Input className="min-w-0 flex-1 basis-36" aria-label={`${header.label} 헤더 이름`} maxLength={40} value={label} disabled={disabled} onChange={event => setLabel(event.target.value)} /><Badge variant="outline">{header.basic ? '기본' : '추가'}</Badge><Badge variant="outline">{KIND_LABELS[header.kind]}</Badge>{header.hidden && <span className="text-xs text-muted-foreground">표에서 삭제됨</span>}<Button type="button" size="sm" variant="outline" disabled={disabled || !label.trim() || label.trim() === header.label} onClick={() => onSave(label)}>이름 저장</Button><Button type="button" size="sm" variant="outline" disabled={disabled} aria-label={`${header.label} 헤더 ${header.hidden ? '복원' : '삭제'}`} onClick={onToggle}>{header.hidden ? '복원' : '삭제'}</Button></div>
}
