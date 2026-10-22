import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { DraftNotice, memberLabel, OpsPanelFrame } from './OpsStat'
import { useOpsDirectory } from './ops-directory'

const OUTPUT_KIND_LABEL = {
  leave: '연차 현황',
  attendance: '월별 근태',
  decisions: '신청 처리 내역',
} as const

const OUTPUT_KIND_ORDER = ['leave', 'attendance', 'decisions'] as const

type OutputKind = (typeof OUTPUT_KIND_ORDER)[number]

const OUTPUT_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatOutputMonth(value: string) {
  const [periodYear, periodMonth] = value.split('-')
  return `${periodYear}년 ${Number(periodMonth)}월`
}

export function DocumentOutputPanel() {
  useRenderWatch('DocumentOutputPanel')
  const directory = useOpsDirectory()
  const currentYear = new Date().getFullYear()
  const [kind, setKind] = useState<OutputKind>('leave')
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()))
  const [month, setMonth] = useState(currentMonth)
  const [memberId, setMemberId] = useState('')

  const members = useMemo(
    () => [...directory.members].sort((left, right) =>
      directory.departmentName(left.departmentId).localeCompare(directory.departmentName(right.departmentId), 'ko')
      || memberLabel(left.displayName).localeCompare(memberLabel(right.displayName), 'ko'),
    ),
    [directory.departmentName, directory.members],
  )
  const memberById = useMemo(
    () => new Map(directory.members.map((member) => [member.id, member])),
    [directory.members],
  )

  const selectedMember = memberId ? memberById.get(memberId) : undefined
  const memberSelectDisabled = directory.loading || Boolean(directory.error)
  const memberUnresolved = memberId !== '' && !directory.loading && !directory.error && !selectedMember
  const targetName = memberId === ''
    ? '전체 직원'
    : selectedMember
      ? memberLabel(selectedMember.displayName)
      : directory.loading || directory.error
        ? '직원 확인 중'
        : '대상 재선택 필요'
  const targetDepartment = memberId === ''
    ? '전체'
    : selectedMember
      ? directory.departmentName(selectedMember.departmentId)
      : '—'

  function applyMonth(value: string) {
    if (!OUTPUT_MONTH.test(value)) return
    setMonth(value)
  }

  return (
    <OpsPanelFrame>
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-base font-semibold">서류 출력</h2>
          <span className="rounded-full border border-warning/30 bg-warning/5 px-3 py-1 text-xs text-warning">서류 양식 대기 · UI 시안</span>
        </div>
        <DraftNotice>
          서류 양식을 받은 뒤 실제 미리보기와 인쇄를 연결합니다. 현재는 출력 조건을 확인하는 화면입니다.
        </DraftNotice>
      </header>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <p id="document-output-kind-label" className="text-xs text-muted-foreground">출력 종류</p>
        <div role="group" aria-labelledby="document-output-kind-label" className="mt-2 flex flex-col gap-2 sm:flex-row">
          {OUTPUT_KIND_ORDER.map((id) => (
            <Button
              key={id}
              type="button"
              className="w-full sm:w-auto"
              variant={kind === id ? 'default' : 'outline'}
              aria-pressed={kind === id}
              onClick={() => setKind(id)}
            >
              {OUTPUT_KIND_LABEL[id]}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          연차 현황·월별 근태·신청 처리 내역은 확정된 서류가 아닌 구성 시안입니다.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {kind === 'leave' ? (
            <label htmlFor="document-output-year" className="block text-xs text-muted-foreground">
              연도
              <Select
                id="document-output-year"
                className="mt-2 w-full"
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
              >
                {[currentYear - 1, currentYear, currentYear + 1].map((item) => (
                  <option key={item} value={String(item)}>{item}년</option>
                ))}
              </Select>
            </label>
          ) : (
            <label htmlFor="document-output-month" className="block text-xs text-muted-foreground">
              월
              <Input
                id="document-output-month"
                className="mt-2 w-full"
                type="month"
                value={month}
                onChange={(event) => applyMonth(event.target.value)}
              />
            </label>
          )}

          <label htmlFor="document-output-member" className="block text-xs text-muted-foreground">
            직원
            <Select
              id="document-output-member"
              className="mt-2 w-full"
              value={memberId}
              disabled={memberSelectDisabled}
              onChange={(event) => setMemberId(event.target.value)}
            >
              <option value="">전체 직원</option>
              {memberUnresolved ? <option value={memberId}>현재 명단에 없음</option> : null}
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberLabel(member.displayName)} · {directory.departmentName(member.departmentId)}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {directory.error ? (
          <div role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3">
            <p className="text-sm text-danger">직원 목록을 불러오지 못했습니다.</p>
            <Button type="button" className="mt-3" size="sm" variant="outline" onClick={directory.refetch}>다시 불러오기</Button>
          </div>
        ) : directory.loading ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">직원 목록을 불러오는 중입니다.</p>
        ) : directory.members.length === 0 ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">등록된 직원이 없습니다.</p>
        ) : null}
        {memberUnresolved ? (
          <p role="status" className="mt-4 text-sm text-warning">선택한 직원이 현재 명단에 없습니다. 대상을 다시 선택해 주세요.</p>
        ) : null}
      </section>

      <section aria-label="선택 조건 요약" className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold">선택 조건</h3>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
            <dt className="text-xs text-muted-foreground">종류</dt>
            <dd className="mt-1 text-sm font-medium">{OUTPUT_KIND_LABEL[kind]} · 구성 시안</dd>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{kind === 'leave' ? '연도' : '월'}</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">{kind === 'leave' ? `${selectedYear}년` : formatOutputMonth(month)}</dd>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
            <dt className="text-xs text-muted-foreground">대상</dt>
            <dd className="mt-1 text-sm font-medium">{targetName}</dd>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
            <dt className="text-xs text-muted-foreground">부서</dt>
            <dd className="mt-1 text-sm font-medium">{targetDepartment}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-dashed border-border bg-muted/30 px-5 py-8">
        <h3 className="text-sm font-semibold">서류 미리보기 자리</h3>
        <p className="mt-3 text-sm text-muted-foreground">출력 양식 미등록</p>
      </section>

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" disabled aria-describedby="document-output-print-reason">
          <Printer aria-hidden="true" size={14} />
          인쇄
        </Button>
        <p id="document-output-print-reason" className="text-sm text-muted-foreground">서류 양식이 준비되면 인쇄할 수 있습니다.</p>
      </div>
    </OpsPanelFrame>
  )
}
