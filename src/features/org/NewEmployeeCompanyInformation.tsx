import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { loadOnboardingCompanyInformation } from '@/lib/supabase/onboarding-company-information'
import { rosterChoiceValues, type RosterChoiceKey } from '@/lib/company/roster-choices'
import { useRosterChoiceSettings } from './use-roster-choice-settings'
import { CALCULATED_PERIOD_KEYS, CALCULATED_WAGE_KEYS, WAGE_PLANS, calculateCompanyPeriods, calculateCompanyWage, fillCompanyInformation, splitWorkTime } from './company-information-values'
import { WagePlanHelp } from './WagePlanHelp'

const FIELDS = {
  employerName: ['사업체명', 'text'], representative: ['대표자', 'text'], employerAddress: ['사업장 소재지', 'textarea'],
  employeeNumber: ['사원번호', 'text'], departmentId: ['부서', 'department'], position: ['직책', 'duty'], jobGrade: ['직급', 'grade'], hireDate: ['입사일', 'date'],
  workplace: ['근로장소', 'choice'], employmentType: ['근로형태', 'choice'], jobDescription: ['업무내용', 'textarea'],
  contractTerm: ['근로계약 기간 구분', 'term'], contractMonths: ['근로계약기간', 'months'], contractStart: ['근로계약 시작일', 'date'], contractEnd: ['근로계약 종료일', 'date'],
  wageTerm: ['연봉계약 기간 구분', 'wageTerm'], wageMonths: ['연봉계약기간', 'months'], wageStart: ['연봉계약 시작일', 'date'], wageEnd: ['연봉계약 종료일', 'date'],
  probationApply: ['수습 적용', 'probation'], probationMonths: ['수습기간', 'months'], probationStart: ['수습 시작일', 'date'], probationEnd: ['수습 종료일', 'date'],
  probationPayRate: ['수습 급여 적용 비율 (%)', 'number'], documentDate: ['근로계약서 작성일', 'date'], periodMode: ['기간 입력 방식', 'periodMode'],
  workDays: ['근로일', 'choice'], workHours: ['근로시간', 'choice'], breakTime: ['휴게시간', 'choice'],
  workStart: ['시업시각', 'time'], workEnd: ['종업시각', 'time'], breakStart: ['휴게시작', 'time'], breakEnd: ['휴게종료', 'time'],
  weeklyHoliday: ['주휴일', 'text'], payDay: ['급여 지급일', 'payDay'],
  payBasis: ['연봉기준', 'choice'], wageMode: ['임금 입력 방식', 'wageMode'], fixedOvertimePlan: ['근로유형', 'wagePlan'], annualSalary: ['연봉', 'money'],
  monthlyWage: ['월급여 (2026 기준)', 'money'], basePay: ['기본급', 'money'], baseHours: ['소정근로', 'number'],
  mealAllowance: ['식대', 'money'], carAllowance: ['자가운전보조비', 'money'], researchAllowance: ['연구개발비', 'money'], childcareAllowance: ['육아수당', 'money'], dutyAllowance: ['직책수당', 'money'],
  overtimeHours: ['연장근로', 'number'], overtimeAllowance: ['연장수당', 'money'],
  nightHours: ['야간근로', 'number'], nightAllowance: ['야간수당', 'money'], holidayHours: ['휴일근로', 'number'], holidayAllowance: ['휴일수당', 'money'],
  annualLeaveHours: ['연차미사용', 'number'], annualLeaveAllowance: ['연차미사용수당', 'money'],
} as const
export type CompanyInformation = Record<keyof typeof FIELDS, string>
type FieldKey = keyof CompanyInformation
const HOUR_UNITS: Partial<Record<FieldKey, string>> = {
  baseHours: '시간/월', overtimeHours: '산정시간/월 · 1.5배 가산', nightHours: '산정시간/월', holidayHours: '산정시간/월', annualLeaveHours: '산정시간/월',
}
function fieldUnit(key: FieldKey) {
  return FIELDS[key][1] === 'money' ? key === 'annualSalary' ? '원/년' : '원/월' : FIELDS[key][1] === 'months' ? '개월' : HOUR_UNITS[key]
}
type Person = { id: string; displayName: string | null; departmentId: string | null; position: string | null; jobGrade: string | null; hireDate: string | null; status: string }
const COMMON_DEFAULTS: Partial<CompanyInformation> = {
  employerName: '주식회사 에스앤디', representative: '김준영',
  employerAddress: '시흥본사: 경기도 시흥시 산기대학로 27, 136호(정왕동, 라성아카데미벤처)\n서울사무소: 서울 금천구 가산디지털1로 204 (가산동) 가산반도아이비밸리 1607호',
  contractTerm: 'fixed', contractMonths: '3', wageTerm: 'until-change', wageMonths: '12', probationApply: 'yes', probationMonths: '3',
  weeklyHoliday: '일요일', payDay: '말일',
}
const FORMULAS: Partial<Record<FieldKey, string>> = {
  contractStart: '입사일에서 가져옴', contractEnd: '시작일 + 계약 개월 수 − 1일', wageStart: '입사일과 근로계약서 작성일 중 늦은 날짜', wageEnd: '연봉계약 시작일 + 개월 수 − 1일',
  probationStart: '입사일에서 가져옴', probationEnd: '입사일 + 수습 개월 수 − 1일',
  monthlyWage: '연봉 ÷ 12개월', basePay: '월급여 − 별도 수당 − 연장수당', baseHours: '(주 40시간 + 주휴 8시간) × 365 ÷ 12 ÷ 7, 반올림',
  overtimeHours: '유형별 주 연장시간 × 365 ÷ 12 ÷ 7 × 1.5', overtimeAllowance: '연장수당 산정시간 × 통상시급',
  nightHours: '현재 엑셀 유형은 미반영', nightAllowance: '야간 산정시간 × 통상시급', holidayHours: '현재 엑셀 유형은 미반영', holidayAllowance: '휴일 산정시간 × 통상시급',
  annualLeaveHours: '현재 엑셀 유형은 미반영', annualLeaveAllowance: '연차미사용 산정시간 × 통상시급',
}
function initialInformation(person: Person): CompanyInformation {
  return {
    ...Object.fromEntries(Object.keys(FIELDS).map(key => [key, ''])),
    ...COMMON_DEFAULTS,
    departmentId: person.departmentId ?? '', position: person.position ?? '', jobGrade: person.jobGrade ?? '', hireDate: person.hireDate ?? '',
    periodMode: 'auto', wageMode: 'excel',
  } as CompanyInformation
}

