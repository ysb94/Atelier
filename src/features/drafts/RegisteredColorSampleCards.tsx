import type { DraftColorSampleRound } from '@/lib/types'
import { colorSampleLabel } from '@/lib/drafts/sample-registration'
import { useRenderWatch } from '@/lib/diagnostics'
import { RegisteredSampleCard } from './RegisteredSampleCard'

/** Reads the same saved rounds as the planning list and China work orders. */
export function RegisteredColorSampleCards({ rounds, originCountry, readOnly, saving, onUpload, onCountry }: {
  rounds: readonly DraftColorSampleRound[]; originCountry: string; readOnly?: boolean; saving?: boolean
  onUpload?: (id: string, file: File) => void; onCountry?: (id: string, country: string) => void
}) {
  useRenderWatch('RegisteredColorSampleCards')
  return <>{rounds.map(round => {
    const label = colorSampleLabel(round.round)
    return <RegisteredSampleCard key={round.id} id={round.id} label={label} status={round.receivedAt ? '수령' : round.returnedAt ? '발송' : '진행'}
      country={round.originCountry || originCountry} url={round.url} name={round.name || `${label} 작업지시서`}
      locked={Boolean(round.id !== rounds.at(-1)?.id || round.returnedAt || round.receivedAt || round.passed)} readOnly={readOnly} saving={saving}
      onUpload={onUpload ? file => onUpload(round.id, file) : undefined} onCountry={onCountry ? country => onCountry(round.id, country) : undefined} />
  })}</>
}
