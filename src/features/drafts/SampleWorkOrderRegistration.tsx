import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SampleDestinationSelect } from './SampleDestinationSelect'
import { SampleWorkOrderFileField, type SampleWorkOrderFile } from './SampleWorkOrderFileField'
import { isSampleDestination } from '@/lib/drafts/sample-receipt'
import { nextRegistrationStages, sampleRegistrationLabel, type SampleRegistrationStage } from '@/lib/drafts/sample-registration'

export function SampleWorkOrderRegistration({ originCountry, nextRound, nextColorRound = 1, latestIsFinal = false, finalCount = 0, readOnly, saving, onRegister }: {
  originCountry: string; nextRound: number; nextColorRound?: number; latestIsFinal?: boolean; finalCount?: number; readOnly: boolean; saving: boolean
  onRegister: (stage: SampleRegistrationStage, file: SampleWorkOrderFile, country: string) => Promise<void>
}) {
  const countryTouched = useRef(false)
  const [country, setCountry] = useState(originCountry)
  const stages = nextRegistrationStages(latestIsFinal)
  const [stage, setStage] = useState<SampleRegistrationStage>(stages[0])
  useEffect(() => {
    const available = nextRegistrationStages(latestIsFinal)
    setStage((current) => (available.includes(current) ? current : available[0]))
  }, [latestIsFinal])
  const [registered, setRegistered] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!countryTouched.current) setCountry(originCountry) }, [originCountry])
  const label = sampleRegistrationLabel(stage, nextRound, finalCount, nextColorRound)
  const disabled = readOnly || saving || busy

  async function register(file: SampleWorkOrderFile) {
    if (!isSampleDestination(country)) throw new Error('샘플 진행처를 선택해 주세요.')
    setRegistered(null)
    setBusy(true)
    try {
      await onRegister(stage, file, country)
      setRegistered(label)
    } finally {
      setBusy(false)
    }
  }

  return <div className="mt-2 border-t border-border pt-5" aria-label="다음 샘플 작업지시서 등록">
    <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="다음 샘플 단계">
      {stages.map(value => <Button key={value} type="button" role="radio" size="sm" disabled={disabled} aria-checked={stage === value} variant={stage === value ? 'default' : 'outline'} onClick={() => { setStage(value); setRegistered(null) }}>{sampleRegistrationLabel(value, nextRound, finalCount, nextColorRound)} 진행</Button>)}
    </div>
    <SampleWorkOrderFileField label={label} readOnly={readOnly} saving={saving} onRegister={register}
      side={<SampleDestinationSelect label="다음 샘플 진행처" value={country} disabled={disabled} onChange={value => {
        countryTouched.current = true; setCountry(value); setRegistered(null)
      }} />} />
    {registered && <p role="status" className="mt-2 text-sm text-success">{registered} 등록 완료 · 샘플 이력에 추가했습니다.</p>}
  </div>
}
