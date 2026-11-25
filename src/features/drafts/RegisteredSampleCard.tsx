import { SampleDestinationSelect } from './SampleDestinationSelect'
import type { SampleWorkOrderFile } from './SampleWorkOrderFileField'
import { SampleWorkOrderPackField } from './SampleWorkOrderPackField'

/** N차·최종·컬러샘플의 저장된 작업지시서를 동일하게 표시한다. */
export function RegisteredSampleCard({ draftId, id, label, status, country, url, name, locked, readOnly = false, saving = false, onRegister, onCountry }: {
  draftId: string | null
  id: string; label: string; status: string; country: string; url: string | null; name: string
  locked: boolean; readOnly?: boolean; saving?: boolean
  onRegister?: (file: SampleWorkOrderFile) => Promise<void>
  onCountry?: (country: string) => void
}) {
  const disabled = readOnly || locked || saving
  return <section id={`sample-history-${id}`} aria-label={`등록된 ${label}`} className="mt-2 scroll-mt-20 border-t border-border pt-5">
    <p className="text-center"><span className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">{label} {status}</span></p>
    <SampleWorkOrderPackField draftId={draftId} slot={`edit:${id}`} label={label} savedFile={url ? { url, name } : null}
      readOnly={readOnly || locked} saving={saving} onRegister={onRegister} side={<div>
        <SampleDestinationSelect label={`${label} 샘플 진행처`} value={country} disabled={disabled || !onCountry}
          onChange={value => onCountry?.(value)} />
        <p className="mt-1 text-xs text-muted-foreground">CHINA (김웅사장님)의 지시서는 중국팀에 전달됩니다. 다른 진행처는 기획안에 기록됩니다.</p>
      </div>} />
  </section>
}
