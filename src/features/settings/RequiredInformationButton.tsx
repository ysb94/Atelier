import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { RELEASE_COMPANY_ID, RELEASE_EXCEPTION_IDS } from '@/lib/company/release-access'

const DOCUMENTS = [
  ['identity', '신분증 사본'], ['bank', '통장 사본'], ['education', '학력 증명서'],
] as const
type DocumentKind = typeof DOCUMENTS[number][0]
const EMPTY_FILES: Record<DocumentKind, string> = { identity: '', bank: '', education: '' }
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>
}
function EmailField({ label, name, domain, defaultValue = '' }: { label: string; name: string; domain: string; defaultValue?: string }) {
  const id = useId()
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <div className="flex min-w-0 items-center gap-2">
      <Input id={id} name={name} required inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254} pattern={'[A-Za-z0-9._%+\\-]{1,64}'} placeholder="아이디" defaultValue={defaultValue} aria-describedby={`${id}-domain`} className="min-w-0 flex-1" onChange={event => {
        const input = event.currentTarget
        const value = input.value.trim()
        input.value = value.toLowerCase().endsWith(`@${domain}`) ? value.slice(0, -(domain.length + 1)) : value
      }} />
      <span id={`${id}-domain`} className="shrink-0 text-sm text-muted-foreground">@{domain}</span>
    </div>
  </div>
}
function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, value.startsWith('02') ? 10 : 11)
  const prefix = digits.startsWith('02') ? 2 : 3
  if (digits.length <= prefix) return digits
  if (digits.length <= prefix + 4) return `${digits.slice(0, prefix)}-${digits.slice(prefix)}`
  const middle = digits.length > prefix + 7 ? 4 : 3
  return `${digits.slice(0, prefix)}-${digits.slice(prefix, prefix + middle)}-${digits.slice(prefix + middle)}`
}

