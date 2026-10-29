import type { DraftColorSampleRound } from '@/lib/types'
import { DraftSampleProgress } from './DraftSampleProgress'

/** 대표·최종 샘플과 같은 등록/발송/수령/다음 단계 UI를 사용한다. */
export function DraftColorSampleProgress({ rounds, originCountry, readOnly, saving, onReceive, onOpen }: {
  rounds: readonly DraftColorSampleRound[]
  originCountry: string
  readOnly?: boolean
  saving?: boolean
  onReceive: (id: string) => Promise<void>
  onOpen?: () => void
}) {
  return <DraftSampleProgress kind="color" orders={rounds.map(round => ({ ...round, shipped: Boolean(round.returnedAt) }))}
    originCountry={originCountry} readOnly={readOnly} saving={saving} onReceive={onReceive} onOpen={onOpen} />
}
