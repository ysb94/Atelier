import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { draftPriceError, type DraftPriceRequest } from '@/lib/supabase/draft-price-requests'
import { formatNumber } from '@/lib/utils'

export type DraftPriceControls = {
  latest?: DraftPriceRequest
  reply?: DraftPriceRequest
  loading: boolean
  error: string
  retry: () => void
  request: () => Promise<unknown>
}

const replyDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
})

export function DraftPriceRequestButton({ readOnly, hasColors, missingColors, controls }: {
  readOnly: boolean
  hasColors: boolean
  missingColors: string[]
  controls?: DraftPriceControls
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useWorkspaceTabActivity()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const latest = controls?.latest
  const reply = controls?.reply
  const amounts = reply?.amounts
  const waiting = Boolean(latest && !latest.answeredAt)
  const ready = hasColors && missingColors.length === 0
  const canSend = Boolean(controls && ready && !readOnly && !waiting && !controls.loading && !controls.error)
  const visible = open && active && (!readOnly || Boolean(latest))

  useEffect(() => {
    if (!visible) return
    const current = dialog.current
    current?.showModal()
    return () => current?.close()
  }, [visible])

  async function send() {
    if (!controls || !canSend || busy) return
    setBusy(true)
    setError('')
    try {
      await controls.request()
    } catch (cause) {
      setError(draftPriceError(cause, '단가요청을 저장하지 못했습니다. 요청 상태를 확인하고 다시 시도해 주세요.'))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Button type="button" size="sm" variant={ready && !waiting && !readOnly ? 'default' : 'outline'} className="h-7 px-2.5"
      disabled={readOnly && !latest} aria-haspopup="dialog" onClick={() => { setError(''); setOpen(true) }}>
      {waiting ? '단가 회신 대기' : reply ? '단가 확인' : '단가 요청'}
    </Button>
    {visible && createPortal(
      <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) setOpen(false) }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl border border-border bg-card p-5 text-left text-card-foreground shadow-xl backdrop:bg-black/40">
        <h2 id={titleId} className="font-semibold">{latest ? `${latest.draftNo} 단가요청` : '단가 요청'}</h2>
        {waiting && <p role="status" className="mt-2 text-sm text-muted-foreground">{latest?.round}차 요청이 접수되어 중국팀 회신을 기다리고 있습니다.</p>}
        {reply?.answeredAt && amounts && <div className="mt-3 rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-medium">{reply.round}차 회신 단가</p>
          <time dateTime={reply.answeredAt} className="text-xs text-muted-foreground">{replyDate.format(new Date(reply.answeredAt))} 회신</time>
          <dl className="mt-1 divide-y divide-border">
            {reply.colors.map(color => <div key={color.id} className="flex justify-between gap-3 py-1.5">
              <dt className="min-w-0 break-words">{color.name}</dt>
              <dd className="shrink-0 font-medium tabular-nums">¥{formatNumber(amounts[color.id])}</dd>
            </div>)}
          </dl>
        </div>}
        {!waiting && !readOnly && <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          {!hasColors ? <p>컬러를 먼저 추가해 주세요.</p> : missingColors.length > 0 ? <>
            <p className="break-words text-danger">미등록 컬러 · {missingColors.join(', ')}</p>
            <p>컬러 문서에서 사진을 첨부하거나 None을 선택해 저장해 주세요.</p>
          </> : <p>등록된 컬러의 단가를 중국팀에 {latest ? '다시 ' : ''}요청합니다.</p>}
        </div>}
        {controls?.loading && <p role="status" className="mt-2 text-sm text-muted-foreground">단가요청을 불러오는 중입니다.</p>}
        {controls?.error && <p role="alert" className="mt-2 text-sm text-danger">{controls.error}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>닫기</Button>
          {controls?.error && <Button type="button" size="sm" variant="outline" onClick={controls.retry}>다시 조회</Button>}
          {canSend && <Button type="button" size="sm" disabled={busy} onClick={() => void send()}>
            {busy ? '요청 저장 중' : latest ? '단가 재요청 보내기' : '단가 요청 보내기'}
          </Button>}
        </div>
      </dialog>, document.body,
    )}
  </>
}
