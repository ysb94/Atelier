import { useMemo, useState } from 'react'
import { ArrowRight, ClipboardCheck, ShieldCheck, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { OPERATIONS_SUPPORT_DEPARTMENT } from '@/lib/company/capabilities'
import { useOpsDirectory } from './ops-directory'
import { memberLabel, OpsPanelFrame } from './OpsStat'
import { useDepartmentApprovers } from './use-department-approvers'

type Draft = { responsibleId: string; substituteId: string; finalId: string }
const EMPTY_DRAFT: Draft = { responsibleId: '', substituteId: '', finalId: '' }

export function ApproverSelfRequestsPanel() {
  useRenderWatch('ApproverSelfRequestsPanel')
  const directory = useOpsDirectory()
  const approvals = useDepartmentApprovers()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [message, setMessage] = useState('')
  const opsDepartment = directory.departments.find(item => item.name.trim() === OPERATIONS_SUPPORT_DEPARTMENT)
  const opsMembers = useMemo(() => directory.members.filter(member => member.departmentId === opsDepartment?.id), [directory.members, opsDepartment?.id])
  const membersById = useMemo(() => new Map(directory.members.map(member => [member.id, member])), [directory.members])
  const approverCount = useMemo(() => new Set(approvals.settings.flatMap(item => [item.approverId, item.substituteId]).filter(id => id && membersById.has(id))).size, [approvals.settings, membersById])
  const unavailable = directory.loading || Boolean(directory.error)
  const name = (id: string, placeholder: string) => id ? memberLabel(membersById.get(id)?.displayName ?? null) : placeholder
  function change(key: keyof Draft, value: string) {
    setDraft(current => ({ ...current, [key]: value }))
    setMessage('')
  }
  function review() {
    if (!draft.responsibleId || !draft.finalId) { setMessage('운영지원 승인 책임자와 책임자 본인의 승인자를 선택해 주세요.'); return }
    if (draft.responsibleId === draft.substituteId || draft.finalId === draft.responsibleId || draft.finalId === draft.substituteId) { setMessage('책임자·대체 담당자·책임자 본인의 승인자는 서로 다른 사람으로 선택해 주세요.'); return }
    setMessage('선택한 흐름을 시안에서 확인했습니다. 아직 저장되거나 실제 승인 담당자로 적용되지는 않습니다.')
  }
  const fields = [
    { key: 'responsibleId', title: '운영지원 승인 책임자', detail: '부서 승인자가 본인 연차·야근을 신청했을 때 확인·승인합니다.', optional: false, icon: UserCheck },
    { key: 'substituteId', title: '대체 담당자', detail: '책임자 부재 시 대신 처리합니다. 본인 신청은 직접 승인하지 않습니다.', optional: true, icon: ShieldCheck },
    { key: 'finalId', title: '책임자 본인의 승인자', detail: '운영지원 책임자·대체 담당자의 본인 신청을 처리할 임원 등 별도 책임자입니다.', optional: false, icon: ClipboardCheck },
  ] as const
  return <OpsPanelFrame>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">승인자 본인 신청 담당</h2><p className="mt-1 text-sm text-muted-foreground">승인자의 연차·야근은 운영지원이 확인·승인하고, 처리 이력을 남기는 구조입니다.</p></div><span className="rounded-full border border-warning/30 bg-warning/5 px-3 py-1 text-xs text-warning">구성 시안 · 실제 승인 경로 미적용</span></header>
    <div className="grid gap-4 lg:grid-cols-3">{fields.map((field, index) => {
      const candidates = field.key === 'finalId' ? directory.members : opsMembers
      return <section key={field.key} className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm"><header className="mb-4 flex items-center gap-2 text-primary"><field.icon size={17}/><span className="text-xs font-medium">0{index + 1}</span></header><h3 className="text-sm font-semibold">{field.title}{field.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">선택</span>}</h3><p className="mt-2 min-h-12 text-xs leading-6 text-muted-foreground">{field.detail}</p><label className="mt-4 block text-xs text-muted-foreground">담당자 선택<Select className="mt-2 w-full" aria-label={field.title} value={draft[field.key]} disabled={unavailable || !approvals.canEdit} onChange={event => change(field.key, event.target.value)}><option value="">{directory.loading ? '직원 불러오는 중…' : '담당자 미지정'}</option>{candidates.map(member => <option key={member.id} value={member.id}>{memberLabel(member.displayName)} · {directory.departmentName(member.departmentId)}{member.position ? ` · ${member.position}` : ''}</option>)}</Select></label><p className="mt-3 text-[11px] text-muted-foreground">{field.key === 'finalId' ? '같은 회사의 재직 직원 중 지정합니다.' : '운영지원팀에 등록된 직원 중 지정합니다.'}</p></section>
    })}</div>
    {!directory.loading && !directory.error && !opsMembers.length && <div className="rounded-xl border border-warning/25 bg-warning/5 p-4 text-sm"><strong className="font-medium">운영지원팀에 등록된 직원이 없습니다.</strong><p className="mt-1 text-xs text-muted-foreground">운영지원의 조직도에서 직원 소속을 배치하면 책임자와 대체 담당자를 선택할 수 있습니다.</p></div>}
    {directory.error && <p role="alert" className="text-sm text-danger">직원 목록을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={directory.refetch}>다시 불러오기</Button></p>}
    <section aria-label="승인 흐름 미리보기" className="rounded-xl border border-border bg-card p-5 shadow-sm"><header className="mb-4"><h3 className="text-sm font-semibold">승인 흐름 미리보기</h3><p className="mt-1 text-xs text-muted-foreground">연차·반차·반반차·야근 공통 · 부서 승인자{approvals.loading ? ' 확인 중' : approvals.error ? ' 조회 실패' : ` ${approverCount}명`}</p></header><div className="divide-y divide-border/60">{[
      { applicant: '일반 직원', target: '부서별 지정 승인자', note: '기존 부서별 설정 적용' },
      { applicant: '부서 승인자 본인', target: name(draft.responsibleId, '운영지원 승인 책임자'), note: '운영지원 확인·승인' },
      { applicant: '운영지원 책임자·대체 담당자 본인', target: name(draft.finalId, '별도 지정 책임자'), note: '본인 승인 금지' },
    ].map(row => <div key={row.applicant} className="flex flex-wrap items-center gap-3 py-4 text-sm"><span className="w-full font-medium sm:w-64">{row.applicant}</span><ArrowRight size={15} className="text-muted-foreground"/><span>{row.target}</span><span className="ml-auto rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{row.note}</span></div>)}</div>{draft.substituteId && <p className="mt-2 text-xs text-muted-foreground">책임자 부재 시 {name(draft.substituteId, '대체 담당자')} 담당 · 대체 담당자 본인 신청은 별도 책임자에게 전달</p>}</section>
    <section className="rounded-xl border border-primary/15 bg-primary/5 p-5"><h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck size={16}/>운영지원 확인·승인 후 처리 이력이 남습니다.</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">신청 내용과 함께 누가, 언제, 어떤 의견으로 처리했는지 확인하는 구성입니다.</p><div className="mt-3 flex flex-wrap gap-2">{['신청자·신청 내용', '승인·반려 결과', '실제 처리자', '처리 시각', '처리 의견'].map(label => <span key={label} className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">{label}</span>)}</div></section>
    {message && <p role="status" className="rounded-xl border border-border bg-muted/40 p-4 text-sm">{message}</p>}
    <footer className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">이 영역은 화면 구성을 확인하는 시안입니다. 기존 부서 승인자 설정은 그대로 유지됩니다.</p><div className="flex gap-2"><Button variant="outline" onClick={() => { setDraft(EMPTY_DRAFT); setMessage('') }}>선택 초기화</Button><Button disabled={unavailable || !approvals.canEdit || !opsMembers.length} onClick={review}>구성 확인 · 시안</Button></div></footer>
  </OpsPanelFrame>
}
