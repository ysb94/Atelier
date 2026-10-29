import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DraftSampleWorkOrder } from '@/lib/types'
import { sampleElapsedDays, sampleHistoryDay, sampleTripSpanDays } from '@/lib/drafts/sample-work-order'
import { canReceiveSample, sampleCountry, sampleReadyForNextStage } from '@/lib/drafts/sample-receipt'
import { colorSampleLabel, sampleOrderLabel } from '@/lib/drafts/sample-registration'
import './draft-sample-progress.css'

type WorkOrderFile = { url: string; name: string }
type Props = {
  orders: readonly Pick<DraftSampleWorkOrder, 'id' | 'round' | 'url' | 'name' | 'originCountry' | 'shippedAt' | 'returnedAt' | 'receivedAt' | 'shipped' | 'passed' | 'sampleStage'>[]
  kind?: 'sample' | 'color'
  /** 다음 단계 목록이 이미 아래에 있으면 경과·다음샘플을 샘플 줄처럼 붙여 둔다. */
  joined?: boolean
  originCountry: string
  readOnly?: boolean
  saving?: boolean
  onReceive: (id: string) => Promise<void>
  onNext?: (file: WorkOrderFile, country: string) => Promise<void>
  onOpen?: () => void
}

export function DraftSampleProgress({ orders, kind = 'sample', joined = false, originCountry, readOnly = false, saving = false, onReceive, onOpen }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const list = orders.filter(order => order.url?.trim()).slice().sort((a, b) => a.round - b.round)
  const latest = list.at(-1)

  async function run(action: () => Promise<void>) {
    if (readOnly || saving || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try { await action() }
    catch (cause) {
      console.warn('[drafts] 샘플 수령·검토 상태 저장 실패', cause)
      setError(cause instanceof Error ? cause.message : '샘플 상태를 저장하지 못했습니다.')
    } finally { pending.current = false; setBusy(false) }
  }

  return <div className={`draft-sample-progress${joined ? ' is-joined' : ''}`} aria-label={kind === 'color' ? '컬러샘플 등록·수령 이력' : '샘플 등록·수령 이력'}>
    {list.map(order => {
      const country = sampleCountry(order.originCountry || originCountry)
      const registered = order.receivedAt ? sampleTripSpanDays(order.shippedAt, order.receivedAt) : sampleElapsedDays(order.shippedAt)
      const received = sampleElapsedDays(order.receivedAt ?? null)
      const current = order.id === latest?.id
      const label = kind === 'color' ? colorSampleLabel(order.round) : sampleOrderLabel(order, list)
      return <section key={order.id} aria-label={label} className="draft-sample-round">
        <div className="draft-sample-route">
          <div className="draft-sample-heading">
            <span className="draft-sample-country" title={country.label}>{country.code}<span aria-hidden="true"> | </span></span>
            <a href={order.url!} download={order.name} title="작업지시서 내려받기">{label} {sampleHistoryDay(order.shippedAt).slice(2) || '등록일 기록 없음'}</a>
            {registered !== null && <span className="draft-sample-registered-elapsed" title={order.receivedAt ? '작업지시서 등록부터 실물 수령까지 걸린 일수' : '작업지시서 등록 후 경과일'}>({registered}일{order.receivedAt ? '' : ' 경과'})</span>}
          </div>
          {!order.receivedAt && <p className="draft-sample-dispatch">{country.code === 'CN'
            ? order.shipped ? `${sampleHistoryDay(order.returnedAt).slice(2) || '날짜 기록 없음'} 중국 발송 완료` : '중국팀 제작·발송 대기'
            : '국내 샘플'}</p>}
          {current && !order.passed && !order.receivedAt && <Button type="button" size="sm" variant="outline" className="draft-sample-receive" disabled={readOnly || saving || busy || !canReceiveSample(order, originCountry)}
            title="실물을 받은 뒤 수령일을 기록하세요." onClick={() => void run(() => onReceive(order.id))}>{busy ? '저장 중' : '수령 확인'}</Button>}
        </div>
        {current && !joined ? <div className="draft-sample-interval">
          {order.receivedAt ? <>
            {received !== null && <strong className="draft-sample-received-elapsed" title={`수령일 ${sampleHistoryDay(order.receivedAt)}`}>+ {received} days</strong>}
            {sampleReadyForNextStage(order) && <div className="draft-sample-next-actions">
              <Button type="button" size="sm" variant="outline" onClick={onOpen}>다음샘플</Button>
            </div>}
          </> : <><span className="draft-sample-waiting">{order.passed ? '이전 기록 · 수령일 기록 없음' : '실물 수령 대기'}</span>{sampleReadyForNextStage(order) && <Button type="button" size="sm" variant="outline" onClick={onOpen}>다음샘플</Button>}</>}
        </div> : null}
      </section>
    })}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>
}