export function NewEmployeeCompanyInformation({ person, rosterProfileId = person.id, isTest = false, saved, departments, duties, grades, canEdit, busy, error, onApply, onClose }: {
  person: Person; saved?: CompanyInformation; departments: { id: string; name: string }[]; duties: string[]; grades: string[]; rosterProfileId?: string; isTest?: boolean
  onApply: (value: CompanyInformation) => void; onClose: () => void; canEdit: boolean; busy: boolean; error: string | null
}) {
  const dialog = useRef<HTMLDialogElement>(null), form = useRef<HTMLFormElement>(null)
  const { profile } = useAuth(), choices = useRosterChoiceSettings(canEdit)
  const roster = useQuery({ queryKey: ['onboarding-company-information', profile?.companyId, profile?.id, rosterProfileId], queryFn: () => loadOnboardingCompanyInformation(rosterProfileId, profile!.companyId!), enabled: !isTest && canEdit && profile?.status === 'active' && Boolean(profile.companyId), retry: false, refetchOnWindowFocus: false })
  const touched = useRef(new Set<string>()), title = useId()
  const [draft, setValue] = useState(() => ({ ...initialInformation(person), ...saved,
    // 이전 시안에서 직접 입력한 날짜와 금액은 자동 계산으로 덮어쓰지 않는다.
    ...(saved && !saved.periodMode ? { periodMode: 'manual', wageTerm: '', probationApply: '' } : {}),
    ...(saved && !saved.wageMode ? { wageMode: 'manual' } : {}),
  }))
  const [customFields, setCustomFields] = useState<string[]>([])
  const calculation = calculateCompanyWage(calculateCompanyPeriods(draft)), value = calculation.value
  useEffect(() => { if (!saved && roster.data) setValue(current => fillCompanyInformation(current, roster.data!, touched.current)) }, [saved, roster.data])
  useEffect(() => { dialog.current?.showModal() }, [])
  function change(key: FieldKey, text: string) {
    touched.current.add(key)
    if (key === 'workHours' || key === 'breakTime') {
      const [start, end] = splitWorkTime(text), keys = key === 'workHours' ? ['workStart', 'workEnd'] as const : ['breakStart', 'breakEnd'] as const
      keys.forEach(item => touched.current.add(item))
      setValue(current => ({ ...current, [key]: text, [keys[0]]: start, [keys[1]]: end })); return
    }
    if (['workStart', 'workEnd', 'breakStart', 'breakEnd'].includes(key)) {
      const selector = key.startsWith('work') ? 'workHours' : 'breakTime'; touched.current.add(selector)
      setValue(current => ({ ...current, [key]: text, [selector]: '' })); return
    }
    if (key === 'wageMode' || key === 'periodMode') { setValue({ ...value, [key]: text }); return }
    setValue(current => ({ ...current, [key]: text }))
  }
  function input(key: FieldKey) {
    const [label, kind] = FIELDS[key], disabled = busy || !canEdit
    const imported = !touched.current.has(key) && Boolean(value[key]) && (roster.data?.[key] === value[key] || (key === 'departmentId' || key === 'position' || key === 'jobGrade' || key === 'hireDate') && person[key] === value[key])
    const origin = imported ? '직원 배치에서 가져옴' : !touched.current.has(key) && COMMON_DEFAULTS[key] === value[key] && value[key] ? '양식 기본값' : '직접 입력'
    const options = kind === 'department' ? departments.map(item => ({ value: item.id, label: item.name }))
      : kind === 'duty' || kind === 'grade' ? [...new Set([...(kind === 'duty' ? duties : grades), ...(value[key] ? [value[key]] : [])])].map(item => ({ value: item, label: item }))
      : kind === 'term' ? [{ value: 'indefinite', label: '기간의 정함 없음' }, { value: 'fixed', label: '개월 수 지정' }]
      : kind === 'wageTerm' ? [{ value: 'until-change', label: '변경 시까지' }, { value: 'fixed', label: '개월 수 지정' }]
      : kind === 'probation' ? [{ value: 'yes', label: '수습 적용' }, { value: 'no', label: '수습 미적용' }]
      : kind === 'payDay' ? [{ value: '말일', label: '매월 말일' }, ...Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: `매월 ${index + 1}일` }))]
      : kind === 'periodMode' ? [{ value: 'auto', label: '입사일·작성일로 자동 계산' }, { value: 'manual', label: '날짜 직접 입력 (예외)' }]
      : kind === 'wageMode' ? [{ value: 'excel', label: '엑셀 기준 자동 계산' }, { value: 'manual', label: '임금 직접 입력 (예외)' }]
      : kind === 'wagePlan' ? [...WAGE_PLANS, ...(value[key] && !WAGE_PLANS.some(plan => plan.value === value[key]) ? [{ value: value[key], label: value[key] }] : [])] : null
    if (kind === 'wagePlan') return <div key={key} data-input-field={key} className="relative min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium"><span>{label}</span><WagePlanHelp/><Badge variant={value.wageMode === 'excel' ? 'default' : 'outline'}>{value.wageMode === 'excel' ? '자동 계산' : origin}</Badge></div>
      {value.wageMode === 'excel' ? <Input aria-label={label} readOnly value={WAGE_PLANS.find(plan => plan.value === value[key])?.label ?? ''} placeholder="연봉 입력 후 자동 적용" className="bg-muted/50"/> : <Select aria-label={label} disabled={disabled} className="w-full" value={value[key]} onChange={event => change(key, event.target.value)}><option value="">선택</option>{options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>}
    </div>
    return <label key={key} data-input-field={key} className={`block min-w-0 space-y-1.5${kind === 'textarea' ? ' sm:col-span-2' : ''}`}><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{label}{fieldUnit(key) ? <span className="text-xs font-normal text-muted-foreground">({fieldUnit(key)})</span> : null}<Badge variant={imported ? 'muted' : 'outline'}>{origin}</Badge></span>
      {kind === 'choice' ? <><Select className="w-full" aria-label={label + ' 목록'} disabled={disabled} value={customFields.includes(key) ? '__custom__' : value[key]} onChange={event => { if (event.target.value === '__custom__') setCustomFields(current => [...current, key]); else { setCustomFields(current => current.filter(item => item !== key)); change(key, event.target.value) } }}><option value="">선택</option>{rosterChoiceValues(choices.data?.settings.find(item => item.key === key as RosterChoiceKey)?.options ?? [], value[key]).map(option => <option key={option} value={option}>{option}</option>)}<option value="__custom__">직접 입력…</option></Select>{customFields.includes(key) ? <Input aria-label={label} disabled={disabled} value={value[key]} placeholder="직접 입력" onChange={event => change(key, event.target.value)} maxLength={80}/> : null}</>
      : options ? <Select aria-label={label} disabled={disabled} className="w-full" value={value[key]} onChange={event => change(key, event.target.value)}><option value="">선택</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
      : kind === 'textarea' ? <Textarea aria-label={label} disabled={disabled} value={value[key]} maxLength={500} rows={2} onChange={event => change(key, event.target.value)}/>
      : kind === 'money' ? <Input aria-label={label} disabled={disabled} type="text" inputMode="numeric" pattern="[0-9,]*" maxLength={200} className="tabular-nums" value={value[key].replace(/\B(?=(\d{3})+(?!\d))/g, ',')} onChange={event => {
        const control = event.currentTarget, raw = control.value, digits = raw.replace(/[,\s원]/g, '')
        if (!/^\d*$/.test(digits)) return
        const digitsBefore = raw.slice(0, control.selectionStart ?? raw.length).replace(/\D/g, '').length
        change(key, digits)
        // 중간 숫자를 고칠 때 쉼표가 생겨도 커서가 맨 끝으로 이동하지 않게 한다.
        requestAnimationFrame(() => {
          if (document.activeElement !== control) return
          let caret = 0, seen = 0
          while (caret < control.value.length && seen < digitsBefore) { if (/\d/.test(control.value[caret])) seen += 1; caret += 1 }
          control.setSelectionRange(caret, caret)
        })
      }}/>
      : <Input aria-label={label} disabled={disabled} value={value[key]} type={kind === 'number' || kind === 'months' ? 'number' : kind} min={kind === 'months' ? 1 : kind === 'number' ? 0 : undefined} max={kind === 'months' ? 1200 : key === 'payDay' ? 31 : key === 'probationPayRate' ? 100 : undefined} step={kind === 'months' ? 1 : kind === 'number' ? 'any' : undefined} maxLength={200} onChange={event => change(key, event.target.value)}/>}</label>
  }
  function output(key: FieldKey) {
    const automatic = (CALCULATED_PERIOD_KEYS as readonly string[]).includes(key) ? value.periodMode === 'auto' : value.wageMode === 'excel'
    const raw = key === 'contractEnd' && value.contractTerm === 'indefinite' ? '기간의 정함 없음' : key === 'wageEnd' && value.wageTerm === 'until-change' ? '변경 시까지' : (key === 'probationStart' || key === 'probationEnd') && value.probationApply === 'no' ? '미적용' : value[key]
    const display = raw && FIELDS[key][1] === 'money' && Number.isFinite(Number(raw)) ? `${Number(raw).toLocaleString('ko-KR')}원` : raw
    return <div key={key} className="min-w-0 rounded-lg border border-border bg-muted/50 p-3"><dt className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{FIELDS[key][0]}{fieldUnit(key) ? <span className="text-xs">({fieldUnit(key)})</span> : null}<Badge variant={automatic ? 'default' : 'outline'}>{automatic ? '자동 계산' : '직접 입력값'}</Badge></dt><dd className="mt-2"><output aria-label={FIELDS[key][0]} className="block font-semibold tabular-nums">{display || '입력 후 표시'}</output><span className="mt-1 block text-xs text-muted-foreground">{automatic ? FORMULAS[key] : '예외 설정에서 입력한 값'}</span></dd></div>
  }
  const grid = (keys: readonly FieldKey[]) => <div className="grid gap-4 sm:grid-cols-2">{keys.map(input)}</div>
  const periodSummary = value.periodMode === 'manual' ? '직접 입력한 계약기간 사용 중' : [value.contractTerm === 'indefinite' ? '근로계약 무기한' : `근로계약 ${value.contractMonths || '—'}개월`, value.wageTerm === 'until-change' ? '연봉계약 변경 시까지' : `연봉계약 ${value.wageMonths || '—'}개월`, value.probationApply === 'no' ? '수습 미적용' : `수습 ${value.probationMonths || '—'}개월`].join(' · ')
  return <dialog ref={dialog} aria-labelledby={title} onClose={onClose} onCancel={event => { if (busy) event.preventDefault() }} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-4xl overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/35 open:flex open:flex-col">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-5"><div><h3 id={title} className="font-semibold">{person.displayName || '신규 직원'} · 회사 입력정보</h3><p className="mt-1 text-xs text-muted-foreground">필요한 값만 입력하면 계약서와 임금 구성이 함께 채워집니다.</p></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>닫기</Button></div>
    <form ref={form} className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); if (canEdit && !busy) onApply(value) }}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs"><Badge variant="outline">직접 입력</Badge><span>흰 입력칸</span><Badge variant="muted">직원 배치에서 가져옴</Badge><span>기존값 확인·수정</span><Badge>자동 계산</Badge><span>아래 결과에서 확인</span></div>
        {canEdit && roster.isPending ? <p role="status" className="text-sm text-muted-foreground">직원 배치 정보 조회 중… 입력한 칸은 덮어쓰지 않습니다.</p> : null}
        {canEdit && roster.isError ? <p role="alert" className="text-sm text-danger">직원 배치 정보를 불러오지 못했습니다. <Button size="sm" variant="outline" type="button" onClick={() => void roster.refetch()}>다시 조회</Button></p> : null}
        {canEdit && choices.isError ? <p role="alert" className="text-sm text-danger">직원 배치 선택 목록 조회 실패 <Button size="sm" variant="outline" type="button" onClick={() => void choices.refetch()}>선택 목록 다시 조회</Button></p> : null}
        <fieldset className="min-w-0 rounded-xl border border-border p-4"><legend className="px-2 text-sm font-semibold">직원 배치·근무 조건</legend><p className="mb-4 text-xs text-muted-foreground">직원 배치와 같은 선택 목록입니다. 성명·생년월일·주소는 직원의 필수정보에서 서류로 연결됩니다.</p>{grid(['departmentId','position','jobGrade','hireDate','workplace','employmentType','jobDescription','workDays','workHours','breakTime','documentDate'])}</fieldset>
        <fieldset className="min-w-0 rounded-xl border border-border p-4"><legend className="px-2 text-sm font-semibold">임금 기준 입력</legend>{grid(['payBasis','fixedOvertimePlan','annualSalary','mealAllowance'])}<details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">추가 수당 입력</summary><div className="mt-4">{grid(['carAllowance','researchAllowance','childcareAllowance','dutyAllowance'])}</div></details><p className="mt-3 text-xs text-muted-foreground">추가 수당 빈칸은 0원으로 계산합니다. 근로유형은 월 급여에 따라 자동 적용되며, 기준은 옆의 ! 안내에서 확인할 수 있습니다.</p></fieldset>
        <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">계약기간·회사 공통값 확인 / 수정<span className="mt-1 block font-normal text-muted-foreground">{periodSummary}</span></summary><div className="mt-4 space-y-5">{grid(['contractTerm',...(value.contractTerm === 'fixed' ? ['contractMonths'] as const : []),'wageTerm',...(value.wageTerm === 'fixed' ? ['wageMonths'] as const : []),'probationApply',...(value.probationApply === 'yes' ? ['probationMonths'] as const : []),'probationPayRate','weeklyHoliday','payDay','employerName','representative','employerAddress'])}<p className="text-xs text-muted-foreground">계약 개월 수와 수습기간은 제공한 출력용 시트의 기본값입니다. 직원별 조건이 다르면 여기서 변경하세요.</p></div></details>
        <section aria-label="자동 반영 결과" className="rounded-xl border border-border p-4"><h4 className="font-semibold">자동 반영 결과</h4><p className="mb-4 mt-1 text-xs text-muted-foreground">입력값이 바뀌면 다시 계산됩니다. 결과 칸은 직접 입력하지 않습니다.</p><h5 className="mb-3 text-sm font-medium">계약서 날짜</h5><dl className="grid gap-3 sm:grid-cols-2">{CALCULATED_PERIOD_KEYS.map(output)}</dl><h5 className="mb-3 mt-5 text-sm font-medium">월 임금</h5><dl className="grid gap-3 sm:grid-cols-2">{(['monthlyWage','basePay','overtimeAllowance'] as const).map(output)}</dl>{calculation.error ? <p role="status" className="mt-3 text-sm text-warning">자동 계산 대기: {calculation.error}</p> : null}<details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">산정시간·나머지 수당 확인</summary><dl className="mt-4 grid gap-3 sm:grid-cols-2">{CALCULATED_WAGE_KEYS.filter(key => !['monthlyWage','basePay','overtimeAllowance'].includes(key)).map(output)}</dl>{calculation.actualOvertimeHours ? <p className="mt-3 text-xs text-muted-foreground">약정 실제 연장근로 월 약 {calculation.actualOvertimeHours}시간 · 1.5배 가산 산정 {value.overtimeHours}시간</p> : null}</details><p className="mt-4 text-xs text-muted-foreground">임금구성항목(2026) 기준: 세전 연봉·주 5일·실근무 8시간·월 기본 209시간. 야간·휴일·연차미사용수당은 현재 유형에 미반영입니다. 원 단위로 반올림하고 기본급에서 합계를 맞춥니다.</p></section>
        <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">예외 조건 직접 입력</summary><div className="mt-4 space-y-4">{grid(['periodMode','wageMode'])}{value.periodMode === 'manual' ? grid(CALCULATED_PERIOD_KEYS) : null}{value.wageMode === 'manual' ? grid(CALCULATED_WAGE_KEYS) : null}<details><summary className="cursor-pointer text-sm text-muted-foreground">시간 직접 지정·기타</summary><div className="mt-3">{grid(['workStart','workEnd','breakStart','breakEnd','employeeNumber'])}</div></details></div></details>
        <p className="text-xs text-muted-foreground">저장하면 회사 입력정보와 해당 직원의 배치·근무·급여 항목에 반영됩니다. 가입 승인·거절은 신규직원 목록의 승인여부 → 관리에서 처리합니다.</p>
      </div>
      <div className="shrink-0 space-y-2 border-t border-border bg-card p-4">{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" variant="outline" disabled={busy || !canEdit}>회사정보 저장</Button></div></div>
    </form>
  </dialog>
}
