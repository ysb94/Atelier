import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, FileText, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { DraftPhoto } from '@/features/drafts/DraftSheetRow'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { sampleElapsedDays, sampleTripSpanDays } from '@/lib/drafts/sample-work-order'
import { listChinaWorkAssignees } from '@/lib/supabase/china-work-assignees'
import { applyChinaWorkOrder } from '@/lib/supabase/china-work-orders'
import { listOrgChartMembers, type OrgChartMember } from '@/lib/supabase/profiles'
import { cn, emptyList, formatNumber } from '@/lib/utils'
import type { WorkOrderGroup, WorkOrderRow } from './work-order-types'

function roundClosed(row: Pick<WorkOrderRow, 'shipped' | 'passed' | 'receivedAt'>) {
  return Boolean(row.shipped || row.passed || row.receivedAt)
}

function assignTarget(rows: readonly WorkOrderRow[]) {
  return [...rows].reverse().find(row => !roundClosed(row)) ?? rows[rows.length - 1]
}

function openRound(rows: readonly WorkOrderRow[]) {
  return [...rows].reverse().find(row => !roundClosed(row))
}

function downloadWorkOrder(url: string, name: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = name.trim() || '작업 지시서'
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function assigneeError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/권한/.test(message)) return '중국팀 업무 권한이 있어야 담당자를 지정할 수 있습니다.'
  if (/다시 조회/.test(message)) return '다른 직원이 수정했습니다. 다시 조회해 주세요.'
  if (/재직/.test(message)) return '중국팀 재직 직원을 선택해 주세요.'
  if (/찾지 못했/.test(message)) return '지정할 회차를 찾지 못했습니다.'
  return '담당자를 저장하지 못했습니다.'
}

function firstAssignee(rows: readonly WorkOrderRow[]) {
  const assignment = rows[0]?.draft.specs.chinaWorkAssignment
  if (assignment?.assigneeId) return { id: assignment.assigneeId, name: assignment.assigneeName.trim() }
  const row = rows.find(item => item.assigneeId)
  return row?.assigneeId ? { id: row.assigneeId, name: row.assigneeName.trim() } : null
}

