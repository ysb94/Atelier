import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { readFileAsDataUrl } from '@/lib/images'
import type { DraftSampleWorkOrder } from '@/lib/types'
import { sampleElapsedDays, sampleHistoryDay } from '@/lib/drafts/sample-work-order'
import { canReceiveSample, sampleCountry } from '@/lib/drafts/sample-receipt'

type WorkOrderFile = { url: string; name: string }
type Props = {
  orders: readonly DraftSampleWorkOrder[]
  originCountry: string
  readOnly?: boolean
  saving?: boolean
  onReceive: (id: string) => Promise<void>
  onNext: (file: WorkOrderFile, country: string) => Promise<void>
  onPass: () => Promise<void>
}

export function DraftSampleProgress({ orders, originCountry, readOnly = false, saving = false, onReceive, onNext, onPass }: Props) {
  const [nextOpen, setNextOpen] = useState(false)
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

  return <div className="space-y-3" aria-label="샘플 등록·수령 이력">
    {list.map(order => {
      const country = sampleCountry(order.originCountry || originCountry)
      const registered = sampleElapsedDays(order.shippedAt)
      const received = sampleElapsedDays(order.receivedAt ?? null)
      const current = order.id === latest?.id
      return <section key={order.id} aria-label={`${order.round}차 샘플`} className="border-b border-border py-3 last:border-b-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold text-primary" title={country.label}>{country.code}</span>
          <strong>{order.round}차 샘플</strong>
          <span title="작업지시서 등록일">{sampleHistoryDay(order.shippedAt).slice(2) || '등록일 기록 없음'}</span>
          {registered !== null && <span className={order.receivedAt ? 'text-xs text-muted-foreground' : 'text-primary'}>등록 후 {registered}일</span>}
          <a href={order.url!} download={order.name} className="text-xs text-muted-foreground underline">작업지시서</a>
        </div>
        {country.code === 'CN' && <p className="mt-1 text-xs text-muted-foreground">{order.shipped ? `${sampleHistoryDay(order.returnedAt).slice(2) || '날짜 기록 없음'} 중국 발송 완료` : '중국팀 제작·발송 대기'}</p>}
        {order.receivedAt ? <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs text-muted-foreground">수령일 {sampleHistoryDay(order.receivedAt).slice(2)}</span>
          {received !== null && <strong className="text-base text-primary">수령 후 {received}일</strong>}
        </div> : <p className="mt-2 text-xs text-muted-foreground">{order.passed ? '이전 기록 · 수령일 기록 없음' : '실물 수령 대기'}</p>}
        {order.passed && <p className="mt-2 text-sm font-medium text-primary">샘플 합격</p>}
        {current && !order.passed && <div className="mt-3 flex flex-wrap gap-2">
          {!order.receivedAt ? <Button type="button" size="sm" variant="outline" disabled={readOnly || saving || busy || !canReceiveSample(order, originCountry)}
            title="실물을 받은 뒤 확인하세요. 수령 확인은 합격 처리가 아닙니다." onClick={() => void run(() => onReceive(order.id))}>{busy ? '저장 중' : '수령 확인'}</Button>
            : <><Button type="button" size="sm" variant="outline" disabled={readOnly || saving || busy} onClick={() => { setError(''); setNextOpen(true) }}>{order.round + 1}차 작업지시서 작성</Button>
              <Button type="button" size="sm" variant="outline" disabled={readOnly || saving || busy} onClick={() => void run(onPass)}>샘플 합격</Button></>}
        </div>}
      </section>
    })}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {nextOpen && latest?.receivedAt && !latest.passed && !readOnly && <NextSampleDialog round={latest.round + 1} originCountry={originCountry} onClose={() => setNextOpen(false)} onRegister={async (file, country) => { await onNext(file, country); setNextOpen(false) }} />}
  </div>
}

function NextSampleDialog({ round, originCountry, onClose, onRegister }: {
  round: number; originCountry: string; onClose: () => void
  onRegister: (file: WorkOrderFile, country: string) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = useRef(false)
  const [country, setCountry] = useState(sampleCountry(originCountry).label)
  const [file, setFile] = useState<WorkOrderFile | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  return createPortal(<dialog ref={dialog} aria-labelledby="next-sample-title" className="m-auto w-[min(40rem,calc(100vw-2rem))] max-h-[85vh] overflow-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm backdrop:bg-black/50"
    onCancel={event => { event.preventDefault(); if (!pending.current) onClose() }}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (pending.current || reading) return
      if (!file) { setError('새 작업지시서 파일을 선택해 주세요.'); return }
      if (!['한국','중국'].includes(country)) { setError('제조국을 선택해 주세요.'); return }
      pending.current = true; setBusy(true); setError('')
      try { await onRegister(file, country) }
      catch (cause) { console.warn('[drafts] 다음 샘플 작업지시서 등록 실패', cause); setError(cause instanceof Error ? cause.message : '등록하지 못했습니다. 다시 시도해 주세요.') }
      finally { pending.current = false; setBusy(false) }
    }}>
      <h2 id="next-sample-title" className="text-lg font-semibold">{round}차 작업지시서 작성</h2>
      <p className="mt-2 text-sm text-muted-foreground">샘플 회의 후 작성한 작업지시서를 올려 등록하세요. 등록 전에는 차수가 추가되거나 중국팀에 전달되지 않습니다.</p>
      <label className="mt-5 block text-sm">제조국<Select aria-label="제조국" className="mt-1 w-full" value={country} disabled={busy} onChange={event => setCountry(event.target.value)}>
        <option value="국가 미정">제조국 선택</option><option value="한국">한국</option><option value="중국">중국</option>
      </Select></label>
      <label className="mt-4 block text-sm">작업지시서 파일<Input type="file" className="mt-1 w-full" accept=".pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx" disabled={busy || reading} onChange={async event => {
        const selected = event.target.files?.[0]; event.target.value = ''; setFile(null); setError('')
        if (!selected) return
        if (selected.size > 8 * 1024 * 1024) { setError('작업지시서는 8MB 이하만 올릴 수 있습니다.'); return }
        setReading(true)
        try { setFile({ url: await readFileAsDataUrl(selected), name: selected.name }) }
        catch (cause) { console.warn('[drafts] 다음 샘플 파일 읽기 실패', cause); setError('파일을 읽지 못했습니다. 다시 선택해 주세요.') }
        finally { setReading(false) }
      }} /></label>
      {file && <p className="mt-2 break-all text-sm">선택한 파일: {file.name}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>취소</Button>
        <Button type="submit" disabled={busy || reading}>{busy ? '등록 중' : `${round}차 작업지시서 등록`}</Button></div>
    </form>
  </dialog>, document.body)
}
