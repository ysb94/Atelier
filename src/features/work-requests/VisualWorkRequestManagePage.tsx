import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { listOrgChartMembers } from '@/lib/supabase/profiles'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import { saveWorkRequestSettings, useWorkRequestSettings } from '@/lib/supabase/work-request-settings'
import { emptyList } from '@/lib/utils'
import { WORK_REQUEST_DEPARTMENT_IDS } from './work-request-form-config'
import { validateVisualSettings, type VisualCategory, type VisualField } from './visual-request-config'

function VisualWorkRequestManageForm() {
  useRenderWatch('VisualWorkRequestManagePage')
  const { profile } = useAuth()
  const settings = useWorkRequestSettings()
  const access = useBasicWorkAccess()
  const client = useQueryClient()
  const directory = useQuery({ queryKey: ['orgChartMembers', profile?.id], queryFn: listOrgChartMembers, enabled: profile?.status === 'active', retry: false })
  const members = (directory.data ?? emptyList()).filter(member => member.departmentId === WORK_REQUEST_DEPARTMENT_IDS.design)
  const [draft, setDraft] = useState<{ revision: number; categories: VisualCategory[]; supervisors: string[] } | null>(null)
  const [selectedId, setSelectedId] = useState('image')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const categories = draft?.categories ?? settings.data?.categories ?? emptyList<VisualCategory>()
  const supervisors = draft?.supervisors ?? settings.data?.supervisorIds ?? emptyList<string>()
  const supervisorIds = new Set(supervisors)
  const membersById = new Map(members.map(member => [member.id, member]))
  const supervisorCandidates = members.filter(member => !supervisorIds.has(member.id))
  const finalApprovalAvailable = settings.data?.supervisorIds !== undefined
  const selected = categories.find(item => item.id === selectedId) ?? categories[0]
  const canManage = settings.data?.canManage ?? Boolean(access.access?.manageOwners.includes('design'))
  const editable = canManage && !saving && !settings.isFetching && !settings.isError
  function change(next: VisualCategory[], nextSupervisors = supervisors) {
    setDraft({ revision: draft?.revision ?? settings.data?.revision ?? 0, categories: next, supervisors: nextSupervisors })
    setMessage('')
  }
  function update(patch: Partial<VisualCategory>) {
    if (selected) change(categories.map(item => item.id === selected.id ? { ...item, ...patch } : item))
  }
  async function save() {
    if (!draft || saving || !settings.data?.available) return
    const trace = startWorkflow('app', 'visual_work_settings_save')
    trace.step('validate_input')
    const error = validateVisualSettings(draft.categories)
    if (error) { trace.block('invalid_categories'); setMessage(error); return }
    if (settings.data.supervisorIds?.length && draft.supervisors.length === 0) {
      trace.block('no_supervisor'); setMessage('총괄 관리자를 한 명 이상 지정해 주세요.'); return
    }
    setSaving(true)
    try {
      await trace.run('save', context => saveWorkRequestSettings(draft.categories, draft.revision, finalApprovalAvailable ? draft.supervisors : undefined, context))
      await trace.run('refresh_queries', () => client.invalidateQueries({ queryKey: ['work-request-settings', profile?.id] }), { writeOutcome: 'committed' })
      trace.done({ writeOutcome: 'committed' })
      setDraft(null)
      setMessage('작업 요청 설정을 저장했습니다.')
    } catch (error) {
      trace.fail(error)
      setMessage(error instanceof Error ? error.message : '설정을 저장하지 못했습니다.')
    } finally { setSaving(false) }
  }
  return (
    <div>
      <PageHeader
        title="작업 요청 관리"
        description="총괄 관리자와 작업 분류별 중간 관리자, 요청 입력 양식을 설정합니다."
        actions={<Button disabled={!draft || !editable || !settings.data?.available} onClick={() => void save()}>{saving ? '저장 중…' : '설정 저장'}</Button>}
      />
      {settings.isPending ? <p role="status">설정을 불러오는 중…</p> : null}
      {settings.error || directory.error ? <p role="alert" className="mb-4 text-sm text-danger">{settings.error?.message ?? directory.error?.message}<Button variant="outline" size="sm" onClick={() => { void settings.refetch(); void directory.refetch() }}>다시 조회</Button></p> : null}
      {settings.data && !settings.data.available ? <p role="status" className="mb-4 text-sm text-warning">서버 설정 연결이 아직 적용되지 않았습니다. 입력 구성을 확인할 수 있으며 서버 적용 후 저장할 수 있습니다.</p> : null}
      {!canManage && !settings.isPending ? <p className="mb-4 text-sm text-muted-foreground">설정 변경은 기존 Visual 업무 관리 담당자만 할 수 있습니다.</p> : null}
      {message ? <p role="status" className="mb-4 text-sm">{message}</p> : null}
      {draft && settings.data && draft.revision !== settings.data.revision ? <p role="alert" className="mb-4 text-sm text-warning">다른 관리자가 설정을 변경했습니다. 작성 중인 값은 유지됩니다. 다시 불러온 뒤 변경 내용을 확인하세요.</p> : null}
      <Card className="mb-5"><CardContent className="space-y-3 p-5">
        <h2 className="font-semibold">총괄 관리자 설정</h2>
        <p className="text-sm text-muted-foreground">요청자가 결과를 확인한 뒤, 해당 업무에 배정된 총괄 관리자가 최종 승인합니다. 한 명이면 자동 지정되며, 여러 명이면 업무별로 한 명씩 나눠 배정할 수 있습니다.</p>
        <fieldset disabled={!editable || !finalApprovalAvailable || directory.isPending || directory.isError} className="min-w-0 space-y-3">
          {supervisors.length > 0 && <ul aria-label="설정된 총괄 관리자" className="flex flex-wrap gap-2">
            {supervisors.map(id => {
              const member = membersById.get(id)
              const name = member ? member.displayName || '직원' : '기존 총괄 관리자 · 현재 배정 불가'
              return <li key={id} className="inline-flex max-w-full items-center gap-2 rounded-md border border-border pl-2 text-sm">
                <span className="break-all">{name}</span>
                <Button type="button" variant="ghost" size="sm" className="shrink-0" aria-label={`${name} 총괄 관리자 해제`} onClick={() => change(categories, supervisors.filter(supervisor => supervisor !== id))}><Trash2 className="size-4" /></Button>
              </li>
            })}
          </ul>}
          <label className="block max-w-sm space-y-1 text-sm">총괄 관리자 추가
            <Select aria-label="총괄 관리자 추가" className="w-full" value="" disabled={!supervisorCandidates.length} onChange={event => change(categories, [...supervisors, event.target.value])}>
              <option value="" disabled>Visual 직원 선택</option>
              {supervisorCandidates.map(member => <option key={member.id} value={member.id}>{member.displayName || '직원'}{member.position ? ` · ${member.position}` : ''}</option>)}
            </Select>
          </label>
        </fieldset>
        {settings.data && !finalApprovalAvailable && <p className="text-sm text-warning">총괄 관리자 설정은 서버 적용 후 저장할 수 있습니다.</p>}
      </CardContent></Card>
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Card><CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold">작업 분류</h2><Button size="sm" variant="outline" disabled={!editable || categories.length >= 40} onClick={() => {
            const id = crypto.randomUUID()
            change([...categories, { id, label: `새 분류 ${categories.length + 1}`, enabled: true, assigneeId: '', fields: [] }]); setSelectedId(id)
          }}><Plus className="size-3.5" />추가</Button></div>
          {categories.map(category => <button key={category.id} type="button" aria-pressed={selected?.id === category.id} onClick={() => setSelectedId(category.id)} className={`flex w-full justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === category.id ? 'border-primary bg-primary/5' : 'border-border'}`}><span className="break-all">{category.label}</span><span className="shrink-0 text-xs text-muted-foreground">{!category.enabled ? '숨김' : category.assigneeId ? '자동 배정' : '관리자 배정'}</span></button>)}
          <Button variant="ghost" size="sm" disabled={!draft || saving} onClick={() => { if (window.confirm('작성 중인 설정을 지우고 다시 불러올까요?')) { setDraft(null); void settings.refetch() } }}>다시 불러오기</Button>
        </CardContent></Card>
        {selected ? <fieldset disabled={!editable} className="min-w-0 space-y-5">
          <Card><CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-40 flex-1 space-y-1 text-sm">분류 이름<Input value={selected.label} maxLength={80} onChange={event => update({ label: event.target.value })} /></label>
              <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={selected.enabled} onChange={event => update({ enabled: event.target.checked })} />등록 화면에 표시</label>
              <Button variant="outline" size="sm" onClick={() => { if (window.confirm('이 분류를 설정에서 삭제할까요? 이미 등록된 요청과 첨부는 유지됩니다.')) change(categories.filter(item => item.id !== selected.id)) }}><Trash2 className="size-3.5" />분류 삭제</Button>
            </div>
            <label className="block space-y-1 text-sm">기본 중간 관리자<Select className="w-full" value={selected.assigneeId} disabled={directory.isPending || directory.isError} onChange={event => update({ assigneeId: event.target.value })}><option value="">미지정 · 관리자가 배정</option>{selected.assigneeId && !members.some(member => member.id === selected.assigneeId) ? <option value={selected.assigneeId}>기존 중간 관리자 · 현재 배정 불가</option> : null}{members.map(member => <option key={member.id} value={member.id}>{member.displayName || '직원'}{member.position ? ` · ${member.position}` : ''}</option>)}</Select></label>
            <p className="text-xs text-muted-foreground">지정한 중간 관리자는 새 요청의 해당 분류에 자동 배정됩니다. 미지정·퇴사·부서 이동 시 관리자 배정을 기다립니다.</p>
          </CardContent></Card>
          <Card><CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between"><h2 className="font-semibold">분류별 입력 양식</h2><Button variant="outline" size="sm" disabled={selected.fields.length >= 30} onClick={() => update({ fields: [...selected.fields, { id: crypto.randomUUID(), label: '', type: 'text', required: false, placeholder: '' }] })}><Plus className="size-3.5" />항목 추가</Button></div>
            <p className="text-xs text-muted-foreground">공통 메인 내용은 항상 표시됩니다. 아래 입력 항목과 별도로 분류별 자유 내용·이미지·파일 첨부 영역을 제공합니다.</p>
            {!selected.fields.length ? <p className="py-6 text-sm text-muted-foreground">등록된 입력 항목이 없습니다. 자유 내용과 첨부만 표시됩니다.</p> : null}
            {selected.fields.map((field, index) => {
              const changeField = (patch: Partial<VisualField>) => update({ fields: selected.fields.map(item => item.id === field.id ? { ...item, ...patch } : item) })
              return <div key={field.id} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-40 flex-1 space-y-1 text-xs">항목 이름<Input value={field.label} maxLength={100} onChange={event => changeField({ label: event.target.value })} placeholder="예: 적용 채널" /></label>
                  <label className="space-y-1 text-xs">입력 방식<Select value={field.type} onChange={event => changeField({ type: event.target.value as VisualField['type'] })}><option value="text">짧은 글</option><option value="textarea">긴 글</option><option value="number">숫자</option><option value="date">날짜</option></Select></label>
                  <label className="flex items-center gap-1 py-2 text-xs"><input type="checkbox" checked={field.required} onChange={event => changeField({ required: event.target.checked })} />필수</label>
                  <Button variant="ghost" size="sm" aria-label={`${index + 1}번 항목 삭제`} onClick={() => update({ fields: selected.fields.filter(item => item.id !== field.id) })}><Trash2 className="size-4" /></Button>
                  <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => { const fields = [...selected.fields]; [fields[index - 1], fields[index]] = [fields[index]!, fields[index - 1]!]; update({ fields }) }}>위로</Button>
                </div>
                <label className="block space-y-1 text-xs">입력 안내<Textarea rows={2} value={field.placeholder} maxLength={300} onChange={event => changeField({ placeholder: event.target.value })} placeholder="요청자에게 보여줄 안내 문구" /></label>
              </div>
            })}
          </CardContent></Card>
        </fieldset> : null}
      </div>
    </div>
  )
}

export function VisualWorkRequestManagePage() {
  const { profile } = useAuth()
  return <VisualWorkRequestManageForm key={profile?.id ?? 'guest'} />
}