function AssigneePicker({ rows, draftId, onChoice }: { rows: readonly WorkOrderRow[]; draftId: string; onChoice: (draftId: string, choice: { assigneeId: string; saving: boolean }) => void }) {
  const queryClient = useQueryClient()
  const assigneesQuery = useQuery({ queryKey: ['china-work-assignees'], queryFn: listChinaWorkAssignees })
  const membersQuery = useQuery({ queryKey: ['org-chart-members'], queryFn: () => listOrgChartMembers() })
  const [pending, setPending] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const target = assignTarget(rows)
  const members = membersQuery.data ?? emptyList<OrgChartMember>()
  const names = new Map(members.map(member => [member.id, member.displayName?.trim() || '담당자']))
  const people = (assigneesQuery.data ?? emptyList<{ profileId: string; sortOrder: number }>()).map(row => ({ id: row.profileId, name: names.get(row.profileId) || '담당자' }))
  const fixed = firstAssignee(rows)
  const stillEmployed = Boolean(fixed && members.some(member => member.id === fixed.id))
  const locked = Boolean(fixed && (membersQuery.isPending || stillEmployed))
  const saved = locked && fixed ? fixed.id : (target?.assigneeId ?? '')
  const value = pending ?? saved
  const loading = assigneesQuery.isPending || membersQuery.isPending
  useEffect(() => { if (pending !== null && pending === saved) setPending(null) }, [pending, saved])
  useEffect(() => { onChoice(draftId, { assigneeId: value, saving }) }, [draftId, onChoice, saving, value])

  async function choose(next: string) {
    if (locked || !target || next === saved) { setPending(null); return }
    setPending(next)
    setSaving(true)
    setError('')
    const trace = startWorkflow('app', 'china_work_assign')
    try {
      trace.step('validate_input')
      await trace.run('save', () => applyChinaWorkOrder(target.draft, target.rowId, target.kind, 'assign', next || null))
      trace.step('refresh')
      await queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
      trace.done({ writeOutcome: 'committed' })
    } catch (cause) {
      trace.fail(cause)
      console.warn('[china-work] 담당자 지정 실패', { code: 'assign' })
      setPending(null)
      setError(assigneeError(cause))
    } finally {
      setSaving(false)
    }
  }

  return <div className="space-y-2">
    <Select aria-label="담당자" className="w-full" value={value} title={locked ? '처음 정한 담당자는 그 직원이 그만두기 전에는 바꾸지 않습니다.' : fixed && !stillEmployed ? '그만둔 담당자 대신 새 담당자를 선택할 수 있습니다.' : undefined} disabled={locked || saving || !target || loading || people.length === 0} onChange={event => void choose(event.target.value)}>
      <option value="">{loading ? '불러오는 중' : people.length === 0 ? '담당자 없음' : '담당자 미지정'}</option>
      {saved && !people.some(person => person.id === saved) ? <option value={saved}>{fixed?.name || names.get(saved) || '기존 담당자'}</option> : null}
      {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
    </Select>
    {error ? <p className="text-xs text-danger">{error}</p> : null}
  </div>
}

function fileTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function ChinaWorkOrderBoard({ groups, brandById, emptyMessage }: { groups: readonly WorkOrderGroup[]; brandById: ReadonlyMap<string, { name: string }>; emptyMessage: string }) {
  useRenderWatch('ChinaWorkOrderBoard')
  const queryClient = useQueryClient()
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [receiveError, setReceiveError] = useState('')
  const [shippingId, setShippingId] = useState<string | null>(null)
  const [shipError, setShipError] = useState('')
  const [choices, setChoices] = useState<Record<string, { assigneeId: string; saving: boolean }>>({})
  const [handingOffId, setHandingOffId] = useState<string | null>(null)
  const [handoffError, setHandoffError] = useState<{ draftId: string; message: string } | null>(null)
  const rememberChoice = useCallback((draftId: string, choice: { assigneeId: string; saving: boolean }) => {
    setChoices(current => {
      const previous = current[draftId]
      if (previous?.assigneeId === choice.assigneeId && previous.saving === choice.saving) return current
      return { ...current, [draftId]: choice }
    })
  }, [])

  async function receive(row: WorkOrderRow) {
    if (!row.url || roundClosed(row)) return
    downloadWorkOrder(row.url, row.fileName)
    if (row.fileCheckedAt) return
    setReceivingId(row.rowId)
    setReceiveError('')
    const trace = startWorkflow('app', 'china_work_check')
    try {
      trace.step('validate_input')
      await trace.run('save', () => applyChinaWorkOrder(row.draft, row.rowId, row.kind, 'check'))
      trace.step('refresh')
      await queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
      trace.done({ writeOutcome: 'committed' })
    } catch (cause) {
      trace.fail(cause)
      console.warn('[china-work] 작업 지시서 받기 실패', { code: 'check' })
      setReceiveError('파일을 받았지만 받기 기록을 저장하지 못했습니다.')
    } finally {
      setReceivingId(null)
    }
  }

  async function ship(row: WorkOrderRow) {
    if (!row.url || roundClosed(row)) return
    setShippingId(row.rowId)
    setShipError('')
    const trace = startWorkflow('app', 'china_work_ship')
    try {
      trace.step('validate_input')
      await trace.run('save', () => applyChinaWorkOrder(row.draft, row.rowId, row.kind, 'ship'))
      trace.step('refresh')
      await queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
      trace.done({ writeOutcome: 'committed' })
    } catch (cause) {
      trace.fail(cause)
      console.warn('[china-work] 샘플 발송 실패', { code: 'ship' })
      const message = assigneeError(cause)
      setShipError(message === '담당자를 저장하지 못했습니다.' ? '샘플 발송을 기획안에 저장하지 못했습니다.' : message)
    } finally {
      setShippingId(null)
    }
  }

  async function handoff(draft: WorkOrderRow['draft'], assigneeId: string) {
    if (!assigneeId) return
    setHandingOffId(draft.id)
    setHandoffError(null)
    const trace = startWorkflow('app', 'china_work_handoff')
    try {
      trace.step('validate_input')
      await trace.run('save', () => applyChinaWorkOrder(draft, '', 'sample', 'handoff', assigneeId))
      trace.step('refresh')
      await queryClient.invalidateQueries({ queryKey: ['product-drafts'] })
      trace.done({ writeOutcome: 'committed' })
    } catch (cause) {
      trace.fail(cause)
      console.warn('[china-work] 업무 배정 실패', { code: 'handoff' })
      const message = assigneeError(cause)
      setHandoffError({ draftId: draft.id, message: message === '담당자를 저장하지 못했습니다.' ? '업무를 배정하지 못했습니다.' : message })
    } finally {
      setHandingOffId(null)
    }
  }
  return <Card className="overflow-hidden">
    <div role="region" aria-label="중국팀 작업 지시서 목록" tabIndex={0} className="overflow-x-auto">
      <table className="w-full min-w-[1280px] table-fixed border-collapse text-sm">
        <colgroup><col className="w-[20%]" /><col className="w-[12%]" /><col className="w-[16%]" /><col className="w-[41%]" /><col className="w-[11%]" /></colgroup>
        <thead className="bg-primary text-primary-foreground">
          <tr>{['상품', '담당자 지정', '샘플차수', '파일', '업무배정'].map(label => <th key={label} scope="col" className="px-4 py-5 text-center font-medium">{label}</th>)}</tr>
        </thead>
        {groups.length === 0 && <tbody><tr><td colSpan={5} className="px-6 py-16 text-center text-muted-foreground">{emptyMessage}</td></tr></tbody>}
        {groups.map(({ draft, rows }) => {
          const brand = draft.brandId ? brandById.get(draft.brandId)?.name ?? '브랜드 미정' : '브랜드 미정'
          const current = openRound(rows)
          const choice = choices[draft.id]
          const assigneeId = choice?.assigneeId ?? assignTarget(rows)?.assigneeId ?? ''
          const workReady = Boolean(current?.fileCheckedAt) && Boolean(assigneeId) && !choice?.saving
          return <tbody key={draft.id} className="border-b border-primary/35 last:border-b-0" aria-label={`${draft.draftNo} 상품 묶음`}>
            {rows.map((row, index) => {
              const done = roundClosed(row)
              const canReceive = !done && Boolean(row.url)
              const receivedFile = Boolean(row.fileCheckedAt)
              const days = done ? sampleTripSpanDays(row.shippedAt, row.returnedAt || row.receivedAt) : sampleElapsedDays(row.shippedAt)
              const sent = fileTime(row.returnedAt)
              const received = fileTime(row.receivedAt)
              const registered = fileTime(row.shippedAt)
              const note = done ? row.failReason : row.focusReason
              return <tr key={`${row.kind}:${row.rowId}`} className="border-t border-border first:border-t-0">
                {index === 0 && <>
                  <td rowSpan={rows.length} className="border-r border-border px-4 py-3 align-middle">
                    <div className="flex items-center gap-3 [&>.draft-sheet-photo]:h-28 [&>.draft-sheet-photo]:w-20 [&>.draft-sheet-photo]:shrink-0">
                      <DraftPhoto src={draft.imageUrl} name={draft.nameEn.trim() || draft.nameKo.trim() || draft.draftNo} />
                      <div className="min-w-0 space-y-2">
                        <strong className="block break-words text-base">{brand}</strong>
                        <p className="text-xs text-muted-foreground">Designer <strong className="ml-1 text-foreground">{draft.owner.trim() || '미정'}</strong></p>
                        <strong className="block">No. {draft.draftNo}</strong>
                        <div className="space-y-1 pt-3 font-medium text-primary">
                          {draft.nameKo.trim() && <p className="break-words">{draft.nameKo}</p>}
                          {draft.nameEn.trim() && <p className="break-words">{draft.nameEn}</p>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td rowSpan={rows.length} className="border-r border-border px-3 py-3 text-center align-middle">
                    <AssigneePicker rows={rows} draftId={draft.id} onChoice={rememberChoice} />
                  </td>
                </>}
                <td className="border-r border-border px-3 py-3 align-middle">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><strong className="block font-medium">{row.stageLabel}</strong></div>
                    <span className={cn('shrink-0 whitespace-nowrap text-base font-semibold tabular-nums', done ? 'text-foreground' : 'text-primary')}>{days == null ? '기간 미등록' : `${done ? '' : '+ '}${formatNumber(days)} days`}</span>
                  </div>
                </td>
                <td className="border-r border-border px-3 py-3 align-middle">
                  <div className={cn('flex min-w-0 flex-wrap items-center gap-3', done && 'text-muted-foreground')}>
                    <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1 basis-32"><p className="break-all" title={row.fileName}>{row.url ? row.fileName : '작업 지시서 미등록'}</p><p className="mt-1 text-xs text-muted-foreground">{sent ? `${sent} 샘플 발송` : received ? `${received} 수령` : registered ? `${registered} 지시서 발송` : '발송일 미등록'}</p></div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" variant={receivedFile ? 'secondary' : 'outline'} size="sm" disabled={!canReceive || receivingId === row.rowId} onClick={() => void receive(row)} className={cn('disabled:opacity-100', receivedFile || done ? 'text-muted-foreground' : 'text-primary')}><Download className="size-3.5" aria-hidden="true" />받기</Button>
                      {done ? <Button type="button" variant="secondary" size="sm" disabled aria-pressed className="text-muted-foreground disabled:opacity-100"><Check className="size-3.5" aria-hidden="true" />발송 완료</Button> : <Button type="button" variant="outline" size="sm" disabled={!row.url || shippingId === row.rowId} onClick={() => void ship(row)} className="text-primary disabled:opacity-100"><Send className="size-3.5" aria-hidden="true" />발송 하기</Button>}
                    </div>
                  </div>
                  {receiveError && row.rowId === current?.rowId ? <p className="mt-3 text-xs text-danger">{receiveError}</p> : null}
                  {shipError && row.rowId === current?.rowId ? <p className="mt-3 text-xs text-danger">{shipError}</p> : null}
                  {note && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">진행 메모: {note}</p>}
                </td>
                {index === 0 && <td rowSpan={rows.length} className="px-3 py-3 text-center align-middle">
                  <Button type="button" variant="outline" disabled={!workReady || handingOffId === draft.id} title={current?.fileCheckedAt ? assigneeId ? '이 기획안의 과거 회차까지 선택한 담당자에게 배정합니다.' : '담당자를 선택한 뒤에 배정할 수 있습니다.' : '작업 지시서를 받은 뒤에 배정할 수 있습니다.'} onClick={() => void handoff(draft, assigneeId)} className="disabled:opacity-100">업무 배정</Button>
                  {handoffError?.draftId === draft.id ? <p className="mt-2 text-xs text-danger">{handoffError.message}</p> : null}
                </td>}
              </tr>
            })}
          </tbody>
        })}
      </table>
    </div>
  </Card>
}