/** 개발자 전용 입력 시안. 값·파일은 현재 창에서만 사용하고 닫을 때 정리한다. */
export function RequiredInformationButton() {
  const { profile, session } = useAuth()
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const fileInputs = useRef<Partial<Record<DocumentKind, HTMLInputElement | null>>>({})
  const titleId = useId()
  const descriptionId = useId()
  const [bank, setBank] = useState('')
  const [showResidentNumber, setShowResidentNumber] = useState(false)
  const [files, setFiles] = useState(EMPTY_FILES)
  const [fileErrors, setFileErrors] = useState(EMPTY_FILES)
  const [review, setReview] = useState<[string, string][] | null>(null)
  const resetForm = useCallback(() => {
    form.current?.reset(); setBank(''); setShowResidentNumber(false)
    setFiles(EMPTY_FILES); setFileErrors(EMPTY_FILES); setReview(null)
  }, [])
  const visible = profile?.status === 'active' && profile.companyId === RELEASE_COMPANY_ID
    && profile.id === RELEASE_EXCEPTION_IDS[0] && session?.user.id === profile.id
  useEffect(() => { if (!visible) dialog.current?.close(); resetForm() }, [visible, profile?.id, session?.user.id, resetForm])
  useEffect(() => { scroll.current?.scrollTo(0, 0) }, [review])
  if (!visible) return null
  return <>
    <Button type="button" className="h-11 px-7 text-base font-semibold shadow-md" onClick={() => { dialog.current?.showModal(); scroll.current?.scrollTo(0, 0) }}><FileText className="size-4" aria-hidden="true" />필수정보 입력</Button>
    <dialog ref={dialog} onClose={resetForm} aria-labelledby={titleId} aria-describedby={descriptionId} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/35">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 id={titleId} className="text-lg font-semibold">필수정보 입력</h2><p className="mt-1 text-xs text-muted-foreground">근로자 명부 · 입사정보</p></div><Button type="button" size="icon" variant="ghost" autoFocus aria-label="필수정보 입력 닫기" onClick={() => dialog.current?.close()}><X className="size-4" /></Button></div>
      <form ref={form} key={profile.id} autoComplete="off" onSubmit={event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const text = (key: string) => String(data.get(key) ?? '').trim()
        setReview([
          ['영문명', text('englishName')],
          ['주민등록번호', `${text('residentFront')}-*******`], ['연락처', text('phone')], ['현 거주지', `${text('address')} ${text('addressDetail')}`.trim()],
          ['G메일', `${text('gmail')}@gmail.com`], ['네이버메일', `${text('naverEmail')}@naver.com`], ['은행', bank === 'other' ? text('bankOther') : bank],
          ['예금주', text('accountHolder')], ['계좌번호', text('accountNumber').replace(/.(?=.{4})/g, '•')],
          ...DOCUMENTS.map(([key, label]): [string, string] => [label, files[key]]),
        ])
        setShowResidentNumber(false)
      }}>
        <div ref={scroll} className="max-h-[calc(90dvh_-_10rem)] space-y-5 overflow-y-auto p-5">
          <p id={descriptionId} className="rounded-md bg-muted p-3 text-sm text-muted-foreground">화면 시안입니다. 테스트용 값·파일로 확인해 주세요. 서버에 전송하거나 저장하지 않으며, 창을 닫거나 새로고침하면 입력 내용이 초기화됩니다.</p>
          <div hidden={review !== null} className="space-y-5">
            <fieldset className="min-w-0 rounded-xl border border-border p-4"><legend className="px-2 text-sm font-semibold">기본 정보·연락처</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="영문명 *"><Input name="englishName" required maxLength={100} placeholder="여권 등 공식 영문명" /></Field>
                <div className="space-y-1.5"><span className="text-sm font-medium">주민등록번호 *</span><div className="flex items-center gap-2"><Input aria-label="주민등록번호 앞 6자리" name="residentFront" inputMode="numeric" required pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="앞 6자리" /><span aria-hidden="true">-</span><Input aria-label="주민등록번호 뒤 7자리" name="residentBack" type={showResidentNumber ? 'text' : 'password'} inputMode="numeric" required pattern="[0-9]{7}" minLength={7} maxLength={7} placeholder="뒤 7자리" /><Button type="button" size="icon" variant="ghost" aria-label={showResidentNumber ? '주민번호 숨기기' : '주민번호 보기'} onClick={() => setShowResidentNumber(value => !value)}>{showResidentNumber ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button></div></div>
                <Field label="연락처 *"><Input name="phone" type="tel" inputMode="tel" required maxLength={20} placeholder="010-0000-0000" onChange={event => {
                  const input = event.currentTarget
                  const before = input.value
                  const caret = input.selectionStart ?? before.length
                  const digitsBeforeCaret = before.slice(0, caret).replace(/\D/g, '').length
                  input.value = formatPhone(before)
                  if (input.value !== before) {
                    let position = 0, digits = 0
                    while (position < input.value.length && digits < digitsBeforeCaret) if (/\d/.test(input.value[position++])) digits++
                    input.setSelectionRange(position, position)
                  }
                }} /></Field>
                <EmailField label="G메일 *" name="gmail" domain="gmail.com" defaultValue={profile.email.toLowerCase().endsWith('@gmail.com') ? profile.email.slice(0, -10) : ''} />
                <EmailField label="네이버메일 *" name="naverEmail" domain="naver.com" />
                <div className="grid gap-3 sm:col-span-2"><Field label="현 거주지 *"><Input name="address" required maxLength={200} placeholder="도로명 또는 지번 주소" /></Field><Field label="상세주소"><Input name="addressDetail" maxLength={100} placeholder="동·호수 등 상세주소" /></Field></div>
              </div>
            </fieldset>
            <fieldset className="min-w-0 rounded-xl border border-border p-4"><legend className="px-2 text-sm font-semibold">급여 지급 정보</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="은행 *"><Select name="bank" aria-label="은행" required className="w-full" value={bank} onChange={event => setBank(event.target.value)}><option value="">은행 선택</option>{['KB국민은행','신한은행','우리은행','하나은행','IBK기업은행','NH농협은행','SC제일은행','한국씨티은행','카카오뱅크','토스뱅크','케이뱅크','우체국'].map(name => <option key={name}>{name}</option>)}<option value="other">기타 · 직접 입력</option></Select></Field>
                <Field label="예금주 *"><Input name="accountHolder" required defaultValue={profile.displayName || ''} maxLength={100} placeholder="본인 명의 예금주" /></Field>
                {bank === 'other' && <Field label="은행명 직접 입력 *"><Input name="bankOther" required maxLength={50} /></Field>}
                <div className="sm:col-span-2"><Field label="계좌번호 *"><Input name="accountNumber" required inputMode="numeric" maxLength={40} placeholder="통장에 표시된 계좌번호" /></Field></div>
              </div>
            </fieldset>
            <fieldset className="min-w-0 rounded-xl border border-border p-4"><legend className="px-2 text-sm font-semibold">제출 서류</legend><p className="mb-4 text-xs text-muted-foreground">PDF·JPG·PNG 파일을 선택할 수 있습니다. 선택한 파일은 업로드되지 않습니다.</p>
              <div className="space-y-4">{DOCUMENTS.map(([key, label]) => <div key={key} className="rounded-lg border border-border p-3"><label className="block space-y-2"><span className="text-sm font-medium">{label} *</span><Input ref={element => { fileInputs.current[key] = element }} name={key} type="file" required accept=".pdf,.jpg,.jpeg,.png" className="h-auto py-2" aria-invalid={Boolean(fileErrors[key])} onChange={event => {
                const file = event.target.files?.[0]
                const error = file && !/\.(pdf|jpe?g|png)$/i.test(file.name) ? 'PDF·JPG·PNG 파일을 선택해 주세요.' : ''
                if (error) event.target.value = ''
                setFileErrors(current => ({ ...current, [key]: error })); setFiles(current => ({ ...current, [key]: error ? '' : file?.name || '' }))
              }} /></label>{fileErrors[key] && <p role="alert" className="mt-2 text-xs text-danger">{fileErrors[key]}</p>}{files[key] && <div className="mt-2 flex items-center justify-between gap-2"><span className="min-w-0 break-all text-xs text-muted-foreground">선택: {files[key]}</span><Button type="button" variant="ghost" size="sm" aria-label={`${label} 파일 지우기`} onClick={() => { const input = fileInputs.current[key]; if (input) input.value = ''; setFiles(current => ({ ...current, [key]: '' })) }}>지우기</Button></div>}</div>)}</div>
            </fieldset>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1 accent-primary" />위 입력 내용이 틀림없음을 확인합니다.</label>
          </div>
          {review && <section aria-label="입력 내용 확인" className="space-y-4"><h3 className="font-semibold">입력 내용 확인</h3><p className="text-sm text-muted-foreground">주민번호와 계좌번호 일부는 가려서 표시합니다. 현재 내용은 실제로 제출되지 않습니다.</p><dl className="divide-y divide-border rounded-xl border border-border px-4">{review.map(([label, value]) => <div key={label} className="grid gap-1 py-3 text-sm sm:grid-cols-[150px_1fr]"><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value || '미입력'}</dd></div>)}</dl></section>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-card p-4">
          <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>닫기</Button>
          {review ? <Button type="button" onClick={() => setReview(null)}>수정하기</Button> : <Button type="submit">입력 내용 확인</Button>}
        </div>
      </form>
    </dialog>
  </>
}
