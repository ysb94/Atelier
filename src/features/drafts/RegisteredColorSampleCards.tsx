import type { DraftColorSampleRound } from '@/lib/types'
import { sampleCountry } from '@/lib/drafts/sample-receipt'
import { sampleHistoryDay } from '@/lib/drafts/sample-work-order'
import { colorSampleLabel } from '@/lib/drafts/sample-registration'
import { useRenderWatch } from '@/lib/diagnostics'

/** Reads the same saved rounds as the planning list and China work orders. */
export function RegisteredColorSampleCards({ rounds, originCountry }: { rounds: readonly DraftColorSampleRound[]; originCountry: string }) {
  useRenderWatch('RegisteredColorSampleCards')
  return <>{rounds.map(round => {
    const country = sampleCountry(round.originCountry || originCountry)
    const label = colorSampleLabel(round.round)
    return <section key={round.id} id={`sample-history-${round.id}`} aria-label={`등록된 ${label}`} className="mt-2 scroll-mt-20 border-t border-border pt-5">
      <p className="text-center"><span className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">{label} {round.returnedAt ? '발송' : '진행'}</span></p>
      <p className="mt-4 text-center text-sm text-muted-foreground">{label} 작업지시서</p>
      <div className="mt-4 grid items-center gap-4 sm:grid-cols-[240px_minmax(0,1fr)]">
        <div className="rounded-lg border border-border px-3 py-2 text-sm">제조국 · {country.label}</div>
        <div className="flex min-h-16 items-center justify-center rounded-xl border border-dashed border-border px-4 py-5 text-sm"><a href={round.url} download={round.name} className="max-w-full truncate underline-offset-2 hover:underline">{round.name || `${label} 작업지시서`}</a></div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">등록 {sampleHistoryDay(round.shippedAt) || '기록 없음'} · {country.code === 'CN' ? round.returnedAt ? `중국팀 발송 ${sampleHistoryDay(round.returnedAt)}` : '중국팀 제작·발송 대기' : '국내 샘플 기록'}</p>
    </section>
  })}</>
}
