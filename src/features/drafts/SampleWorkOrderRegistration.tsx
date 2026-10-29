import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { readFileAsDataUrl } from '@/lib/images'
import { sampleCountry } from '@/lib/drafts/sample-receipt'
import { nextRegistrationStages, sampleRegistrationLabel, type SampleRegistrationStage } from '@/lib/drafts/sample-registration'

type WorkOrderFile = { url: string; name: string }

export function SampleWorkOrderRegistration({ originCountry, nextRound, latestIsFinal = false, finalCount = 0, readOnly, saving, onRegister }: {
  originCountry: string; nextRound: number; latestIsFinal?: boolean; finalCount?: number; readOnly: boolean; saving: boolean
  onRegister: (stage: SampleRegistrationStage, file: WorkOrderFile, country: string) => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const countryTouched = useRef(false)
  const pending = useRef(false)
  const [country, setCountry] = useState(sampleCountry(originCountry).label)
  const stages = nextRegistrationStages(latestIsFinal)
  const [stage, setStage] = useState<SampleRegistrationStage>(stages[0])
  useEffect(() => {
    const available = nextRegistrationStages(latestIsFinal)
    setStage((current) => (available.includes(current) ? current : available[0]))
  }, [latestIsFinal])
  const [file, setFile] = useState<WorkOrderFile | null>(null)
  const [registered, setRegistered] = useState<(WorkOrderFile & { label: string }) | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (!countryTouched.current) setCountry(sampleCountry(originCountry).label) }, [originCountry])
  const label = sampleRegistrationLabel(stage, nextRound, finalCount)
  const shown = file ?? registered
  const disabled = readOnly || saving || busy || reading

  async function register() {
    if (disabled || pending.current) return
    if (!file) { setError('작업지시서 파일을 먼저 선택해 주세요.'); return }
    if (!['CN','KO'].includes(sampleCountry(country).code)) { setError('제조국을 선택해 주세요.'); return }
    pending.current = true; setBusy(true); setError('')
    try { await onRegister(stage, file, country); setRegistered({ ...file, label }); setFile(null) }
    catch (cause) { console.warn('[drafts] 샘플 단계 작업지시서 등록 실패', cause); setError(cause instanceof Error ? cause.message : '작업지시서를 등록하지 못했습니다. 다시 시도해 주세요.') }
    finally { pending.current = false; setBusy(false) }
  }

  return <div className="mt-2 border-t border-border pt-5" aria-label="다음 샘플 작업지시서 등록">
    <input ref={fileRef} type="file" aria-label="다음 샘플 작업지시서 파일" accept=".pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx" className="hidden" disabled={disabled} onChange={async event => {
      const selected = event.target.files?.[0]; event.target.value = ''
      if (!selected || disabled) return
      setError(''); setRegistered(null); setFile(null)
      if (selected.size > 8 * 1024 * 1024) { setError('작업지시서는 8MB 이하만 올릴 수 있습니다.'); return }
      setFile(null); setReading(true)
      try { setFile({ url: await readFileAsDataUrl(selected), name: selected.name }) }
      catch (cause) { console.warn('[drafts] 다음 샘플 파일 읽기 실패', cause); setError('작업지시서를 불러오지 못했습니다.') }
      finally { setReading(false) }
    }} />
    <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="다음 샘플 단계">
      {stages.map(value => <Button key={value} type="button" role="radio" size="sm" disabled={disabled} aria-checked={stage === value} variant={stage === value ? 'default' : 'outline'} onClick={() => { setStage(value); setError('') }}>{sampleRegistrationLabel(value, nextRound, finalCount)} 진행</Button>)}
    </div>
    <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <span /><p className="text-sm text-muted-foreground">{label} 작업지시서 업로드</p>
      <div className="flex flex-wrap justify-end gap-2 justify-self-end">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => fileRef.current?.click()}><Upload className="size-3.5" />{reading ? '읽는 중' : '올리기'}</Button>
        <Button type="button" size="sm" disabled={disabled || !file} onClick={() => void register()}>{busy ? '등록 중...' : '등록'}</Button>
      </div>
    </div>
    <div className="mt-4 grid items-center gap-4 sm:grid-cols-[240px_minmax(0,1fr)]">
      <Select aria-label="다음 샘플 제조국" className="h-11" value={country} disabled={disabled} onChange={event => { countryTouched.current = true; setCountry(event.target.value); setError('') }}>
        <option value="국가 미정">제조국 선택</option><option value="중국">중국</option><option value="한국">한국</option>
      </Select>
      <div className="flex min-h-16 items-center justify-center rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
        {shown ? <a href={shown.url} download={shown.name} className="max-w-full truncate text-foreground underline-offset-2 hover:underline">{shown.name}</a> : '올린 파일이 없습니다.'}
      </div>
    </div>
    {file && <p className="mt-2 text-xs text-muted-foreground">파일을 선택했습니다. 등록을 눌러야 샘플 이력에 추가됩니다.</p>}
    {registered && !file && <p role="status" className="mt-2 text-sm text-success">{registered.label} 등록 완료 · 샘플 이력에 추가했습니다.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
  </div>
}
