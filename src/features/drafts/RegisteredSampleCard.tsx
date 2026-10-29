import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { DRAFT_ORIGIN_OPTIONS } from '@/lib/types'

/** N차·최종·컬러샘플의 저장된 작업지시서를 동일하게 표시한다. */
export function RegisteredSampleCard({ id, label, status, country, url, name, locked, readOnly = false, saving = false, onUpload, onCountry }: {
  id: string; label: string; status: string; country: string; url: string | null; name: string
  locked: boolean; readOnly?: boolean; saving?: boolean
  onUpload?: (file: File) => void
  onCountry?: (country: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const countryValue = (DRAFT_ORIGIN_OPTIONS as readonly string[]).includes(country) ? country : ''
  const disabled = readOnly || locked || saving
  return <section id={`sample-history-${id}`} aria-label={`등록된 ${label}`} className="mt-2 scroll-mt-20 border-t border-border pt-5">
    <input ref={fileRef} type="file" aria-label={`${label} 작업지시서 파일`} accept=".pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx" className="hidden" disabled={disabled || !onUpload} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''
      if (file && !disabled) onUpload?.(file)
    }} />
    <p className="text-center"><span className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">{label} {status}</span></p>
    <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <span /><p className="text-sm text-muted-foreground">{label} 작업지시서 업로드</p>
      <div className="justify-self-end"><Button type="button" variant="outline" size="sm" disabled={disabled || !onUpload} onClick={() => fileRef.current?.click()}><Upload className="size-3.5" />올리기</Button></div>
    </div>
    <div className="mt-4 grid items-center gap-4 sm:grid-cols-[240px_minmax(0,1fr)]">
      <div>
        <Select aria-label={`${label} 제조국`} className="h-11" value={countryValue} disabled={disabled || !onCountry} onChange={event => onCountry?.(event.target.value)}>
          <option value="" disabled>제조국 선택</option>{DRAFT_ORIGIN_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">중국은 중국팀으로 전달되고, 한국은 전송하지 않고 기록만 남습니다.</p>
      </div>
      <div className="flex min-h-16 items-center justify-center rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
        {url ? <a href={url} download={name} className="max-w-full truncate text-foreground underline-offset-2 hover:underline">{name}</a> : '올린 파일이 없습니다.'}
      </div>
    </div>
  </section>
}
